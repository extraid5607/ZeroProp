"""Live price hub.

* Crypto (and gold/silver where an exchange lists them) come from CCXT.
* Forex, and gold/silver as a fallback, come from Yahoo Finance's public chart endpoint.
* PRICE_SOURCE=demo swaps everything for a simulated random-walk feed (for development).

Each market has an ordered list of sources. The hub uses the first one that is working and
automatically fails over to the next (e.g. Binance blocked on this host -> Bybit -> OKX).
"""
from __future__ import annotations

import asyncio
import logging
import math
import random
import time
from dataclasses import dataclass

import httpx

from .config import settings
from .markets import MARKET_LIST, MARKETS, Market

log = logging.getLogger("prices")

TF_SECONDS = {"1m": 60, "5m": 300, "15m": 900, "1h": 3600, "4h": 14400, "1d": 86400}
# Candle row: [time (epoch seconds), open, high, low, close, volume]
Candle = list


@dataclass
class Quote:
    price: float
    ts: float                      # when the price was observed (epoch seconds)
    change24h: float | None        # percent
    source: str
    bid: float | None = None
    ask: float | None = None


def aggregate(candles: list[Candle], seconds: int) -> list[Candle]:
    """Merge smaller candles into bigger ones (used to build 4h from Yahoo's 1h)."""
    out: list[Candle] = []
    for t, o, h, l, c, v in candles:
        bucket = int(t // seconds) * seconds
        if out and out[-1][0] == bucket:
            row = out[-1]
            row[2] = max(row[2], h)
            row[3] = min(row[3], l)
            row[4] = c
            row[5] += v
        else:
            out.append([bucket, o, h, l, c, v])
    return out


# --------------------------------------------------------------------------- CCXT
class CcxtFeed:
    def __init__(self) -> None:
        self._clients: dict[str, object] = {}
        self._locks: dict[str, asyncio.Lock] = {}

    async def _client(self, venue: str):
        import ccxt.async_support as ccxt_async

        ex = self._clients.get(venue)
        if ex is None:
            ex = getattr(ccxt_async, venue)({
                "enableRateLimit": True,
                "timeout": 10_000,
                "options": {"fetchCurrencies": False},
            })
            self._clients[venue] = ex
        if not ex.markets:
            lock = self._locks.setdefault(venue, asyncio.Lock())
            async with lock:
                if not ex.markets:
                    await ex.load_markets()
        return ex

    @staticmethod
    def _resolve(ex, candidates: tuple[str, ...]) -> str:
        for sym in candidates:
            if sym in ex.markets:
                return sym
        raise KeyError(f"{ex.id}: no market among {candidates}")

    async def quotes(self, venue: str, wanted: dict[str, tuple[str, ...]]) -> dict[str, Quote]:
        ex = await self._client(venue)
        resolved: dict[str, str] = {}
        for mid, candidates in wanted.items():
            try:
                resolved[mid] = self._resolve(ex, candidates)
            except KeyError:
                continue  # this market does not exist on this venue -> hub fails it over
        if not resolved:
            return {}
        data = await ex.fetch_tickers(list(resolved.values()))
        now = time.time()
        out: dict[str, Quote] = {}
        for mid, sym in resolved.items():
            t = data.get(sym)
            if not t:
                continue
            price = t.get("last") or t.get("close")
            if not price or price <= 0:
                continue
            ts = (t.get("timestamp") or 0) / 1000 or now
            out[mid] = Quote(price=float(price), ts=min(ts, now), source=venue,
                             change24h=t.get("percentage"), bid=t.get("bid"), ask=t.get("ask"))
        return out

    async def candles(self, venue: str, candidates: tuple[str, ...], tf: str, limit: int) -> list[Candle]:
        ex = await self._client(venue)
        sym = self._resolve(ex, candidates)
        rows = await ex.fetch_ohlcv(sym, tf, limit=limit)
        return [[r[0] / 1000, r[1], r[2], r[3], r[4], r[5] or 0] for r in rows if None not in r[:5]]

    async def close(self) -> None:
        for ex in self._clients.values():
            try:
                await ex.close()
            except Exception:  # pragma: no cover
                pass


# --------------------------------------------------------------------------- Yahoo
class YahooFeed:
    BASE = "https://query1.finance.yahoo.com/v8/finance/chart/"
    # (interval, range) per timeframe. Yahoo has no 4h bars, so those are built from 1h.
    RANGES = {"1m": ("1m", "1d"), "5m": ("5m", "5d"), "15m": ("15m", "5d"),
              "1h": ("60m", "1mo"), "4h": ("60m", "3mo"), "1d": ("1d", "1y")}

    def __init__(self) -> None:
        self._http = httpx.AsyncClient(
            timeout=10, follow_redirects=True,
            headers={"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                                   "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
                     "Accept": "application/json"},
        )
        self._gate = asyncio.Semaphore(3)

    async def _chart(self, symbol: str, interval: str, rng: str) -> dict:
        async with self._gate:
            r = await self._http.get(self.BASE + symbol, params={"interval": interval, "range": rng})
        r.raise_for_status()
        body = r.json()["chart"]
        if body.get("error") or not body.get("result"):
            raise RuntimeError(f"yahoo {symbol}: {body.get('error')}")
        return body["result"][0]

    async def quote(self, mid: str, symbol: str) -> Quote:
        res = await self._chart(symbol, "1m", "1d")
        meta = res["meta"]
        price = meta.get("regularMarketPrice")
        if not price:
            raise RuntimeError(f"yahoo {symbol}: no price")
        prev = meta.get("chartPreviousClose") or meta.get("previousClose")
        ts = float(meta.get("regularMarketTime") or time.time())
        return Quote(price=float(price), ts=min(ts, time.time()), source="yahoo",
                     change24h=((price / prev - 1) * 100) if prev else None)

    async def quotes(self, wanted: dict[str, str]) -> dict[str, Quote]:
        async def one(mid: str, sym: str):
            try:
                return mid, await self.quote(mid, sym)
            except Exception as exc:
                log.warning("yahoo %s failed: %s", sym, exc)
                return mid, None
        results = await asyncio.gather(*(one(m, s) for m, s in wanted.items()))
        return {mid: q for mid, q in results if q}

    async def candles(self, symbol: str, tf: str, limit: int) -> list[Candle]:
        interval, rng = self.RANGES[tf]
        res = await self._chart(symbol, interval, rng)
        stamps = res.get("timestamp") or []
        q = (res.get("indicators", {}).get("quote") or [{}])[0]
        rows: list[Candle] = []
        for i, t in enumerate(stamps):
            o, h, l, c = (q.get(k, [None] * len(stamps))[i] for k in ("open", "high", "low", "close"))
            if None in (o, h, l, c):
                continue
            v = (q.get("volume") or [0] * len(stamps))[i] or 0
            rows.append([float(t), o, h, l, c, v])
        if tf == "4h":
            rows = aggregate(rows, 14400)
        return rows[-limit:]

    async def close(self) -> None:
        await self._http.aclose()


# --------------------------------------------------------------------------- Demo
class DemoFeed:
    """Simulated prices: a mean-reverting random walk. Used when PRICE_SOURCE=demo."""
    SPEED = 25  # simulated seconds per real second, so price moves are visible

    def __init__(self) -> None:
        self.rng = random.Random(7)
        self.prices = {m.id: m.base_price for m in MARKET_LIST}
        self.open = dict(self.prices)
        self.series: dict[tuple[str, str], list[Candle]] = {}

    def step(self, dt: float) -> None:
        for m in MARKET_LIST:
            p = self.prices[m.id]
            sigma = m.vol * math.sqrt(dt * self.SPEED / 31_536_000)
            pull = -0.002 * math.log(p / m.base_price) * dt
            p *= math.exp(pull + sigma * self.rng.gauss(0, 1))
            self.prices[m.id] = p
            self._touch(m.id, p)

    def _touch(self, mid: str, price: float) -> None:
        now = time.time()
        for (smid, tf), rows in self.series.items():
            if smid != mid:
                continue
            secs = TF_SECONDS[tf]
            bucket = int(now // secs) * secs
            last = rows[-1]
            if last[0] < bucket:
                if (bucket - last[0]) / secs > 50:
                    rows.append([bucket, last[4], price, price, price, 0])
                else:
                    t = last[0] + secs
                    while t <= bucket:
                        rows.append([t, last[4], last[4], last[4], last[4], 0])
                        t += secs
                last = rows[-1]
            last[4] = price
            last[2] = max(last[2], price)
            last[3] = min(last[3], price)

    def _generate(self, m: Market, tf: str, n: int) -> list[Candle]:
        secs = TF_SECONDS[tf]
        rng = random.Random(f"{m.id}-{tf}")
        sigma = m.vol * math.sqrt(secs / 31_536_000)
        end_bucket = int(time.time() // secs) * secs
        close = self.prices[m.id]
        rows: list[Candle] = []
        for i in range(n):
            t = end_bucket - i * secs
            ret = rng.gauss(0, sigma)
            open_ = close / math.exp(ret)
            wick = abs(rng.gauss(0, sigma)) * 0.5
            high = max(open_, close) * (1 + wick)
            low = min(open_, close) * (1 - wick)
            rows.append([t, open_, high, low, close, rng.uniform(50, 500)])
            close = open_
        rows.reverse()
        return rows

    def candles(self, m: Market, tf: str, limit: int) -> list[Candle]:
        key = (m.id, tf)
        if key not in self.series:
            self.series[key] = self._generate(m, tf, 600)
        return [list(r) for r in self.series[key][-limit:]]


# --------------------------------------------------------------------------- Hub
class PriceHub:
    COOLDOWN = 45          # seconds a failing source is skipped
    FAILS_BEFORE_SKIP = 2
    CCXT_EVERY = 2.0
    YAHOO_EVERY = 8.0

    def __init__(self) -> None:
        self.demo = settings.price_source == "demo"
        self.quotes: dict[str, Quote] = {}
        self.errors: dict[str, str] = {}
        self._fails: dict[tuple[str, int], int] = {}
        self._skip_until: dict[tuple[str, int], float] = {}
        # (symbol, timeframe) -> (fetched at, candles, how many were requested)
        self._candle_cache: dict[tuple[str, str], tuple[float, list[Candle], int]] = {}
        self.ccxt = CcxtFeed()
        self.yahoo = YahooFeed()
        self.demo_feed = DemoFeed()
        self._tasks: list[asyncio.Task] = []

    # ---- lifecycle ----------------------------------------------------------------
    async def start(self) -> None:
        if self.demo:
            self._seed_demo()
            self._tasks = [asyncio.create_task(self._demo_loop())]
        else:
            self._tasks = [
                asyncio.create_task(self._loop("ccxt", self.CCXT_EVERY)),
                asyncio.create_task(self._loop("yahoo", self.YAHOO_EVERY)),
            ]

    async def stop(self) -> None:
        for t in self._tasks:
            t.cancel()
        await asyncio.gather(*self._tasks, return_exceptions=True)
        await self.ccxt.close()
        await self.yahoo.close()

    # ---- reading ------------------------------------------------------------------
    def last(self, mid: str) -> Quote | None:
        return self.quotes.get(mid)

    def fresh(self, mid: str) -> Quote | None:
        """The latest quote, or None when the market is closed / the feed is stale."""
        q = self.quotes.get(mid)
        m = MARKETS.get(mid)
        if q is None or m is None:
            return None
        if self.demo:
            return q
        return q if (time.time() - q.ts) <= m.stale_after else None

    def snapshot(self) -> dict:
        out = {}
        for mid, q in self.quotes.items():
            out[mid] = {"p": q.price, "c": q.change24h, "f": 1 if self.fresh(mid) else 0}
        return out

    def status(self) -> dict:
        now = time.time()
        out = {}
        for m in MARKET_LIST:
            q = self.quotes.get(m.id)
            out[m.id] = {
                "source": q.source if q else None,
                "live": bool(self.fresh(m.id)),
                "age_seconds": round(now - q.ts, 1) if q else None,
                "error": self.errors.get(m.id),
            }
        return out

    # ---- routing & failover -------------------------------------------------------
    def _order(self, m: Market) -> list[int]:
        """Source indexes, best first: sources not currently skipped, then the rest."""
        now = time.time()
        ready = [i for i in range(len(m.sources)) if self._skip_until.get((m.id, i), 0) <= now]
        waiting = sorted((i for i in range(len(m.sources)) if i not in ready),
                         key=lambda i: self._skip_until.get((m.id, i), 0))
        return ready + waiting

    def _ok(self, m: Market, idx: int) -> None:
        self._fails.pop((m.id, idx), None)
        self._skip_until.pop((m.id, idx), None)
        self.errors.pop(m.id, None)

    def _fail(self, m: Market, idx: int, err: str) -> None:
        n = self._fails.get((m.id, idx), 0) + 1
        self._fails[(m.id, idx)] = n
        self.errors[m.id] = err[:160]
        if n >= self.FAILS_BEFORE_SKIP:
            self._skip_until[(m.id, idx)] = time.time() + self.COOLDOWN

    # ---- polling ------------------------------------------------------------------
    async def _loop(self, provider: str, every: float) -> None:
        while True:
            started = time.monotonic()
            try:
                await self._poll(provider)
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # never let the feed loop die
                log.exception("poll %s crashed: %s", provider, exc)
            await asyncio.sleep(max(0.25, every - (time.monotonic() - started)))

    async def _poll(self, provider: str) -> None:
        # Which markets are currently routed to this provider?
        by_venue: dict[tuple[str, str], dict[str, tuple[Market, int, tuple[str, ...]]]] = {}
        for m in MARKET_LIST:
            idx = self._order(m)[0]
            src = m.sources[idx]
            if src.provider == provider:
                by_venue.setdefault((src.provider, src.venue), {})[m.id] = (m, idx, src.symbols)

        async def run(key, group):
            _, venue = key
            try:
                if provider == "ccxt":
                    got = await self.ccxt.quotes(venue, {mid: v[2] for mid, v in group.items()})
                else:
                    got = await self.yahoo.quotes({mid: v[2][0] for mid, v in group.items()})
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                got, err = {}, f"{provider}:{venue} {type(exc).__name__}: {exc}"
            else:
                err = f"{provider}:{venue} returned no price"
            for mid, (m, idx, _symbols) in group.items():
                q = got.get(mid)
                if q:
                    self.quotes[mid] = q
                    self._ok(m, idx)
                else:
                    self._fail(m, idx, err)

        await asyncio.gather(*(run(k, g) for k, g in by_venue.items()))

    # ---- demo ---------------------------------------------------------------------
    def _seed_demo(self) -> None:
        now = time.time()
        for m in MARKET_LIST:
            self.quotes[m.id] = Quote(self.demo_feed.prices[m.id], now, 0.0, "demo")

    async def _demo_loop(self) -> None:
        last = time.monotonic()
        while True:
            await asyncio.sleep(1.0)
            now_m = time.monotonic()
            self.demo_feed.step(now_m - last)
            last = now_m
            now = time.time()
            for m in MARKET_LIST:
                p = self.demo_feed.prices[m.id]
                chg = (p / self.demo_feed.open[m.id] - 1) * 100
                self.quotes[m.id] = Quote(p, now, chg, "demo")

    # ---- candles ------------------------------------------------------------------
    async def candles(self, mid: str, tf: str, limit: int = 300) -> list[Candle]:
        m = MARKETS[mid]
        if tf not in TF_SECONDS:
            raise ValueError("bad timeframe")
        key = (mid, tf)
        ttl = 6 if m.cls == "crypto" else 20
        hit = self._candle_cache.get(key)
        # Reuse a cached list only if it was fetched with at least as many candles as asked for,
        # otherwise a small earlier request would shorten a bigger later one.
        if hit and time.time() - hit[0] < ttl and hit[2] >= limit:
            return hit[1][-limit:]
        if self.demo:
            rows = self.demo_feed.candles(m, tf, limit)
        else:
            rows = None
            last_err = "no sources"
            for idx in self._order(m):
                src = m.sources[idx]
                try:
                    if src.provider == "ccxt":
                        rows = await self.ccxt.candles(src.venue, src.symbols, tf, limit)
                    else:
                        rows = await self.yahoo.candles(src.symbols[0], tf, limit)
                    if rows:
                        break
                except Exception as exc:
                    last_err = f"{src.provider}:{src.venue} {type(exc).__name__}: {exc}"
            if not rows:
                raise RuntimeError(last_err)
        self._candle_cache[key] = (time.time(), rows, limit)
        return rows[-limit:]
