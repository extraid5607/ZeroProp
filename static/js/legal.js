// Legal, Regulatory, About Us, and Commercial Policies for ZeroProp
// Modular component that renders in the Account tab and can also be opened as a dialog.
import { h, mount } from './util.js';

export const LEGAL_SECTIONS = [
  {
    id: 'about',
    title: 'About ZeroProp',
    icon: '🏢',
    badge: 'Prop Simulator',
    summary: 'Our mission, technology, simulated prop trading model, and live market infrastructure.',
  },
  {
    id: 'disclaimer',
    title: 'Disclaimer & Risk',
    icon: '⚠️',
    badge: 'Regulatory Notice',
    summary: 'Important disclosures regarding virtual simulated capital, CFTC/SEBI notice, and lack of financial advice.',
  },
  {
    id: 'privacy',
    title: 'Privacy Policy',
    icon: '🔒',
    badge: 'Data Protection',
    summary: 'How user credentials, trading statistics, session data, and UPI references are handled.',
  },
  {
    id: 'terms',
    title: 'Terms of Service',
    icon: '📜',
    badge: 'Platform Rules',
    summary: 'Terms of use, prohibited trading practices, evaluation criteria, and user responsibilities.',
  },
  {
    id: 'refund',
    title: 'Refund & Cancellation',
    icon: '💳',
    badge: 'Commercial Policy',
    summary: 'Digital evaluation service conditions, non-refundable terms, and duplicate payment resolution.',
  },
  {
    id: 'contact',
    title: 'Contact & Support',
    icon: '💬',
    badge: 'Trader Desk',
    summary: 'Official support channels, payment verification desk, and response time commitments.',
  },
];

