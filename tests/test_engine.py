import random

import pytest

from app.engine import TradeError
from app.markets import MARKETS
from app.risk import liq_price, pnl_usd, size_position
from tests.conftest import order


def approx(a, b, tol=1e-6):
    return abs(a - b) <= tol * max(1, abs(b))


# ------------------------------------------------------------------ opening & closing
def test_long_roundtrip_matches_hand_calculation(engine, hub, db, user):
    res = engine.place_order(db, user, order(qty=0.1, leverage=10))
    assert res["kind"] == "position"
    st = engine.state(db, user)
    pos = st["positions"][0]
    assert approx(pos["margin"], 500.0)               # 0.1 * 50000 / 10
    assert approx(user.cash, 10_000 - 2.5)            # 0.05% taker fee on 5,000
    assert approx(st["available"], 10_000 - 2.5 - 500)

    hub.set("BTCUSDT", 51_000.0)
    engine.close_trade(db, user, pos["id"])
    # gross +100, fees 2.5 + 2.55
    assert approx(user.cash, 10_000 - 2.5 + 100 - 2.55)
    t = engine.state(db, user)
    assert t["positions"] == []
    from app.db import Trade
    closed = db.get(Trade, pos["id"])
    assert closed.status == "closed" and approx(closed.pnl, 94.95)


def test_short_profits_when_price_falls(engine, hub, db, user):
    engine.place_order(db, user, order(side="short", qty=0.1, leverage=5))
    pid = engine.state(db, user)["positions"][0]["id"]
    hub.set("BTCUSDT", 49_000.0)
    assert approx(engine.state(db, user)["positions"][0]["upnl"], 100.0)
    engine.close_trade(db, user, pid)
    assert user.cash > 10_000


def test_usd_base_pair_converts_pnl_to_usd(engine, hub, db, user):
    engine.place_order(db, user, order(symbol="USDJPY", qty=10_000, leverage=10))
    pos = engine.state(db, user)["positions"][0]
    assert approx(pos["margin"], 1_000.0)
    hub.set("USDJPY", 151.0)
    assert approx(engine.state(db, user)["positions"][0]["upnl"], 10_000 / 151.0)  # 1 JPY * 10k / 151


def test_liquidation_price_formulas():
    btc, jpy = MARKETS["BTCUSDT"], MARKETS["USDJPY"]
    assert approx(liq_price(btc, "long", 50_000, 10), 45_250)
    assert approx(liq_price(btc, "short", 50_000, 10), 54_750)
    assert approx(liq_price(jpy, "long", 150, 10), 150 / 1.095)
    assert approx(liq_price(jpy, "short", 150, 10), 150 / 0.905)
    # at the liquidation price the loss equals margin minus the maintenance slice
    for m, side, entry in ((btc, "long", 50_000), (btc, "short", 50_000), (jpy, "long", 150), (jpy, "short", 150)):
        qty = 10_000 if m.kind == "usd_base" else 0.2
        notional = qty if m.kind == "usd_base" else qty * entry
        loss = -pnl_usd(m, side, entry, liq_price(m, side, entry, 10), qty)
        assert approx(loss, notional / 10 - 0.005 * notional, 1e-9)


# ------------------------------------------------------------------ stops & liquidation
def test_stop_loss_fires_and_gaps_cost_extra(engine, hub, db, user):
    engine.place_order(db, user, order(qty=0.1, leverage=5, sl=49_000, tp=53_000))
    hub.set("BTCUSDT", 48_900.0)   # price gapped past the stop
    assert engine.process_tick(db) == 1
    from app.db import Trade
    t = db.query(Trade).one()
    assert t.close_reason == "sl" and t.exit_price == 48_900.0
    assert t.r_multiple < -1.0     # lost more than 1R because the stop filled below 49,000


def test_take_profit_fills_at_target(engine, hub, db, user):
    engine.place_order(db, user, order(qty=0.1, leverage=5, sl=49_000, tp=53_000))
    hub.set("BTCUSDT", 53_500.0)
    engine.process_tick(db)
    from app.db import Trade
    t = db.query(Trade).one()
    assert t.close_reason == "tp" and t.exit_price == 53_000.0 and t.pnl > 0


