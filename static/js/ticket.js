// Order ticket + risk ladder. All the maths comes from the server (/api/risk/size), so what
// you see in the preview is exactly what the engine will enforce.
import { api } from './api.js';
import { h, mount, debounce, num, money, pct, rMult, price, qtyText, toast } from './util.js';
import { store, on, emit, market, setAccount } from './store.js';

const SETUPS = ['Breakout', 'Pullback', 'Reversal', 'Range', 'Trend follow', 'News', 'Other'];
const SL_CHIPS = [0.5, 1, 2, 5];
const TP_CHIPS = [1, 2, 3];

function parse(v) {
  const n = parseFloat(String(v).replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function createTicket(root) {
  const ui = {
    side: 'long', type: 'market', sizeBy: 'risk',
    limit: '', sl: '', tp: '', risk: '1', qty: '', lev: 5, setup: '', note: '',
  };
  let preview = null;      // last server preview
  let previewErr = '';
  let reqId = 0;
  let busy = false;
  const refs = {};
  const unsub = [];

  // ---------------------------------------------------------------- helpers
  const mk = () => market(store.symbol);
  const live = () => { const p = store.prices[store.symbol]; return p && p.f ? p.p : null; };
  const cap = () => {
    const m = mk();
    const user = store.me.user;
    return Math.max(1, Math.min(user.settings.max_leverage, m.max_leverage));
  };
  const refPrice = () => (ui.type === 'limit' ? parse(ui.limit) : live());

  function seg(options, value, onPick, cls = '') {
    return h('div', { class: `seg ${cls}`, role: 'group' }, options.map(([val, label, extra]) =>
      h('button', {
        type: 'button', class: `seg-btn ${extra || ''}`, 'aria-pressed': String(val === value),
        on: { click: () => onPick(val) },
      }, label)));
  }

  function field(label, input, hint) {
    return h('label', { class: 'field' },
      h('span', { class: 'field-label' }, label),
      input,
      hint ? h('span', { class: 'field-hint' }, hint) : null);
  }

  function textInput(key, placeholder, attrs = {}) {
    const el = h('input', {
      type: 'text', inputmode: 'decimal', autocomplete: 'off', spellcheck: 'false',
      placeholder, value: ui[key], ...attrs,
    });
    el.addEventListener('input', () => { ui[key] = el.value; schedule(); });
    refs[key] = el;
    return el;
  }

  // ---------------------------------------------------------------- rendering
  function render() {
    const m = mk();
    if (!m) return;
    const user = store.me.user;
    const maxLev = cap();
    if (ui.lev > maxLev) ui.lev = maxLev;

    const sideBtns = seg([['long', 'Long', 'long'], ['short', 'Short', 'short']], ui.side, (v) => { ui.side = v; render(); schedule(); }, 'side-seg');
    const typeBtns = seg([['market', 'Market'], ['limit', 'Limit']], ui.type, (v) => { ui.type = v; render(); schedule(); });
    const sizeBtns = seg([['risk', 'Risk %'], ['qty', 'Quantity']], ui.sizeBy, (v) => { ui.sizeBy = v; render(); schedule(); });

    const slChips = h('div', { class: 'chips', 'aria-label': 'Stop-loss distance' },
      SL_CHIPS.map((d) => h('button', { type: 'button', class: 'chip', on: { click: () => setSlPct(d) } }, `${d}%`)));
    const tpChips = h('div', { class: 'chips', 'aria-label': 'Target as a multiple of risk' },
      TP_CHIPS.map((r) => h('button', { type: 'button', class: 'chip', on: { click: () => setTpR(r) } }, `${r}R`)));

    const levInput = h('input', { type: 'range', min: '1', max: String(maxLev), step: '1', value: String(ui.lev), 'aria-label': 'Leverage' });
    const levOut = h('output', { class: 'lev-out' }, `${ui.lev}×`);
    levInput.addEventListener('input', () => { ui.lev = parseInt(levInput.value, 10); levOut.textContent = `${ui.lev}×`; schedule(); });

    const setupSel = h('select', { 'aria-label': 'Setup' },
      h('option', { value: '' }, 'No setup'),
      SETUPS.map((s) => h('option', { value: s, selected: ui.setup === s }, s)));
    setupSel.addEventListener('change', () => { ui.setup = setupSel.value; });
    const noteIn = h('input', { type: 'text', maxlength: '500', placeholder: 'Why this trade?', value: ui.note });
    noteIn.addEventListener('input', () => { ui.note = noteIn.value; });

    refs.preview = h('div', { class: 'preview', 'aria-live': 'polite' });
    refs.ladder = h('div', { class: 'ladder-wrap' });
    refs.submit = h('button', { type: 'button', class: `btn submit ${ui.side}`, on: { click: submit } });
    refs.msg = h('p', { class: 'ticket-msg', role: 'status' });

    mount(root,
      h('div', { class: 'ticket-head' },
        h('h2', null, 'New order'),
        h('span', { class: 'ticket-sym' }, m.name)),
      sideBtns,
      typeBtns,
      ui.type === 'limit'
        ? field('Limit price', textInput('limit', price(m, live())), ui.side === 'long' ? 'Must be below the current price' : 'Must be above the current price')
        : null,
      h('div', { class: 'field' },
        h('div', { class: 'field-row' }, h('span', { class: 'field-label' }, 'Stop-loss'), slChips),
        textInput('sl', 'Price'),
      ),
      h('div', { class: 'field' },
        h('div', { class: 'field-row' }, h('span', { class: 'field-label' }, 'Take-profit'), tpChips),
        textInput('tp', 'Price (optional)'),
      ),
      sizeBtns,
      ui.sizeBy === 'risk'
        ? field('Risk per trade (% of equity)', textInput('risk', '1'), 'Size is set so the stop costs this much, fees included.')
        : field(`Quantity (${m.qty_label})`, textInput('qty', `min ${m.min_qty}`)),
      h('div', { class: 'field' },
        h('div', { class: 'field-row' }, h('span', { class: 'field-label' }, 'Leverage'), levOut),
        levInput,
        h('span', { class: 'field-hint' }, `Up to ${maxLev}× (set in Rules)`)),
      refs.ladder,
      refs.preview,
      h('details', { class: 'journal-fold' },
        h('summary', null, 'Journal (optional)'),
        h('div', { class: 'journal-fields' }, setupSel, noteIn)),
      refs.submit,
      refs.msg,
      h('p', { class: 'fine' }, user.settings.require_sl ? 'Your rules require a stop-loss on every trade.' : 'Tip: trades with a stop-loss give you R-multiples in your stats.'),
    );
    renderSubmit();
    renderPreview();
  }

  function setSlPct(d) {
    const p = refPrice();
    if (!p) { toast('Wait for the price (or enter a limit price) first.', 'error'); return; }
    const m = mk();
    const v = ui.side === 'long' ? p * (1 - d / 100) : p * (1 + d / 100);
    ui.sl = v.toFixed(m.decimals);
    refs.sl.value = ui.sl;
    schedule();
  }

  function setTpR(r) {
    const p = refPrice();
    const sl = parse(ui.sl);
    if (!p || !sl) { toast('Set a stop-loss first. The target is measured in multiples of the risk.', 'error'); return; }
    const m = mk();
    const dist = Math.abs(p - sl) * r;
    ui.tp = (ui.side === 'long' ? p + dist : p - dist).toFixed(m.decimals);
    refs.tp.value = ui.tp;
    schedule();
  }

  // ---------------------------------------------------------------- preview
  const schedule = debounce(fetchPreview, 220);

  function params() {
    const m = mk();
    const q = { symbol: m.id, side: ui.side, leverage: ui.lev };
    const entry = ui.type === 'limit' ? parse(ui.limit) : null;
    if (ui.type === 'limit') { if (!entry) return null; q.entry = entry; }
    const sl = parse(ui.sl), tp = parse(ui.tp);
    if (sl) q.stop = sl;
    if (tp) q.tp = tp;
    if (ui.sizeBy === 'risk') {
      const r = parse(ui.risk);
      if (!r || !sl) return null;
      q.risk_pct = r;
    } else {
      const qty = parse(ui.qty);
      if (!qty) return null;
      q.qty = qty;
    }
    return q;
  }

  async function fetchPreview() {
    const q = params();
    emitDraft();
    if (!q) { preview = null; previewErr = ''; renderPreview(); renderSubmit(); return; }
    const mine = ++reqId;
    try {
      const r = await api('/api/risk/size', { params: q });
      if (mine !== reqId) return;
      preview = r; previewErr = '';
    } catch (e) {
      if (mine !== reqId) return;
      preview = null; previewErr = e.message;
    }
    renderPreview(); renderSubmit(); emitDraft();
  }

  function emitDraft() {
    const m = mk();
    if (!m) return;
    emit('draft', {
      symbol: m.id, side: ui.side,
      sl: parse(ui.sl), tp: parse(ui.tp),
      entry: ui.type === 'limit' ? parse(ui.limit) : null,
      liq: preview ? preview.liq_price : null,
    });
  }

  function row(label, value, cls = '') {
    return h('div', { class: `pv-row ${cls}` }, h('span', null, label), h('strong', null, value));
  }

  function renderPreview() {
    if (!refs.preview) return;
    const m = mk();
    if (!preview) {
      mount(refs.preview,
        previewErr
          ? h('p', { class: 'pv-error' }, previewErr)
          : h('p', { class: 'pv-empty' }, ui.sizeBy === 'risk' ? 'Enter a stop-loss and a risk % to see your position size.' : 'Enter a quantity to see margin and risk.'));
      renderLadder();
      return;
    }
    const p = preview;
    mount(refs.preview,
      row('Size', `${qtyText(m, p.qty)} ${m.qty_label}`),
      row('Position value', money(p.notional)),
      row('Margin used', `${money(p.margin)} of ${money(p.available)} free`),
      p.risk_usd != null ? row('Risk at stop', `${money(p.risk_usd)} (${pct(p.risk_pct)})`, 'risk') : null,
      p.rr != null ? row('Reward : risk', `${num(p.rr, 2)} : 1`) : null,
      row('Liquidation', price(m, p.liq_price)),
      p.warnings.length ? h('ul', { class: 'pv-warn' }, p.warnings.map((w) => h('li', null, w))) : null);
    renderLadder();
  }

  // The risk ladder: liquidation, stop, entry and target on one price scale, labelled in R.
  function renderLadder() {
    const wrap = refs.ladder;
    if (!wrap) return;
    const m = mk();
    const p = preview;
    const sl = parse(ui.sl), tp = parse(ui.tp);
    const entry = p ? p.entry : refPrice();
    if (!entry || (!sl && !tp && !p)) { mount(wrap); return; }

    const risk = p && p.risk_usd ? p.risk_usd : null;
    const items = [{ key: 'entry', name: 'Entry', price: entry, r: 0 }];
    if (sl) items.push({ key: 'sl', name: 'Stop', price: sl, r: risk ? -1 : null });
    if (tp) items.push({ key: 'tp', name: 'Target', price: tp, r: p && p.rr != null ? p.rr : null });
    if (p) items.push({ key: 'liq', name: 'Liquidation', price: p.liq_price, r: risk ? -p.liq_loss_usd / risk : null });

    const H = 190, PAD = 16;
    const prices = items.map((i) => i.price);
    let hi = Math.max(...prices), lo = Math.min(...prices);
    if (hi === lo) { hi += 1; lo -= 1; }
    const span = hi - lo;
    const y = (v) => PAD + ((hi - v) / span) * (H - 2 * PAD);
    items.forEach((i) => { i.y = y(i.price); i.ly = i.y; });

    // keep labels readable: spread them at least 34px apart without moving the ticks
    const sorted = [...items].sort((a, b) => a.y - b.y);
    for (let i = 1; i < sorted.length; i++) if (sorted[i].ly < sorted[i - 1].ly + 34) sorted[i].ly = sorted[i - 1].ly + 34;
    const overflow = sorted.length ? sorted[sorted.length - 1].ly - (H - 6) : 0;
    if (overflow > 0) {
      sorted[sorted.length - 1].ly -= overflow;
      for (let i = sorted.length - 2; i >= 0; i--) if (sorted[i].ly > sorted[i + 1].ly - 34) sorted[i].ly = sorted[i + 1].ly - 34;
    }

    const zone = (a, b, cls) => h('div', { class: `zone ${cls}`, style: { top: `${Math.min(a, b)}px`, height: `${Math.max(2, Math.abs(a - b))}px` } });
    const byKey = Object.fromEntries(items.map((i) => [i.key, i]));
    const zones = [];
    if (byKey.sl) zones.push(zone(byKey.entry.y, byKey.sl.y, 'zone-risk'));
    if (byKey.tp) zones.push(zone(byKey.entry.y, byKey.tp.y, 'zone-reward'));
    if (byKey.liq && byKey.sl) zones.push(zone(byKey.sl.y, byKey.liq.y, 'zone-liq'));
    else if (byKey.liq) zones.push(zone(byKey.entry.y, byKey.liq.y, 'zone-liq'));

    mount(wrap,
      h('div', { class: 'ladder', style: { height: `${H}px` }, role: 'img', 'aria-label': 'Risk ladder: liquidation, stop, entry and target on one price scale' },
        h('div', { class: 'rail' }),
        zones,
        items.map((i) => h('span', { class: `tick tick-${i.key}`, style: { top: `${i.y}px` } })),
        items.map((i) => {
          const dist = ((i.price - entry) / entry) * 100;
          return h('div', { class: `rung rung-${i.key}`, style: { top: `${i.ly}px` } },
            h('span', { class: 'rung-name' }, i.name),
            h('span', { class: 'rung-price' }, price(m, i.price)),
            h('span', { class: 'rung-r' }, i.key === 'entry' ? '' : [i.r != null ? rMult(i.r, 1) : '', i.r != null ? ' · ' : '', pct(dist, { sign: true, decimals: 2 })]));
        })));
  }

  // ---------------------------------------------------------------- submit
  function canSubmit() {
    const m = mk();
    if (busy || !m) return false;
    if (!live()) return false;
    return !!preview && preview.qty >= m.min_qty;
  }

  function renderSubmit() {
    const b = refs.submit;
    if (!b) return;
    const m = mk();
    const open = !!live();
    const verb = ui.type === 'limit' ? 'Place limit' : 'Open';
    b.textContent = busy ? 'Sending…' : `${verb} ${ui.side === 'long' ? 'long' : 'short'} ${m.base}${m.cls === 'forex' ? '/' + m.quote : ''}`;
    b.className = `btn submit ${ui.side}`;
    b.disabled = !canSubmit();
    refs.msg.textContent = open ? '' : `${m.name} is closed or its price feed is unavailable. Try again shortly.`;
    const acct = store.account;
    if (open && acct && acct.locked) refs.msg.textContent = 'Daily loss limit reached. New trades unlock at 00:00 UTC.';
  }

  async function submit() {
    if (!canSubmit()) return;
    const m = mk();
    const body = {
      symbol: m.id, side: ui.side, type: ui.type, leverage: ui.lev,
      sl: parse(ui.sl), tp: parse(ui.tp), setup: ui.setup, note: ui.note,
    };
    if (ui.type === 'limit') body.limit_price = parse(ui.limit);
    if (ui.sizeBy === 'risk') body.risk_pct = parse(ui.risk); else body.qty = parse(ui.qty);
    busy = true; renderSubmit();
    try {
      const r = await api('/api/orders', { method: 'POST', body });
      setAccount(r.account);
      toast(r.result.kind === 'order' ? `Limit order placed on ${m.name}.` : `Opened ${ui.side} on ${m.name}.`, 'ok');
      ui.sl = ''; ui.tp = ''; ui.note = ''; ui.qty = '';
      preview = null;
      render();
      emitDraft();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      busy = false; renderSubmit();
    }
  }

  // ---------------------------------------------------------------- wiring
  unsub.push(on('symbol', () => {
    ui.sl = ''; ui.tp = ''; ui.limit = ''; ui.qty = '';
    preview = null; previewErr = '';
    render(); schedule();
  }));
  unsub.push(on('account', () => { renderSubmit(); }));
  let lastLive = null;
  let lastRefresh = 0;
  unsub.push(on('prices', () => {
    const l = live();
    if ((l === null) !== (lastLive === null)) renderSubmit();
    lastLive = l;
    // market-order previews drift with the price: refresh them every few seconds
    if (ui.type === 'market' && params() && Date.now() - lastRefresh > 4000) { lastRefresh = Date.now(); schedule(); }
  }));

  render();
  schedule();

  return {
    destroy() { schedule.cancel(); unsub.forEach((f) => f()); emit('draft', null); mount(root); },
    setSide(side) {
      if (side === 'long' || side === 'short') {
        ui.side = side;
        render();
        schedule();
      }
    },
    // Used by the chart: clicking a price sets the stop or the target.
    setField(kind, value) {
      const m = mk();
      const v = Number(value).toFixed(m.decimals);
      if (kind === 'sl') { ui.sl = v; refs.sl.value = v; }
      if (kind === 'tp') { ui.tp = v; refs.tp.value = v; }
      schedule();
    },
  };
}
