// The tabbed panel under the chart: open positions, pending orders and recent history.
// Tables are updated cell by cell (never rebuilt) so buttons stay put while prices tick.
import { api } from './api.js';
import { h, mount, money, pct, rMult, price, qtyText, tone, arrow, dateTime, toast } from './util.js';
import { store, on, emit, market, setAccount, markHandled } from './store.js';
import { openStopsDialog, openJournalDialog, confirmDialog, REASONS } from './dialogs.js';

function sideBadge(side, extra = '') {
  return h('span', { class: `badge ${side === 'long' ? 'up' : 'down'}` }, side === 'long' ? '▲ Long' : '▼ Short', extra);
}

function marketLabel(m) {
  return m.cls === 'crypto' ? `${m.base}/${m.quote}` : m.name;
}

// Generic table whose rows are created once and then only have their cells refreshed.
// column: { label, cls, fill(td, item), once }  (once: fill only when the row is created)
function keyedTable(columns, getKey) {
  const tbody = h('tbody');
  const table = h('table', { class: 'tbl tbl-cards' },
    h('thead', null, h('tr', null, columns.map((c) => h('th', { class: c.cls || '' }, c.label || '')))),
    tbody);
  const rows = new Map();

  function update(items) {
    const keys = new Set(items.map(getKey));
    for (const [k, row] of rows) {
      if (!keys.has(k)) { row.tr.remove(); rows.delete(k); }
    }
    let prev = null;
    for (const item of items) {
      const k = getKey(item);
      let row = rows.get(k);
      if (!row) {
        const tds = columns.map((c) => h('td', { class: c.cls || '', 'data-label': c.label || null }));
        row = { tr: h('tr', null, tds), tds };
        columns.forEach((c, i) => c.fill(tds[i], item));
        rows.set(k, row);
      } else {
        columns.forEach((c, i) => { if (!c.once) c.fill(row.tds[i], item); });
      }
      const ref = prev ? prev.nextSibling : tbody.firstChild;
      if (row.tr !== ref) tbody.insertBefore(row.tr, ref);
      prev = row.tr;
    }
  }
  return { el: table, update };
}

