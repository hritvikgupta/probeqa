import type { Run, Target, AgentData } from './types';

export const STATUS_LABEL: Record<string, string> = {
  ok: 'Passed',
  fail: 'Failed',
  run: 'Running',
  warn: 'Diff',
};

export const RUNS: Run[] = [
  {
    id: 1, n: 'checkout.purchase-flow', ty: 'web', tgt: 'shop.acme.com', a: 'Browser',
    dur: '1m 12s', when: '2m ago', s: 'ok', err: null,
    steps: [['Load shop.acme.com','ok','420ms'],['Add item to cart','ok','180ms'],['Open checkout','ok','310ms'],['Fill billing','ok','620ms'],['Submit order','ok','840ms'],['Verify confirmation','ok','290ms']],
  },
  {
    id: 2, n: 'auth.login.api', ty: 'api', tgt: 'api.acme.com/v1/auth', a: 'API',
    dur: '18s', when: '7m ago', s: 'ok', err: null,
    steps: [['POST /auth/login','ok','142ms'],['Assert 200','ok','2ms'],['Assert schema','ok','4ms'],['Decode JWT','ok','11ms']],
  },
  {
    id: 3, n: 'invoices.list', ty: 'api', tgt: 'api.acme.com/v1', a: 'API',
    dur: '42s', when: '14m ago', s: 'fail',
    err: 'Expected status 200 but received 500.\nResponse body did not match schema "invoice.list.v2".',
    loc: 'tests/api/invoices.spec.ts:48',
    steps: [['GET /invoices?page=1','ok','220ms'],['Assert 200','fail','—'],['Validate schema','—','—']],
  },
  {
    id: 4, n: 'dashboard.visual', ty: 'page', tgt: 'app.acme.com/dashboard', a: 'Visual',
    dur: '1m 04s', when: '22m ago', s: 'warn',
    err: '2 visual diffs detected above threshold (0.4%).',
    loc: 'tests/visual/dashboard.spec.ts',
    steps: [['Open page','ok','680ms'],['Wait for stable','ok','1.2s'],['Snapshot viewport','ok','—'],['Compare baseline','warn','2 diffs']],
  },
  {
    id: 5, n: 'signup.regression', ty: 'web', tgt: 'app.acme.com', a: 'Browser',
    dur: '2m 31s', when: '31m ago', s: 'ok', err: null,
    steps: [['Open signup','ok','410ms'],['Fill form','ok','1.1s'],['Submit','ok','620ms'],['Verify email step','ok','520ms'],['Complete onboarding','ok','11.2s']],
  },
  {
    id: 6, n: 'pricing.a11y', ty: 'page', tgt: 'acme.com/pricing', a: 'Accessibility',
    dur: '9s', when: '48m ago', s: 'ok', err: null,
    steps: [['Render page','ok','340ms'],['Check landmarks','ok','—'],['Check contrast','ok','—'],['Check focus order','ok','—']],
  },
  {
    id: 7, n: 'payments.webhook', ty: 'api', tgt: 'api.acme.com/hooks', a: 'API',
    dur: '12s', when: '1h ago', s: 'run', err: null,
    steps: [['Send test event','ok','—'],['Wait for ack','run','—']],
  },
  {
    id: 8, n: 'search.smoke', ty: 'web', tgt: 'app.acme.com', a: 'Browser',
    dur: '24s', when: '1h ago', s: 'ok', err: null,
    steps: [['Open app','ok','—'],['Type query','ok','—'],['Expect results','ok','—']],
  },
  {
    id: 9, n: 'profile.edit', ty: 'web', tgt: 'app.acme.com', a: 'Browser',
    dur: '38s', when: '2h ago', s: 'fail',
    err: 'Element "button[data-action=save]" was not visible after 5000ms.',
    loc: 'tests/web/profile.spec.ts:22',
    steps: [['Open /profile','ok','—'],['Click edit','ok','—'],['Wait for save button','fail','5.0s']],
  },
  {
    id: 10, n: 'org.invite-flow', ty: 'web', tgt: 'app.acme.com', a: 'Browser',
    dur: '55s', when: '3h ago', s: 'ok', err: null,
    steps: [['Open team page','ok','—'],['Invite member','ok','—'],['Accept invite','ok','—']],
  },
];

export const TARGETS: Record<string, Target[]> = {
  apps: [
    { n: 'Acme Shop',      ty: 'Web app', url: 'https://shop.acme.com',  a: 'Browser', s: 'ok' },
    { n: 'Acme Console',   ty: 'Web app', url: 'https://app.acme.com',   a: 'Browser', s: 'ok' },
    { n: 'Marketing site', ty: 'Web app', url: 'https://acme.com',       a: 'Browser', s: 'warn' },
  ],
  pages: [
    { n: 'Home',      ty: 'Page', url: 'acme.com/',              a: 'Visual',        s: 'ok' },
    { n: 'Pricing',   ty: 'Page', url: 'acme.com/pricing',       a: 'Accessibility', s: 'ok' },
    { n: 'Signup',    ty: 'Page', url: 'app.acme.com/signup',    a: 'Browser',       s: 'fail' },
    { n: 'Dashboard', ty: 'Page', url: 'app.acme.com/dashboard', a: 'Visual',        s: 'warn' },
    { n: 'Checkout',  ty: 'Page', url: 'shop.acme.com/checkout', a: 'Browser',       s: 'ok' },
  ],
  apis: [
    { n: 'Auth API',     ty: 'API', url: 'api.acme.com/v1/auth',     a: 'API', s: 'ok' },
    { n: 'Invoices API', ty: 'API', url: 'api.acme.com/v1/invoices', a: 'API', s: 'fail' },
    { n: 'Checkout API', ty: 'API', url: 'api.acme.com/v1/checkout', a: 'API', s: 'ok' },
    { n: 'Webhooks',     ty: 'API', url: 'api.acme.com/hooks',       a: 'API', s: 'run' },
  ],
};

export const AGENTS: AgentData[] = [
  { n: 'Browser',       p: 'Drives end-to-end flows in a real browser', cov: '24 tests', last: '2m ago',  sr: '98%',
    ic: '<rect x="3" y="4" width="18" height="14" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/>' },
  { n: 'API',           p: 'Sends requests and validates responses',     cov: '42 tests', last: '7m ago',  sr: '94%',
    ic: '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>' },
  { n: 'Visual',        p: 'Captures screenshots and compares baselines',cov: '17 tests', last: '22m ago', sr: '91%',
    ic: '<circle cx="12" cy="12" r="3"/><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/>' },
  { n: 'Accessibility', p: 'Audits pages against WCAG rules',            cov: '9 tests',  last: '48m ago', sr: '100%',
    ic: '<circle cx="12" cy="5" r="2"/><path d="M5 9h14M12 11v10M9 14l-2 7M15 14l2 7"/>' },
];
