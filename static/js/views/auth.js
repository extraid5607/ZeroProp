// Signed-out screen: what the app is, a worked risk example, live prices, and the login form.
import { api } from '../api.js';
import { h, mount, price, pct, tone, arrow } from '../util.js';
import { store, on } from '../store.js';
import { openInstallDialog } from '../dialogs.js';

const STRIP = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XAUUSD', 'EURUSD', 'USDJPY'];

// A static copy of the order-panel risk ladder, so a new visitor sees what "R" means.
function exampleLadder() {
  const entry = 90000, stop = 89100, target = 91800, liq = 85950;   // long, 20x
  const H = 190, PAD = 16, hi = target, lo = liq, span = hi - lo;
  const y = (v) => PAD + ((hi - v) / span) * (H - 2 * PAD);
  const items = [
    { key: 'tp', name: 'Target', p: target, r: '+1.8R' },
    { key: 'entry', name: 'Entry', p: entry, r: '' },
    { key: 'sl', name: 'Stop', p: stop, r: '−1.0R' },
    { key: 'liq', name: 'Liquidation', p: liq, r: '−4.1R' },
  ].map((i) => ({ ...i, y: y(i.p), ly: y(i.p) }));
  for (let i = 1; i < items.length; i++) if (items[i].ly < items[i - 1].ly + 34) items[i].ly = items[i - 1].ly + 34;
  const zone = (a, b, cls) => h('div', { class: `zone ${cls}`, style: { top: `${Math.min(a, b)}px`, height: `${Math.abs(a - b)}px` } });
  const by = Object.fromEntries(items.map((i) => [i.key, i]));
  return h('div', { class: 'ladder', style: { height: `${H}px` }, role: 'img',
    'aria-label': 'Example: target at plus 1.8 R, entry, stop at minus 1 R, and liquidation at minus 4.1 R' },
  h('div', { class: 'rail' }),
  zone(by.entry.y, by.sl.y, 'zone-risk'), zone(by.entry.y, by.tp.y, 'zone-reward'), zone(by.sl.y, by.liq.y, 'zone-liq'),
  items.map((i) => h('span', { class: `tick tick-${i.key}`, style: { top: `${i.y}px` } })),
  items.map((i) => h('div', { class: `rung rung-${i.key}`, style: { top: `${i.ly}px` } },
    h('span', { class: 'rung-name' }, i.name),
    h('span', { class: 'rung-price' }, i.p.toLocaleString('en-US')),
    h('span', { class: 'rung-r' }, i.r))));
}

