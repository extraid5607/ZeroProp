"""FastAPI application: JSON API, live price WebSocket, and the static website."""
from __future__ import annotations

import asyncio
import logging
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response, WebSocket, WebSocketDisconnect
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from . import auth
from .config import settings
from .db import SessionLocal, Snapshot, Trade, User, init_db
from .engine import LOCK, Engine, TradeError, today_utc
from .markets import MARKET_LIST, MARKETS, floor_to_step
from .prices import TF_SECONDS, PriceHub
from .risk import preview_position, size_position
from .schemas import Credentials, JournalReq, OrderReq, ResetReq, SettingsReq, StopsReq
from .stats import compute_stats

log = logging.getLogger("zeropaper")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

COOKIE = "zp_session"
STATIC_DIR = Path(__file__).resolve().parent.parent / "static"

hub = PriceHub()
engine = Engine(hub)
login_limiter = auth.RateLimiter(limit=10, window=300)
register_limiter = auth.RateLimiter(limit=5, window=3600)


# ----------------------------------------------------------------------- background loops
def _tick_sync() -> None:
    with LOCK, SessionLocal() as db:
        engine.process_tick(db)


def _housekeeping_sync() -> None:
    with LOCK, SessionLocal() as db:
        engine.housekeeping(db)
        auth.purge_expired(db)
    login_limiter.sweep()
    register_limiter.sweep()


async def _every(seconds: float, fn) -> None:
    while True:
        try:
            await asyncio.to_thread(fn)
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("background task %s failed", fn.__name__)
        await asyncio.sleep(seconds)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    await hub.start()
    tasks = [asyncio.create_task(_every(settings.tick_seconds, _tick_sync)),
             asyncio.create_task(_every(60, _housekeeping_sync))]
    log.info("%s started (price source: %s)", settings.app_name, settings.price_source)
    try:
        yield
    finally:
        for t in tasks:
            t.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        await hub.stop()


app = FastAPI(title=settings.app_name, lifespan=lifespan, docs_url=None, redoc_url=None)


# ----------------------------------------------------------------------- middleware
@app.middleware("http")
async def guard(request: Request, call_next):
    # State-changing API calls must carry this header. A cross-site form or <img> cannot add
    # custom headers, which (together with SameSite cookies) blocks CSRF.
    if request.method in ("POST", "PATCH", "PUT", "DELETE") and request.url.path.startswith("/api/"):
        if request.headers.get("x-requested-with") != "zeropaper":
            return JSONResponse({"detail": "Missing request header."}, status_code=403)
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "same-origin"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data:; font-src 'self'; connect-src 'self' ws: wss:; "
        "frame-ancestors 'none'; base-uri 'self'; form-action 'self'")
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    return response


@app.exception_handler(TradeError)
async def trade_error_handler(_request: Request, exc: TradeError):
    return JSONResponse({"detail": str(exc)}, status_code=400)


@app.exception_handler(RequestValidationError)
async def validation_error_handler(_request: Request, exc: RequestValidationError):
    # The default handler echoes the rejected input back, which crashes (500) on inf/NaN
    # and could reflect junk to the page. Return one short human-readable message instead.
    first = exc.errors()[0] if exc.errors() else {}
    loc = [str(p) for p in first.get("loc", ()) if p not in ("body", "query", "path")]
    field = loc[-1] if loc else "request"
    msg = str(first.get("msg", "invalid value"))[:120]
    return JSONResponse({"detail": f"Invalid {field}: {msg}"}, status_code=422)


@app.exception_handler(auth.AuthError)
async def auth_error_handler(_request: Request, exc: auth.AuthError):
    return JSONResponse({"detail": str(exc)}, status_code=400)


# ----------------------------------------------------------------------- dependencies
def get_db():
    with SessionLocal() as db:
        yield db


def optional_user(request: Request, db: Session = Depends(get_db)) -> User | None:
    return auth.user_for_token(db, request.cookies.get(COOKIE))


def current_user(user: User | None = Depends(optional_user)) -> User:
    if user is None:
        raise HTTPException(401, "Please log in.")
    return user


def _user_view(u: User) -> dict:
    return {
        "username": u.username, "season": u.season, "start_balance": u.start_balance,
        "settings": {"require_sl": u.require_sl, "max_leverage": u.max_leverage,
                     "max_risk_pct": u.max_risk_pct, "daily_loss_pct": u.daily_loss_pct},
    }