function keyedPositions(closePosition, openStops) {
  const container = h('div', { class: 'pos-card-list' });
  const cards = new Map();

  function update(positions) {
    const keys = new Set(positions.map((p) => p.id));
    for (const [k, row] of cards) {
      if (!keys.has(k)) {
        row.el.remove();
        cards.delete(k);
      }
    }

    let prev = null;
    for (const p of positions) {
      const m = market(p.symbol);
      let row = cards.get(p.id);

      if (!row) {
        const markPrice = h('span', { class: 'pos-val font-num' });
        const pnlHero = h('div', { class: 'pos-pnl-hero' });
        const pnlVal = h('div', { class: 'pos-pnl-num font-num' });
        const pnlPct = h('span', { class: 'pos-pnl-pct font-num' });
        const rBadge = h('span', { class: 'badge sm pos-r-badge' });
        const slVal = h('span', { class: 'pos-pill-text font-num' });
        const slPill = h('div', {
          class: 'pos-pill pos-pill-sl',
          role: 'button',
          tabindex: '0',
          title: 'Click to adjust Stop-Loss',
          on: { click: () => { const cur = (store.account?.positions || []).find((x) => x.id === p.id); if (cur) openStops(cur); } },
        },
          h('span', { class: 'pos-dot dot-red' }),
          slVal);

        const tpVal = h('span', { class: 'pos-pill-text font-num' });
        const tpPill = h('div', {
          class: 'pos-pill pos-pill-tp',
          role: 'button',
          tabindex: '0',
          title: 'Click to adjust Take-Profit',
          on: { click: () => { const cur = (store.account?.positions || []).find((x) => x.id === p.id); if (cur) openStops(cur); } },
        },
          h('span', { class: 'pos-dot dot-green' }),
          tpVal);

        const liqVal = h('span', { class: 'pos-val font-num' });
        const liqPill = h('span', { class: 'badge sm pos-liq-badge' });

        const closeBtn = h('button', {
          type: 'button',
          class: 'btn sm danger pos-btn-close',
          on: { click: () => closePosition(p.id, closeBtn) },
        }, 'Close Position');

        const editBtn = h('button', {
          type: 'button',
          class: 'btn sm ghost pos-btn-edit',
          on: { click: () => { const cur = (store.account?.positions || []).find((x) => x.id === p.id); if (cur) openStops(cur); } },
        });
        editBtn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:6px"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>Edit stops';

        const el = h('article', { class: 'pos-card', 'data-pos-id': String(p.id) },
          // Header: Symbol, Side/Lev, Size & Hero PnL
          h('div', { class: 'pos-head' },
            h('div', { class: 'pos-market' },
              h('div', { class: 'pos-sym-line' },
                h('strong', { class: 'pos-sym' }, marketLabel(m)),
                sideBadge(p.side, ` ${p.leverage}×`)),
              h('div', { class: 'pos-meta-line muted' },
                h('span', null, `${qtyText(m, p.qty)} ${m.qty_label}`),
                h('span', { class: 'pos-meta-sep' }, '·'),
                h('span', null, money(p.notional, { decimals: 0 })))),
            mount(pnlHero,
              h('span', { class: 'pos-pnl-label' }, 'UNREALIZED P&L'),
              pnlVal,
              h('div', { class: 'pos-pnl-sub' }, pnlPct, rBadge))),

          // Key Metrics Grid
          h('div', { class: 'pos-grid' },
            // 1. Entry Price
            h('div', { class: 'pos-tile' },
              h('span', { class: 'pos-tile-lbl' }, 'Entry Price'),
              h('span', { class: 'pos-val font-num' }, price(m, p.entry))),

            // 2. Mark / Current Price
            h('div', { class: 'pos-tile' },
              h('span', { class: 'pos-tile-lbl' }, 'Mark Price'),
              markPrice),

            // 3. Stop Loss (SL)
            h('div', { class: 'pos-tile pos-tile-sl' },
              h('span', { class: 'pos-tile-lbl' }, 'Stop Loss (SL)'),
              slPill),

            // 4. Target (TP)
            h('div', { class: 'pos-tile pos-tile-tp' },
              h('span', { class: 'pos-tile-lbl' }, 'Target (TP)'),
              tpPill),

            // 5. Margin Held
            h('div', { class: 'pos-tile' },
              h('span', { class: 'pos-tile-lbl' }, 'Margin Held'),
              h('span', { class: 'pos-val font-num' }, money(p.margin || (p.notional / p.leverage), { decimals: 2 }))),

            // 6. Liquidation
            h('div', { class: 'pos-tile pos-tile-liq' },
              h('span', { class: 'pos-tile-lbl' }, 'Est. Liquidation'),
              h('div', { class: 'pos-liq-row' }, liqVal, liqPill))),

          // Action buttons
          h('div', { class: 'pos-actions' },
            editBtn,
            closeBtn));

        row = {
          el,
          refs: {
            markPrice,
            pnlHero,
            pnlVal,
            pnlPct,
            rBadge,
            slVal,
            slPill,
            tpVal,
            tpPill,
            liqVal,
            liqPill,
          },
        };
        cards.set(p.id, row);
      }

      // Live updates
      const { refs } = row;
      refs.markPrice.textContent = price(m, p.price);
      refs.pnlHero.className = `pos-pnl-hero ${tone(p.upnl)}`;
      refs.pnlVal.textContent = `${arrow(p.upnl)} ${money(p.upnl, { sign: true })}`;
      refs.pnlPct.textContent = pct(p.upnl_pct, { sign: true });

      if (p.r_now != null) {
        refs.rBadge.style.display = 'inline-flex';
        refs.rBadge.textContent = rMult(p.r_now);
        refs.rBadge.className = `badge sm pos-r-badge ${tone(p.r_now)}`;
      } else {
        refs.rBadge.style.display = 'none';
      }

      // SL Pill update
      if (p.sl != null) {
        refs.slVal.textContent = price(m, p.sl);
        refs.slPill.className = 'pos-pill pos-pill-sl set';
      } else {
        refs.slVal.textContent = 'None · Set SL';
        refs.slPill.className = 'pos-pill pos-pill-sl unset';
      }

      // TP Pill update
      if (p.tp != null) {
        refs.tpVal.textContent = price(m, p.tp);
        refs.tpPill.className = 'pos-pill pos-pill-tp set';
      } else {
        refs.tpVal.textContent = 'None · Set TP';
        refs.tpPill.className = 'pos-pill pos-pill-tp unset';
      }

      // Liq update
      refs.liqVal.textContent = price(m, p.liq);
      if (p.liq_distance_pct != null) {
        const near = p.liq_distance_pct < 5;
        const warn = p.liq_distance_pct < 10;
        refs.liqPill.textContent = `${pct(p.liq_distance_pct, { decimals: 1 })} away`;
        refs.liqPill.className = `badge sm pos-liq-badge ${near ? 'down' : warn ? 'warn' : ''}`;
      } else {
        refs.liqPill.textContent = '';
      }

      const ref = prev ? prev.nextSibling : container.firstChild;
      if (row.el !== ref) container.insertBefore(row.el, ref);
      prev = row.el;
    }
  }

  return { el: container, update };
}

