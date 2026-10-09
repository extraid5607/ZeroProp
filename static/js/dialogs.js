// Modal dialogs shared by several views. They use the native <dialog> element, so Escape,
// focus trapping and the backdrop come from the browser.
import { api } from './api.js';
import { h, num, money, pct, rMult, price, qtyText, tone, arrow, toast } from './util.js';
import { store, market, setAccount } from './store.js';

export const SETUPS = ['Breakout', 'Pullback', 'Reversal', 'Range', 'Trend follow', 'News', 'Other'];
export const EMOTIONS = ['Calm', 'Confident', 'Anxious', 'Greedy', 'FOMO', 'Revenge', 'Bored', 'Tired'];
export const REASONS = { manual: 'Closed by you', sl: 'Stop-loss', tp: 'Target hit', liquidation: 'Liquidated', reset: 'Account reset' };

let seq = 0;

function openDialog(dlg) {
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });   // click on the backdrop
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
  return dlg;
}

function parseOptional(text) {
  const t = String(text).trim().replace(/,/g, '');
  if (t === '') return { value: null };
  const n = Number(t);
  if (!Number.isFinite(n) || n <= 0) return { error: true };
  return { value: n };
}

// ---------------------------------------------------------------- confirm
export function confirmDialog({ title, body, confirmLabel = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    const id = `dlg-${++seq}`;
    let result = false;
    const dlg = h('dialog', { 'aria-labelledby': id },
      h('div', { class: 'dlg-head' }, h('h2', { id }, title)),
      h('div', { class: 'dlg-body' }, h('p', null, body)),
      h('div', { class: 'dlg-foot' },
        h('button', { type: 'button', class: 'btn', on: { click: () => dlg.close() } }, 'Cancel'),
        h('button', { type: 'button', class: `btn ${danger ? 'danger solid' : 'primary'}`, on: { click: () => { result = true; dlg.close(); } } }, confirmLabel)));
    dlg.addEventListener('close', () => resolve(result));
    openDialog(dlg);
  });
}

// ---------------------------------------------------------------- edit stop-loss / take-profit
export function openStopsDialog(pos) {
  const m = market(pos.symbol);
  const id = `dlg-${++seq}`;
  const slIn = h('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', value: pos.sl != null ? String(pos.sl) : '', placeholder: 'No stop-loss' });
  const tpIn = h('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', value: pos.tp != null ? String(pos.tp) : '', placeholder: 'No take-profit' });
  const err = h('p', { class: 'dlg-error', role: 'alert' });
  const save = h('button', { type: 'button', class: 'btn primary' }, 'Save stops');
  const live = store.prices[pos.symbol];

  const dlg = h('dialog', { 'aria-labelledby': id },
    h('div', { class: 'dlg-head' },
      h('h2', { id }, `Stops for ${pos.side === 'long' ? 'long' : 'short'} ${m.name}`)),
    h('div', { class: 'dlg-body' },
      h('p', { class: 'muted' }, `Entry ${price(m, pos.entry)}`, live && live.f ? ` · price now ${price(m, live.p)}` : '', ` · liquidation ${price(m, pos.liq)}`),
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Stop-loss'), slIn,
        h('span', { class: 'field-hint' }, 'Moving the stop in your favour locks in profit. Your original risk (1R) stays the same in the journal.')),
      h('button', { type: 'button', class: 'btn sm', style: { justifySelf: 'start' }, on: { click: () => { slIn.value = String(pos.entry); } } }, 'Move stop to entry (break-even)'),
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Take-profit'), tpIn,
        h('span', { class: 'field-hint' }, 'Leave a box empty to remove that stop.')),
      err),
    h('div', { class: 'dlg-foot' },
      h('button', { type: 'button', class: 'btn', on: { click: () => dlg.close() } }, 'Cancel'),
      save));

  save.addEventListener('click', async () => {
    const sl = parseOptional(slIn.value), tp = parseOptional(tpIn.value);
    if (sl.error || tp.error) { err.textContent = 'Enter a price above zero, or leave the box empty.'; return; }
    save.disabled = true; err.textContent = '';
    try {
      const r = await api(`/api/trades/${pos.id}/stops`, { method: 'PATCH', body: { sl: sl.value, tp: tp.value } });
      setAccount(r.account);
      dlg.close();
    } catch (e) {
      err.textContent = e.message;
      save.disabled = false;
    }
  });
  slIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') save.click(); });
  tpIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') save.click(); });
  openDialog(dlg);
  slIn.focus();
}