def _set_cookie(response: Response, token: str) -> None:
    response.set_cookie(COOKIE, token, max_age=settings.session_days * 86400, httponly=True,
                        samesite="lax", secure=settings.cookie_secure, path="/")


def _ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


# ----------------------------------------------------------------------- auth
@app.post("/api/auth/register")
def register(body: Credentials, request: Request, response: Response, db: Session = Depends(get_db)):
    if not register_limiter.allow(_ip(request)):
        raise HTTPException(429, "Too many sign-ups from this network. Try again later.")
    with LOCK:
        user = auth.create_user(db, body.username.strip(), body.password, today_utc())
        engine.snapshot(db, user, user.cash)
        db.commit()
    _set_cookie(response, auth.new_session(db, user.id))
    return {"user": _user_view(user)}


@app.post("/api/auth/login")
def login(body: Credentials, request: Request, response: Response, db: Session = Depends(get_db)):
    if not login_limiter.allow(f"{_ip(request)}|{body.username.lower()}"):
        raise HTTPException(429, "Too many attempts. Wait a few minutes and try again.")
    user = auth.authenticate(db, body.username.strip(), body.password)
    _set_cookie(response, auth.new_session(db, user.id))
    return {"user": _user_view(user)}


@app.post("/api/auth/logout")
def logout(request: Request, response: Response, db: Session = Depends(get_db)):
    auth.end_session(db, request.cookies.get(COOKIE))
    response.delete_cookie(COOKIE, path="/")
    return {"ok": True}


@app.get("/api/me")
def me(user: User | None = Depends(optional_user)):
    return {
        "app_name": settings.app_name,
        "demo": hub.demo,
        "user": _user_view(user) if user else None,
        "limits": {"max_open": settings.max_open_positions,
                   "min_trades_leaderboard": settings.min_trades_leaderboard},
    }


# ----------------------------------------------------------------------- market data
@app.get("/api/markets")
def markets():
    out = []
    for m in MARKET_LIST:
        d = m.public()
        q = hub.last(m.id)
        d["price"] = q.price if q else None
        d["change24h"] = q.change24h if q else None
        d["live"] = bool(hub.fresh(m.id))
        out.append(d)
    return {"markets": out}


@app.get("/api/prices")
def prices():
    return {"t": time.time(), "q": hub.snapshot()}


@app.get("/api/candles")
async def candles(symbol: str = Query(max_length=16), tf: str = "15m", limit: int = Query(300, ge=20, le=600)):
    if symbol not in MARKETS:
        raise HTTPException(404, "Unknown market.")
    if tf not in TF_SECONDS:
        raise HTTPException(400, "Unknown timeframe.")
    try:
        rows = await hub.candles(symbol, tf, limit)
    except Exception as exc:
        log.warning("candles %s %s failed: %s", symbol, tf, exc)
        raise HTTPException(503, "Chart data is unavailable right now. Try again in a moment.")
    return {"symbol": symbol, "tf": tf, "candles": rows}


@app.get("/api/health")
def health():
    return {"ok": True, "price_source": settings.price_source, "feeds": hub.status()}


@app.websocket("/ws/prices")
async def ws_prices(ws: WebSocket):
    await ws.accept()
    try:
        while True:
            await ws.send_json({"t": time.time(), "q": hub.snapshot()})
            await asyncio.sleep(1.0)
    except (WebSocketDisconnect, RuntimeError):
        pass


# ----------------------------------------------------------------------- trading
@app.get("/api/account")
def account(user: User = Depends(current_user), db: Session = Depends(get_db)):
    with LOCK:
        return engine.state(db, user)


@app.post("/api/orders")
def place_order(body: OrderReq, user: User = Depends(current_user), db: Session = Depends(get_db)):
    with LOCK:
        result = engine.place_order(db, user, body)
        return {"result": result, "account": engine.state(db, user)}