export function createDock(root) {
  const unsub = [];
  let tab = 'positions';
  let history = null;          // { total, trades } once loaded
  let historyStale = true;
  let historyBusy = false;

  const tabs = h('div', { class: 'dock-tabs', role: 'tablist' });
  const body = h('div', { class: 'dock-body', role: 'tabpanel' });
  mount(root, tabs, body);

  // ---------------------------------------------------------------- positions
  const posTable = keyedPositions(closePosition, openStopsDialog);

  async function closePosition(id, btn) {
    btn.disabled = true;
    markHandled('trade', id);
    try {
      const r = await api(`/api/trades/${id}/close`, { method: 'POST' });
      setAccount(r.account);
      const t = r.trade;
      const m = market(t.symbol);
      toast(`Closed ${marketLabel(m)}: ${money(t.pnl, { sign: true })}${t.r != null ? ` (${rMult(t.r)})` : ''}`, t.pnl >= 0 ? 'ok' : 'info');
      historyStale = true;
      if (tab === 'history') loadHistory();
    } catch (e) {
      store.handled.delete(`trade:${id}`);
      btn.disabled = false;
      toast(e.message, 'error');
    }
  }

  // ---------------------------------------------------------------- orders
  const ordTable = keyedTable([
    { label: 'Market', cls: 'sym', once: true, fill: (td, o) => { const m = market(o.symbol); td.append(marketLabel(m), h('span', { class: 'sub' }, sideBadge(o.side, ` ${o.leverage}×`))); } },
    { label: 'Type', once: true, fill: (td, o) => { td.textContent = o.side === 'long' ? 'Buy limit' : 'Sell limit'; } },
    { label: 'Size', cls: 'r', once: true, fill: (td, o) => { const m = market(o.symbol); td.textContent = `${qtyText(m, o.qty)} ${m.qty_label}`; } },
    { label: 'Limit price', cls: 'r', once: true, fill: (td, o) => { td.textContent = price(market(o.symbol), o.limit_price); } },
    { label: 'Price now', cls: 'r', fill: (td, o) => { const q = store.prices[o.symbol]; td.textContent = q ? price(market(o.symbol), q.p) : '–'; } },
    { label: 'Stop', cls: 'r', once: true, fill: (td, o) => { td.textContent = o.sl != null ? price(market(o.symbol), o.sl) : '–'; } },
    { label: 'Target', cls: 'r', once: true, fill: (td, o) => { td.textContent = o.tp != null ? price(market(o.symbol), o.tp) : '–'; } },
    { label: 'Margin held', cls: 'r', once: true, fill: (td, o) => { td.textContent = money(o.reserved); } },
    { label: '', cls: 'full', once: true, fill: (td, o) => {
      const btn = h('button', { type: 'button', class: 'btn sm', on: { click: () => cancelOrder(o.id, btn) } }, 'Cancel');
      td.append(h('div', { class: 'acts' }, btn));
    } },
  ], (o) => o.id);

  async function cancelOrder(id, btn) {
    btn.disabled = true;
    markHandled('order', id);
    try {
      const r = await api(`/api/orders/${id}`, { method: 'DELETE' });
      setAccount(r.account);
      toast('Order cancelled. Its margin is free again.', 'info');
    } catch (e) {
      store.handled.delete(`order:${id}`);
      btn.disabled = false;
      toast(e.message, 'error');
    }
  }

  // ---------------------------------------------------------------- history
  async function loadHistory() {
    if (historyBusy) return;
    historyBusy = true;
    try {
      history = await api('/api/trades', { params: { limit: 15 } });
      historyStale = false;
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      historyBusy = false;
      if (tab === 'history') renderBody();
    }
  }

  function renderHistory() {
    if (!history) return h('p', { class: 'empty' }, 'Loading your trades…');
    if (!history.trades.length) {
      return h('div', { class: 'empty' }, h('strong', null, 'No closed trades yet'), 'Close a position and it shows up here, ready for a journal note.');
    }
    const t = h('table', { class: 'tbl tbl-cards' },
      h('thead', null, h('tr', null, ['Closed', 'Market', 'Entry', 'Exit', 'P&L', 'R', 'Result', ''].map((x, i) => h('th', { class: i >= 2 && i <= 5 ? 'r' : '' }, x)))),
      h('tbody', null, history.trades.map((x) => {
        const m = market(x.symbol);
        return h('tr', null,
          h('td', { 'data-label': 'Closed' }, dateTime(x.closed_at)),
          h('td', { class: 'sym', 'data-label': 'Market' }, marketLabel(m), ' ', sideBadge(x.side)),
          h('td', { class: 'r', 'data-label': 'Entry' }, price(m, x.entry)),
          h('td', { class: 'r', 'data-label': 'Exit' }, price(m, x.exit)),
          h('td', { class: `r ${tone(x.pnl)}`, 'data-label': 'P&L' }, `${arrow(x.pnl)} ${money(x.pnl, { sign: true })}`.trim()),
          h('td', { class: `r ${tone(x.r)}`, 'data-label': 'R' }, x.r != null ? rMult(x.r) : '–'),
          h('td', { 'data-label': 'Result' }, h('span', { class: `badge ${x.reason === 'liquidation' ? 'down' : ''}` }, REASONS[x.reason] || x.reason)),
          h('td', { class: 'full' }, h('div', { class: 'acts' },
            h('button', { type: 'button', class: 'btn sm ghost', on: { click: () => openJournalDialog(x, (nt) => { Object.assign(x, nt); }) } }, x.note || x.lesson ? 'Edit journal' : 'Add journal'))));
      })));
    return h('div', null, t,
      h('p', { class: 'fine', style: { padding: '8px 12px' } }, history.total > history.trades.length ? `Showing the latest ${history.trades.length} of ${history.total}. ` : '', h('a', { href: '#/journal' }, 'Open the full journal')));
  }

  // ---------------------------------------------------------------- shell
  function drawTabs() {
    const a = store.account;
    const counts = { positions: a ? a.positions.length : 0, orders: a ? a.orders.length : 0 };
    mount(tabs, ['positions', 'orders', 'history'].map((k) => h('button', {
      type: 'button', class: 'dock-tab', role: 'tab', 'aria-selected': String(tab === k),
      on: { click: () => { tab = k; drawTabs(); renderBody(); if (k === 'history' && (historyStale || !history)) loadHistory(); } },
    }, k === 'positions' ? `Positions${counts.positions ? ` (${counts.positions})` : ''}`
      : k === 'orders' ? `Orders${counts.orders ? ` (${counts.orders})` : ''}` : 'History')));
  }

  const posEmpty = h('div', { class: 'empty' }, h('strong', null, 'No open positions'), 'Pick a market, set a stop-loss and open a trade from the order panel.');
  const ordEmpty = h('div', { class: 'empty' }, h('strong', null, 'No pending orders'), 'A limit order waits until the price reaches the level you choose, then opens a position.');

  function renderBody() {
    const a = store.account;
    if (!a) { mount(body); return; }
    if (tab === 'positions') {
      mount(body, a.positions.length ? posTable.el : posEmpty);
      posTable.update(a.positions);
    } else if (tab === 'orders') {
      mount(body, a.orders.length ? ordTable.el : ordEmpty);
      ordTable.update(a.orders);
    } else {
      mount(body, renderHistory());
    }
  }

  let lastCounts = '';
  unsub.push(on('account', (a) => {
    const counts = `${a.positions.length}/${a.orders.length}`;
    if (counts !== lastCounts) { lastCounts = counts; drawTabs(); }
    if (tab === 'positions') {
      const showing = body.firstChild === posTable.el;
      if (showing !== !!a.positions.length) renderBody(); else posTable.update(a.positions);
    } else if (tab === 'orders') {
      const showing = body.firstChild === ordTable.el;
      if (showing !== !!a.orders.length) renderBody(); else ordTable.update(a.orders);
    }
  }));
  unsub.push(on('prices', () => {
    if (tab === 'orders' && store.account && store.account.orders.length) ordTable.update(store.account.orders);
  }));
  unsub.push(on('closed', () => { historyStale = true; if (tab === 'history') loadHistory(); }));

  drawTabs();
  renderBody();

  return { destroy() { unsub.forEach((f) => f()); mount(root); } };
}
