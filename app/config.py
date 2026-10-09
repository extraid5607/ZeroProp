"""Runtime settings, read once from environment variables."""
from __future__ import annotations

import os
from dataclasses import dataclass


def _bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, default))
    except ValueError:
        return default


def _int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, default))
    except ValueError:
        return default


def _list(name: str, default: str) -> tuple[str, ...]:
    raw = os.getenv(name, default)
    return tuple(x.strip() for x in raw.split(",") if x.strip())


def _database_url() -> str:
    raw = os.getenv("DATABASE_URL")
    if not raw or not raw.strip():
        return "sqlite:///./zeropaper.db"

    url = raw.strip().strip("'\"")
    if "psql " in url:
        url = url.split("psql ", 1)[-1].strip().strip("'\"")

    # If the user mistakenly pasted just a Service ID (e.g. dpg-xxx) or non-URL text
    if "://" not in url:
        return "sqlite:///./zeropaper.db"

    # Render / Heroku hand out "postgres://..." which SQLAlchemy does not accept.
    if url.startswith("postgres://"):
        url = "postgresql+psycopg://" + url[len("postgres://"):]
    elif url.startswith("postgresql://"):
        url = "postgresql+psycopg://" + url[len("postgresql://"):]
    return url


@dataclass(frozen=True)
class Settings:
    app_name: str
    database_url: str
    # "live" = real prices (CCXT + Yahoo), "demo" = simulated random-walk prices
    price_source: str
    # Exchanges tried in order for crypto. Some exchanges block some countries/hosts,
    # so the feed fails over to the next one automatically.
    crypto_venues: tuple[str, ...]
    # Exchanges tried in order for gold/silver before falling back to Yahoo.
    metal_venues: tuple[str, ...]
    start_balance: float
    cookie_secure: bool
    session_days: int
    min_trades_leaderboard: int
    max_open_positions: int
    tick_seconds: float
    # Defaults for new accounts (each user can change them in Risk settings)
    default_max_leverage: int
    default_max_risk_pct: float
    default_daily_loss_pct: float


def load_settings() -> Settings:
    return Settings(
        app_name=os.getenv("APP_NAME", "ZeroProp"),
        database_url=_database_url(),
        price_source=os.getenv("PRICE_SOURCE", "live").strip().lower(),
        crypto_venues=_list("CRYPTO_VENUES", "binance,bybit,okx,kucoin"),
        metal_venues=_list("METAL_VENUES", "binanceusdm"),
        start_balance=_float("START_BALANCE", 10_000.0),
        cookie_secure=_bool("COOKIE_SECURE", False),
        session_days=_int("SESSION_DAYS", 30),
        min_trades_leaderboard=_int("MIN_TRADES_LEADERBOARD", 5),
        max_open_positions=_int("MAX_OPEN_POSITIONS", 10),
        tick_seconds=_float("TICK_SECONDS", 1.0),
        default_max_leverage=_int("DEFAULT_MAX_LEVERAGE", 20),
        default_max_risk_pct=_float("DEFAULT_MAX_RISK_PCT", 5.0),
        default_daily_loss_pct=_float("DEFAULT_DAILY_LOSS_PCT", 10.0),
    )


settings = load_settings()
