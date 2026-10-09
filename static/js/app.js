// App shell: top bar, page switching (URL hash), login state, theme toggle.
import { api, setUnauthorizedHandler } from './api.js';
import { h, mount, money, tone, toast, storage } from './util.js';
import {
  store, on, loadMe, loadMarkets, connectPrices, refreshAccount, startAccountPolling,
  stopAccountPolling, setAccount,
} from './store.js';
import { renderAuth } from './views/auth.js';
import { renderTrade } from './views/trade.js';
import { renderJournal } from './views/journal.js';
import { renderStats } from './views/stats.js';
import { renderRules } from './views/rules.js';
import { renderLeaderboard } from './views/leaderboard.js';

const ROUTES = [
  ['trade', 'Trade', renderTrade],
  ['journal', 'Journal', renderJournal],
  ['stats', 'Stats', renderStats],
  ['rules', 'Rules', renderRules],
  ['leaderboard', 'Ranks', renderLeaderboard],
];
const ROUTE_TITLES = { trade: 'Trade', journal: 'Journal', stats: 'Stats', rules: 'Risk rules', leaderboard: 'Leaderboard' };
const ROUTE_ICONS = {
  trade: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M7 16l4-6 4 4 6-9"/></svg>',
  journal: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z"/><path d="M8 7h8M8 11h8M8 15h5"/></svg>',
  stats: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 20V10M12 20V4M6 20v-6"/></svg>',
  rules: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg>',
  leaderboard: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6M18 9h1.5a2.5 2.5 0 0 0 0-5H18M4 22h16M10 14.66V17c0 .55-.45 1-1 1H7M14 14.66V17c0 .55.45 1 1 1h2M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg>',
};

const root = document.getElementById('app');
let shell = null;        // { main, nav, acct, banner } while logged in
let destroyView = null;  // cleanup function of the page that is on screen
let unsubShell = [];

