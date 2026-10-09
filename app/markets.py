"""Market catalogue: what can be traded, how it is sized, and where its price comes from."""
from __future__ import annotations

import math
from dataclasses import dataclass

from .config import settings


@dataclass(frozen=True)
class Source:
    provider: str                 # "ccxt" or "yahoo"
    venue: str                    # ccxt exchange id ("" for yahoo)
    symbols: tuple[str, ...]      # candidate symbols, first one that exists wins


@dataclass(frozen=True)
class Market:
    id: str
    name: str
    base: str
    quote: str
    cls: str                      # "crypto" | "forex" | "metal"
    # "linear":   quote currency is USD(T). notional = qty * price, P&L is already in USD.
    # "usd_base": base currency is USD (USD/JPY). notional = qty, P&L is in the quote
    #             currency and is converted to USD by dividing by the exit price.
    kind: str
    decimals: int                 # price decimals for display
    qty_step: float
    min_qty: float
    max_leverage: int
    fee_rate: float               # taker fee (market orders, stops, liquidations)
    maker_rate: float             # limit orders and take-profits
    qty_label: str                # unit shown next to the size box
    base_price: float             # only used by the simulated feed
    vol: float                    # annualised volatility, only used by the simulated feed
    sources: tuple[Source, ...]
    stale_after: int              # seconds before a quote is treated as "market closed"

    def public(self) -> dict:
        return {
            "id": self.id, "name": self.name, "base": self.base, "quote": self.quote,
            "cls": self.cls, "kind": self.kind, "decimals": self.decimals,
            "qty_step": self.qty_step, "min_qty": self.min_qty,
            "max_leverage": self.max_leverage, "fee_rate": self.fee_rate,
            "maker_rate": self.maker_rate, "qty_label": self.qty_label,
        }


def _crypto(base: str, name: str, decimals: int, step: float, min_qty: float,
            base_price: float, vol: float) -> Market:
    sources = tuple(Source("ccxt", v, (f"{base}/USDT",)) for v in settings.crypto_venues)
    return Market(
        id=f"{base}USDT", name=name, base=base, quote="USDT", cls="crypto", kind="linear",
        decimals=decimals, qty_step=step, min_qty=min_qty, max_leverage=20,
        fee_rate=0.0005, maker_rate=0.0002, qty_label=base,
        base_price=base_price, vol=vol, sources=sources, stale_after=30,
    )


def _metal(base: str, name: str, yahoo: tuple[str, ...], decimals: int, step: float,
           min_qty: float, base_price: float, vol: float) -> Market:
    sources = [Source("ccxt", v, (f"{base}/USDT:USDT", f"{base}/USDT")) for v in settings.metal_venues]
    sources += [Source("yahoo", "", (y,)) for y in yahoo]
    return Market(
        id=f"{base}USD", name=name, base=base, quote="USD", cls="metal", kind="linear",
        decimals=decimals, qty_step=step, min_qty=min_qty, max_leverage=20,
        fee_rate=0.0005, maker_rate=0.0002, qty_label="oz",
        base_price=base_price, vol=vol, sources=tuple(sources), stale_after=600,
    )


def _fx(base: str, quote: str, decimals: int, base_price: float, vol: float = 0.08) -> Market:
    kind = "linear" if quote == "USD" else "usd_base"
    return Market(
        id=f"{base}{quote}", name=f"{base}/{quote}", base=base, quote=quote, cls="forex",
        kind=kind, decimals=decimals, qty_step=1000, min_qty=1000, max_leverage=30,
        fee_rate=0.0001, maker_rate=0.00005, qty_label=base,
        base_price=base_price, vol=vol,
        sources=(Source("yahoo", "", (f"{base}{quote}=X",)),), stale_after=600,
    )


_MARKETS: list[Market] = [
    # --- crypto (CCXT) ---------------------------------------------------------------
    _crypto("BTC", "Bitcoin", 2, 0.0001, 0.0001, 90_000, 0.55),
    _crypto("ETH", "Ethereum", 2, 0.001, 0.001, 3_200, 0.70),
    _crypto("SOL", "Solana", 2, 0.01, 0.01, 150, 0.90),
    _crypto("BNB", "BNB", 2, 0.01, 0.01, 600, 0.60),
    _crypto("XRP", "XRP", 4, 1, 1, 2.2, 0.85),
    _crypto("DOGE", "Dogecoin", 5, 10, 10, 0.18, 1.00),
    _crypto("ADA", "Cardano", 4, 1, 1, 0.6, 0.85),
    _crypto("AVAX", "Avalanche", 2, 0.1, 0.1, 28, 0.90),
    _crypto("LINK", "Chainlink", 3, 0.1, 0.1, 15, 0.85),
    _crypto("LTC", "Litecoin", 2, 0.01, 0.01, 90, 0.75),
    # --- metals (Binance gold/silver perpetuals via CCXT, Yahoo as fallback) ---------
    _metal("XAU", "Gold", ("XAUUSD=X", "GC=F"), 2, 0.01, 0.01, 4_300, 0.18),
    _metal("XAG", "Silver", ("XAGUSD=X", "SI=F"), 3, 0.1, 0.1, 55, 0.35),
    # --- forex majors (Yahoo Finance) -------------------------------------------------
    _fx("EUR", "USD", 5, 1.16),
    _fx("GBP", "USD", 5, 1.33),
    _fx("AUD", "USD", 5, 0.66),
    _fx("NZD", "USD", 5, 0.60),
    _fx("USD", "JPY", 3, 150.0),
    _fx("USD", "CAD", 5, 1.38),
    _fx("USD", "CHF", 5, 0.80),
]

MARKETS: dict[str, Market] = {m.id: m for m in _MARKETS}
MARKET_LIST: list[Market] = list(_MARKETS)


def floor_to_step(value: float, step: float) -> float:
    """Round a size DOWN to the market's step (never up: never risk more than asked)."""
    if step <= 0:
        return value
    decimals = max(0, -int(math.floor(math.log10(step)))) if step < 1 else 0
    return round(math.floor(value / step + 1e-9) * step, decimals + 2)