export function getLegalContent(id) {
  switch (id) {
    case 'about':
      return h('div', { class: 'legal-article' },
        h('div', { class: 'legal-header-block' },
          h('div', { class: 'legal-badge-row' },
            h('span', { class: 'badge accent' }, 'Prop Trading Sandbox'),
            h('span', { class: 'legal-date' }, 'Last updated: October 2026')),
          h('h3', null, 'About ZeroProp: Zero Risk. Real Skill.'),
          h('p', { class: 'legal-lead' },
            'ZeroProp is a cutting-edge simulated proprietary trading evaluation platform. ' +
            'We provide aspirational traders with institutional-grade trading tools, live multi-asset market data, ' +
            'and realistic execution environments to cultivate discipline, master risk management, and prove trading profitability.')),

        h('div', { class: 'legal-grid-2' },
          h('div', { class: 'legal-feature-box' },
            h('h4', null, '⚡ Live Multi-Asset Markets'),
            h('p', null, 'ZeroProp aggregates tick-by-tick market feeds from tier-1 liquidity providers: Crypto (BTC, ETH, SOL, altcoins), Commodities (Gold, Silver, Crude Oil, Natural Gas), and Major Forex pairs.')),
          h('div', { class: 'legal-feature-box' },
            h('h4', null, '🛡️ Built-In Risk Enforcer'),
            h('p', null, 'Our engine enforces professional prop rules: mandatory stop-loss calculation in R-multiples, leverage control, and automatic daily drawdown locks to protect trader psychology.')),
          h('div', { class: 'legal-feature-box' },
            h('h4', null, '📓 Behavioral Trading Journal'),
            h('p', null, 'Every trade records your entry emotion, setup rationale, and post-trade performance analytics, revealing which psychological states make or lose money.')),
          h('div', { class: 'legal-feature-box' },
            h('h4', null, '🏆 Funded Evaluation Path'),
            h('p', null, 'Traders start with a free $2,000 evaluation sandbox or unlock up to $25,000 capital tiers to test strategies under realistic prop firm drawdown constraints.'))),

        h('div', { class: 'legal-callout info' },
          h('strong', null, 'Our Core Philosophy: '),
          h('span', null, 'Trading with real money before mastering emotional control and risk management is financial suicide. ZeroProp allows you to fail safely, iterate rapidly, and build verifiable track records before you risk a single rupee or dollar.')));

    case 'disclaimer':
      return h('div', { class: 'legal-article' },
        h('div', { class: 'legal-header-block' },
          h('div', { class: 'legal-badge-row' },
            h('span', { class: 'badge warn' }, 'Regulatory & Risk Warning'),
            h('span', { class: 'legal-date' }, 'CFTC / Financial Disclosure')),
          h('h3', null, 'Disclaimer & Simulated Trading Disclosure'),
          h('p', { class: 'legal-lead' },
            'Please read this disclaimer carefully before utilizing any features, evaluation plans, or educational tools on ZeroProp.')),

        h('div', { class: 'legal-callout warn' },
          h('strong', null, 'CRITICAL NOTICE: '),
          h('span', null,
            'ZeroProp is NOT a broker-dealer, financial institution, registered investment advisor (RIA), exchange, or custodian of client funds. ' +
            'ZeroProp does NOT provide financial advisory services, recommend investments, or facilitate real-money transactions on public exchanges.')),

        h('h4', { class: 'legal-subhead' }, '1. Completely Simulated Capital'),
        h('p', null,
          'All accounts, balances, equity curves, margins, positions, and profits/losses displayed on ZeroProp are entirely hypothetical, simulated, and virtual ("paper trading"). ' +
          'Virtual funds have no cash value, cannot be withdrawn, and cannot be used to redeem real financial assets. Payments made to ZeroProp are strictly evaluation access fees, not trading deposits.'),

        h('h4', { class: 'legal-subhead' }, '2. Hypothetical Performance Limitations (CFTC Rule 4.41 Notice)'),
        h('p', null,
          'Hypothetical or simulated performance results have certain inherent limitations. Unlike an actual performance record, simulated results do not represent actual trading. ' +
          'Also, since the trades have not actually been executed, the results may have under- or over-compensated for the impact, if any, of certain market factors, such as liquidity shortages, slippage, or counterparty insolvency. ' +
          'Simulated trading programs in general are also subject to the fact that they are designed with the benefit of hindsight. No representation is being made that any account will or is likely to achieve profits or losses similar to those shown.'),

        h('h4', { class: 'legal-subhead' }, '3. High Risk of Real Financial Trading'),
        h('p', null,
          'Trading financial markets (cryptocurrencies, commodities, forex, derivatives) involves substantial risk of loss and is not suitable for everyone. ' +
          'Success on the ZeroProp simulator does not guarantee success in real-money trading environments. You should never trade with capital you cannot afford to lose completely.'),

        h('h4', { class: 'legal-subhead' }, '4. No Investment Advice'),
        h('p', null,
          'All content, leaderboard statistics, quotes, charts, and materials provided on ZeroProp are for educational and training purposes only and must not be construed as investment, tax, or legal advice.'));

    case 'privacy':
      return h('div', { class: 'legal-article' },
        h('div', { class: 'legal-header-block' },
          h('div', { class: 'legal-badge-row' },
            h('span', { class: 'badge accent' }, 'Privacy & Data Protection'),
            h('span', { class: 'legal-date' }, 'Strict No-Sale Policy')),
          h('h3', null, 'Privacy Policy'),
          h('p', { class: 'legal-lead' },
            'ZeroProp values your privacy. We believe in minimal data footprint and maximum data security.')),

        h('h4', { class: 'legal-subhead' }, '1. Information We Collect'),
        h('ul', { class: 'legal-list' },
          h('li', null, h('strong', null, 'Account Information: '), 'Your chosen public username and a cryptographically salted password hash (PBKDF2-HMAC-SHA256). We do not require or collect your real legal name, telephone number, or email address during registration.'),
          h('li', null, h('strong', null, 'Trading Data & Journal: '), 'Simulated trade executions, timestamps, stop-loss and take-profit levels, emotional self-assessments, and user trade notes.'),
          h('li', null, h('strong', null, 'UPI Transaction References: '), 'When purchasing an evaluation plan, we collect the 12-digit UPI UTR / Reference ID and optional payment screenshot proof for manual verification against bank ledgers.'),
          h('li', null, h('strong', null, 'Technical Session Cookies: '), 'Secure HTTP-only session tokens necessary to keep you securely signed in to your trading terminal.')),

        h('h4', { class: 'legal-subhead' }, '2. What We NEVER Collect'),
        h('div', { class: 'legal-callout safe' },
          h('strong', null, 'Zero Sensitive Financial Data: '),
          h('span', null,
            'We never collect, store, or have access to your bank account passwords, UPI MPIN, debit/credit card numbers, or OTPs. ' +
            'All payments occur entirely inside your own UPI banking app (Google Pay, PhonePe, Paytm, BHIM, Axis Bank, etc.).')),

        h('h4', { class: 'legal-subhead' }, '3. Data Security & Storage'),
        h('p', null,
          'All communication between your device and ZeroProp servers is encrypted via TLS 1.3 / SSL. ' +
          'Rate limiting protects your login endpoints from brute-force intrusions. Database backups are strictly secured.'),

        h('h4', { class: 'legal-subhead' }, '4. No Data Selling or Sharing'),
        h('p', null,
          'ZeroProp will never sell, rent, monetize, or disclose your personal data, journal notes, or trading strategies to third-party advertisers, data aggregators, or external commercial entities.'),

        h('h4', { class: 'legal-subhead' }, '5. Data Retention & Deletion'),
        h('p', null,
          'You may request the permanent deletion of your account and associated trading journal data at any time by contacting the admin support desk.'));

    case 'terms':
      return h('div', { class: 'legal-article' },
        h('div', { class: 'legal-header-block' },
          h('div', { class: 'legal-badge-row' },
            h('span', { class: 'badge' }, 'Terms & Conditions'),
            h('span', { class: 'legal-date' }, 'User Agreement')),
          h('h3', null, 'Terms of Service'),
          h('p', { class: 'legal-lead' },
            'By registering an account, accessing the trading terminal, or submitting an evaluation payment on ZeroProp, you agree to be bound by these Terms of Service.')),

        h('h4', { class: 'legal-subhead' }, '1. Eligibility & User Accounts'),
        h('p', null,
          'You must be at least 18 years of age or the legal age of majority in your jurisdiction to use ZeroProp. ' +
          'Each account is for individual personal use only. Sharing credentials or attempting to operate accounts under false pretenses is prohibited.'),

        h('h4', { class: 'legal-subhead' }, '2. Simulated Trading Sandbox Rules'),
        h('p', null,
          'ZeroProp grants you a revocable, non-exclusive license to use our simulated trading terminal. ' +
          'You acknowledge that all funds provided ($2,000 free, $10,000, $15,000, $25,000) are purely fictitious evaluation capital with zero cash value.'),

        h('h4', { class: 'legal-subhead' }, '3. Prohibited Trading & Abusive Practices'),
        h('p', null, 'To ensure fair evaluation and accurate trading records, the following activities are strictly forbidden and will result in immediate termination:'),
        h('ul', { class: 'legal-list' },
          h('li', null, h('strong', null, 'Latency Arbitrage & Exploits: '), 'Exploiting internet lag, software delays, or feed anomalies to execute orders at outdated prices.'),
          h('li', null, h('strong', null, 'Feed Manipulation: '), 'Attempting to inject false tick packets or tamper with WebSocket price streaming.'),
          h('li', null, h('strong', null, 'Platform Abuse: '), 'DDoS attacks, brute-forcing API endpoints, reverse-engineering, or automated bot scraping without written consent.'),
          h('li', null, h('strong', null, 'Payment Fraud: '), 'Submitting forged, duplicate, or fraudulent UPI UTR numbers.')),

        h('h4', { class: 'legal-subhead' }, '4. Evaluation Validity & Seasons'),
        h('p', null,
          'Paid evaluation tiers are active for the specified duration (e.g., 30 days, 90 days, 180 days). ' +
          'Breaching risk rules (such as exceeding maximum daily drawdown) will lock the account until the daily reset or end the active evaluation season in accordance with prop evaluation standards.'),

        h('h4', { class: 'legal-subhead' }, '5. Limitation of Liability'),
        h('p', null,
          'ZeroProp is provided on an "as is" and "as available" basis. ZeroProp shall not be liable for any indirect, incidental, or consequential damages resulting from platform downtime, market price feed disruptions, or lost profits.'));

    case 'refund':
      return h('div', { class: 'legal-article' },
        h('div', { class: 'legal-header-block' },
          h('div', { class: 'legal-badge-row' },
            h('span', { class: 'badge accent' }, 'Commercial Policy'),
            h('span', { class: 'legal-date' }, 'Transparent & Fair')),
          h('h3', null, 'Refund & Cancellation Policy'),
          h('p', { class: 'legal-lead' },
            'ZeroProp is dedicated to transparent, fair, and professional commercial practices. ' +
            'Please read our policy regarding evaluation plan payments, cancellations, and refunds.')),

        h('h4', { class: 'legal-subhead' }, '1. Nature of the Digital Service'),
        h('p', null,
          'ZeroProp sells access to proprietary simulated evaluation infrastructure, risk monitoring software, and administrative account management. ' +
          'Because account activation grants immediate digital access to evaluation capital and server resources, all evaluation fee purchases are considered digital goods.'),

        h('h4', { class: 'legal-subhead' }, '2. Non-Refundable Once Activated'),
        h('div', { class: 'legal-callout info' },
          h('strong', null, 'Standard Policy: '),
          h('span', null,
            'Once an evaluation plan payment has been verified by the administrator and the evaluation capital is unlocked on your account, the fee is non-refundable. ' +
            'Evaluation fees are not deposits and cannot be withdrawn or converted to fiat cash under any circumstances.')),

        h('h4', { class: 'legal-subhead' }, '3. Eligible Refund Circumstances'),
        h('ul', { class: 'legal-list' },
          h('li', null, h('strong', null, 'Accidental Duplicate Transfer: '), 'If you accidentally transfer funds multiple times for the same plan, the duplicate amount will be refunded in full once verified.'),
          h('li', null, h('strong', null, 'Service Unfulfillment: '), 'If you submit a valid payment and ZeroProp is unable to activate your evaluation account due to platform technical failures within 48 hours, you are entitled to a 100% refund.'),
          h('li', null, h('strong', null, 'Rejection Before Activation: '), 'If an admin rejects your evaluation application before activating virtual funds, any verified funds received will be refunded.')),

        h('h4', { class: 'legal-subhead' }, '4. Refund Processing Window'),
        h('p', null,
          'Approved refunds are returned directly to the originating UPI Virtual Payment Address (VPA) / Bank Account within 5 to 7 business days. ' +
          'To request a refund review, contact our support desk with your username, payment date, and 12-digit UTR number.'));

    case 'contact':
      return h('div', { class: 'legal-article' },
        h('div', { class: 'legal-header-block' },
          h('div', { class: 'legal-badge-row' },
            h('span', { class: 'badge accent' }, 'Trader Support Desk'),
            h('span', { class: 'legal-date' }, '24/7 Monitoring')),
          h('h3', null, 'Contact & Official Support'),
          h('p', { class: 'legal-lead' },
            'Need help with evaluation plans, payment verifications, bug reports, or risk rule inquiries? Reach out to our team.')),

        h('div', { class: 'legal-contact-grid' },
          h('div', { class: 'legal-contact-card' },
            h('div', { class: 'contact-icon' }, '✉️'),
            h('h4', null, 'Email Support'),
            h('p', { class: 'muted-xs' }, 'For general inquiries, account management & corporate matters:'),
            h('a', { href: 'mailto:support@zeroprop.com', class: 'contact-link' }, 'support@zeroprop.com')),
          h('div', { class: 'legal-contact-card' },
            h('div', { class: 'contact-icon' }, '💳'),
            h('h4', null, 'UPI Payment & UTR Desk'),
            h('p', { class: 'muted-xs' }, 'For payment confirmation, UTR tracking, and account activation:'),
            h('span', { class: 'contact-highlight' }, 'Harjinder1070-2@okaxis'),
            h('small', { class: 'muted-xs', style: { display: 'block', marginTop: '4px' } }, 'Average manual verification: 15–60 mins')),
          h('div', { class: 'legal-contact-card' },
            h('div', { class: 'contact-icon' }, '💬'),
            h('h4', null, 'Community & Trader Desk'),
            h('p', { class: 'muted-xs' }, 'Join other prop traders, ask technical questions, and track feature updates:'),
            h('span', { class: 'contact-link' }, '@ZeroPropSupport (Telegram)')),
          h('div', { class: 'legal-contact-card' },
            h('div', { class: 'contact-icon' }, '⏱️'),
            h('h4', null, 'Operating Hours'),
            h('p', { class: 'muted-xs' }, 'Simulator terminal & price streams: 24/7/365.'),
            h('p', { class: 'muted-xs' }, 'Admin review desk: 09:00 – 23:00 IST daily.'))),

        h('div', { class: 'legal-callout info' },
          h('strong', null, 'Verification Assistance: '),
          h('span', null, 'If you submitted a UPI UTR and your account has not upgraded within 2 hours, please email support or message the admin desk with your username and UTR number.')));

    default:
      return h('div', { class: 'legal-article' }, h('p', null, 'Select a policy from the tabs above.'));
  }
}

