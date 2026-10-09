import os
import tempfile

# Must be set before the app modules are imported.
_tmp = tempfile.mkdtemp()
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp}/test.db"
os.environ["PRICE_SOURCE"] = "demo"
os.environ["MIN_TRADES_LEADERBOARD"] = "1"
os.environ["COOKIE_SECURE"] = "false"

import time
from types import SimpleNamespace

import pytest

from app import db as dbm
from app.engine import Engine
from app.prices import Quote


class FakeHub:
    """Price hub whose prices the test controls."""
    demo = True

    def __init__(self):
        self.q = {}

    def set(self, mid, price, ts=None):
        self.q[mid] = Quote(price=price, ts=ts or time.time(), change24h=0.0, source="fake")

    def last(self, mid):
        return self.q.get(mid)

    def fresh(self, mid):
        return self.q.get(mid)


@pytest.fixture()
def fresh_db():
    dbm.Base.metadata.drop_all(dbm.engine)
    dbm.Base.metadata.create_all(dbm.engine)
    yield
    dbm.Base.metadata.drop_all(dbm.engine)


@pytest.fixture()
def hub():
    h = FakeHub()
    h.set("BTCUSDT", 50_000.0)
    h.set("ETHUSDT", 3_000.0)
    h.set("EURUSD", 1.10)
    h.set("USDJPY", 150.0)
    h.set("XAUUSD", 2_000.0)
    return h


@pytest.fixture()
def engine(hub, fresh_db):
    return Engine(hub)


@pytest.fixture()
def db(fresh_db):
    with dbm.SessionLocal() as s:
        yield s


@pytest.fixture()
def user(db):
    from app import auth
    return auth.create_user(db, "tester", "correct horse battery", "2000-01-01")


def order(**kw):
    """Build an order request without going through HTTP validation."""
    base = dict(symbol="BTCUSDT", side="long", type="market", qty=None, risk_pct=None,
                limit_price=None, leverage=1, sl=None, tp=None, note="", setup="", tags=[])
    base.update(kw)
    return SimpleNamespace(**base)
