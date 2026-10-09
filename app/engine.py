"""Paper-trading engine: accounts, orders, positions, stops, liquidation, snapshots, leaderboard.

Model (kept deliberately close to how a crypto/CFD exchange behaves, so the lessons transfer):

* Every position is its own trade with ISOLATED margin: margin = notional / leverage.
* `cash` only changes when a trade closes (realised P&L) or a fee is paid.
* equity     = cash + unrealised P&L
* available  = cash - margin in open positions - margin reserved by pending limit orders
  (unrealised profit is NOT spendable, which is the conservative choice).
* Market orders fill at the last price. Limit orders fill when the price touches them.
  Stop-losses fill at the price seen when they trigger (so gaps cost you).
  Take-profits fill at the target. Liquidation fills at the liquidation price.
* Fees: taker rate for market/stop/liquidation, maker rate for limit/take-profit.
"""
from __future__ import annotations

import threading
import time
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import settings
from .db import Order, Snapshot, Trade, User
from .markets import MARKETS, Market, floor_to_step
from .prices import PriceHub
from .risk import (check_stop_side, fee_usd, liq_price, notional_usd, pnl_usd,
                   risk_at_stop, size_position)
from .stats import max_drawdown_pct

# One lock serialises every mutation, so the price-tick loop and API calls never interleave.
LOCK = threading.RLock()


class TradeError(Exception):
    """A user-facing problem with a trade request (shown verbatim in the UI)."""


def today_utc() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _fmt(m: Market, price: float) -> str:
    return f"{price:,.{m.decimals}f}"


def split_tags(raw: str) -> list[str]:
    return [t for t in (raw or "").split(",") if t]


def join_tags(tags: list[str]) -> str:
    clean: list[str] = []
    for t in tags[:8]:
        t = t.strip().replace(",", " ")[:24]
        if t and t not in clean:
            clean.append(t)
    return ",".join(clean)