// ---------------------------------------------------------------- journal entry for one trade
export function openJournalDialog(trade, onSaved) {
  const m = market(trade.symbol);
  const id = `dlg-${++seq}`;
  const state = { rating: trade.rating || null };

  const setup = h('select', null, h('option', { value: '' }, 'No setup'),
    SETUPS.map((s) => h('option', { value: s, selected: trade.setup === s }, s)));
  const emotion = h('select', null, h('option', { value: '' }, 'Not sure'),
    EMOTIONS.map((s) => h('option', { value: s, selected: trade.emotion === s }, s)));
  const tags = h('input', { type: 'text', maxlength: '200', value: (trade.tags || []).join(', '), placeholder: 'e.g. news, london-open' });
  const note = h('textarea', { maxlength: '2000', placeholder: 'Why did you take this trade?' }, trade.note || '');
  const lesson = h('textarea', { maxlength: '2000', placeholder: 'What would you do differently?' }, trade.lesson || '');
  const err = h('p', { class: 'dlg-error', role: 'alert' });
  const save = h('button', { type: 'button', class: 'btn primary' }, 'Save journal');

  const starWrap = h('div', { class: 'chips', role: 'group', 'aria-label': 'Plan rating' });
  function drawStars() {
    starWrap.replaceChildren(
      ...[1, 2, 3, 4, 5].map((n) => h('button', {
        type: 'button', class: 'chip', 'aria-pressed': String(state.rating === n),
        'aria-label': `${n} out of 5`, style: state.rating === n ? { background: 'var(--accent-bg)', color: 'var(--accent)', borderColor: 'var(--accent)' } : null,
        on: { click: () => { state.rating = state.rating === n ? null : n; drawStars(); } },
      }, String(n))));
  }
  drawStars();

  const summary = [];
  if (trade.status === 'closed') {
    summary.push(
      h('p', null,
        h('strong', null, `${trade.side === 'long' ? 'Long' : 'Short'} ${m.name}`), ': ',
        `${price(m, trade.entry)} → ${price(m, trade.exit)}, `,
        h('strong', { class: tone(trade.pnl) }, `${arrow(trade.pnl)} ${money(trade.pnl, { sign: true })}`),
        trade.r != null ? ` (${rMult(trade.r)})` : ''),
      h('p', { class: 'fine' }, `While it was open, price moved ${pct(trade.mfe_pct, { decimals: 2 })} your way and ${pct(trade.mae_pct, { decimals: 2 })} against you.`));
  }

  const dlg = h('dialog', { 'aria-labelledby': id },
    h('div', { class: 'dlg-head' }, h('h2', { id }, 'Trade journal')),
    h('div', { class: 'dlg-body' },
      ...summary,
      h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' } },
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Setup'), setup),
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'How did you feel going in?'), emotion)),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'How closely did you follow your plan?'), starWrap,
        h('span', { class: 'field-hint' }, '1 = not at all, 5 = exactly. Tap again to clear.')),
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Tags'), tags),
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Notes'), note),
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'What did you learn?'), lesson),
      err),
    h('div', { class: 'dlg-foot' },
      h('button', { type: 'button', class: 'btn', on: { click: () => dlg.close() } }, 'Cancel'),
      save));

  save.addEventListener('click', async () => {
    save.disabled = true; err.textContent = '';
    const tagList = tags.value.split(',').map((t) => t.trim().slice(0, 24)).filter(Boolean).slice(0, 8);
    try {
      const r = await api(`/api/trades/${trade.id}/journal`, {
        method: 'PATCH',
        body: { setup: setup.value, emotion: emotion.value, rating: state.rating, tags: tagList, note: note.value, lesson: lesson.value },
      });
      dlg.close();
      if (onSaved) onSaved(r.trade);
    } catch (e) {
      err.textContent = e.message;
      save.disabled = false;
    }
  });
  openDialog(dlg);
}

