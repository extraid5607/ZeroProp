// The Trade screen: markets list, live chart, order ticket and the positions panel.
import { api } from '../api.js';
import { h, mount, price, pct, tone, arrow, qtyText, cssVar, storage, toast } from '../util.js';
import { store, on, setSymbol, setTimeframe, market } from '../store.js';
import { createPriceChart } from '../chart.js';
import { createTicket } from '../ticket.js';
import { createDock } from '../dock.js';

const TFS = [['1m', '1m'], ['5m', '5m'], ['15m', '15m'], ['1h', '1h'], ['4h', '4h'], ['1d', '1D']];
const TF_SEC = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400 };
const GROUPS = [['crypto', 'Crypto'], ['metal', 'Commodities'], ['forex', 'Forex']];

function title(m) { return m.cls === 'crypto' ? `${m.base}/${m.quote}` : m.name; }

export function renderTrade(root) {
  const unsub = [];
  const cleanups = [];

  const savedSym = storage('zp_symbol');
  if (savedSym && store.byId[savedSym]) store.symbol = savedSym;
  const savedTf = storage('zp_tf');
  if (savedTf && TF_SEC[savedTf]) store.tf = savedTf;

  let mview = storage('zp_mview') || 'chart';
  const posBadge = h('span', { class: 'm-tab-badge' }, '0');
  posBadge.style.display = 'none';

  const mTabChart = h('button', {
    type: 'button', class: 'm-tab-btn', 'aria-selected': String(mview === 'chart'),
    on: { click: () => setMView('chart') },
  }, h('span', null, '📈 Chart'));

  const mTabOrder = h('button', {
    type: 'button', class: 'm-tab-btn', 'aria-selected': String(mview === 'order'),
    on: { click: () => setMView('order') },
  }, h('span', null, '⚡ Order'));

  const mTabDock = h('button', {
    type: 'button', class: 'm-tab-btn', 'aria-selected': String(mview === 'dock'),
    on: { click: () => setMView('dock') },
  }, h('span', null, '📋 Positions'), posBadge);

  const mobileSwitcher = h('div', { class: 'mobile-trade-switcher', role: 'tablist' }, mTabChart, mTabOrder, mTabDock);

  const marketsEl = h('aside', { class: 'panel markets', 'aria-label': 'Markets' });
  const chartPanel = h('section', { class: 'panel chart-panel', 'aria-label': 'Price chart' });
  const dockRoot = h('section', { class: 'panel dock', 'aria-label': 'Positions, orders and history' });
  const ticketRoot = h('aside', { class: 'panel ticket', 'aria-label': 'Order ticket' });

  const workspace = h('div', { class: 'workspace', 'data-mview': mview },
    mobileSwitcher,
    marketsEl,
    h('div', { class: 'chart-col' }, chartPanel, dockRoot),
    ticketRoot);

  mount(root, h('div', { class: 'page' }, workspace));

  function setMView(v) {
    mview = v;
    storage('zp_mview', v);
    workspace.setAttribute('data-mview', v);
    mTabChart.setAttribute('aria-selected', String(v === 'chart'));
    mTabOrder.setAttribute('aria-selected', String(v === 'order'));
    mTabDock.setAttribute('aria-selected', String(v === 'dock'));
    if (v === 'chart' && chart) {
      setTimeout(() => { if (chart) chart.resize(); }, 60);
    }
  }

  // ---------------------------------------------------------------- markets list
  const rows = {};
  mount(marketsEl, GROUPS.map(([cls, label]) => {
    const ms = store.markets.filter((m) => m.cls === cls);
    if (!ms.length) return null;
    return h('div', { class: 'mgroup' }, h('div', { class: 'mgroup-title' }, label), ms.map((m) => {
      const r = {
        price: h('div', { class: 'mrow-price' }),
        chg: h('div', { class: 'mrow-chg' }),
      };
      r.btn = h('button', { type: 'button', class: 'mrow', on: { click: () => { setSymbol(m.id); storage('zp_symbol', m.id); } } },
        h('div', { class: 'mrow-name' }, m.cls === 'crypto' ? m.base : m.name),
        r.price,
        h('div', { class: 'mrow-sub' }, m.cls === 'crypto' ? m.name : m.cls === 'metal' ? `${m.base}/${m.quote}` : ''),
        r.chg);
      rows[m.id] = r;
      return r.btn;
    }));
  }));

  function paintMarkets() {
    for (const m of store.markets) {
      const r = rows[m.id];
      if (!r) continue;
      const q = store.prices[m.id];
      r.price.textContent = q ? price(m, q.p) : '–';
      if (q && !q.f) { r.chg.textContent = 'Closed'; r.chg.className = 'mrow-chg'; }
      else if (q && q.c != null) { r.chg.textContent = `${arrow(q.c)} ${pct(q.c, { sign: true })}`.trim(); r.chg.className = `mrow-chg ${tone(q.c)}`; }
      else { r.chg.textContent = ''; r.chg.className = 'mrow-chg'; }
      r.btn.setAttribute('aria-current', String(m.id === store.symbol));
    }
  }

  // ---------------------------------------------------------------- chart
  const titleEl = h('h2');
  const priceEl = h('span', { class: 'chart-price' });
  const chgEl = h('span', { class: 'chart-chg' });
  const tfSeg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Timeframe' });
  const box = h('div', { class: 'chart-box' });
  const noteEl = h('div', { class: 'chart-note' }, 'Loading chart…');
  box.append(noteEl);
  const btnQuickLong = h('button', {
    type: 'button', class: 'btn-quick-trade quick-long',
    on: { click: () => { if (ticket) ticket.setSide('long'); setMView('order'); } },
  }, h('span', { class: 'quick-btn-icon' }, '▲'), h('span', { class: 'quick-btn-label' }, 'Buy / Long'));

  const btnQuickShort = h('button', {
    type: 'button', class: 'btn-quick-trade quick-short',
    on: { click: () => { if (ticket) ticket.setSide('short'); setMView('order'); } },
  }, h('span', { class: 'quick-btn-icon' }, '▼'), h('span', { class: 'quick-btn-label' }, 'Sell / Short'));

  const quickActions = h('div', { class: 'mobile-quick-bar' }, btnQuickLong, btnQuickShort);

  mount(chartPanel,
    h('div', { class: 'chart-head' }, h('div', { class: 'chart-title' }, titleEl, priceEl, chgEl), tfSeg),
    box,
    quickActions,
    h('p', { class: 'chart-tip' }, 'Tip: click the chart to set a stop-loss or take-profit at that price.'));

  let chart = null;
  let ticket = null;
  if (window.LightweightCharts) {
    chart = createPriceChart(box);
  } else {
    mount(noteEl, 'The chart library did not load. Reload the page to try again.');
  }

  function drawTfs() {
    mount(tfSeg, TFS.map(([tf, label]) => h('button', {
      type: 'button', class: 'seg-btn', 'aria-pressed': String(tf === store.tf),
      on: { click: () => { if (tf === store.tf) return; setTimeframe(tf); storage('zp_tf', tf); drawTfs(); loadCandles(); } },
    }, label)));
  }

  function paintHead() {
    const m = market(store.symbol);
    const q = store.prices[store.symbol];
    titleEl.textContent = title(m);
    priceEl.textContent = q ? price(m, q.p) : '–';
    if (q && !q.f) { chgEl.textContent = 'Market closed'; chgEl.className = 'chart-chg muted'; }
    else if (q && q.c != null) { chgEl.textContent = `${arrow(q.c)} ${pct(q.c, { sign: true })} today`.replace('  ', ' ').trim(); chgEl.className = `chart-chg ${tone(q.c)}`; }
    else { chgEl.textContent = ''; chgEl.className = 'chart-chg'; }
  }

  let loadId = 0;
  async function loadCandles() {
    if (!chart) return;
    const id = ++loadId;
    const m = market(store.symbol);
    const tf = store.tf;
    mount(noteEl, 'Loading chart…');
    noteEl.hidden = false;
    try {
      const r = await api('/api/candles', { params: { symbol: m.id, tf, limit: 300 } });
      if (id !== loadId) return;
      chart.setCandles(r.candles, m, TF_SEC[tf]);
      noteEl.hidden = true;
      syncLines();
    } catch (e) {
      if (id !== loadId) return;
      mount(noteEl, h('p', null, e.message), h('button', { type: 'button', class: 'btn sm', on: { click: loadCandles } }, 'Try again'));
      noteEl.hidden = false;
    }
  }

  // Lines for open positions, pending orders and the order you are drafting in the ticket.
  let draft = null;
  function syncLines() {
    if (!chart) return;
    const sym = store.symbol;
    const m = market(sym);
    const spec = [];
    const a = store.account;
    const down = cssVar('--chart-down'), up = cssVar('--chart-up'), accent = cssVar('--accent'), warn = cssVar('--warn');
    if (a) {
      for (const p of a.positions) {
        if (p.symbol !== sym) continue;
        spec.push({ key: `e${p.id}`, price: p.entry, color: accent, width: 2, title: `${p.side === 'long' ? 'Long' : 'Short'} ${qtyText(m, p.qty)}` });
        if (p.sl != null) spec.push({ key: `s${p.id}`, price: p.sl, color: down, style: 'dashed', title: 'Stop' });
        if (p.tp != null) spec.push({ key: `t${p.id}`, price: p.tp, color: up, style: 'dashed', title: 'Target' });
        spec.push({ key: `l${p.id}`, price: p.liq, color: warn, style: 'dotted', title: 'Liquidation' });
      }
      for (const o of a.orders) {
        if (o.symbol !== sym) continue;
        spec.push({ key: `o${o.id}`, price: o.limit_price, color: accent, style: 'dotted', title: o.side === 'long' ? 'Buy limit' : 'Sell limit' });
      }
    }
    if (draft && draft.symbol === sym) {
      if (draft.entry) spec.push({ key: 'd-entry', price: draft.entry, color: accent, style: 'dotted', title: 'Limit (new)' });
      if (draft.sl) spec.push({ key: 'd-sl', price: draft.sl, color: down, style: 'dotted', title: 'Stop (new)' });
      if (draft.tp) spec.push({ key: 'd-tp', price: draft.tp, color: up, style: 'dotted', title: 'Target (new)' });
      if (draft.liq) spec.push({ key: 'd-liq', price: draft.liq, color: warn, style: 'dotted', title: 'Liq (new)' });
    }
    chart.setLines(spec);
  }

  // click on the chart -> small menu to use that price as stop-loss or take-profit
  let pop = null;
  function hidePop() { if (pop) { pop.remove(); pop = null; } }
  if (chart) {
    chart.onClick((p, pt) => {
      hidePop();
      const m = market(store.symbol);
      pop = h('div', { class: 'pop', role: 'dialog', 'aria-label': 'Use this price' },
        h('div', { class: 'pop-price' }, price(m, p)),
        h('button', { type: 'button', class: 'btn sm', on: { click: () => { ticket && ticket.setField('sl', p); toast(`Stop-loss set to ${price(m, p)}`, 'info'); hidePop(); } } }, 'Use as stop-loss'),
        h('button', { type: 'button', class: 'btn sm', on: { click: () => { ticket && ticket.setField('tp', p); toast(`Take-profit set to ${price(m, p)}`, 'info'); hidePop(); } } }, 'Use as take-profit'),
        h('button', { type: 'button', class: 'btn sm ghost', on: { click: hidePop } }, 'Cancel'));
      box.append(pop);
      pop.style.left = `${Math.max(8, Math.min(pt.x + 12, box.clientWidth - 206))}px`;
      pop.style.top = `${Math.max(8, Math.min(pt.y - 50, box.clientHeight - 148))}px`;
    });
  }
  const onKey = (e) => { if (e.key === 'Escape') hidePop(); };
  const onDown = (e) => { if (pop && !pop.contains(e.target)) hidePop(); };
  document.addEventListener('keydown', onKey);
  document.addEventListener('pointerdown', onDown);
  cleanups.push(() => { document.removeEventListener('keydown', onKey); document.removeEventListener('pointerdown', onDown); });

  // ---------------------------------------------------------------- wiring
  unsub.push(on('prices', () => {
    paintMarkets();
    paintHead();
    const q = store.prices[store.symbol];
    if (chart && q && q.f) chart.tick(q.p);
  }));
  unsub.push(on('symbol', () => { hidePop(); draft = null; paintMarkets(); paintHead(); loadCandles(); syncLines(); }));
  unsub.push(on('account', syncLines));
  unsub.push(on('draft', (d) => { draft = d; syncLines(); }));
  unsub.push(on('theme', () => { if (chart) { chart.applyTheme(); syncLines(); } }));

  const updatePosCount = () => {
    const a = store.account;
    const count = (a && a.positions) ? a.positions.length : 0;
    posBadge.textContent = String(count);
    posBadge.style.display = count > 0 ? 'inline-block' : 'none';
  };
  unsub.push(on('account', updatePosCount));
  updatePosCount();

  drawTfs();
  paintMarkets();
  paintHead();
  ticket = createTicket(ticketRoot);
  const ticketBackBtn = h('button', {
    type: 'button', class: 'btn sm ghost mobile-back-chart',
    on: { click: () => setMView('chart') },
  }, '← Back to Live Chart');
  ticketRoot.prepend(ticketBackBtn);

  const dock = createDock(dockRoot);
  loadCandles();
  syncLines();

  return function destroy() {
    unsub.forEach((f) => f());
    cleanups.forEach((f) => f());
    ticket.destroy();
    dock.destroy();
    if (chart) chart.destroy();
  };
}