/**
 * Renders the complete, interactive legal & commercial documentation section for the Account page.
 */
export function renderLegalSection(activeTabId = 'about') {
  let currentTab = activeTabId;
  const container = h('section', { class: 'panel legal-section-container', id: 'company-legal' });

  function draw() {
    const navButtons = LEGAL_SECTIONS.map((sec) =>
      h('button', {
        type: 'button',
        class: `legal-tab-btn ${sec.id === currentTab ? 'active' : ''}`,
        'aria-selected': String(sec.id === currentTab),
        on: {
          click: () => {
            currentTab = sec.id;
            draw();
          },
        },
      },
        h('span', { class: 'legal-tab-icon' }, sec.icon),
        h('span', { class: 'legal-tab-label' }, sec.title)));

    const activeMeta = LEGAL_SECTIONS.find((s) => s.id === currentTab) || LEGAL_SECTIONS[0];
    const contentBody = getLegalContent(currentTab);

    mount(container,
      // Section Header
      h('div', { class: 'legal-section-top' },
        h('div', null,
          h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
            h('h2', { style: { margin: 0, fontSize: '18px' } }, 'Company & Legal Information'),
            h('span', { class: 'badge' }, 'Compliance & Trust')),
          h('p', { class: 'muted', style: { margin: '4px 0 0', fontSize: '13px' } },
            'Official platform terms, simulated prop trading disclaimers, privacy policy, and commercial refund guidelines.')),
        h('div', { class: 'legal-top-actions' },
          h('button', {
            type: 'button',
            class: 'btn sm ghost',
            on: { click: () => openLegalDialog(currentTab) },
          }, 'Expand Fullscreen ↗'))),

      // Tab selector
      h('div', { class: 'legal-tabs-bar', role: 'tablist' }, navButtons),

      // Content viewer
      h('div', { class: 'legal-content-viewport' },
        contentBody),

      // Section Footer
      h('div', { class: 'legal-section-foot' },
        h('span', null, '© 2026 ZeroProp Platform. All rights reserved.'),
        h('span', null, 'Proprietary Simulated Evaluation System · Zero Risk. Real Skill.')));
  }

  draw();
  return container;
}

