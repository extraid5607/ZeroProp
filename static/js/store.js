// Shared state: who is logged in, the market list, live prices and the account.
// Views subscribe to events instead of polling on their own.
import { api } from './api.js';

const listeners = new Map();
export function on(event, fn) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(fn);
  return () => listeners.get(event).delete(fn);
}
export function emit(event, payload) {
  (listeners.get(event) || []).forEach((fn) => { try { fn(payload); } catch (e) { console.error(e); } });
}

export const store = {
  me: null,          // { app_name, demo, user, limits }
  markets: [],       // market catalogue (from /api/markets)
  byId: {},
  prices: {},        // id -> { p, c, f }
  account: null,
  symbol: null,
  tf: '15m',
  handled: new Set(), // "trade:12" / "order:3" the user closed or cancelled themselves (no alert needed)
  quietUntil: 0,      // no auto-close alerts before this time (used right after an account reset)
};

export function market(id) { return store.byId[id] || null; }
export function markHandled(kind, id) { store.handled.add(`${kind}:${id}`); }
export function stayQuiet(ms = 4000) { store.quietUntil = Date.now() + ms; }

export async function loadMe() {
  store.me = await api('/api/me');
  return store.me;
}

export async function loadMarkets() {
  const { markets } = await api('/api/markets');
  store.markets = markets;
  store.byId = Object.fromEntries(markets.map((m) => [m.id, m]));
  for (const m of markets) {
    if (m.price != null) store.prices[m.id] = { p: m.price, c: m.change24h, f: m.live ? 1 : 0 };
  }
  if (!store.symbol || !store.byId[store.symbol]) store.symbol = markets.find((m) => m.id === 'BTCUSDT') ? 'BTCUSDT' : markets[0].id;
}

export function setAccount(acct) {
  store.account = acct;
  emit('account', acct);
}

export async function refreshAccount() {
  if (!store.me || !store.me.user) return null;
  const acct = await api('/api/account');
  setAccount(acct);
  return acct;
}

export function setSymbol(id) {
  if (!store.byId[id] || id === store.symbol) return;
  store.symbol = id;
  emit('symbol', id);
}

export function setTimeframe(tf) {
  store.tf = tf;
  emit('timeframe', tf);
}

// ---------------------------------------------------------------- live prices
let ws = null;
let wsTimer = null;
let pollTimer = null;
let wsFailures = 0;

function applyPrices(q) {
  store.prices = { ...store.prices, ...q };
  emit('prices', store.prices);
}

function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(async () => {
    try { const r = await api('/api/prices'); applyPrices(r.q); } catch (_) { /* retry next tick */ }
  }, 2000);
}

export function connectPrices() {
  if (ws) return;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  try { ws = new WebSocket(`${proto}://${location.host}/ws/prices`); } catch (_) { startPolling(); return; }
  ws.onopen = () => { wsFailures = 0; if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } };
  ws.onmessage = (ev) => { try { applyPrices(JSON.parse(ev.data).q); } catch (_) { /* ignore bad frame */ } };
  ws.onclose = () => {
    ws = null;
    wsFailures += 1;
    if (wsFailures >= 3) startPolling();   // WebSockets blocked: fall back to polling
    clearTimeout(wsTimer);
    wsTimer = setTimeout(connectPrices, Math.min(15000, 1000 * wsFailures));
  };
  ws.onerror = () => { try { ws.close(); } catch (_) { /* ignore */ } };
}

// ---------------------------------------------------------------- account polling
let acctTimer = null;
export function startAccountPolling() {
  stopAccountPolling();
  acctTimer = setInterval(() => {
    if (document.hidden) return;
    refreshAccount().catch(() => {});
  }, 2000);
}
export function stopAccountPolling() { clearInterval(acctTimer); acctTimer = null; }