// ---------------------------------------------------------------- PWA install guide
export function openInstallDialog({ deferredPrompt } = {}) {
  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const id = `dlg-${++seq}`;

  if (deferredPrompt) {
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then((choiceResult) => {
      if (choiceResult.outcome === 'accepted') {
        toast('Installing ZeroProp App…', 'ok');
      }
    });
    return;
  }

  const content = [];
  if (isStandalone) {
    content.push(
      h('div', { class: 'dlg-install-success' },
        h('span', { style: { fontSize: '28px' } }, '🎉'),
        h('p', { style: { fontWeight: '600', fontSize: '15px' } }, 'ZeroProp is already installed!'),
        h('p', { class: 'muted' }, 'You are running the standalone application.'))
    );
  } else if (isIos) {
    content.push(
      h('div', { class: 'dlg-install-steps' },
        h('p', null, 'Install ZeroProp on your iPhone or iPad in 3 simple steps:'),
        h('div', { class: 'install-step' },
          h('span', { class: 'step-num' }, '1'),
          h('div', null, h('strong', null, 'Tap Share'), h('p', { class: 'muted' }, 'Tap the Share icon at the bottom of Safari (square with arrow pointing up).'))),
        h('div', { class: 'install-step' },
          h('span', { class: 'step-num' }, '2'),
          h('div', null, h('strong', null, 'Add to Home Screen'), h('p', { class: 'muted' }, 'Scroll down in the share sheet and tap "Add to Home Screen" (➕).'))),
        h('div', { class: 'install-step' },
          h('span', { class: 'step-num' }, '3'),
          h('div', null, h('strong', null, 'Confirm Install'), h('p', { class: 'muted' }, 'Tap "Add" in the top-right corner. ZeroProp will appear on your home screen like a native app!'))))
    );
  } else {
    content.push(
      h('div', { class: 'dlg-install-steps' },
        h('p', null, 'Install ZeroProp as a Progressive Web App (PWA) for 1-click access and fullscreen trading:'),
        h('div', { class: 'install-step' },
          h('span', { class: 'step-num' }, '1'),
          h('div', null, h('strong', null, 'Browser Address Bar'), h('p', { class: 'muted' }, 'Click the Install icon (💻 / 📲) in the right side of your browser address bar.'))),
        h('div', { class: 'install-step' },
          h('span', { class: 'step-num' }, '2'),
          h('div', null, h('strong', null, 'Or Browser Menu'), h('p', { class: 'muted' }, 'Click the menu (⋮ or ⋯) in your browser and select "Install ZeroProp".'))))
    );
  }

  const dlg = h('dialog', { 'aria-labelledby': id, class: 'dlg-install' },
    h('div', { class: 'dlg-head' },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } },
        h('img', { src: '/img/logo.svg', width: '28', height: '28', alt: '' }),
        h('h2', { id }, 'Download ZeroProp App'))),
    h('div', { class: 'dlg-body' }, content),
    h('div', { class: 'dlg-foot' },
      h('button', { type: 'button', class: 'btn primary', on: { click: () => dlg.close() } }, 'Got it')));

  openDialog(dlg);
}

// ---------------------------------------------------------------- Monetization: Upgrade Evaluation Plan
export const EVAL_PLANS = [
  {
    id: '10k',
    title: '$10,000 Evaluation',
    balance: 10000,
    amount_inr: 199,
    duration_days: 30,
    duration_label: '30 Days',
    badge: 'Popular',
    desc: 'Perfect for building consistency and evaluating risk discipline.',
  },
  {
    id: '15k',
    title: '$15,000 Evaluation',
    balance: 15000,
    amount_inr: 499,
    duration_days: 90,
    duration_label: '90 Days (3 Mo)',
    badge: 'Best Value',
    desc: 'Extended 3-month validity with enhanced virtual capital.',
  },
  {
    id: '25k',
    title: '$25,000 Evaluation',
    balance: 25000,
    amount_inr: 799,
    duration_days: 180,
    duration_label: '180 Days (6 Mo)',
    badge: 'Pro Trader',
    desc: 'Maximum capital allocation with full 6 months trading runway.',
  },
];