def test_liquidation_caps_loss_at_margin(engine, hub, db, user):
    engine.place_order(db, user, order(qty=0.1, leverage=10))
    hub.set("BTCUSDT", 40_000.0)
    engine.process_tick(db)
    from app.db import Trade
    t = db.query(Trade).one()
    assert t.close_reason == "liquidation" and approx(t.exit_price, 45_250)
    assert approx(t.gross_pnl, -475.0)
    assert user.cash > 0 and approx(user.cash, 10_000 - 2.5 - 475 - 2.2625, 1e-6)


def test_peak_and_trough_tracked(engine, hub, db, user):
    engine.place_order(db, user, order(qty=0.1, leverage=2))
    for p in (50_500, 49_200, 50_100):
        hub.set("BTCUSDT", p)
        engine.process_tick(db)
    from app.db import Trade
    t = db.query(Trade).one()
    assert t.peak_price == 50_500 and t.trough_price == 49_200


# ------------------------------------------------------------------ limit orders
def test_limit_order_reserves_margin_then_fills(engine, hub, db, user):
    engine.place_order(db, user, order(type="limit", limit_price=49_000, qty=0.1, leverage=10))
    st = engine.state(db, user)
    assert len(st["orders"]) == 1 and st["positions"] == []
    assert st["reserved"] > 490 and approx(st["cash"], 10_000)
    hub.set("BTCUSDT", 49_100)
    assert engine.process_tick(db) == 0          # not touched yet
    hub.set("BTCUSDT", 48_990)
    assert engine.process_tick(db) == 1
    st = engine.state(db, user)
    assert st["orders"] == [] and st["positions"][0]["entry"] == 49_000
    assert st["reserved"] == 0


def test_cancel_limit_order_releases_margin(engine, hub, db, user):
    engine.place_order(db, user, order(type="limit", limit_price=49_000, qty=0.1, leverage=10))
    oid = engine.state(db, user)["orders"][0]["id"]
    engine.cancel_order(db, user, oid)
    st = engine.state(db, user)
    assert st["orders"] == [] and approx(st["available"], 10_000)


# ------------------------------------------------------------------ validation
@pytest.mark.parametrize("kw,fragment", [
    (dict(qty=0.1, leverage=10, sl=51_000), "below the entry"),
    (dict(qty=0.1, leverage=10, tp=49_000), "above the entry"),
    (dict(qty=0.1, leverage=50), "Max leverage"),
    (dict(qty=0.1, leverage=10, sl=45_000), "beyond the liquidation"),
    (dict(qty=0.00001, leverage=1), "too small"),
    (dict(qty=5, leverage=1), "free margin"),
    (dict(leverage=1), "Enter a size"),
    (dict(type="limit", limit_price=51_000, qty=0.1), "buy limit must be below"),
])
def test_rejections(engine, db, user, kw, fragment):
    with pytest.raises(TradeError, match=fragment):
        engine.place_order(db, user, order(**kw))


def test_max_risk_per_trade_enforced(engine, db, user):
    user.max_risk_pct = 1.0
    db.commit()
    with pytest.raises(TradeError, match="risks"):
        engine.place_order(db, user, order(qty=0.1, leverage=5, sl=45_000))   # ~$500+ risk = 5%
    engine.place_order(db, user, order(qty=0.01, leverage=5, sl=49_000))      # ~$10 risk = 0.1%


def test_require_stop_loss_setting(engine, db, user):
    engine.update_settings(db, user, {"require_sl": True})
    with pytest.raises(TradeError, match="stop-loss on every trade"):
        engine.place_order(db, user, order(qty=0.01, leverage=2))
    engine.place_order(db, user, order(qty=0.01, leverage=2, sl=49_000))


