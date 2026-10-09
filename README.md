# ZeroProp

A professional paper trading and funded evaluation simulator platform. Visitors get $10,000 of virtual funds and trade **crypto, forex, gold and silver** on real live market prices, with the risk tools a real trader needs: position sizing from a stop-loss, leverage and liquidation, a trade journal with statistics, personal risk rules, and a leaderboard. No broker accounts or API keys required.

- **Backend:** Python, FastAPI, SQLAlchemy (SQLite or PostgreSQL)
- **Prices:** [CCXT](https://github.com/ccxt/ccxt) for crypto (and gold/silver where an exchange lists them), Yahoo Finance for forex and as the gold/silver fallback
- **Frontend:** plain JavaScript modules and CSS, no build step. Charts by TradingView Lightweight Charts (included in `static/vendor`)

## What is in it

| Area | What it does |
|---|---|
| Markets | 10 crypto pairs, gold, silver, 7 forex pairs (EUR/USD, GBP/USD, AUD/USD, NZD/USD, USD/JPY, USD/CAD, USD/CHF) |
| Orders | Market and limit orders, stop-loss, take-profit, edit stops on open trades, cancel limit orders |
| Risk tools | Position-size calculator (size the trade so the stop costs X% of equity, fees included), liquidation price, reward, R:R, warnings |
| Account | Isolated margin per position, leverage up to 20x (30x forex), taker/maker fees, liquidation, equity and margin shown live |
| Rules | Each user can require stop-losses, cap leverage, cap risk per trade, and set a daily loss limit that locks new trades until 00:00 UTC |
| Journal | Notes, setup, tags, emotion, 1-5 rating and lesson on every trade |
| Stats | Equity curve, win rate, profit factor, expectancy in $ and R, drawdown, streaks, and breakdowns by market, side, setup, mood, exit type and weekday |
| Leaderboard | All time, 30 days and 7 days, by return; appears after a minimum number of closed trades |
| Account reset | Starts a new season from $10,000; the old season's stats are kept out of the new one |

### How the simulator behaves

- Market orders fill at the latest price. Limit orders fill when the price touches them. Stop-losses fill at the price seen when they trigger, so a price gap costs more than 1R. Take-profits fill at the target. Liquidation fills at the liquidation price.
- Fees: crypto/metals 0.05% taker, 0.02% maker. Forex 0.01% taker, 0.005% maker. These are fixed, round numbers, not any exchange's real schedule.
- `equity = cash + unrealised P&L`. Free margin is `cash - margin in open trades - margin reserved by limit orders`. Unrealised profit is not spendable.
- A trade can only be opened or edited while its market has a fresh price. If a market is closed or its feed is down, the app says so instead of filling at an old price.
- There is no spread or slippage model. Fills are at the last traded price.

## Run it on your computer

Needs Python 3.11 or newer (developed and tested on 3.13).

```bash
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt

# Simulated prices, works offline. Prices move fast on purpose, so trades play out quickly.
PRICE_SOURCE=demo uvicorn app.main:app --reload

# Real prices
uvicorn app.main:app --reload
```

Open http://127.0.0.1:8000, create an account and trade. The database is a `zeropaper.db` file in the folder you started from. Delete it to start fresh.

On Windows PowerShell, set variables like this: `$env:PRICE_SOURCE="demo"; uvicorn app.main:app --reload`

### Tests

```bash
pip install -r requirements-dev.txt
pytest
```

44 tests cover the trading maths, stops, liquidation, limit orders, validation, risk rules, statistics, login and sessions, plus a randomised stress test (4 seeds, 600 random price steps each, with random orders, stops and closes) that checks cash never goes negative, margin is never over-committed and every closed trade reconciles with the balance. They run on simulated prices and need no internet.

## Deploy on Render

1. Put this folder in a GitHub repository.
2. In Render, create a **PostgreSQL** database. Copy its **Internal Database URL**.
3. Create a **Blueprint** from the repository (Render reads `render.yaml`), or create a Web Service by hand with:
   - Build command: `pip install -r requirements.txt`
   - Start command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT --proxy-headers --forwarded-allow-ips="*"`
   - Health check path: `/api/health`
4. Set `DATABASE_URL` to the database URL, `COOKIE_SECURE` to `true` and `PRICE_SOURCE` to `live`.
5. Open the site and check `/api/health`. Every market should show a `source` and `"live": true`.

Things to know before you go live:

- **Use PostgreSQL, not the default SQLite file.** A web host's disk is wiped on each deploy, which would delete every account. PostgreSQL support is written and the tables compile for it, but it was not run against a real Postgres server during development, so test sign-up, a trade and a restart on your own deployment first.
- **Run exactly one worker.** The price feed, order engine and rate limiters live in the server process. Do not add `--workers` or scale to several instances.
- **Free-tier hosting sleeps when idle.** While asleep, nothing watches prices, so stops, take-profits and limit orders do not trigger. When the service wakes, they trigger against the first price it sees. Use an always-on plan if that matters to your users.
- **Exchange access depends on the server's location.** Some exchanges block some countries or cloud hosts. The feed tries `CRYPTO_VENUES` in order (Binance, Bybit, OKX, KuCoin) and skips a failing one for 45 seconds, so one blocked exchange is not a problem. `/api/health` shows which source each market is using.

## Honest limits

- **Live feeds were not tested end to end.** The development machine could not reach any exchange or Yahoo, so everything was tested on the built-in simulated feed. The CCXT and Yahoo code follows their documented behaviour, but check `/api/health` after your first deploy.
- **Forex and fallback metals use Yahoo Finance's unofficial chart endpoint.** It is free and needs no key, but it is not guaranteed, can rate-limit a server, and can change. If you outgrow it, replace `YahooFeed` in `app/prices.py` with a paid forex data API.
- **Gold and silver:** Binance launched gold and silver perpetual contracts (XAUUSDT, XAGUSDT) in January 2026. The code looks for them through CCXT and otherwise falls back to Yahoo's spot gold/silver. Which one a given market is using shows in `/api/health`.
- **No email, so no password reset.** Passwords are stored as scrypt hashes. A user who forgets a password loses the account.
- **Usernames are public** on the leaderboard. Nothing else about a user is.
- This is a learning tool, not financial advice. The site says so, and results here do not predict real trading results.

## Settings

All optional environment variables are listed, with defaults, in `.env.example`.

## Project layout

```
app/
  main.py       API routes, WebSocket price stream, security headers
  engine.py     orders, positions, stops, liquidation, leaderboard
  risk.py       position sizing and liquidation maths
  prices.py     price hub: CCXT, Yahoo, demo feed, failover
  markets.py    the list of tradable markets and their sizing rules
  stats.py      journal statistics
  auth.py       passwords, sessions, rate limiting
  db.py         tables
static/         the website (index.html, css, js, views, vendored chart library and font)
tests/          automated tests
```

## Credits and licences

- Charts: [TradingView Lightweight Charts](https://github.com/tradingview/lightweight-charts), Apache-2.0 (licence in `static/vendor/`). The TradingView logo on charts is the required attribution; leave it in place.
- Font: IBM Plex Sans, SIL Open Font License (`static/fonts/IBM-PLEX-OFL.txt`).
- Prices via [CCXT](https://github.com/ccxt/ccxt) (MIT). Exchange data is subject to each exchange's terms.
