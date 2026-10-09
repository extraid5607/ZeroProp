// Combined Journal & Stats view with top segmented subtab switcher.
import { h, mount } from '../util.js';
import { renderJournal } from './journal.js';
import { renderStats } from './stats.js';

export function renderJournalStats(root) {
  let activeTab = (location.hash || '').includes('stats') ? 'stats' : 'journal';
  let destroyChild = null;

  const header = h('div', { class: 'subtabs-header' });
  const seg = h('div', { class: 'seg subtabs-seg', role: 'tablist', 'aria-label': 'Journal or Stats view' });

  const journalBtn = h('button', {
    type: 'button', class: 'seg-btn', role: 'tab',
    'aria-selected': String(activeTab === 'journal'),
    'aria-pressed': String(activeTab === 'journal'),
    on: { click: () => switchTab('journal') },
  });
  journalBtn.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:6px"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z"/><path d="M8 7h8M8 11h8M8 15h5"/></svg>Journal';

  const statsBtn = h('button', {
    type: 'button', class: 'seg-btn', role: 'tab',
    'aria-selected': String(activeTab === 'stats'),
    'aria-pressed': String(activeTab === 'stats'),
    on: { click: () => switchTab('stats') },
  });
  statsBtn.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:6px"><path d="M18 20V10M12 20V4M6 20v-6"/></svg>Stats';

  mount(seg, journalBtn, statsBtn);
  mount(header, seg);

  const content = h('div', { class: 'subtabs-content' });
  mount(root, header, content);

  function switchTab(tab) {
    if (activeTab === tab && destroyChild) return;
    activeTab = tab;
    journalBtn.setAttribute('aria-selected', String(activeTab === 'journal'));
    journalBtn.setAttribute('aria-pressed', String(activeTab === 'journal'));
    statsBtn.setAttribute('aria-selected', String(activeTab === 'stats'));
    statsBtn.setAttribute('aria-pressed', String(activeTab === 'stats'));

    if (location.hash.replace(/^#\/?/, '').split(/[?/]/)[0] !== activeTab) {
      history.replaceState(null, '', `#/${activeTab}`);
    }

    if (destroyChild) {
      try { destroyChild(); } catch (e) { console.error(e); }
      destroyChild = null;
    }
    content.innerHTML = '';

    if (activeTab === 'stats') {
      destroyChild = renderStats(content);
    } else {
      destroyChild = renderJournal(content);
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
