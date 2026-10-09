// Combined Rules & Ranks (Leaderboard) view with top segmented subtab switcher.
import { h, mount } from '../util.js';
import { renderRules } from './rules.js';
import { renderLeaderboard } from './leaderboard.js';

export function renderRulesRanks(root) {
  let activeTab = (location.hash || '').match(/(ranks|leaderboard)/) ? 'ranks' : 'rules';
  let destroyChild = null;

  const header = h('div', { class: 'subtabs-header' });
  const seg = h('div', { class: 'seg subtabs-seg', role: 'tablist', 'aria-label': 'Rules or Ranks view' });

  const rulesBtn = h('button', {
    type: 'button', class: 'seg-btn', role: 'tab',
    'aria-selected': String(activeTab === 'rules'),
    'aria-pressed': String(activeTab === 'rules'),
    on: { click: () => switchTab('rules') },
  });
  rulesBtn.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:6px"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg>Rules';

  const ranksBtn = h('button', {
    type: 'button', class: 'seg-btn', role: 'tab',
    'aria-selected': String(activeTab === 'ranks'),
    'aria-pressed': String(activeTab === 'ranks'),
    on: { click: () => switchTab('ranks') },
  });
  ranksBtn.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:6px"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6M18 9h1.5a2.5 2.5 0 0 0 0-5H18M4 22h16M10 14.66V17c0 .55-.45 1-1 1H7M14 14.66V17c0 .55.45 1 1 1h2M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg>Ranks';

  mount(seg, rulesBtn, ranksBtn);
  mount(header, seg);

  const content = h('div', { class: 'subtabs-content' });
  mount(root, header, content);

  function switchTab(tab) {
    if (activeTab === tab && destroyChild) return;
    activeTab = tab;
    rulesBtn.setAttribute('aria-selected', String(activeTab === 'rules'));
    rulesBtn.setAttribute('aria-pressed', String(activeTab === 'rules'));
    ranksBtn.setAttribute('aria-selected', String(activeTab === 'ranks'));
    ranksBtn.setAttribute('aria-pressed', String(activeTab === 'ranks'));

    if (location.hash.replace(/^#\/?/, '').split(/[?/]/)[0] !== activeTab) {
      history.replaceState(null, '', `#/${activeTab}`);
    }

    if (destroyChild) {
      try { destroyChild(); } catch (e) { console.error(e); }
      destroyChild = null;
    }
    content.innerHTML = '';

    if (activeTab === 'ranks') {
      destroyChild = renderLeaderboard(content);
    } else {
      destroyChild = renderRules(content);
    }
  }

  switchTab(activeTab);

  return function destroy() {
    if (destroyChild) {
      try { destroyChild(); } catch (e) { console.error(e); }
      destroyChild = null;
    }
  };
}
