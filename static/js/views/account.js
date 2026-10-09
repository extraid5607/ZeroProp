// Account: user profile, equity and margin breakdown, risk limits summary, and preferences.
import { api } from '../api.js';
import { h, mount, money, pct, tone, arrow, toast, storage } from '../util.js';
import { store, on, setAccount, refreshAccount } from '../store.js';
import { confirmDialog, openInstallDialog } from '../dialogs.js';

export function renderAccount(root) {
  const unsub = [];

  const bodyEl = h('div', { class: 'account-body' });

  function renderContent() {
    const user = store.me?.user;
    if (!user) {
      mount(bodyEl, h('div', { class: 'panel empty' }, h('strong', null, 'Not signed in'), 'Please log in to view account.'));
      return;
    }

    const a = store.account;
    const equity = a ? a.equity : user.start_balance;
    const dayPnl = a ? a.day_pnl : 0;
    const avail = a ? a.available : user.start_balance;
    const unrealized = a ? a.unrealized : 0;
    const posCount = a && a.positions ? a.positions.length : 0;
    const locked = a && a.locked;

    // Reset account handler
    async function handleReset() {
      const ok = await confirmDialog({
        title: 'Reset account to $10,000?',
        body: `Season ${user.season} will end. All open positions will be closed, pending orders cancelled, and your equity reset to ${money(user.start_balance, { decimals: 0 })}.`,
        confirmLabel: 'Reset account',
        danger: true,
      });
      if (!ok) return;
      try {
        const r = await api('/api/account/reset', { method: 'POST', body: { confirm: true } });
        store.me.user = r.user;
        setAccount(r.account);
        toast(`Season ${r.user.season} started with ${money(r.user.start_balance, { decimals: 0 })}.`, 'ok');
        renderContent();
      } catch (e) {
        toast(e.message, 'error');
      }
    }

    async function handleLogout() {
      try { await api('/api/auth/logout', { method: 'POST' }); } catch (_) {}
      location.hash = '';
      location.reload();
    }

    const isDark = document.documentElement.getAttribute('data-theme') === 'dark' ||
      (!document.documentElement.getAttribute('data-theme') && window.matchMedia('(prefers-color-scheme: dark)').matches);

    function toggleTheme() {
      const next = isDark ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      storage('zp_theme', next);
      renderContent();
    }

    mount(bodyEl,
      // User Profile Hero
      h('div', { class: 'panel account-hero' },
        h('div', { class: 'account-avatar' }, user.username.slice(0, 2).toUpperCase()),
        h('div', { class: 'account-user-meta' },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
            h('h2', { style: { margin: 0, fontSize: '20px' } }, user.username),
            h('span', { class: 'badge accent' }, `Season ${user.season}`),
            locked ? h('span', { class: 'badge warn' }, 'Locked (Daily Limit)') : null),
          h('p', { class: 'muted', style: { margin: '4px 0 0' } }, `Starting balance: ${money(user.start_balance, { decimals: 0 })} · Evaluation account`))),

      // Financials Summary Grid
      h('div', { class: 'account-kpi-grid' },
        h('div', { class: 'panel kpi' },
          h('span', null, 'Total Equity'),
          h('strong', null, money(equity)),
          h('small', { class: tone(dayPnl) }, `${arrow(dayPnl)} ${money(dayPnl, { sign: true })} today`)),
        h('div', { class: 'panel kpi' },
          h('span', null, 'Available Margin'),
          h('strong', null, money(Math.max(avail, 0))),
          h('small', null, `${posCount} open position${posCount === 1 ? '' : 's'}`)),
        h('div', { class: 'panel kpi' },
          h('span', null, 'Unrealized P&L'),
          h('strong', { class: tone(unrealized) }, `${arrow(unrealized)} ${money(unrealized, { sign: true })}`),
          h('small', null, posCount > 0 ? 'Live marked' : 'No active trades'))),

      // Risk Rules Quick View
      h('section', { class: 'panel panel-pad form-grid' },
        h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
          h('h2', null, 'Risk Rules Summary'),
          h('a', { href: '#/rules', class: 'btn sm ghost' }, 'Manage rules →')),
        h('div', { class: 'account-rules-list' },
          h('div', { class: 'account-rule-item' },
            h('span', { class: 'muted' }, 'Stop-loss on every trade'),
            h('strong', null, user.settings.require_sl ? 'Enforced' : 'Optional')),
          h('div', { class: 'account-rule-item' },
            h('span', { class: 'muted' }, 'Maximum leverage'),
            h('strong', null, `${user.settings.max_leverage}×`)),
          h('div', { class: 'account-rule-item' },
            h('span', { class: 'muted' }, 'Maximum risk per trade'),
            h('strong', null, `${user.settings.max_risk_pct}% of equity`)),
          h('div', { class: 'account-rule-item' },
            h('span', { class: 'muted' }, 'Daily loss limit'),
            h('strong', null, user.settings.daily_loss_pct > 0 ? `${user.settings.daily_loss_pct}% of equity` : 'Disabled')))),

      // Settings & App Actions
      h('section', { class: 'panel panel-pad form-grid' },
        h('h2', null, 'Preferences & App'),
        h('div', { class: 'account-actions-grid' },
          h('button', {
            type: 'button', class: 'btn btn-pwa-install',
            on: { click: () => openInstallDialog({ deferredPrompt: window.__zp_install_prompt }) },
          },
            h('svg', { viewBox: '0 0 24 24', width: '16', height: '16', fill: 'none', stroke: 'currentColor', 'stroke-width': '2.2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' },
              h('path', { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' }),
              h('polyline', { points: '7 10 12 15 17 10' }),
              h('line', { x1: '12', y1: '15', x2: '12', y2: '3' })),
            h('span', null, 'Download / Install ZeroProp App')),
          h('button', {
            type: 'button', class: 'btn',
            on: { click: toggleTheme },
          }, `Switch to ${isDark ? 'Light' : 'Dark'} theme`),
          h('button', {
            type: 'button', class: 'btn danger',
            on: { click: handleReset },
          }, 'Reset account (fresh season)'),
          h('button', {
            type: 'button', class: 'btn ghost',
            on: { click: handleLogout },
          }, 'Log out of ZeroProp'))));
  }

  unsub.push(on('account', renderContent));

  mount(root, h('div', { class: 'page page-narrow' },
    h('div', { class: 'page-head' }, h('h1', null, 'Account')),
    h('p', { class: 'page-sub' }, 'Manage your virtual trading evaluation account, risk limits, app preferences and reset history.'),
    bodyEl));

  renderContent();

  return function destroy() {
    unsub.forEach((f) => f());
  };
}