function routeFromHash() {
  const id = (location.hash || '').replace(/^#\/?/, '').split(/[?/]/)[0];
  return ROUTES.some((r) => r[0] === id) ? id : 'trade';
}

function stopView() {
  if (destroyView) { try { destroyView(); } catch (e) { console.error(e); } }
  destroyView = null;
}

function setTitle(label) {
  const name = (store.me && store.me.app_name) || 'ZeroProp';
  document.title = label ? `${label} · ${name}` : `${name}: Professional Trading Evaluation`;
}

// ---------------------------------------------------------------- theme
function effectiveTheme() {
  const set = document.documentElement.getAttribute('data-theme');
  if (set === 'light' || set === 'dark') return set;
  return window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function toggleTheme() {
  const next = effectiveTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  storage('zp_theme', next);
  drawThemeButton();
  if (shell) showRoute(false);   // charts read their colours when created, so redraw the page
}

let themeBtn = null;
function drawThemeButton() {
  if (!themeBtn) return;
  const dark = effectiveTheme() === 'dark';
  themeBtn.innerHTML = dark
    ? '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg><span class="hide-sm">Light</span>'
    : '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg><span class="hide-sm">Dark</span>';
  themeBtn.setAttribute('aria-label', dark ? 'Switch to the light theme' : 'Switch to the dark theme');
}

// ---------------------------------------------------------------- logged-in shell
function acctItem(label, value, cls = '', extra = '') {
  return h('div', { class: `acct-item ${extra}`.trim() }, h('span', null, label), h('strong', { class: cls }, value));
}

function drawAccount() {
  if (!shell) return;
  const a = store.account;
  if (!a) { mount(shell.acct, acctItem('Equity', '–', '', 'big')); return; }
  mount(shell.acct,
    h('div', { class: 'acct-item big' },
      h('span', null, 'Equity'),
      h('strong', null, money(a.equity), a.locked ? h('span', { class: 'badge warn lock-badge', title: 'Daily loss limit reached. New trades unlock at 00:00 UTC.' }, 'Locked') : null)),
    acctItem('Today', money(a.day_pnl, { sign: true }), tone(a.day_pnl), 'hide-xs'),
    acctItem('Available', money(Math.max(a.available, 0)), '', 'hide-md hide-sm'),
    acctItem('Open P&L', money(a.unrealized, { sign: true }), tone(a.unrealized), 'hide-md hide-sm'));
}

function drawNav(active) {
  mount(shell.nav, ROUTES.map(([id, label]) => {
    const a = h('a', {
      href: `#/${id}`, 'aria-current': id === active ? 'page' : null, class: 'nav-link',
    });
    const icon = h('span', { class: 'nav-icon' });
    icon.innerHTML = ROUTE_ICONS[id] || '';
    const text = h('span', { class: 'nav-text' }, label);
    mount(a, icon, text);
    return a;
  }));
}

async function logout() {
  try { await api('/api/auth/logout', { method: 'POST' }); } catch (_) { /* leaving anyway */ }
  endSession();
}

function endSession(message) {
  stopAccountPolling();
  stopView();
  unsubShell.forEach((f) => f());
  unsubShell = [];
  shell = null;
  store.account = null;
  if (store.me) store.me.user = null;
  location.hash = '';
  renderLoggedOut();
  if (message) toast(message, 'info');
}

function renderLoggedIn() {
  stopView();
  const main = h('main', { id: 'main', tabindex: '-1' });
  const nav = h('nav', { class: 'nav', 'aria-label': 'Pages' });
  const acct = h('div', { class: 'acct', 'aria-live': 'off' });
  themeBtn = h('button', { type: 'button', class: 'btn ghost sm btn-icon', on: { click: toggleTheme } });
  const logoutBtn = h('button', { type: 'button', class: 'btn ghost sm btn-icon', on: { click: logout }, title: 'Log out', 'aria-label': 'Log out' });
  logoutBtn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg><span class="hide-sm">Log out</span>';
  const banner = h('div', { class: 'banner', role: 'note' });
  const top = h('header', { class: 'topbar' },
    h('a', { class: 'brand', href: '#/trade' },
      h('img', { src: '/img/logo.svg', alt: '', class: 'brand-logo', width: '30', height: '30' }),
      h('span', { class: 'brand-text' },
        h('span', { class: 'brand-zero' }, 'Zero'),
        h('span', { class: 'brand-prop' }, 'Prop'))),
    nav, acct,
    h('div', { class: 'topbar-tools' },
      h('span', { class: 'badge accent hide-sm', title: 'Signed in as' }, store.me.user.username),
      themeBtn, logoutBtn));
  mount(root, top, store.me.demo ? banner : null, main);
  if (store.me.demo) banner.textContent = 'Demo mode: prices are simulated and move faster than real markets. Nothing here is a real quote.';
  shell = { main, nav, acct, banner };
  drawThemeButton();
  drawAccount();
  unsubShell.push(on('account', drawAccount));
  showRoute(false);
}

function showRoute(moveFocus) {
  if (!shell) return;
  const id = routeFromHash();
  const route = ROUTES.find((r) => r[0] === id);
  stopView();
  window.scrollTo(0, 0);
  drawNav(id);
  setTitle(ROUTE_TITLES[id]);
  try {
    destroyView = route[2](shell.main) || null;
  } catch (e) {
    console.error(e);
    mount(shell.main, h('div', { class: 'page' }, h('div', { class: 'panel empty' },
      h('strong', null, 'This page could not load'), 'Reload the page and try again.')));
  }
  if (moveFocus) shell.main.focus({ preventScroll: true });
}

// ---------------------------------------------------------------- logged-out screen
function renderLoggedOut() {
  stopView();
  themeBtn = null;
  setTitle('');
  const view = h('div', { id: 'main' });
  mount(root, view);
  destroyView = renderAuth(view, async () => {
    stopView();
    try { await refreshAccount(); } catch (_) { /* the poller will retry */ }
    startAccountPolling();
    renderLoggedIn();
  });
}

// ---------------------------------------------------------------- boot
async function boot() {
  setUnauthorizedHandler(() => {
    if (store.me && store.me.user) endSession('Your session ended. Please log in again.');
  });
  window.addEventListener('hashchange', () => showRoute(true));

  try {
    await Promise.all([loadMe(), loadMarkets()]);
  } catch (e) {
    mount(root, h('div', { class: 'page page-narrow' }, h('div', { class: 'panel empty' },
      h('strong', null, 'Could not reach the server'), 'Check your connection and reload the page.')));
    return;
  }
  connectPrices();
  if (store.me.user) {
    try { await refreshAccount(); } catch (_) { setAccount(null); }
    startAccountPolling();
    renderLoggedIn();
  } else {
    renderLoggedOut();
  }
}

boot();
