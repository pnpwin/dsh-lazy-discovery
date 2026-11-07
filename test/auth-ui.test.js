import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../src/client.js', import.meta.url), 'utf8');
const tick = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)); };
const response = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data });
const clone = value => JSON.parse(JSON.stringify(value));
const server = overrides => ({ serverName: 'example', transport: 'streamable-http', destination: 'https://example.test', enabled: true, headerRefs: {}, envRefs: {}, credentials: [{ name: 'API_TOKEN', configured: true, source: 'native' }], hasLiteralCredentials: false, revision: 'r1', ...overrides });
const snapshot = servers => ({ version: 1, writable: true, credentialProviderAvailable: true, servers });
const payload = overrides => ({ serverName: 'example', revision: 'r1', enabled: true, headerRefs: {}, envRefs: {}, confirmed: false, replaceExisting: false, ...overrides });
const cards = page => nodes(page.render()).filter(node => typeof node.type === 'function');
const cardTree = (app, page, name = 'example') => { const card = cards(page).find(node => node.props.server.serverName === name); return app.runner(card.type, card.props).render(); };

// A small hook driver exercises the actual plain-JS module without a browser,
// duplicate React installation, global DOM or any real credential provider.
function harness(fetchImpl = async () => response(snapshot([])), timers = {}) {
  let current;
  const React = {
    createElement: (type, props, ...children) => ({ type, props: { ...(props ?? {}), children: children.flat(Infinity).filter(child => child !== false && child !== null && child !== undefined) } }),
    useState(initial) {
      const runner = current, index = runner.index++;
      if (!(index in runner.state)) runner.state[index] = typeof initial === 'function' ? initial() : initial;
      return [runner.state[index], value => { runner.state[index] = typeof value === 'function' ? value(runner.state[index]) : value; }];
    },
    useRef(initial) {
      const runner = current, index = runner.index++;
      return runner.state[index] ?? (runner.state[index] = { current: initial });
    },
    useEffect(effect) {
      const runner = current, index = runner.index++;
      if (!(index in runner.state)) { runner.state[index] = true; runner.effects.push(effect); }
    },
    useSyncExternalStore(subscribe, getSnapshot) { getSnapshot(); },
    useId() { const index = current.index++; return `test-id-${index}`; },
  };
  let bundle;
  const requires = [];
  vm.runInNewContext(source, { window: { __ModuleLoader__: { load: value => { bundle = value; } } }, fetch: fetchImpl, AbortController, setTimeout: timers.setTimeout ?? setTimeout, clearTimeout: timers.clearTimeout ?? clearTimeout });
  const plugin = bundle.factory(name => { requires.push(name); assert.equal(name, 'react'); return React; });
  const registrations = [], dictionaries = new Map();
  let language = 'en';
  const ctx = {
    effect: effect => effect(),
    slots: { inject: (name, register) => register(), register: (options, component) => { registrations.push({ options, component }); return () => {}; } },
    locale: {
      register: (namespace, lang, dictionary) => { dictionaries.set(lang, dictionary); return () => {}; },
      bind: () => key => dictionaries.get(language)[key],
      subscribe: () => () => {}, getSnapshot: () => language,
    },
  };
  plugin.apply(ctx);
  function runner(component, props = {}) {
    const result = {
      state: [], index: 0, effects: [], cleanups: [], props,
      render() { result.index = 0; current = result; try { result.tree = component(result.props); return result.tree; } finally { current = undefined; } },
      mount() { result.render(); result.cleanups = result.effects.map(effect => effect()); },
      unmount() { result.cleanups.forEach(cleanup => cleanup?.()); },
      remountEffects() { result.cleanups = result.effects.map(effect => effect()); },
    };
    return result;
  }
  const Page = registrations[0].component;
  function form(overrides = {}, extra = {}) {
    const page = runner(Page); page.render();
    // Obtain the nested component from a loaded page while avoiding any network.
    page.state[0] = snapshot([server(overrides)]);
    const element = nodes(page.render()).find(node => typeof node.type === 'function');
    const saved = [];
    const result = runner(element.type, { ...element.props, busy: false, save: async body => { saved.push(clone(body)); }, dirty: () => {}, ...extra });
    result.render(); result.saved = saved;
    return result;
  }
  return { plugin, bundle, registrations, requires, runner, Page, form, language: value => { language = value; } };
}
function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  return [tree, ...(tree.props?.children ?? []).flatMap(nodes)];
}
function text(tree) {
  if (tree === null || tree === undefined || tree === false) return '';
  return typeof tree === 'object' ? (tree.props?.children ?? []).map(text).join(' ') : String(tree);
}
const input = (form, label) => nodes(form.render()).find(node => node.type === 'label' && text(node).trimStart().startsWith(label))?.props.children.find(node => node.type === 'input');
const button = (form, label) => nodes(form.render()).find(node => node.type === 'button' && text(node) === label);
const change = (node, value) => node.props.onChange({ target: typeof value === 'boolean' ? { checked: value } : { value } });
const submit = form => form.render().props.onSubmit({ preventDefault() {} });
const confirm = form => change(input(form, 'I authorize'), true);
function bearerForm(app, page, name, credential) {
  const card = cards(page).find(node => node.props.server.serverName === name);
  const form = app.runner(card.type, card.props); form.render();
  change(nodes(form.render()).find(node => node.type === 'select'), 'bearer');
  change(input(form, 'Credential name'), credential);
  confirm(form);
  return form;
}