def test_daily_loss_lock_blocks_new_trades_but_not_closing(engine, hub, db, user):
    user.daily_loss_pct = 5.0
    db.commit()
    engine.place_order(db, user, order(qty=0.2, leverage=10))
    pid = engine.state(db, user)["positions"][0]["id"]
    hub.set("BTCUSDT", 47_000)                      # -3,000 * 0.2 = -$600 = -6%
    st = engine.state(db, user)
    assert st["locked"]
    with pytest.raises(TradeError, match="Daily loss limit"):
        engine.place_order(db, user, order(qty=0.01, leverage=2))
    engine.close_trade(db, user, pid)               # closing is still allowed


def test_stale_feed_blocks_trading(engine, hub, db, user):
    hub.q.pop("BTCUSDT")
    with pytest.raises(TradeError, match="closed or its price feed"):
        engine.place_order(db, user, order(qty=0.01, leverage=2))


def test_set_stops_validates_and_defines_r(engine, hub, db, user):
    engine.place_order(db, user, order(qty=0.1, leverage=5))
    pid = engine.state(db, user)["positions"][0]["id"]
    with pytest.raises(TradeError):
        engine.set_stops(db, user, pid, 51_000, None)          # stop above price on a long
    t = engine.set_stops(db, user, pid, 49_000, 52_000)
    assert t.sl == 49_000 and approx(t.initial_risk, 100.0)    # 1,000 * 0.1
    t = engine.set_stops(db, user, pid, 49_500, None)          # trailing the stop keeps 1R
    assert approx(t.initial_risk, 100.0)


def test_other_users_trades_are_off_limits(engine, hub, db, user):
    from app import auth
    other = auth.create_user(db, "someone_else", "another long password", "2000-01-01")
    engine.place_order(db, user, order(qty=0.01, leverage=2))
    pid = engine.state(db, user)["positions"][0]["id"]
    with pytest.raises(TradeError, match="not found"):
        engine.close_trade(db, other, pid)


# ------------------------------------------------------------------ risk calculator
def test_position_size_risks_exactly_the_budget(engine):
    m = MARKETS["BTCUSDT"]
    out = size_position(m, "long", 10_000, 1.0, 50_000, 49_000, 5, tp=52_000, available=10_000)
    assert 0.98 * 100 <= out["risk_usd"] <= 100.0 + 1e-9
    assert out["rr"] and 1.8 < out["rr"] < 2.0
    assert out["warnings"] == []


def test_position_size_warns_when_stop_beyond_liquidation():
    m = MARKETS["BTCUSDT"]
    out = size_position(m, "long", 10_000, 1.0, 50_000, 40_000, 10)
    assert any("liquidation" in w for w in out["warnings"])


def test_risk_pct_order_uses_calculator(engine, db, user):
    engine.place_order(db, user, order(risk_pct=1.0, sl=49_000, leverage=5))
    pos = engine.state(db, user)["positions"][0]
    assert approx(pos["initial_risk"], 95.2, 0.02)   # ~0.0952 BTC * 1000


# ------------------------------------------------------------------ reset / leaderboard
def test_reset_closes_everything_and_starts_new_season(engine, hub, db, user):
    engine.place_order(db, user, order(qty=0.1, leverage=5))
    engine.place_order(db, user, order(type="limit", limit_price=45_000, qty=0.05, leverage=5))
    engine.reset_account(db, user)
    st = engine.state(db, user)
    assert st["positions"] == [] and st["orders"] == []
    assert approx(st["equity"], 10_000) and user.season == 2


def test_leaderboard_ranks_by_return(engine, hub, db, user):
    from app import auth
    other = auth.create_user(db, "rival", "another long password", "2000-01-01")
    for u, price in ((user, 51_000), (other, 49_000)):
        hub.set("BTCUSDT", 50_000)
        engine.place_order(db, u, order(qty=0.1, leverage=5))
        pid = engine.state(db, u)["positions"][0]["id"]
        hub.set("BTCUSDT", price)
        engine.close_trade(db, u, pid)
    rows = engine.leaderboard(db, "all")
    assert [r["username"] for r in rows] == ["tester", "rival"]
    assert rows[0]["return_pct"] > 0 > rows[1]["return_pct"]