@app.delete("/api/orders/{order_id}")
def cancel_order(order_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    with LOCK:
        engine.cancel_order(db, user, order_id)
        return {"account": engine.state(db, user)}


@app.post("/api/trades/{trade_id}/close")
def close_trade(trade_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    with LOCK:
        t = engine.close_trade(db, user, trade_id)
        return {"trade": engine.trade_view(t), "account": engine.state(db, user)}


@app.patch("/api/trades/{trade_id}/stops")
def set_stops(trade_id: int, body: StopsReq, user: User = Depends(current_user),
              db: Session = Depends(get_db)):
    with LOCK:
        engine.set_stops(db, user, trade_id, body.sl, body.tp)
        return {"account": engine.state(db, user)}


@app.get("/api/trades")
def trades(limit: int = Query(50, ge=1, le=200), offset: int = Query(0, ge=0),
           user: User = Depends(current_user), db: Session = Depends(get_db)):
    where = (Trade.user_id == user.id, Trade.season == user.season, Trade.status == "closed")
    total = db.scalar(select(func.count()).select_from(Trade).where(*where)) or 0
    rows = db.scalars(select(Trade).where(*where).order_by(Trade.closed_at.desc())
                      .limit(limit).offset(offset))
    return {"total": total, "trades": [engine.trade_view(t) for t in rows]}


@app.patch("/api/trades/{trade_id}/journal")
def journal(trade_id: int, body: JournalReq, user: User = Depends(current_user),
            db: Session = Depends(get_db)):
    with LOCK:
        t = engine.update_journal(db, user, trade_id, body.model_dump(exclude_unset=True))
        return {"trade": engine.trade_view(t)}


@app.get("/api/stats")
def stats(period: str = Query("all", pattern="^(all|7d|30d)$"),
          user: User = Depends(current_user), db: Session = Depends(get_db)):
    cutoff = None
    if period != "all":
        cutoff = time.time() - {"7d": 7, "30d": 30}[period] * 86400
    q = select(Trade).where(Trade.user_id == user.id, Trade.season == user.season,
                            Trade.status == "closed")
    s = select(Snapshot).where(Snapshot.user_id == user.id, Snapshot.season == user.season)
    if cutoff is not None:
        q = q.where(Trade.closed_at >= cutoff)
        s = s.where(Snapshot.ts >= cutoff)
    closed = list(db.scalars(q))
    snaps = [(x.ts, x.equity) for x in db.scalars(s.order_by(Snapshot.ts))]
    # Always end the curve at "now", so it matches the equity shown in the header.
    with LOCK:
        snaps.append((time.time(), engine.equity(db, user)))
    return compute_stats(closed, snaps, user.start_balance)


@app.get("/api/risk/size")
def risk_size(symbol: str, side: str = Query(pattern="^(long|short)$"),
              leverage: int = Query(1, ge=1, le=100), entry: float | None = Query(None, gt=0),
              stop: float | None = Query(None, gt=0), tp: float | None = Query(None, gt=0),
              risk_pct: float | None = Query(None, gt=0, le=100),
              qty: float | None = Query(None, gt=0, lt=1e12),
              user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Order-ticket preview. Give `risk_pct` (+ `stop`) to size by risk, or `qty` to size directly."""
    m = MARKETS.get(symbol)
    if m is None:
        raise HTTPException(404, "Unknown market.")
    if (risk_pct is None) == (qty is None):
        raise HTTPException(400, "Give either risk_pct or qty.")
    if risk_pct is not None and stop is None:
        raise HTTPException(400, "Sizing by risk needs a stop-loss price.")
    ref = entry
    if ref is None:
        q = hub.last(symbol)
        if q is None:
            raise HTTPException(503, "No price yet for this market.")
        ref = q.price
    with LOCK:
        st = engine.state(db, user)
    try:
        if risk_pct is not None:
            out = size_position(m, side, st["equity"], risk_pct, ref, stop, leverage, tp,
                                available=st["available"], max_risk_pct=user.max_risk_pct)
        else:
            out = preview_position(m, side, st["equity"], ref, floor_to_step(qty, m.qty_step), leverage,
                                   stop, tp, available=st["available"], max_risk_pct=user.max_risk_pct)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    return out | {"entry": ref, "available": st["available"], "equity": st["equity"]}


@app.patch("/api/settings")
def update_settings(body: SettingsReq, user: User = Depends(current_user),
                    db: Session = Depends(get_db)):
    with LOCK:
        engine.update_settings(db, user, body.model_dump(exclude_unset=True))
    return {"user": _user_view(user)}


@app.post("/api/account/reset")
def reset_account(body: ResetReq, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if not body.confirm:
        raise HTTPException(400, "Confirm the reset.")
    with LOCK:
        engine.reset_account(db, user)
        return {"user": _user_view(user), "account": engine.state(db, user)}


@app.get("/api/leaderboard")
def leaderboard(period: str = Query("all", pattern="^(all|7d|30d)$"), db: Session = Depends(get_db)):
    with LOCK:
        return {"period": period, "rows": engine.leaderboard(db, period),
                "min_trades": settings.min_trades_leaderboard}


# The website itself (must be mounted last so it does not shadow the API routes).
app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
