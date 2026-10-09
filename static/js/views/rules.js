// Rules: the limits you set for yourself, how the simulation works, and account reset.
import { api } from '../api.js';
import { h, mount, money, pct, toast } from '../util.js';
import { store, setAccount, emit, stayQuiet } from '../store.js';
import { confirmDialog } from '../dialogs.js';

const BEGINNER = { require_sl: true, max_leverage: 5, max_risk_pct: 1, daily_loss_pct: 3 };

export function renderRules(root) {
  const user = store.me.user;
  const s = user.settings;

  const requireSl = h('input', { type: 'checkbox', id: 'r-sl', checked: s.require_sl });
  const maxLev = h('input', { type: 'number', id: 'r-lev', min: '1', max: '30', step: '1', value: String(s.max_leverage), inputmode: 'numeric' });
  const maxRisk = h('input', { type: 'number', id: 'r-risk', min: '0.1', max: '100', step: '0.1', value: String(s.max_risk_pct), inputmode: 'decimal' });
  const dayLoss = h('input', { type: 'number', id: 'r-day', min: '0', max: '100', step: '0.5', value: String(s.daily_loss_pct), inputmode: 'decimal' });
  const err = h('p', { class: 'dlg-error', role: 'alert' });
  const saveBtn = h('button', { type: 'button', class: 'btn primary' }, 'Save rules');

  function fill(v) {
    requireSl.checked = v.require_sl;
    maxLev.value = String(v.max_leverage);
    maxRisk.value = String(v.max_risk_pct);
    dayLoss.value = String(v.daily_loss_pct);
  }

  async function save() {
    const lev = Number(maxLev.value), risk = Number(maxRisk.value), day = Number(dayLoss.value);
    if (!Number.isInteger(lev) || lev < 1 || lev > 30) { err.textContent = 'Maximum leverage must be a whole number from 1 to 30.'; return; }
    if (!(risk >= 0.1 && risk <= 100)) { err.textContent = 'Risk per trade must be between 0.1% and 100%.'; return; }
    if (!(day >= 0 && day <= 100)) { err.textContent = 'Daily loss limit must be between 0% and 100%. Use 0 to turn it off.'; return; }
    err.textContent = '';
    saveBtn.disabled = true;
    try {
      const r = await api('/api/settings', { method: 'PATCH', body: { require_sl: requireSl.checked, max_leverage: lev, max_risk_pct: risk, daily_loss_pct: day } });
      store.me.user = r.user;
      toast('Rules saved.', 'ok');
    } catch (e) {
      err.textContent = e.message;
    } finally {
      saveBtn.disabled = false;
    }
  }
  saveBtn.addEventListener('click', save);

  async function resetAccount() {
    const ok = await confirmDialog({
      title: 'Reset your account?',
      body: `This closes every open position at the current price, cancels pending orders, and starts season ${user.season + 1} with ${money(user.start_balance, { decimals: 0 })}. Your journal, stats and leaderboard rank only count the new season.`,
      confirmLabel: 'Reset account', danger: true,
    });
    if (!ok) return;
    try {
      stayQuiet();
      const r = await api('/api/account/reset', { method: 'POST', body: { confirm: true } });
      store.me.user = r.user;
      setAccount(r.account);
      emit('closed', []);
      toast(`Season ${r.user.season} started with ${money(r.user.start_balance, { decimals: 0 })}.`, 'ok');
      renderRules(root);
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  // fees and leverage, read from the live market catalogue
  const classes = [['crypto', 'Crypto'], ['metal', 'Commodities (Gold, Silver, Oil)'], ['forex', 'Forex']].map(([cls, label]) => {
    const m = store.markets.find((x) => x.cls === cls);
    return m ? { label, taker: m.fee_rate * 100, maker: m.maker_rate * 100, lev: m.max_leverage } : null;
  }).filter(Boolean);

  mount(root, h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('h1', null, 'Rules')),
    h('p', { class: 'page-sub' }, 'Set limits for yourself. The simulator enforces them on every order, the way a disciplined trader would.'),
    h('div', { class: 'rules-grid' },
      h('div', { style: { display: 'grid', gap: '14px' } },
        h('section', { class: 'panel panel-pad form-grid' },
          h('h2', null, 'Your risk limits'),
          h('div', { class: 'check-row' }, requireSl, h('label', { for: 'r-sl' }, 'Require a stop-loss on every trade', h('small', null, 'Orders without a stop-loss are refused.'))),
          h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'r-lev' }, 'Maximum leverage'), maxLev,
            h('span', { class: 'field-hint' }, 'Higher leverage puts liquidation closer to your entry.')),
          h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'r-risk' }, 'Maximum risk per trade (% of equity)'), maxRisk,
            h('span', { class: 'field-hint' }, 'Counted from your entry to your stop-loss, fees included.')),
          h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'r-day' }, 'Daily loss limit (% of equity at the start of the day)'), dayLoss,
            h('span', { class: 'field-hint' }, 'After this loss you cannot open new trades until 00:00 UTC. Use 0 to turn it off.')),
          err,
          h('div', { class: 'rules-actions' }, saveBtn,
            h('button', { type: 'button', class: 'btn', on: { click: () => fill(BEGINNER) } }, 'Fill in beginner rules'))),
        h('section', { class: 'panel panel-pad form-grid danger-zone' },
          h('h2', null, 'Account'),
          h('p', null, `Season ${user.season}. You started with ${money(user.start_balance, { decimals: 0 })}.`),
          h('p', { class: 'fine' }, 'Blown the account, or want a clean start? Resetting keeps your username.'),
          h('div', { class: 'rules-actions' }, h('button', { type: 'button', class: 'btn danger', on: { click: resetAccount } }, 'Reset account')))),
      h('section', { class: 'panel panel-pad form-grid' },
        h('h2', null, 'How the simulation works'),
        h('ul', { class: 'explain' },
          h('li', null, 'Market orders fill at the latest price. A limit order waits until the price touches your level.'),
          h('li', null, 'A stop-loss fills at the price when it triggers. In a fast move that can be worse than your stop, so a loss can be bigger than 1R.'),
          h('li', null, 'A take-profit fills at your target price.'),
          h('li', null, 'Every position has its own margin. If losses use it up, the position is liquidated at the liquidation price shown in the order panel.'),
          h('li', null, 'Crypto and commodities (Gold, Silver, Oil) come from real-time exchange data with 0 delay. Forex comes from public market data and pauses when FX markets close on weekends.')),
        h('div', { style: { overflowX: 'auto' } },
          h('table', { class: 'tbl' },
            h('thead', null, h('tr', null, [['Market', ''], ['Market order fee', 'r'], ['Limit order fee', 'r'], ['Max leverage', 'r']].map(([t, c]) => h('th', { class: c }, t)))),
            h('tbody', null, classes.map((c) => h('tr', null,
              h('td', { class: 'sym' }, c.label),
              h('td', { class: 'r' }, pct(c.taker, { decimals: 3 })),
              h('td', { class: 'r' }, pct(c.maker, { decimals: 3 })),
              h('td', { class: 'r' }, `${c.lev}×`)))))),
        h('p', { class: 'fine' }, 'ZeroProp is a simulated evaluation and training environment. Real trading involves spreads, slippage, and execution factors. Nothing here constitutes financial advice.')))));
}