# ------------------------------------------------------------------ fuzz: accounting invariants
@pytest.mark.parametrize("seed", [1234, 7, 99, 2026])
def test_random_trading_never_breaks_accounting(engine, hub, db, user, seed):
    rng = random.Random(seed)
    prices = {"BTCUSDT": 50_000.0, "ETHUSDT": 3_000.0, "EURUSD": 1.10, "USDJPY": 150.0, "XAUUSD": 2_000.0}
    qty_for = {"BTCUSDT": 0.05, "ETHUSDT": 0.5, "EURUSD": 20_000, "USDJPY": 20_000, "XAUUSD": 1.0}
    for step in range(600):
        for sym in prices:
            prices[sym] *= 1 + rng.gauss(0, 0.012)
            hub.set(sym, prices[sym])
        if rng.random() < 0.35:
            sym = rng.choice(list(prices))
            side = rng.choice(["long", "short"])
            lev = rng.choice([1, 2, 5, 10, 20])
            ref = prices[sym]
            sl = ref * (0.97 if side == "long" else 1.03) if rng.random() < 0.6 else None
            tp = ref * (1.04 if side == "long" else 0.96) if rng.random() < 0.5 else None
            kind = "limit" if rng.random() < 0.25 else "market"
            lp = ref * (0.99 if side == "long" else 1.01) if kind == "limit" else None
            try:
                engine.place_order(db, user, order(
                    symbol=sym, side=side, type=kind, qty=qty_for[sym] * rng.choice([0.5, 1, 2, 4]),
                    leverage=lev, sl=sl, tp=tp, limit_price=lp))
            except TradeError:
                pass
        engine.process_tick(db)
        if rng.random() < 0.1:
            open_ = engine.state(db, user)["positions"]
            if open_:
                try:
                    engine.close_trade(db, user, rng.choice(open_)["id"])
                except TradeError:
                    pass
        st = engine.state(db, user)
        assert user.cash >= -1e-6, f"cash went negative at step {step}"
        assert st["available"] >= -1e-6, f"over-committed margin at step {step}"
        assert st["equity"] >= -1e-6
    # every closed trade's P&L reconciles with the cash balance
    from app.db import Trade
    closed = db.query(Trade).filter(Trade.status == "closed").all()
    assert len(closed) >= 8, "fuzz run was too quiet to prove anything"
    open_ = db.query(Trade).filter(Trade.status == "open").all()
    expected_cash = 10_000 + sum(t.gross_pnl - t.fee_open - t.fee_close for t in closed) \
        - sum(t.fee_open for t in open_)
    assert approx(user.cash, expected_cash, 1e-9)


# ------------------------------------------------------------------ ticket preview
def test_preview_without_stop_has_no_risk_numbers():
    from app.risk import preview_position
    m = MARKETS["BTCUSDT"]
    out = preview_position(m, "long", 10_000, 50_000, 0.1, 10)
    assert out["risk_usd"] is None and out["rr"] is None
    assert approx(out["margin"], 500.0) and approx(out["liq_price"], 45_250)
    assert approx(out["liq_loss_usd"], 475.0)


def test_preview_with_stop_matches_size_position():
    from app.risk import preview_position
    m = MARKETS["BTCUSDT"]
    sized = size_position(m, "long", 10_000, 1.0, 50_000, 49_000, 5, tp=52_000, available=10_000)
    prev = preview_position(m, "long", 10_000, 50_000, sized["qty"], 5, 49_000, 52_000, available=10_000)
    for k in ("qty", "risk_usd", "reward_usd", "rr", "margin", "liq_price"):
        assert approx(prev[k], sized[k])


def test_preview_warns_on_oversized_trade():
    from app.risk import preview_position
    m = MARKETS["BTCUSDT"]
    out = preview_position(m, "long", 10_000, 50_000, 5, 1, available=10_000)
    assert any("free margin" in w for w in out["warnings"])
    out = preview_position(m, "long", 10_000, 50_000, 0.1, 2, stop=40_000, max_risk_pct=1.0, available=10_000)
    assert any("own limit" in w for w in out["warnings"])
