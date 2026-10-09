// Account: user profile, equity and margin breakdown, risk limits summary, and preferences.
import { api } from '../api.js';
import { h, mount, money, pct, tone, arrow, toast, storage } from '../util.js';
import { store, on, setAccount, refreshAccount } from '../store.js';
import { openUpgradeDialog, openInstallDialog } from '../dialogs.js';

export function renderAccount(root) {
  const unsub = [];

  const bodyEl = h('div', { class: 'account-body' });
  let pendingPayment = null;

  async function loadPending() {
    try {
      const data = await api('/api/plans');
      pendingPayment = data.pending_payment;
      renderContent();
    } catch (_) {}
  }
  loadPending();

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

    const planLabel = user.plan_name && user.plan_name !== 'free'
      ? `${money(user.start_balance, { decimals: 0 })} Evaluation`
      : 'Free Practice ($2,000)';

    mount(bodyEl,
      // User Profile Hero
      h('div', { class: 'panel account-hero' },
        h('div', { class: 'account-avatar' }, user.username.slice(0, 2).toUpperCase()),
        h('div', { class: 'account-user-meta' },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } },
            h('h2', { style: { margin: 0, fontSize: '20px' } }, user.username),
            h('span', { class: 'badge accent' }, planLabel),
            h('span', { class: 'badge' }, `Season ${user.season}`),
            user.is_admin ? h('a', { href: '#/admin', class: 'badge', style: { background: 'var(--accent)', color: '#fff', textDecoration: 'none' } }, 'Admin Portal') : null,
            locked ? h('span', { class: 'badge warn' }, 'Locked (Daily Limit)') : null),
          h('p', { class: 'muted', style: { margin: '4px 0 0' } }, `Starting balance: ${money(user.start_balance, { decimals: 0 })} · Simulated execution`))),

      // Evaluation Plan & Funded Capital Card
      h('section', { class: 'panel panel-pad form-grid' },
        h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' } },
          h('div', null,
            h('h2', { style: { margin: 0 } }, 'Evaluation Capital & Plan'),
            h('p', { class: 'muted', style: { margin: '4px 0 0', fontSize: '13px' } },
              user.plan_expires_at
                ? `Active plan valid until ${new Date(user.plan_expires_at * 1000).toLocaleDateString()}`
                : 'Free practice plan ($2,000). Upgrade for larger funded capital & verified status.')),
          h('button', {
            type: 'button', class: 'btn primary',
            on: { click: () => openUpgradeDialog() },
          }, 'Upgrade Account / Plans')),

        pendingPayment ? h('div', {
          style: {
            background: 'rgba(234, 179, 8, 0.12)',
            border: '1px solid rgba(234, 179, 8, 0.4)',
            borderRadius: 'var(--radius)',
            padding: '12px 16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
          },
        },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
            h('span', { class: 'badge warn' }, 'Verification Pending'),
            h('strong', null, pendingPayment.plan_title)),
          h('p', { style: { margin: 0, fontSize: '13px', color: 'var(--muted)' } },
            `UTR / Ref No: `, h('code', { style: { background: 'var(--bg-card)', padding: '2px 6px', borderRadius: '4px' } }, pendingPayment.utr),
            ` · Amount: ₹${pendingPayment.amount_inr} INR. Your account will be upgraded immediately once verified by admin.`)) : null),

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
          user.is_admin ? h('a', {
            href: '#/admin', class: 'btn', style: { textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' },
          }, 'Admin Portal (Payment Verifications)') : null,
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
