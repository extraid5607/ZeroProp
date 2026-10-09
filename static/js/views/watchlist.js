// Watchlist: list of all trading markets across Crypto, Commodities and Forex.
// Clicking any script selects that symbol and immediately redirects/lands on the Trade tab.
import { h, mount, price, pct, tone, arrow, storage } from '../util.js';
import { store, on, setSymbol, market } from '../store.js';

const CATEGORIES = [
  ['all', 'All markets'],
  ['crypto', 'Crypto'],
  ['metal', 'Commodities'],
  ['forex', 'Forex'],
];

export function renderWatchlist(root) {
  let query = '';
  let activeCat = 'all';
  const unsub = [];

  const searchIn = h('input', {
    type: 'search',
    placeholder: 'Search symbol, asset or pair (e.g. BTC, Gold, Oil, EUR)…',
    class: 'watchlist-search',
    autocomplete: 'off',
    spellcheck: 'false',
  });
  searchIn.addEventListener('input', () => {
    query = searchIn.value.trim().toLowerCase();
    paintList();
  });

  const catSeg = h('div', { class: 'seg watchlist-cats', role: 'group', 'aria-label': 'Market Category' });
  const listEl = h('div', { class: 'watchlist-list' });

  function drawCats() {
    mount(catSeg, CATEGORIES.map(([id, label]) => {
      const count = id === 'all'
        ? store.markets.length
        : store.markets.filter((m) => m.cls === id).length;
      return h('button', {
        type: 'button', class: 'seg-btn', 'aria-pressed': String(id === activeCat),
        on: { click: () => { activeCat = id; drawCats(); paintList(); } },
      }, `${label} (${count})`);
    }));
  }

  function pickMarket(m) {
    setSymbol(m.id);
    storage('zp_symbol', m.id);
    if (location.hash === '#/trade' || location.hash === '#trade') {
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    } else {
      location.hash = '#/trade';
    }
  }

  const rows = {};

  function paintList() {
    const filtered = store.markets.filter((m) => {
      if (activeCat !== 'all' && m.cls !== activeCat) return false;
      if (!query) return true;
      const haystack = `${m.id} ${m.name} ${m.base} ${m.quote}`.toLowerCase();
      return haystack.includes(query);
    });

    if (!filtered.length) {
      mount(listEl, h('div', { class: 'panel empty' },
        h('strong', null, 'No matching markets found'),
        'Try searching for another symbol, asset name or currency.'));
      return;
    }

    mount(listEl, filtered.map((m) => {
      let r = rows[m.id];
      if (!r) {
        r = {
          price: h('div', { class: 'wl-price' }),
          chg: h('div', { class: 'wl-chg' }),
          badge: h('span', { class: 'badge sm' }),
        };
        r.btn = h('div', {
          class: 'panel wl-card',
          role: 'button',
          tabindex: '0',
          'aria-label': `Trade ${m.name}`,
          on: {
            click: () => pickMarket(m),
            keydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickMarket(m); } },
          },
        },
          h('div', { class: 'wl-info' },
            h('div', { class: 'wl-sym-line' },
              h('strong', { class: 'wl-sym' }, m.cls === 'crypto' ? `${m.base}/${m.quote}` : m.name),
              r.badge),
            h('span', { class: 'wl-name muted' }, m.cls === 'crypto' ? m.name : `${m.base}/${m.quote}`)),
          h('div', { class: 'wl-quote' },
            r.price,
            r.chg),
          h('div', { class: 'wl-act' },
            h('span', { class: 'btn sm primary wl-trade-btn' }, 'Trade →')));
        rows[m.id] = r;
      }

      // Update values
      const q = store.prices[m.id];
      r.price.textContent = q ? price(m, q.p) : '–';
      r.badge.textContent = m.cls === 'metal' ? 'Commodity' : m.cls === 'crypto' ? 'Crypto' : 'Forex';
      r.badge.className = `badge sm wl-tag-${m.cls}`;

      if (q && !q.f) {
        r.chg.textContent = 'Market closed';
        r.chg.className = 'wl-chg muted';
      } else if (q && q.c != null) {
        r.chg.textContent = `${arrow(q.c)} ${pct(q.c, { sign: true })}`;
        r.chg.className = `wl-chg ${tone(q.c)}`;
      } else {
        r.chg.textContent = '';
        r.chg.className = 'wl-chg';
      }

      return r.btn;
    }));
  }

  function tickLive() {
    for (const m of store.markets) {
      const r = rows[m.id];
      if (!r) continue;
      const q = store.prices[m.id];
      r.price.textContent = q ? price(m, q.p) : '–';
      if (q && !q.f) {
        r.chg.textContent = 'Market closed';
        r.chg.className = 'wl-chg muted';
      } else if (q && q.c != null) {
        r.chg.textContent = `${arrow(q.c)} ${pct(q.c, { sign: true })}`;
        r.chg.className = `wl-chg ${tone(q.c)}`;
      } else {
        r.chg.textContent = '';
        r.chg.className = 'wl-chg';
      }
    }
  }

  unsub.push(on('prices', tickLive));
  unsub.push(on('markets', () => { drawCats(); paintList(); }));

  mount(root, h('div', { class: 'page page-narrow' },
    h('div', { class: 'page-head' },
      h('h1', null, 'Watchlist'),
      h('span', { class: 'muted hide-sm' }, `${store.markets.length} live tradable assets`)),
    h('p', { class: 'page-sub' }, 'Real-time quotes across crypto, commodities, and forex. Tap any market to jump straight to the live chart and order ticket.'),
    h('div', { class: 'watchlist-controls' },
      searchIn,
      catSeg),
    listEl));

  drawCats();
  paintList();

  return function destroy() {
    unsub.forEach((f) => f());
  };
}