export function openUpgradeDialog({ defaultPlanId = '10k', onComplete } = {}) {
  const id = `dlg-${++seq}`;
  const upiId = 'Harjinder1070-2@okaxis';
  let selectedPlanId = defaultPlanId;
  let proofImageBase64 = null;

  const planCardsWrap = h('div', { class: 'upgrade-plans-grid' });
  const paymentBox = h('div', { class: 'upgrade-payment-box' });
  const utrInput = h('input', {
    type: 'text',
    inputmode: 'numeric',
    pattern: '[0-9]*',
    maxlength: '12',
    placeholder: 'Enter 12-digit UTR / Ref No.',
    class: 'input-utr',
  });
  const utrHint = h('span', { class: 'field-hint' }, '0 / 12 digits');
  const fileInput = h('input', { type: 'file', accept: 'image/*', style: { display: 'none' } });
  const fileBtn = h('button', { type: 'button', class: 'btn sm', style: { alignSelf: 'start' } }, '📷 Upload Payment Screenshot (Optional)');
  const filePreview = h('div', { class: 'file-preview', style: { display: 'none' } });
  const errorEl = h('p', { class: 'dlg-error', role: 'alert' });
  const submitBtn = h('button', { type: 'button', class: 'btn primary' }, 'Submit Payment for Verification');

  // Helper to render QR SVG
  function getQrSvg(text) {
    if (typeof window.qrcode === 'function') {
      try {
        const qr = window.qrcode(0, 'M');
        qr.addData(text);
        qr.make();
        return qr.createSvgTag({ cellSize: 4, margin: 2 });
      } catch (e) {
        console.warn('QR error:', e);
      }
    }
    return '';
  }

  function getSelectedPlan() {
    return EVAL_PLANS.find((p) => p.id === selectedPlanId) || EVAL_PLANS[0];
  }

  function renderPlanCards() {
    planCardsWrap.innerHTML = '';
    EVAL_PLANS.forEach((plan) => {
      const isSelected = plan.id === selectedPlanId;
      const card = h('div', {
        class: `upgrade-plan-card ${isSelected ? 'selected' : ''}`,
        on: {
          click: () => {
            selectedPlanId = plan.id;
            renderPlanCards();
            renderPaymentBox();
          },
        },
      },
        h('div', { class: 'plan-card-head' },
          h('span', { class: 'plan-card-badge' }, plan.badge),
          h('span', { class: 'plan-card-dur' }, plan.duration_label)),
        h('h3', { class: 'plan-card-title' }, plan.title),
        h('div', { class: 'plan-card-price' },
          h('span', { class: 'plan-price-curr' }, '₹'),
          h('strong', { class: 'plan-price-val' }, String(plan.amount_inr)),
          h('small', { class: 'plan-price-inr' }, 'INR')),
        h('p', { class: 'plan-card-desc' }, plan.desc));
      planCardsWrap.append(card);
    });
  }

  function renderPaymentBox() {
    paymentBox.innerHTML = '';
    const plan = getSelectedPlan();
    const username = store.me?.user?.username || 'trader';
    const upiUri = `upi://pay?pa=${upiId}&pn=ZeroProp&am=${plan.amount_inr}&cu=INR&tn=ZeroProp_${plan.id}_${username}`;
    const qrSvg = getQrSvg(upiUri);

    const qrContainer = h('div', { class: 'upi-qr-wrap' });
    if (qrSvg) {
      qrContainer.innerHTML = qrSvg;
    } else {
      qrContainer.textContent = 'Scan via UPI';
    }

    const copyBtn = h('button', { type: 'button', class: 'btn sm ghost' }, '📋 Copy UPI ID');
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(upiId);
        copyBtn.textContent = '✅ Copied!';
        toast('UPI ID copied to clipboard!', 'ok');
        setTimeout(() => { copyBtn.textContent = '📋 Copy UPI ID'; }, 2000);
      } catch (_) {
        toast(`UPI ID: ${upiId}`, 'info');
      }
    });

    const upiAppBtn = h('a', {
      href: upiUri,
      class: 'btn primary sm upi-app-link',
      target: '_blank',
      rel: 'noopener',
    }, '⚡ Pay via UPI App (GPay / PhonePe / Paytm)');

    const boxContent = h('div', { class: 'payment-details-flex' },
      h('div', { class: 'payment-left' },
        qrContainer,
        h('span', { class: 'muted-xs' }, 'Scan QR in any UPI app')),
      h('div', { class: 'payment-right' },
        h('div', { class: 'payment-field' },
          h('span', { class: 'payment-lbl' }, 'Payable Amount:'),
          h('strong', { class: 'payment-amt' }, `₹${plan.amount_inr} INR`)),
        h('div', { class: 'payment-field' },
          h('span', { class: 'payment-lbl' }, 'UPI ID:'),
          h('div', { class: 'upi-copy-row' },
            h('code', { class: 'upi-id-code' }, upiId),
            copyBtn)),
        h('div', { class: 'payment-actions' }, upiAppBtn),
        h('p', { class: 'payment-instruction' },
          'Open your UPI app (Google Pay, PhonePe, Paytm, etc.), complete the payment of ',
          h('strong', null, `₹${plan.amount_inr}`),
          ', then copy the 12-digit UTR number from the transaction details.')));

    paymentBox.append(boxContent);
  }

  // Handle UTR input validation & live counter
  utrInput.addEventListener('input', (e) => {
    const val = e.target.value.replace(/\D/g, '').slice(0, 12);
    e.target.value = val;
    const len = val.length;
    utrHint.textContent = `${len} / 12 digits`;
    utrHint.style.color = len === 12 ? 'var(--up)' : 'var(--ink-3)';
    errorEl.textContent = '';
  });

  // Handle screenshot upload
  fileBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      errorEl.textContent = 'Please choose a valid image file.';
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const maxDim = 900;
        let w = img.width, h = img.height;
        if (w > maxDim || h > maxDim) {
          if (w > h) { h = Math.round((h * maxDim) / w); w = maxDim; }
          else { w = Math.round((w * maxDim) / h); h = maxDim; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        proofImageBase64 = canvas.toDataURL('image/jpeg', 0.85);

        // Show preview thumbnail
        filePreview.innerHTML = '';
        filePreview.style.display = 'flex';
        const thumb = h('img', { src: proofImageBase64, class: 'proof-thumb', alt: 'Screenshot preview' });
        const removeBtn = h('button', { type: 'button', class: 'btn sm danger ghost' }, '✕ Remove');
        removeBtn.addEventListener('click', () => {
          proofImageBase64 = null;
          fileInput.value = '';
          filePreview.style.display = 'none';
          filePreview.innerHTML = '';
        });
        filePreview.append(thumb, removeBtn);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });

  const dlg = h('dialog', { 'aria-labelledby': id, class: 'dlg-upgrade' },
    h('div', { class: 'dlg-head' },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } },
        h('img', { src: '/img/logo.svg', width: '28', height: '28', alt: '' }),
        h('h2', { id }, 'Funded Evaluation Plans'))),
    h('div', { class: 'dlg-body upgrade-dlg-body' },
      h('p', { class: 'muted', style: { margin: 0, fontSize: '13px' } },
        'Choose a funded evaluation tier to trade live markets with higher capital and verified leaderboard status.'),
      // Step 1: Select Plan
      h('div', { class: 'upgrade-section' },
        h('div', { class: 'upgrade-step-title' },
          h('span', { class: 'step-badge' }, '1'),
          h('strong', null, 'Select Your Evaluation Plan')),
        planCardsWrap),
      // Step 2: Payment Details
      h('div', { class: 'upgrade-section' },
        h('div', { class: 'upgrade-step-title' },
          h('span', { class: 'step-badge' }, '2'),
          h('strong', null, 'Pay via UPI')),
        paymentBox),
      // Step 3: Anti-Fraud Verification Form
      h('div', { class: 'upgrade-section' },
        h('div', { class: 'upgrade-step-title' },
          h('span', { class: 'step-badge' }, '3'),
          h('strong', null, 'Submit 12-Digit UPI Reference (UTR) for Verification')),
        h('div', { class: 'verification-form' },
          h('label', { class: 'field' },
            h('span', { class: 'field-label' }, '12-Digit UPI Transaction ID / UTR / Ref No:'),
            utrInput,
            utrHint),
          h('div', { class: 'field file-field' },
            fileBtn,
            fileInput,
            filePreview),
          h('div', { class: 'anti-fraud-callout' },
            h('span', { style: { fontSize: '14px' } }, '🛡️'),
            h('span', null,
              'Every UTR is matched against official UPI bank statements by admin before account capital is activated. ' +
              'Fake, guessed, or duplicate UTRs are rejected.')))),
      errorEl),
    h('div', { class: 'dlg-foot' },
      h('button', { type: 'button', class: 'btn', on: { click: () => dlg.close() } }, 'Cancel'),
      submitBtn));

  // Initial renders
  renderPlanCards();
  renderPaymentBox();

  // Submission handler
  submitBtn.addEventListener('click', async () => {
    const plan = getSelectedPlan();
    const utr = utrInput.value.trim();

    if (!/^[0-9]{12}$/.test(utr)) {
      errorEl.textContent = 'Please enter exactly 12 numeric digits for the UPI UTR / Reference ID.';
      utrInput.focus();
      return;
    }

    submitBtn.disabled = true;
    errorEl.textContent = '';
    submitBtn.textContent = 'Verifying & Submitting…';

    try {
      const resp = await api('/api/payments/submit', {
        method: 'POST',
        body: {
          plan_id: plan.id,
          utr: utr,
          proof_image: proofImageBase64,
        },
      });

      // Show success modal content
      const bodyEl = dlg.querySelector('.dlg-body');
      const footEl = dlg.querySelector('.dlg-foot');
      mount(bodyEl,
        h('div', { class: 'upgrade-success-view' },
          h('div', { class: 'success-icon-wrap' }, '🎉'),
          h('h3', { style: { margin: '8px 0 4px', fontSize: '18px' } }, 'Payment Submitted for Verification!'),
          h('p', { class: 'muted', style: { margin: 0 } },
            `Your submission for `, h('strong', null, plan.title), ` (₹${plan.amount_inr} INR) has been registered.`),
          h('div', { class: 'success-info-card' },
            h('div', { class: 'success-row' }, h('span', null, 'UTR / Reference:'), h('code', null, utr)),
            h('div', { class: 'success-row' }, h('span', null, 'Status:'), h('span', { class: 'badge warn' }, 'Pending Admin Review')),
            h('div', { class: 'success-row' }, h('span', null, 'Target Capital:'), h('strong', null, `$${plan.balance.toLocaleString()}`))),
          h('p', { class: 'muted-xs', style: { maxWidth: '400px', margin: '12px auto 0' } },
            'Our admin team verifies transactions directly on the UPI ledger. Once confirmed, your virtual balance and active validity will update automatically.')));

      mount(footEl,
        h('button', {
          type: 'button', class: 'btn primary',
          on: {
            click: () => {
              dlg.close();
              if (onComplete) onComplete(resp);
              location.hash = '#/account';
            },
          },
        }, 'Done'));

      toast('Payment request submitted for admin review.', 'ok');
    } catch (err) {
      errorEl.textContent = err.message || 'Submission failed. Please check your UTR and try again.';
      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit Payment for Verification';
    }
  });

  openDialog(dlg);
}