export function renderAuth(root, onAuthed) {
  let mode = 'login';
  const unsub = [];

  const modeSeg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Log in or create an account' });
  const username = h('input', { type: 'text', id: 'a-user', autocomplete: 'username', maxlength: '20', spellcheck: 'false', autocapitalize: 'none' });
  const password = h('input', { type: 'password', id: 'a-pass', maxlength: '200' });
  const err = h('p', { class: 'auth-error', role: 'alert' });
  const submit = h('button', { type: 'submit', class: 'btn primary', style: { minHeight: '42px' } });
  const hintUser = h('span', { class: 'field-hint' });
  const hintPass = h('span', { class: 'field-hint' });
  const form = h('form', { novalidate: true },
    h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'a-user' }, 'Username'), username, hintUser),
    h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'a-pass' }, 'Password'), password, hintPass),
    err, submit);

  function drawMode() {
    mount(modeSeg, [['login', 'Log in'], ['register', 'Create account']].map(([v, t]) => h('button', {
      type: 'button', class: 'seg-btn', 'aria-pressed': String(v === mode),
      on: { click: () => { mode = v; err.textContent = ''; drawMode(); } },
    }, t)));
    submit.textContent = mode === 'login' ? 'Log in' : 'Create account and start with $10,000';
    password.setAttribute('autocomplete', mode === 'login' ? 'current-password' : 'new-password');
    hintUser.textContent = mode === 'register' ? '3 to 20 letters, numbers or underscores. This is your name on the leaderboard.' : '';
    hintPass.textContent = mode === 'register' ? 'At least 8 characters. There is no email, so there is no password reset: keep it safe.' : '';
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const u = username.value.trim(), p = password.value;
    if (!u || !p) { err.textContent = 'Enter your username and password.'; return; }
    submit.disabled = true; err.textContent = '';
    try {
      const r = await api(mode === 'login' ? '/api/auth/login' : '/api/auth/register', { method: 'POST', body: { username: u, password: p } });
      store.me.user = r.user;
      onAuthed();
    } catch (ex) {
      err.textContent = ex.message;
      submit.disabled = false;
    }
  });

  // live price strip
  const strip = h('div', { class: 'strip', 'aria-label': 'Live prices' });
  const cells = {};
  for (const id of STRIP) {
    const m = store.byId[id];
    if (!m) continue;
    cells[id] = { p: h('strong'), c: h('span') };
    strip.append(h('div', { class: 'strip-item' }, h('span', null, m.cls === 'crypto' ? `${m.base}/${m.quote}` : m.name), cells[id].p, cells[id].c));
  }
  function paintStrip() {
    for (const [id, c] of Object.entries(cells)) {
      const m = store.byId[id], q = store.prices[id];
      c.p.textContent = q ? price(m, q.p) : '–';
      if (q && !q.f) { c.c.textContent = 'Market closed'; c.c.className = ''; }
      else if (q && q.c != null) { c.c.textContent = `${arrow(q.c)} ${pct(q.c, { sign: true })}`.trim(); c.c.className = tone(q.c); }
      else c.c.textContent = '';
    }
  }
  unsub.push(on('prices', paintStrip));

  const authInstallBtn = h('button', {
    type: 'button', class: 'btn sm btn-pwa-install',
    on: { click: () => openInstallDialog({ deferredPrompt: window.__zp_install_prompt }) },
  });
  authInstallBtn.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg><span>Download App</span>';
  if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true) {
    authInstallBtn.style.display = 'none';
  }

  mount(root,
    h('div', { class: 'auth' },
      h('div', { class: 'auth-brand' },
        h('span', { class: 'brand' },
          h('img', { src: '/img/logo.svg', alt: '', class: 'brand-logo', width: '34', height: '34' }),
          h('span', { class: 'brand-text' },
            h('span', { class: 'brand-zero' }, 'Zero'),
            h('span', { class: 'brand-prop' }, 'Prop'))),
        authInstallBtn),
      h('div', { class: 'auth-intro' },
        h('h1', null, 'Learn to trade with pretend money'),
        h('p', { class: 'auth-lead' }, 'Start with $10,000. Trade crypto, forex, gold and silver on live prices, and find out what a trade would really have cost you before it costs you anything.'),
        h('ul', { class: 'auth-points' },
          h('li', null, h('strong', null, 'See your risk before you click. '), 'Set a stop-loss and the order panel shows your position size, liquidation price and reward, all measured in R.'),
          h('li', null, h('strong', null, 'Keep a journal. '), 'Note why you took each trade and how you felt, then see which setups and moods make or lose money.'),
          h('li', null, h('strong', null, 'Set your own rules. '), 'Limit leverage, require stop-losses and cap your daily loss. The simulator holds you to them.'),
          h('li', null, h('strong', null, 'Compare with others. '), 'A leaderboard ranks practice accounts by return.')),
        h('section', { class: 'panel example' },
          h('h2', null, 'Example: a long with a 1% stop at 20× leverage'),
          exampleLadder(),
          h('p', { class: 'fine' }, 'Example numbers. 1R is what you lose if the stop is hit, fees included. At 20× leverage, liquidation is more than four times further away than the stop.'))),
      h('section', { class: 'panel auth-card', 'aria-label': 'Log in or create an account' }, modeSeg, form)),
    strip,
    h('p', { class: 'disclaimer' }, 'ZeroProp uses simulated funds on real-time market data for educational and evaluation purposes. It does not provide financial advice.'));

  drawMode();
  paintStrip();
  return function destroy() { unsub.forEach((f) => f()); };
}