test('bundle uses inspected slot, locale and theme-only CSS contracts', () => {
  const app = harness();
  assert.equal(app.bundle.id, '@pnpwin/dsh-lazy-discovery');
  assert.deepEqual(clone(app.plugin.inject), ['slots', 'locale']);
  assert.deepEqual(app.requires, ['react']);
  assert.equal(app.registrations[0].options.name, 'settings.section');
  assert.equal(app.registrations[0].options.id, 'lazy-mcp-auth');
  assert.equal(app.registrations[0].options.order, 36);
  assert.equal(app.registrations[0].options.label(), 'MCP authorization');
  app.language('ru');
  assert.equal(app.registrations[0].options.label(), 'Авторизация MCP');
  assert.doesNotMatch(source, /document\.|console\.|require\(['"]@deepseek/);
  assert.ok([...source.matchAll(/var\((--[^)]+)\)/g)].every(([, name]) => name.startsWith('--dsw-alias-')));
});

test('imported multi-header bindings and missing prefixes survive an untouched save', async () => {
  const refs = { 'X-Api-Key': { name: 'API_TOKEN' }, Authorization: { name: 'OTHER_TOKEN', prefix: 'Custom ' } };
  const form = harness().form({ headerRefs: refs, envRefs: { HIDDEN: 'ENV_TOKEN' } });
  assert.equal(nodes(form.render()).find(node => node.type === 'select').props.value, 'custom');
  assert.equal(button(form, 'Save bindings').props.disabled, true);
  await submit(form);
  assert.equal(form.saved.length, 0);
  confirm(form);
  await submit(form);
  assert.equal(form.saved.length, 1);
  assert.deepEqual(form.saved[0].headerRefs, refs);
  assert.deepEqual(form.saved[0].envRefs, { HIDDEN: 'ENV_TOKEN' });
  assert.equal(form.saved[0].confirmed, true);
  assert.equal(form.saved[0].revision, 'r1');
  change(input(form, 'Credential name'), 'NEW_TOKEN');
  assert.equal(input(form, 'I authorize').props.checked, false);
  assert.equal(button(form, 'Save bindings').props.disabled, true);
});

test('Bearer mode emits a public prefix, and switching to keep never implies literal removal', async () => {
  const form = harness().form({ hasLiteralCredentials: true });
  change(nodes(form.render()).find(node => node.type === 'select'), 'bearer');
  change(input(form, 'Credential name'), 'API_TOKEN');
  change(input(form, 'Replace overlapping existing'), true);
  confirm(form);
  await submit(form);
  assert.deepEqual(form.saved[0].headerRefs, { Authorization: { name: 'API_TOKEN', prefix: 'Bearer ' } });
  assert.equal(form.saved[0].replaceExisting, true);
  change(nodes(form.render()).find(node => node.type === 'select'), 'keep');
  assert.match(text(form.render()), /Existing literal credentials are not removed/);
  assert.match(text(form.render()), /Keeping existing \/ no token bindings does not remove them/);
  await submit(form);
  assert.deepEqual(form.saved[1].headerRefs, {});
  assert.equal(form.saved[1].replaceExisting, false);
  assert.equal(form.saved[1].confirmed, false);
});

test('stdio mappings support add, edit, remove and fresh confirmation', async () => {
  const form = harness().form({ transport: 'stdio', destination: 'example-mcp', envRefs: { API_KEY: 'API_TOKEN' } });
  assert.equal(nodes(form.render()).some(node => node.type === 'select'), false);
  confirm(form);
  change(input(form, 'Environment variable'), 'AUTH_KEY');
  assert.equal(input(form, 'I authorize').props.checked, false);
  confirm(form);
  await submit(form);
  assert.deepEqual(form.saved[0].envRefs, { AUTH_KEY: 'API_TOKEN' });
  button(form, 'Add mapping').props.onClick();
  assert.equal(button(form, 'Save bindings').props.disabled, true);
  assert.equal(nodes(form.render()).filter(node => node.type === 'div' && node.props.className === 'lma-mapping lma-env').length, 2);
  const removes = nodes(form.render()).filter(node => node.type === 'button' && text(node) === 'Remove mapping');
  removes[1].props.onClick();
  assert.equal(nodes(form.render()).filter(node => node.type === 'div' && node.props.className === 'lma-mapping lma-env').length, 1);
});

test('duplicate targets, invalid names, unavailable provider, read-only config and max32 are guarded', async () => {
  const app = harness();
  const invalid = app.form({ headerRefs: { 'X-Key': { name: 'DSH_SECRET' } } });
  assert.equal(button(invalid, 'Save bindings').props.disabled, true);
  assert.match(text(invalid.render()), /Invalid credential name/);
  const duplicate = app.form({ headerRefs: { 'X-Key': { name: 'API_TOKEN' }, 'x-key': { name: 'OTHER_TOKEN' } } });
  confirm(duplicate); await submit(duplicate);
  assert.equal(duplicate.saved.length, 0);
  assert.match(text(duplicate.render()), /duplicate targets/);
  const full = app.form({ transport: 'stdio', envRefs: Object.fromEntries(Array.from({ length: 32 }, (_, i) => [`KEY_${i}`, 'API_TOKEN'])) });
  assert.equal(button(full, 'Add mapping').props.disabled, true);
  const unavailable = app.form({ headerRefs: { Authorization: { name: 'API_TOKEN', prefix: 'Bearer ' } } }, { providerAvailable: false });
  confirm(unavailable);
  assert.equal(button(unavailable, 'Save bindings').props.disabled, true);
  const readOnly = app.form({}, { writable: false });
  assert.equal(nodes(readOnly.render()).find(node => node.type === 'fieldset').props.disabled, true);
});

test('changed destinations require a fresh grant; dynamic rows cannot submit', async () => {
  const app = harness();
  const changed = app.form({ bindingTargetChanged: true, headerRefs: { Authorization: { name: 'API_TOKEN', prefix: 'Bearer ' } } });
  assert.match(text(changed.render()), /endpoint or executable changed/);
  assert.equal(input(changed, 'I authorize').props.checked, false);
  assert.equal(button(changed, 'Save bindings').props.disabled, true);
  confirm(changed); await submit(changed);
  assert.equal(changed.saved[0].confirmed, true);
  const dynamic = app.form({ editable: false });
  assert.match(text(dynamic.render()), /generated dynamically/);
  await submit(dynamic);
  assert.equal(dynamic.saved.length, 0);
  assert.equal(nodes(dynamic.render()).find(node => node.type === 'fieldset').props.disabled, true);
});

test('disabled drafts do not require credential confirmation or an available provider', async () => {
  const form = harness().form({ enabled: false, headerRefs: { Authorization: { name: 'UNCONFIGURED_TOKEN', prefix: 'Bearer ' } } }, { providerAvailable: false });
  assert.equal(button(form, 'Save bindings').props.disabled, false);
  assert.equal(input(form, 'I authorize'), undefined);
  await submit(form);
  assert.equal(form.saved[0].confirmed, false);
  assert.equal(form.saved[0].enabled, false);
});

test('malformed server projection becomes a visible error instead of crashing a form', async () => {
  const app = harness(async url => url.endsWith('/list') ? response({}, 404) : response(snapshot([server({ headerRefs: { Authorization: null } })])));
  const page = app.runner(app.Page); page.mount(); await tick();
  assert.match(text(page.render()), /request or server response is invalid/);
  assert.equal(nodes(page.render()).some(node => typeof node.type === 'function'), false);
  page.unmount();
});

test('Vault 404/503 is optional, with manual input and native name suggestions', async () => {
  for (const status of [404, 503]) {
    const requests = [];
    const app = harness(async url => { requests.push(url); return url.endsWith('/list') ? response({}, status) : response(snapshot([server()])); });
    const page = app.runner(app.Page); page.mount(); await tick();
    assert.match(text(page.render()), /Enter credential names manually/);
    const nested = nodes(page.render()).find(node => typeof node.type === 'function');
    assert.deepEqual(clone(nested.props.suggestions), []);
    const form = app.runner(nested.type, nested.props); form.render();
    assert.equal(nodes(form.tree).some(node => node.type === 'option' && node.props.value === 'API_TOKEN'), true);
    assert.deepEqual(requests.sort(), ['/api/lazy-discovery/auth', '/api/token-vault/list']);
    page.unmount();
  }
});

test('save is locked against duplicates and is never reported saved when re-fetch fails', async () => {
  let finishPost, failRefresh = false;
  const requests = [];
  const app = harness(async (url, options) => {
    requests.push({ url, options });
    if (url.endsWith('/list')) return response({ entries: [] });
    if (options.method === 'POST') return new Promise(resolve => { finishPost = resolve; });
    if (failRefresh) throw new Error('private backend detail must not be displayed');
    return response(snapshot([server({ enabled: false })]));
  });
  const page = app.runner(app.Page); page.mount(); await tick();
  const props = nodes(page.render()).find(node => typeof node.type === 'function').props;
  const body = { serverName: 'example', revision: 'r1', enabled: false, headerRefs: {}, envRefs: {}, confirmed: false };
  const first = props.save(body), second = props.save(body);
  assert.equal(requests.filter(row => row.options.method === 'POST').length, 1);
  assert.equal(requests.find(row => row.options.method === 'POST').url, '/api/lazy-discovery/auth/save');
  assert.deepEqual(JSON.parse(requests.find(row => row.options.method === 'POST').options.body), body);
  failRefresh = true;
  finishPost(response({ saved: true, serverName: 'example' }));
  await Promise.all([first, second]);
  assert.doesNotMatch(text(page.render()), /Saved and configuration reloaded/);
  assert.equal(nodes(page.render()).filter(node => typeof node.type === 'function').some(node => node.props.operation?.status === 'saved'), false);
  assert.match(text(cardTree(app, page)), /Nothing is confirmed saved/);
  assert.doesNotMatch(text(cardTree(app, page)), /private backend detail/);
  assert.equal(nodes(page.render()).some(node => node.props.role === 'alert'), false);
  failRefresh = false;
  await cards(page)[0].props.verify();
  assert.equal(cards(page)[0].props.operation.status, 'saved');
  assert.equal(requests.filter(row => row.options.method === 'POST').length, 1);
  page.unmount();
});

test('success requires a matching saved result and successful refresh, and edits clear it', async () => {
  const requests = [];
  let revision = 'r1';
  const app = harness(async (url, options) => {
    requests.push({ url, method: options.method });
    if (url.endsWith('/list')) return response({ entries: [{ name: 'OPTIONAL_TOKEN', configured: true, writable: true }] });
    if (options.method === 'POST') { revision = 'r2'; return response({ saved: true, serverName: 'example' }); }
    return response(snapshot([server({ revision })]));
  });
  const page = app.runner(app.Page); page.mount(); await tick();
  let nested = nodes(page.render()).find(node => typeof node.type === 'function');
  await nested.props.save(payload());
  nested = nodes(page.render()).find(node => typeof node.type === 'function');
  assert.equal(nested.props.operation?.status === 'saved', true);
  const form = app.runner(nested.type, nested.props);
  const status = nodes(form.render()).find(node => node.props.role === 'status');
  assert.match(text(status), /Saved and configuration reloaded/);
  assert.match(text(status), /example/);
  assert.equal(status.props['aria-live'], 'polite');
  assert.equal(status.props['aria-atomic'], true);
  assert.equal(nested.props.server.revision, 'r2');
  nested.props.dirty();
  nested = nodes(page.render()).find(node => typeof node.type === 'function');
  assert.equal(nested.props.operation?.status === 'saved', false);
  assert.equal(nodes(app.runner(nested.type, nested.props).render()).some(node => node.props.className === 'lma-success'), false);
  assert.deepEqual(requests, [
    { method: 'GET', url: '/api/lazy-discovery/auth' },
    { method: 'GET', url: '/api/token-vault/list' },
    { method: 'POST', url: '/api/lazy-discovery/auth/save' },
    { method: 'GET', url: '/api/lazy-discovery/auth' },
  ]);
  page.unmount();
});

test('save confirmation stays beside the matching server button across form remounts and unrelated edits', async () => {
  const app = harness(async (url, options) => {
    if (url.endsWith('/list')) return response({ entries: [] });
    if (options.method === 'POST') return response({ saved: true, serverName: 'example' });
    return response(snapshot([server(), server({ serverName: 'other' })]));
  });
  const page = app.runner(app.Page); page.mount(); await tick();
  const cards = () => nodes(page.render()).filter(node => typeof node.type === 'function');
  await cards()[0].props.save(payload());
  assert.deepEqual(cards().map(card => card.props.operation?.status === 'saved'), [true, false]);
  for (let remount = 0; remount < 2; remount++) {
    const card = cards()[0], form = app.runner(card.type, card.props);
    const actions = nodes(form.render()).find(node => node.props.className === 'lma-actions');
    assert.ok(nodes(actions).some(node => node.type === 'button' && node.props.type === 'submit'));
    const status = nodes(actions).find(node => node.props.role === 'status');
    assert.match(text(status), /✓.*Saved and configuration reloaded.*example/);
    assert.doesNotMatch(text(status), /API_TOKEN|Bearer/);
    form.unmount();
  }
  cards()[1].props.dirty();
  assert.equal(cards()[0].props.operation?.status === 'saved', true);
  app.language('ru');
  const card = cards()[0];
  assert.match(text(app.runner(card.type, card.props).render()), /Сохранено, конфигурация перечитана/);
  cards()[0].props.dirty();
  assert.deepEqual(cards().map(item => item.props.operation?.status === 'saved'), [false, false]);
  page.unmount();
});

test('stale Context7 save shows a local error, preserves draft, and read-only verification refreshes its revision', async () => {
  let current = server({ serverName: 'context7', credentials: [{ name: 'CONTEXT7_API_KEY', configured: true }] });
  let stale = true;
  const requests = [];
  const app = harness(async (url, options) => {
    requests.push({ url, method: options.method, body: options.body && JSON.parse(options.body) });
    if (url.endsWith('/list')) return Response.json({ entries: [] });
    if (options.method === 'POST') {
      if (stale) { current = { ...current, revision: 'r2' }; return Response.json({ error: { code: 'config-changed', detail: 'private detail' } }, { status: 400 }); }
      const body = JSON.parse(options.body);
      current = { ...current, enabled: body.enabled, headerRefs: body.headerRefs, envRefs: body.envRefs, revision: 'r3' };
      return Response.json({ saved: true, serverName: current.serverName });
    }
    return Response.json(snapshot([current]));
  });
  const page = app.runner(app.Page); page.mount(); await tick();
  const originalKey = cards(page)[0].props.key;
  const form = bearerForm(app, page, 'context7', 'CONTEXT7_API_KEY');
  await submit(form);
  let card = cards(page)[0];
  assert.equal(card.props.operation.status, 'error');
  assert.equal(card.props.operation.error, 'config-changed');
  assert.equal(card.props.key, originalKey);
  assert.equal(requests.filter(row => row.method === 'GET' && row.url.endsWith('/auth')).length, 1);
  form.props = card.props;
  assert.match(text(form.render()), /Configuration changed elsewhere/);
  assert.doesNotMatch(text(form.render()), /private detail/);
  assert.equal(input(form, 'Credential name').props.value, 'CONTEXT7_API_KEY');
  assert.equal(input(form, 'I authorize').props.checked, true);
  assert.equal(nodes(page.render()).some(node => node.props.role === 'alert'), false);
  assert.equal(button(form, 'Verify / refresh (read-only)').props.type, 'button');
  await button(form, 'Verify / refresh (read-only)').props.onClick();
  card = cards(page)[0];
  assert.equal(card.props.operation.error, 'config-not-applied');
  assert.notEqual(card.props.key, originalKey);
  assert.equal(card.props.server.revision, 'r2');
  assert.equal(requests.filter(row => row.method === 'POST').length, 1);
  const refreshed = app.runner(card.type, card.props); refreshed.render();
  assert.equal(input(refreshed, 'Credential name').props.value, 'CONTEXT7_API_KEY');
  assert.equal(input(refreshed, 'I authorize').props.checked, false);
  stale = false;
  confirm(refreshed); await submit(refreshed);
  assert.equal(cards(page)[0].props.operation.status, 'saved');
  assert.equal(requests.filter(row => row.method === 'POST').length, 2);
  assert.equal(requests.filter(row => row.method === 'POST')[1].body.revision, 'r2');
  page.unmount();
});

test('pending and verification status stay in the submitting card; unchanged fetched bindings never show saved', async () => {
  let finishPost, finishGet, afterPost = false;
  const app = harness(async (url, options) => {
    if (url.endsWith('/list')) return Response.json({ entries: [] });
    if (options.method === 'POST') return new Promise(resolve => { finishPost = value => { afterPost = true; resolve(value); }; });
    if (afterPost) return new Promise(resolve => { finishGet = resolve; });
    return Response.json(snapshot([server({ serverName: 'context7' }), server({ serverName: 'other' })]));
  });
  const page = app.runner(app.Page); page.mount(); await tick();
  const originalKey = cards(page)[0].props.key;
  const form = bearerForm(app, page, 'context7', 'CONTEXT7_API_KEY');
  const pending = submit(form);
  assert.equal(cards(page)[0].props.operation.status, 'saving');
  assert.match(text(cardTree(app, page, 'context7')), /Saving…/);
  assert.doesNotMatch(text(cardTree(app, page, 'other')), /Saving…/);
  finishPost(Response.json({ saved: true, serverName: 'context7' })); await tick();
  assert.equal(cards(page)[0].props.operation.status, 'verifying');
  assert.match(text(cardTree(app, page, 'context7')), /Checking saved bindings/);
  finishGet(Response.json(snapshot([server({ serverName: 'context7' }), server({ serverName: 'other' })])));
  await pending;
  assert.equal(cards(page)[0].props.operation.error, 'config-not-applied');
  assert.equal(cards(page)[0].props.key, originalKey);
  assert.doesNotMatch(text(cardTree(app, page, 'context7')), /Saved and configuration reloaded/);
  form.props = cards(page)[0].props;
  assert.equal(input(form, 'Credential name').props.value, 'CONTEXT7_API_KEY');
  assert.match(text(form.render()), /Save is not confirmed/);
  page.unmount();
});

test('verified success requires the requested server, destination, enabled flag and complete header/env mappings', async () => {
  const desired = { Authorization: { name: 'CONTEXT7_API_KEY', prefix: 'Bearer ' } };
  const cases = [
    {},
    { headerRefs: { Authorization: { name: 'OTHER_TOKEN', prefix: 'Bearer ' } } },
    { headerRefs: { Authorization: { name: 'CONTEXT7_API_KEY', prefix: 'Other ' } } },
    { headerRefs: desired, envRefs: { EXTRA: 'API_TOKEN' } },
    { headerRefs: desired, enabled: false },
    { headerRefs: desired, destination: 'https://different.test' },
    { headerRefs: desired, transport: 'stdio' },
    { headerRefs: desired, serverName: 'different' },
    { headerRefs: desired, bindingTargetChanged: true },
    { headerRefs: { ...desired, 'X-Extra': { name: 'API_TOKEN' } } },
  ];
  for (const changed of cases) {
    let posted = false;
    const app = harness(async (url, options) => {
      if (url.endsWith('/list')) return Response.json({ entries: [] });
      if (options.method === 'POST') { posted = true; return Response.json({ saved: true, serverName: 'example' }); }
      return Response.json(snapshot([server(posted ? changed : {})]));
    });
    const page = app.runner(app.Page); page.mount(); await tick();
    await cards(page)[0].props.save(payload({ headerRefs: desired, confirmed: true }));
    assert.equal(cards(page)[0].props.operation.status, 'error');
    assert.equal(cards(page)[0].props.operation.error, 'config-not-applied');
    assert.doesNotMatch(text(cardTree(app, page)), /Saved and configuration reloaded/);
    page.unmount();
  }
});

test('Firecrawl then Context7 save with current revisions and independently verified card successes', async () => {
  let revision = 1;
  let current = [server({ serverName: 'firecrawl' }), server({ serverName: 'context7' })];
  const posts = [];
  const app = harness(async (url, options) => {
    if (url.endsWith('/list')) return Response.json({ entries: [] });
    if (options.method === 'POST') {
      const body = JSON.parse(options.body); posts.push(body);
      assert.equal(body.revision, current.find(row => row.serverName === body.serverName).revision);
      revision += 1;
      current = current.map(row => ({ ...row, ...(row.serverName === body.serverName ? { enabled: body.enabled, headerRefs: body.headerRefs, envRefs: body.envRefs } : {}), revision: `r${revision}` }));
      return Response.json({ saved: true, serverName: body.serverName });
    }
    return Response.json(snapshot(current));
  });
  const page = app.runner(app.Page); page.mount(); await tick();
  await submit(bearerForm(app, page, 'firecrawl', 'FIRECRAWL_API_KEY'));
  assert.equal(cards(page)[0].props.operation.status, 'saved');
  assert.equal(cards(page)[1].props.server.revision, 'r2');
  await submit(bearerForm(app, page, 'context7', 'CONTEXT7_API_KEY'));
  assert.deepEqual(posts.map(body => body.serverName), ['firecrawl', 'context7']);
  assert.equal(posts[1].revision, 'r2');
  assert.deepEqual(cards(page).map(card => card.props.operation.status), ['saved', 'saved']);
  assert.match(text(cardTree(app, page, 'context7')), /Saved and configuration reloaded/);
  page.unmount();
});

test('failed-card Verify remains read-only and available in a non-writable configuration', () => {
  const expected = { ...payload({ headerRefs: { Authorization: { name: 'API_TOKEN', prefix: 'Bearer ' } }, confirmed: true }), transport: 'streamable-http', destination: 'https://example.test' };
  const form = harness().form({}, { writable: false, operation: { status: 'error', error: 'config-changed', expected }, verify: () => {} });
  assert.equal(button(form, 'Save bindings').props.disabled, true);
  assert.equal(button(form, 'Verify / refresh (read-only)').props.disabled, false);
  assert.equal(nodes(form.render()).find(node => node.type === 'fieldset').props.children.some(node => node.props?.className === 'lma-actions'), false);
});

test('all backend error codes have visible localized messages, without raw response text', async () => {
  for (const code of ['request-too-large', 'invalid-request', 'invalid-bindings', 'invalid-name', 'config-read-only', 'config-changed', 'dynamic-config', 'confirmation-required', 'literal-conflict', 'credential-provider-unavailable', 'credential-missing', 'operation-failed', 'transport', 'unexpected-sensitive-text']) {
    const app = harness(async url => url.endsWith('/list') ? response({}, 404) : response({ error: { code, detail: 'must-not-be-rendered' } }, 409));
    const page = app.runner(app.Page); page.mount(); await tick();
    const alert = nodes(page.render()).find(node => node.props.role === 'alert');
    assert.ok(text(alert));
    assert.doesNotMatch(text(alert), /must-not-be-rendered|unexpected-sensitive-text/);
    app.language('ru'); assert.ok(text(nodes(page.render()).find(node => node.props.role === 'alert')));
    page.unmount();
  }
});

test('native text/plain HTTP failures have safe diagnostics on GET and POST, never transport or saved', async () => {
  for (const method of ['GET', 'POST']) {
    for (const [status, expected] of [[400, /unexpected HTTP or non-JSON response/], [401, /access denied \(HTTP 401\/403\)/], [403, /access denied \(HTTP 401\/403\)/], [404, /route unavailable \(HTTP 404\)/], [200, /unexpected HTTP or non-JSON response/]]) {
      const requests = [];
      let fail = method === 'GET';
      const app = harness(async (url, options) => {
        requests.push({ url, method: options.method });
        if (url === '/api/token-vault/list') return new Response('', { status: 404 });
        if (fail) return new Response('invalid response https://private:secret@example.test/?token=hidden', { status, headers: { 'Content-Type': 'text/plain' } });
        return Response.json(snapshot([server()]));
      });
      const page = app.runner(app.Page); page.mount(); await tick();
      if (method === 'POST') {
        const nested = nodes(page.render()).find(node => typeof node.type === 'function');
        fail = true;
        await nested.props.save(payload());
        assert.deepEqual(requests.at(-1), { method: 'POST', url: '/api/lazy-discovery/auth/save' });
        assert.equal(requests.filter(row => row.method === 'POST').length, 1);
        assert.equal(requests.filter(row => row.url === '/api/lazy-discovery/auth').length, 1);
      }
      const alert = nodes(method === 'POST' ? cardTree(app, page) : page.render()).find(node => node.props.role === 'alert');
      assert.match(text(alert), expected);
      assert.doesNotMatch(text(alert), /Cannot reach|private|secret|example\.test|hidden/);
      assert.doesNotMatch(text(page.render()), /Saved and configuration reloaded/);
      app.language('ru');
      assert.match(text(nodes(method === 'POST' ? cardTree(app, page) : page.render()).find(node => node.props.role === 'alert')), /Сохранение не подтверждено/);
      page.unmount();
    }
  }
});

test('known JSON backend codes survive status mapping and unknown JSON failures stay sanitized', async () => {
  for (const [status, code, expected] of [[403, 'config-read-only', /MCP configuration is read-only/], [500, 'private-secret-code', /unexpected HTTP or non-JSON response/]]) {
    const app = harness(async url => url.endsWith('/list') ? new Response('', { status: 404 }) : Response.json({ error: { code, detail: 'private-server-detail' } }, { status }));
    const page = app.runner(app.Page); page.mount(); await tick();
    const alert = nodes(page.render()).find(node => node.props.role === 'alert');
    assert.match(text(alert), expected);
    assert.doesNotMatch(text(alert), /private/);
    page.unmount();
  }
});

test('request timeout is distinct from HTTP responses and network failures, without retrying', async () => {
  const timers = new Map();
  let id = 0, calls = 0;
  const app = harness(async (url, { signal }) => {
    calls += 1;
    if (url.endsWith('/list')) return new Response('', { status: 404 });
    return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('private timeout detail', 'AbortError')), { once: true }));
  }, { setTimeout: callback => { timers.set(++id, callback); return id; }, clearTimeout: key => timers.delete(key) });
  const page = app.runner(app.Page); page.mount(); await tick();
  assert.equal(timers.size, 1);
  [...timers.values()][0](); await tick();
  const alert = nodes(page.render()).find(node => node.props.role === 'alert');
  assert.match(text(alert), /request timed out/);
  assert.doesNotMatch(text(alert), /Cannot reach|private timeout detail/);
  assert.equal(calls, 2);
  assert.equal(timers.size, 0);
  page.unmount();
});

test('unmount aborts fetches and Strict Mode effect remount starts a fresh request', async () => {
  const signals = [];
  const app = harness((url, { signal }) => {
    signals.push(signal);
    return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
  });
  const page = app.runner(app.Page); page.mount();
  assert.equal(signals.length, 2);
  page.unmount();
  assert.ok(signals.every(signal => signal.aborted));
  page.remountEffects();
  assert.equal(signals.length, 4);
  await tick();
  assert.doesNotMatch(text(page.render()), /Nothing is confirmed saved/);
  page.unmount(); await tick();
  assert.ok(signals.every(signal => signal.aborted));
});