class Engine:
    def __init__(self, hub: PriceHub):
        self.hub = hub

    # ------------------------------------------------------------------ views
    def trade_view(self, t: Trade, price: float | None = None) -> dict:
        m = MARKETS[t.symbol]
        base = {
            "id": t.id, "symbol": t.symbol, "side": t.side, "qty": t.qty, "leverage": t.leverage,
            "entry": t.entry_price, "margin": t.margin, "liq": t.liq_price,
            "sl": t.sl, "tp": t.tp, "opened_at": t.opened_at, "entry_type": t.entry_type,
            "notional": notional_usd(m, t.entry_price, t.qty), "fee_open": t.fee_open,
            "initial_risk": t.initial_risk, "status": t.status,
            "note": t.note, "setup": t.setup, "tags": split_tags(t.tags),
            "emotion": t.emotion, "rating": t.rating, "lesson": t.lesson,
        }
        if t.status == "open":
            p = price if price is not None else t.entry_price
            upnl = pnl_usd(m, t.side, t.entry_price, p, t.qty)
            base.update({
                "price": p, "upnl": upnl,
                "upnl_pct": upnl / t.margin * 100 if t.margin else 0.0,
                "r_now": upnl / t.initial_risk if t.initial_risk else None,
                "liq_distance_pct": abs(p - t.liq_price) / p * 100 if p else None,
            })
        else:
            if t.side == "long":
                mfe = (t.peak_price - t.entry_price) / t.entry_price * 100
                mae = (t.entry_price - t.trough_price) / t.entry_price * 100
            else:
                mfe = (t.entry_price - t.trough_price) / t.entry_price * 100
                mae = (t.peak_price - t.entry_price) / t.entry_price * 100
            base.update({
                "exit": t.exit_price, "closed_at": t.closed_at, "reason": t.close_reason,
                "fee_close": t.fee_close, "gross_pnl": t.gross_pnl, "pnl": t.pnl,
                "r": t.r_multiple, "mfe_pct": max(mfe, 0.0), "mae_pct": max(mae, 0.0),
            })
        return base

    @staticmethod
    def order_view(o: Order) -> dict:
        return {
            "id": o.id, "symbol": o.symbol, "side": o.side, "qty": o.qty, "leverage": o.leverage,
            "limit_price": o.limit_price, "sl": o.sl, "tp": o.tp, "reserved": o.reserved,
            "created_at": o.created_at,
        }

    # ------------------------------------------------------------------ account
    def _open_trades(self, db: Session, user: User) -> list[Trade]:
        return list(db.scalars(select(Trade).where(
            Trade.user_id == user.id, Trade.status == "open")))

    def _pending_orders(self, db: Session, user: User) -> list[Order]:
        return list(db.scalars(select(Order).where(
            Order.user_id == user.id, Order.status == "pending")))

    def _upnl(self, t: Trade) -> float:
        q = self.hub.last(t.symbol)
        price = q.price if q else t.entry_price
        return pnl_usd(MARKETS[t.symbol], t.side, t.entry_price, price, t.qty)

    def equity(self, db: Session, user: User) -> float:
        return user.cash + sum(self._upnl(t) for t in self._open_trades(db, user))

    def state(self, db: Session, user: User) -> dict:
        trades = self._open_trades(db, user)
        orders = self._pending_orders(db, user)
        positions = []
        upnl = 0.0
        for t in trades:
            q = self.hub.last(t.symbol)
            view = self.trade_view(t, q.price if q else None)
            upnl += view["upnl"]
            positions.append(view)
        margin_used = sum(t.margin for t in trades)
        reserved = sum(o.reserved for o in orders)
        equity = user.cash + upnl
        self._roll_day(db, user, equity)
        day_pnl = equity - user.day_start_equity
        limit_pct = user.daily_loss_pct
        locked = bool(limit_pct > 0 and day_pnl <= -user.day_start_equity * limit_pct / 100)
        return {
            "cash": user.cash, "equity": equity, "unrealized": upnl,
            "margin_used": margin_used, "reserved": reserved,
            "available": user.cash - margin_used - reserved,
            "start_balance": user.start_balance, "season": user.season,
            "return_pct": (equity / user.start_balance - 1) * 100,
            "day_pnl": day_pnl, "day_start_equity": user.day_start_equity, "locked": locked,
            "positions": positions, "orders": [self.order_view(o) for o in orders],
        }

    def _roll_day(self, db: Session, user: User, equity: float) -> None:
        today = today_utc()
        if user.day_start_date != today:
            user.day_start_date = today
            user.day_start_equity = equity
            db.commit()

    def snapshot(self, db: Session, user: User, equity: float | None = None) -> None:
        eq = self.equity(db, user) if equity is None else equity
        db.add(Snapshot(user_id=user.id, season=user.season, ts=time.time(), equity=eq))

    # ------------------------------------------------------------------ opening
    def _check_stops(self, m: Market, side: str, ref: float, sl: float | None,
                     tp: float | None, leverage: int) -> None:
        err = check_stop_side(side, ref, sl, tp)
        if err:
            raise TradeError(err)
        if sl is not None:
            liq = liq_price(m, side, ref, leverage)
            if (side == "long" and sl <= liq) or (side == "short" and sl >= liq):
                raise TradeError(
                    f"Your stop-loss is beyond the liquidation price ({_fmt(m, liq)}). At "
                    f"{leverage}x you would be liquidated first. Use a tighter stop or lower leverage.")

    def place_order(self, db: Session, user: User, req) -> dict:
        m = MARKETS.get(req.symbol)
        if m is None:
            raise TradeError("Unknown market.")
        q = self.hub.fresh(m.id)
        if q is None:
            raise TradeError(f"{m.name} is closed or its price feed is unavailable right now.")
        st = self.state(db, user)
        if st["equity"] <= 0:
            raise TradeError("Your account balance is empty. Reset the account to start again.")
        if st["locked"]:
            raise TradeError("Daily loss limit reached: new trades are locked until 00:00 UTC. "
                             "You can still close positions.")
        if len(st["positions"]) + len(st["orders"]) >= settings.max_open_positions:
            raise TradeError(f"You can have at most {settings.max_open_positions} open positions "
                             f"and orders at once.")

        lev = req.leverage
        cap = min(user.max_leverage, m.max_leverage)
        if lev > cap:
            raise TradeError(f"Max leverage for {m.name} is {cap}x "
                             f"(market limit {m.max_leverage}x, your setting {user.max_leverage}x).")

        is_limit = req.type == "limit"
        if is_limit:
            if req.limit_price is None:
                raise TradeError("Enter a limit price.")
            if req.side == "long" and req.limit_price >= q.price:
                raise TradeError(f"A buy limit must be below the current price "
                                 f"({_fmt(m, q.price)}). Use a market order to buy now.")
            if req.side == "short" and req.limit_price <= q.price:
                raise TradeError(f"A sell limit must be above the current price "
                                 f"({_fmt(m, q.price)}). Use a market order to sell now.")
            ref = req.limit_price
        else:
            ref = q.price

        sl, tp = req.sl, req.tp
        self._check_stops(m, req.side, ref, sl, tp, lev)
        if user.require_sl and sl is None:
            raise TradeError("Your risk settings require a stop-loss on every trade.")

        if req.qty is not None:
            qty = req.qty
        elif req.risk_pct is not None and sl is not None:
            qty = size_position(m, req.side, st["equity"], req.risk_pct, ref, sl, lev)["qty"]
        else:
            raise TradeError("Enter a size, or a risk % together with a stop-loss.")
        qty = floor_to_step(qty, m.qty_step)
        if qty < m.min_qty:
            raise TradeError(f"Size is too small. The minimum for {m.name} is "
                             f"{m.min_qty:g} {m.qty_label}.")

        notional = notional_usd(m, ref, qty)
        margin = notional / lev
        fee = fee_usd(m, ref, qty, m.maker_rate if is_limit else m.fee_rate)

        if sl is not None:
            risk = risk_at_stop(m, req.side, ref, sl, qty)
            risk_pct = risk / st["equity"] * 100
            if risk_pct > user.max_risk_pct + 1e-9:
                raise TradeError(
                    f"This trade risks {risk_pct:.1f}% of your equity if the stop hits, above your "
                    f"{user.max_risk_pct:g}% limit. Reduce the size or tighten the stop.")

        if margin + fee > st["available"] + 1e-9:
            raise TradeError(f"Not enough free margin: this needs ${margin + fee:,.2f} but you have "
                             f"${max(st['available'], 0):,.2f}. Lower the size or raise the leverage.")

        tags = join_tags(req.tags)
        if is_limit:
            order = Order(
                user_id=user.id, season=user.season, symbol=m.id, side=req.side, qty=qty,
                leverage=lev, limit_price=req.limit_price, sl=sl, tp=tp, reserved=margin + fee,
                created_at=time.time(), note=req.note, setup=req.setup, tags=tags)
            db.add(order)
            db.commit()
            return {"kind": "order", "id": order.id}

        trade = self._open_trade(db, user, m, req.side, qty, lev, q.price, sl, tp,
                                 "market", req.note, req.setup, tags)
        return {"kind": "position", "id": trade.id}

    def _open_trade(self, db: Session, user: User, m: Market, side: str, qty: float, lev: int,
                    price: float, sl: float | None, tp: float | None, entry_type: str,
                    note: str, setup: str, tags: str) -> Trade:
        notional = notional_usd(m, price, qty)
        fee = notional * (m.maker_rate if entry_type == "limit" else m.fee_rate)
        user.cash -= fee
        trade = Trade(
            user_id=user.id, season=user.season, symbol=m.id, side=side, qty=qty, leverage=lev,
            entry_price=price, margin=notional / lev, liq_price=liq_price(m, side, price, lev),
            entry_type=entry_type, sl=sl, tp=tp, initial_sl=sl,
            initial_risk=abs(pnl_usd(m, side, price, sl, qty)) if sl is not None else None,
            fee_open=fee, opened_at=time.time(), peak_price=price, trough_price=price,
            status="open", note=note, setup=setup, tags=tags)
        db.add(trade)
        db.commit()
        return trade

    # ------------------------------------------------------------------ editing / closing
    def _get_trade(self, db: Session, user: User, trade_id: int, status: str | None = None) -> Trade:
        t = db.get(Trade, trade_id)
        if t is None or t.user_id != user.id or (status and t.status != status):
            raise TradeError("Trade not found.")
        return t

    def set_stops(self, db: Session, user: User, trade_id: int, sl: float | None,
                  tp: float | None) -> Trade:
        t = self._get_trade(db, user, trade_id, "open")
        m = MARKETS[t.symbol]
        q = self.hub.fresh(t.symbol)
        if q is None:
            raise TradeError(f"{m.name} is closed or its price feed is unavailable right now.")
        err = check_stop_side(t.side, q.price, sl, tp)
        if err:
            raise TradeError(err.replace("entry price", "current price"))
        if sl is not None and ((t.side == "long" and sl <= t.liq_price) or
                               (t.side == "short" and sl >= t.liq_price)):
            raise TradeError(f"Your stop-loss is beyond the liquidation price ({_fmt(m, t.liq_price)}).")
        t.sl, t.tp = sl, tp
        if sl is not None and t.initial_risk is None:
            # First stop on a trade opened without one: this defines "1R" for the journal.
            t.initial_sl = sl
            t.initial_risk = abs(pnl_usd(m, t.side, t.entry_price, sl, t.qty))
        db.commit()
        return t

    def close_trade(self, db: Session, user: User, trade_id: int) -> Trade:
        t = self._get_trade(db, user, trade_id, "open")
        q = self.hub.fresh(t.symbol)
        if q is None:
            raise TradeError(f"{MARKETS[t.symbol].name} is closed or its price feed is "
                             f"unavailable, so it can't be closed right now.")
        self._close(db, user, t, q.price, "manual")
        return t

    def _close(self, db: Session, user: User, t: Trade, price: float, reason: str,
               maker: bool = False) -> None:
        m = MARKETS[t.symbol]
        fee = fee_usd(m, price, t.qty, m.maker_rate if maker else m.fee_rate)
        gross = pnl_usd(m, t.side, t.entry_price, price, t.qty)
        t.status = "closed"
        t.exit_price = price
        t.closed_at = time.time()
        t.close_reason = reason
        t.fee_close = fee
        t.gross_pnl = gross
        t.pnl = gross - t.fee_open - fee
        t.r_multiple = t.pnl / t.initial_risk if t.initial_risk else None
        user.cash += gross - fee
        if -1e-6 < user.cash < 0:
            user.cash = 0.0
        db.flush()
        self.snapshot(db, user)
        db.commit()

    def cancel_order(self, db: Session, user: User, order_id: int) -> None:
        o = db.get(Order, order_id)
        if o is None or o.user_id != user.id or o.status != "pending":
            raise TradeError("Order not found.")
        o.status = "cancelled"
        o.closed_at = time.time()
        db.commit()

    def update_journal(self, db: Session, user: User, trade_id: int, data: dict) -> Trade:
        t = self._get_trade(db, user, trade_id)
        for key in ("note", "setup", "emotion", "lesson"):
            if key in data and data[key] is not None:
                setattr(t, key, data[key])
        if "tags" in data and data["tags"] is not None:
            t.tags = join_tags(data["tags"])
        if "rating" in data:
            t.rating = data["rating"]
        db.commit()
        return t

    def update_settings(self, db: Session, user: User, data: dict) -> None:
        if "require_sl" in data:
            user.require_sl = bool(data["require_sl"])
        if "max_leverage" in data:
            user.max_leverage = int(data["max_leverage"])
        if "max_risk_pct" in data:
            user.max_risk_pct = float(data["max_risk_pct"])
        if "daily_loss_pct" in data:
            user.daily_loss_pct = float(data["daily_loss_pct"])
        db.commit()

    def reset_account(self, db: Session, user: User) -> None:
        for t in self._open_trades(db, user):
            q = self.hub.last(t.symbol)
            self._close(db, user, t, q.price if q else t.entry_price, "reset")
        for o in self._pending_orders(db, user):
            o.status = "cancelled"
            o.closed_at = time.time()
        user.season += 1
        user.season_started_at = time.time()
        user.cash = user.start_balance
        user.day_start_equity = user.start_balance
        user.day_start_date = today_utc()
        db.flush()
        self.snapshot(db, user, user.start_balance)
        db.commit()

    # ------------------------------------------------------------------ price ticks
    def process_tick(self, db: Session) -> int:
        """Fill limit orders, fire stops/targets, liquidate. Returns how many events happened."""
        events = 0
        orders = list(db.scalars(select(Order).where(Order.status == "pending")))
        for o in orders:
            q = self.hub.fresh(o.symbol)
            if q is None:
                continue
            touched = q.price <= o.limit_price if o.side == "long" else q.price >= o.limit_price
            if not touched:
                continue
            user = db.get(User, o.user_id)
            m = MARKETS[o.symbol]
            self._open_trade(db, user, m, o.side, o.qty, o.leverage, o.limit_price, o.sl, o.tp,
                             "limit", o.note, o.setup, o.tags)
            o.status = "filled"
            o.closed_at = time.time()
            db.commit()
            events += 1

        dirty = False
        for t in list(db.scalars(select(Trade).where(Trade.status == "open"))):
            q = self.hub.fresh(t.symbol)
            if q is None:
                continue
            p = q.price
            if p > t.peak_price:
                t.peak_price, dirty = p, True
            if p < t.trough_price:
                t.trough_price, dirty = p, True
            long_ = t.side == "long"
            user = db.get(User, t.user_id)
            if (long_ and p <= t.liq_price) or (not long_ and p >= t.liq_price):
                self._close(db, user, t, t.liq_price, "liquidation")
            elif t.sl is not None and ((long_ and p <= t.sl) or (not long_ and p >= t.sl)):
                self._close(db, user, t, p, "sl")
            elif t.tp is not None and ((long_ and p >= t.tp) or (not long_ and p <= t.tp)):
                self._close(db, user, t, t.tp, "tp", maker=True)
            else:
                continue
            events += 1
            dirty = False
        if dirty:
            db.commit()
        return events

    # ------------------------------------------------------------------ housekeeping
    def housekeeping(self, db: Session) -> None:
        """Every minute: roll the daily-loss baseline at 00:00 UTC and sample equity."""
        open_by_user: dict[int, list[Trade]] = {}
        for t in db.scalars(select(Trade).where(Trade.status == "open")):
            open_by_user.setdefault(t.user_id, []).append(t)
        now = time.time()
        today = today_utc()
        for user in db.scalars(select(User)):
            trades = open_by_user.get(user.id, [])
            equity = user.cash + sum(self._upnl(t) for t in trades)
            if user.day_start_date != today:
                user.day_start_date = today
                user.day_start_equity = equity
            last = db.scalar(select(Snapshot).where(
                Snapshot.user_id == user.id, Snapshot.season == user.season
            ).order_by(Snapshot.ts.desc()).limit(1))
            if last is None or abs(last.equity - equity) > 0.01 or now - last.ts > 3600:
                db.add(Snapshot(user_id=user.id, season=user.season, ts=now, equity=equity))
        db.commit()

    # ------------------------------------------------------------------ leaderboard
    def leaderboard(self, db: Session, period: str) -> list[dict]:
        days = {"7d": 7, "30d": 30}.get(period)
        cutoff = time.time() - days * 86400 if days else None
        open_by_user: dict[int, list[Trade]] = {}
        for t in db.scalars(select(Trade).where(Trade.status == "open")):
            open_by_user.setdefault(t.user_id, []).append(t)

        rows: list[dict] = []
        for user in db.scalars(select(User)):
            closed = list(db.scalars(select(Trade).where(
                Trade.user_id == user.id, Trade.season == user.season, Trade.status == "closed")))
            if len(closed) < settings.min_trades_leaderboard:
                continue
            if cutoff is not None and not any(t.closed_at and t.closed_at >= cutoff for t in closed):
                continue
            equity = user.cash + sum(self._upnl(t) for t in open_by_user.get(user.id, []))
            if cutoff is None:
                base = user.start_balance
            else:
                snap = db.scalar(select(Snapshot).where(
                    Snapshot.user_id == user.id, Snapshot.season == user.season,
                    Snapshot.ts <= cutoff).order_by(Snapshot.ts.desc()).limit(1))
                base = snap.equity if snap else user.start_balance
            wins = sum(1 for t in closed if t.pnl > 0)
            rows.append({
                "username": user.username, "equity": equity,
                "return_pct": (equity / base - 1) * 100 if base > 0 else 0.0,
                "trades": len(closed), "win_rate": wins / len(closed) * 100,
                "_uid": user.id, "_season": user.season,
            })
        rows.sort(key=lambda r: r["return_pct"], reverse=True)
        rows = rows[:50]
        for i, r in enumerate(rows, 1):
            uid, season = r.pop("_uid"), r.pop("_season")
            snaps = [s.equity for s in db.scalars(select(Snapshot).where(
                Snapshot.user_id == uid, Snapshot.season == season).order_by(Snapshot.ts))]
            r["max_drawdown_pct"] = max_drawdown_pct(snaps)
            r["rank"] = i
        return rows
