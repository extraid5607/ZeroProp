// Admin View: Verify UPI UTR payments, inspect proofs, and approve/reject evaluation accounts.
import { api } from '../api.js';
import { h, mount, money, toast } from '../util.js';
import { store } from '../store.js';

export function renderAdmin(root) {
  const container = h('div', { class: 'page page-narrow' });
  mount(root, container);

  let activeTab = 'pending';
  let payments = [];

  function renderUnlock() {
    const keyInput = h('input', { type: 'password', placeholder: 'Enter Admin Secret Key', autocomplete: 'off' });
    const errEl = h('p', { class: 'dlg-error', role: 'alert' });
    const unlockBtn = h('button', { type: 'button', class: 'btn primary' }, 'Unlock Admin Portal');

    unlockBtn.addEventListener('click', async () => {
      const key = keyInput.value.trim();
      if (!key) { errEl.textContent = 'Please enter the admin key.'; return; }
      unlockBtn.disabled = true;
      errEl.textContent = '';
      try {
        const r = await api('/api/admin/make-admin', { method: 'POST', body: { admin_key: key } });
        if (store.me && store.me.user) store.me.user.is_admin = true;
        toast('Admin access granted!', 'ok');
        loadPayments();
      } catch (e) {
        errEl.textContent = e.message || 'Invalid admin key.';
        unlockBtn.disabled = false;
      }
    });

    keyInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') unlockBtn.click(); });

    mount(container,
      h('div', { class: 'page-head' }, h('h1', null, 'Admin Verification Portal')),
      h('p', { class: 'page-sub' }, 'Manage user evaluation upgrades and verify UPI payments.'),
      h('div', { class: 'panel panel-pad form-grid', style: { maxWidth: '440px', margin: '40px auto 0' } },
        h('h2', { style: { margin: 0 } }, 'Enter Admin Secret Key'),
        h('p', { class: 'muted', style: { margin: 0, fontSize: '13px' } }, 'This portal is restricted to ZeroProp administrators.'),
        h('label', { class: 'field' },
          h('span', { class: 'field-label' }, 'Admin Secret Key:'),
          keyInput),
        errEl,
        h('div', { style: { display: 'flex', justifyContent: 'flex-end', marginTop: '8px' } }, unlockBtn)));
  }

  async function loadPayments() {
    try {
      const data = await api('/api/admin/payments');
      payments = data.payments || [];
      renderPortal();
    } catch (e) {
      if (e.status === 403 || e.message?.toLowerCase().includes('admin')) {
        renderUnlock();
      } else {
        mount(container, h('div', { class: 'panel empty' },
          h('strong', null, 'Error loading payments'), e.message));
      }
    }
  }

  function openProofModal(imgSrc, username, utr) {
    const dlg = h('dialog', { class: 'dlg-proof' },
      h('div', { class: 'dlg-head' },
        h('h2', null, `Payment Proof: @${username} (UTR ${utr})`),
        h('button', { type: 'button', class: 'btn sm ghost', on: { click: () => dlg.close() } }, '✕ Close')),
      h('div', { class: 'dlg-body', style: { textAlign: 'center', padding: '16px' } },
        h('img', { src: imgSrc, style: { maxWidth: '100%', maxHeight: '75vh', borderRadius: '8px', objectFit: 'contain' }, alt: 'Proof screenshot' })),
      h('div', { class: 'dlg-foot' },
        h('button', { type: 'button', class: 'btn', on: { click: () => dlg.close() } }, 'Close')));
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg);
    dlg.showModal();
  }

  function renderPortal() {
    container.innerHTML = '';

    const pendingCount = payments.filter((p) => p.status === 'pending').length;
    const approvedCount = payments.filter((p) => p.status === 'approved').length;
    const rejectedCount = payments.filter((p) => p.status === 'rejected').length;

    const filtered = activeTab === 'all'
      ? payments
      : payments.filter((p) => p.status === activeTab);

    const tabsBar = h('div', { class: 'seg', role: 'tablist' },
      [['pending', `Pending (${pendingCount})`],
       ['approved', `Approved (${approvedCount})`],
       ['rejected', `Rejected (${rejectedCount})`],
       ['all', `All (${payments.length})`]].map(([tabId, label]) => {
        return h('button', {
          type: 'button',
          class: 'seg-btn',
          'aria-pressed': String(activeTab === tabId),
          on: { click: () => { activeTab = tabId; renderPortal(); } },
        }, label);
      }));

    const refreshBtn = h('button', { type: 'button', class: 'btn sm ghost' }, '🔄 Refresh');
    refreshBtn.addEventListener('click', loadPayments);

    const head = h('div', { class: 'page-head', style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' } },
      h('div', null,
        h('h1', null, 'Admin Verification Portal'),
        h('p', { class: 'page-sub', style: { margin: '4px 0 0' } }, 'Verify 12-digit UPI UTRs against your Google Pay / Axis Bank statement.')),
      refreshBtn);

    const listWrap = h('div', { class: 'admin-payments-list', style: { display: 'grid', gap: '12px', marginTop: '16px' } });

    if (!filtered.length) {
      listWrap.append(h('div', { class: 'panel empty' },
        h('strong', null, `No ${activeTab} payments`),
        activeTab === 'pending' ? 'All submitted payments have been reviewed.' : 'Nothing to show here.'));
    } else {
      filtered.forEach((p) => {
        const dateStr = new Date(p.created_at * 1000).toLocaleString();
        const noteInput = h('input', { type: 'text', placeholder: 'Admin note (optional)', style: { fontSize: '13px' } });
        const approveBtn = h('button', { type: 'button', class: 'btn primary sm', style: { background: 'var(--up)' } }, '✓ Approve & Activate');
        const rejectBtn = h('button', { type: 'button', class: 'btn danger sm ghost' }, '✕ Reject');

        approveBtn.addEventListener('click', async () => {
          if (!confirm(`Approve payment #${p.id} for @${p.username}? This will upgrade their account to ${money(p.balance, { decimals: 0 })}.`)) return;
          approveBtn.disabled = true;
          try {
            await api(`/api/admin/payments/${p.id}/approve`, {
              method: 'POST',
              body: { note: noteInput.value.trim() },
            });
            toast(`Payment #${p.id} approved! @${p.username} upgraded to ${p.plan_title}.`, 'ok');
            loadPayments();
          } catch (e) {
            toast(e.message, 'error');
            approveBtn.disabled = false;
          }
        });

        rejectBtn.addEventListener('click', async () => {
          const reason = prompt(`Enter rejection reason for @${p.username}:`, 'Payment not found on bank statement');
          if (reason === null) return;
          rejectBtn.disabled = true;
          try {
            await api(`/api/admin/payments/${p.id}/reject`, {
              method: 'POST',
              body: { note: reason.trim() },
            });
            toast(`Payment #${p.id} rejected.`, 'info');
            loadPayments();
          } catch (e) {
            toast(e.message, 'error');
            rejectBtn.disabled = false;
          }
        });

        const statusBadge = p.status === 'approved'
          ? h('span', { class: 'badge accent' }, 'Approved')
          : p.status === 'rejected'
            ? h('span', { class: 'badge danger' }, 'Rejected')
            : h('span', { class: 'badge warn' }, 'Pending Review');

        const card = h('div', { class: 'panel panel-pad admin-payment-card', style: { display: 'grid', gap: '10px' } },
          h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' } },
            h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } },
              h('strong', { style: { fontSize: '16px' } }, `@${p.username}`),
              h('span', { class: 'badge' }, p.plan_title),
              h('strong', { style: { color: 'var(--accent)' } }, `₹${p.amount_inr} INR`)),
            statusBadge),

          h('div', { style: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '14px', fontSize: '13px', background: 'var(--bg-card)', padding: '10px 14px', borderRadius: 'var(--radius)' } },
            h('div', null,
              h('span', { class: 'muted' }, '12-Digit UTR / Ref: '),
              h('code', { style: { fontSize: '14px', fontWeight: 'bold', color: 'var(--ink)' } }, p.utr),
              h('button', {
                type: 'button', class: 'btn sm ghost', style: { marginLeft: '8px', padding: '2px 6px', fontSize: '11px' },
                on: { click: () => { navigator.clipboard.writeText(p.utr); toast('Copied UTR', 'ok'); } },
              }, 'Copy')),
            h('div', null,
              h('span', { class: 'muted' }, 'Submitted: '),
              h('span', null, dateStr)),
            h('div', null,
              h('span', { class: 'muted' }, 'Capital: '),
              h('strong', null, money(p.balance, { decimals: 0 })))),

          p.proof_image ? h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } },
            h('span', { class: 'muted-xs' }, 'Screenshot:'),
            h('img', {
              src: p.proof_image, class: 'admin-proof-preview',
              style: { height: '48px', width: 'auto', borderRadius: '4px', cursor: 'pointer', border: '1px solid var(--line)' },
              title: 'Click to enlarge screenshot',
              on: { click: () => openProofModal(p.proof_image, p.username, p.utr) },
            }),
            h('button', {
              type: 'button', class: 'btn sm ghost',
              on: { click: () => openProofModal(p.proof_image, p.username, p.utr) },
            }, '🔍 View Screenshot')) : null,

          p.reviewer_note ? h('p', { class: 'fine', style: { margin: 0 } },
            h('strong', null, 'Note: '), p.reviewer_note,
            p.reviewed_at ? ` · ${new Date(p.reviewed_at * 1000).toLocaleString()}` : '') : null,

          p.status === 'pending' ? h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', borderTop: '1px solid var(--line)', paddingTop: '10px', marginTop: '4px' } },
            h('div', { style: { flex: '1', minWidth: '200px' } }, noteInput),
            approveBtn,
            rejectBtn) : null);

        listWrap.append(card);
      });
    }

    mount(container, head, tabsBar, listWrap);
  }

  loadPayments();

  return function destroy() {};
}