/**
 * Opens a modal dialog with full-screen view of any legal section.
 */
export function openLegalDialog(initialTab = 'about') {
  let cur = initialTab;
  const id = `dlg-legal-${Date.now()}`;
  const bodyEl = h('div', { class: 'legal-dialog-content' });

  const dlg = h('dialog', { class: 'dlg-legal', 'aria-labelledby': id },
    h('div', { class: 'dlg-head' },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } },
        h('img', { src: '/img/logo.svg', alt: 'ZeroProp', class: 'brand-logo', width: '24', height: '24' }),
        h('h2', { id, style: { margin: 0, fontSize: '17px' } }, 'ZeroProp Legal & Compliance Center')),
      h('button', {
        type: 'button', class: 'btn sm ghost', 'aria-label': 'Close',
        on: { click: () => dlg.close() },
      }, '✕')),
    h('div', { class: 'dlg-legal-tabs' },
      LEGAL_SECTIONS.map((s) =>
        h('button', {
          type: 'button',
          class: `dlg-tab-btn ${s.id === cur ? 'active' : ''}`,
          on: {
            click: (e) => {
              cur = s.id;
              dlg.querySelectorAll('.dlg-tab-btn').forEach((b) => b.classList.remove('active'));
              e.currentTarget.classList.add('active');
              mount(bodyEl, getLegalContent(cur));
            },
          },
        }, `${s.icon} ${s.title}`))),
    h('div', { class: 'dlg-body legal-dialog-body' }, bodyEl),
    h('div', { class: 'dlg-foot' },
      h('button', { type: 'button', class: 'btn primary', on: { click: () => dlg.close() } }, 'Close')));

  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  dlg.addEventListener('close', () => dlg.remove());

  mount(bodyEl, getLegalContent(cur));
  document.body.append(dlg);
  dlg.showModal();
  return dlg;
}
