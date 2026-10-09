"""Risk maths shared by the order ticket (position-size calculator) and the engine."""
from __future__ import annotations

import math

from .markets import Market, floor_to_step

MMR = 0.005  # maintenance margin rate: the slice of notional the exchange keeps at liquidation


def direction(side: str) -> int:
    return 1 if side == "long" else -1


def notional_usd(m: Market, price: float, qty: float) -> float:
    """Position value in USD. For USD-base pairs (USD/JPY) the size is already in USD."""
    return qty * price if m.kind == "linear" else qty


def pnl_usd(m: Market, side: str, entry: float, exit_price: float, qty: float) -> float:
    raw = (exit_price - entry) * qty * direction(side)
    return raw if m.kind == "linear" else raw / exit_price


def liq_price(m: Market, side: str, entry: float, leverage: float) -> float:
    """Isolated-margin liquidation price: the loss has eaten all margin except the
    maintenance slice."""
    k = 1.0 / leverage - MMR
    if m.kind == "linear":
        return entry * (1 - k) if side == "long" else entry * (1 + k)
    return entry / (1 + k) if side == "long" else entry / (1 - k)


def fee_usd(m: Market, price: float, qty: float, rate: float) -> float:
    return notional_usd(m, price, qty) * rate


def risk_at_stop(m: Market, side: str, entry: float, stop: float, qty: float) -> float:
    """Worst-case USD loss if the stop-loss fills: price loss plus entry and exit fees."""
    loss = -pnl_usd(m, side, entry, stop, qty)
    fees = fee_usd(m, entry, qty, m.fee_rate) + fee_usd(m, stop, qty, m.fee_rate)
    return max(loss, 0.0) + fees


def check_stop_side(side: str, ref: float, sl: float | None, tp: float | None) -> str | None:
    """Return an error message when the stop/target are on the wrong side of the price."""
    if side == "long":
        if sl is not None and not sl < ref:
            return "For a long, the stop-loss must be below the entry price."
        if tp is not None and not tp > ref:
            return "For a long, the take-profit must be above the entry price."
    else:
        if sl is not None and not sl > ref:
            return "For a short, the stop-loss must be above the entry price."
        if tp is not None and not tp < ref:
            return "For a short, the take-profit must be below the entry price."
    return None


def preview_position(m: Market, side: str, equity: float, entry: float, qty: float,
                     leverage: float, stop: float | None = None, tp: float | None = None,
                     available: float | None = None, max_risk_pct: float | None = None) -> dict:
    """Everything the order ticket shows for a trade of a given size: margin, liquidation,
    risk at the stop, reward and R:R. The stop is optional (no stop = no risk numbers)."""
    err = check_stop_side(side, entry, stop, tp)
    if err:
        raise ValueError(err)
    if equity <= 0:
        raise ValueError("Account equity is zero.")

    notional = notional_usd(m, entry, qty)
    margin = notional / leverage if leverage else 0.0
    liq = liq_price(m, side, entry, leverage)
    out = {
        "qty": qty,
        "notional": notional,
        "margin": margin,
        "risk_usd": None,
        "risk_pct": None,
        "liq_price": liq,
        "liq_loss_usd": max(-pnl_usd(m, side, entry, liq, qty), 0.0),
        "leverage": leverage,
        "fees_est": None,
        "reward_usd": None,
        "rr": None,
        "leverage_needed": None,
        "warnings": [],
    }
    w = out["warnings"]
    if stop is not None:
        risk = risk_at_stop(m, side, entry, stop, qty)
        out["risk_usd"] = risk
        out["risk_pct"] = risk / equity * 100
        out["fees_est"] = fee_usd(m, entry, qty, m.fee_rate) + fee_usd(m, stop, qty, m.fee_rate)
        if tp is not None and qty > 0:
            reward = pnl_usd(m, side, entry, tp, qty) - fee_usd(m, entry, qty, m.fee_rate) \
                - fee_usd(m, tp, qty, m.maker_rate)
            out["reward_usd"] = reward
            out["rr"] = reward / risk if risk > 0 else None
        if (side == "long" and stop <= liq) or (side == "short" and stop >= liq):
            w.append("Your stop is beyond the liquidation price. Lower the leverage.")
        if max_risk_pct is not None and out["risk_pct"] > max_risk_pct + 1e-9:
            w.append(f"Above your own limit of {max_risk_pct:g}% risk per trade.")
        if out["rr"] is not None and out["rr"] < 1:
            w.append("Reward is smaller than risk (R:R below 1). You'd need a very high win rate.")
    if qty < m.min_qty:
        w.append(f"Size is below the minimum ({m.min_qty:g} {m.qty_label}).")
    if available is not None and qty > 0 and available > 0:
        out["leverage_needed"] = max(1.0, math.ceil(notional / available * 10) / 10)
    if available is not None and margin > available:
        need = out["leverage_needed"]
        extra = f" You need about {need:g}x leverage or a smaller size." if need else ""
        w.append(f"Not enough free margin at {leverage:g}x.{extra}")
    return out


def size_position(m: Market, side: str, equity: float, risk_pct: float, entry: float,
                  stop: float, leverage: float, tp: float | None = None,
                  available: float | None = None, max_risk_pct: float | None = None) -> dict:
    """Position-size calculator: how big can the trade be so that hitting the stop costs
    exactly `risk_pct` of equity (fees included)?"""
    err = check_stop_side(side, entry, stop, tp)
    if err:
        raise ValueError(err)
    if equity <= 0:
        raise ValueError("Account equity is zero.")
    risk_budget = equity * risk_pct / 100.0
    # USD lost per 1 unit if the stop fills, plus round-trip taker fees on that unit
    per_unit = risk_at_stop(m, side, entry, stop, 1.0)
    qty = floor_to_step(risk_budget / per_unit, m.qty_step) if per_unit > 0 else 0.0
    out = preview_position(m, side, equity, entry, qty, leverage, stop, tp, available, max_risk_pct)
    if qty < m.min_qty:
        out["warnings"] = [x for x in out["warnings"] if not x.startswith("Size is below")]
        out["warnings"].insert(0, f"Stop is too wide for this risk: size rounds to less than the minimum "
                                  f"({m.min_qty:g} {m.qty_label}). Raise the risk % or tighten the stop.")
    return out
