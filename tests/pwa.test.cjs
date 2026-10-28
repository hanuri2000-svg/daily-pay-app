const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const root = join(__dirname, '..');
const source = readFileSync(join(root, 'service-worker.js'), 'utf8');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const scope = 'https://example.test/daily-pay-app/';
const prefix = 'rabic-gongsu-pro:' + encodeURIComponent(scope) + ':v';
const current = prefix + '5.6.9';

function cacheStorage() {
  const data = new Map();
  const deleted = [];
  const storage = {
    data, deleted,
    async keys() { return [...data.keys()]; },
    async delete(key) { deleted.push(key); return data.delete(key); },
    async open(key) {
      if (!data.has(key)) data.set(key, new Map());
      const entries = data.get(key);
      const url = r => typeof r === 'string' ? r : r.url;
      return {
        async keys() { return [...entries.keys()].map(u => new Request(u)); },
        async match(r) { return entries.get(url(r))?.clone(); },
        async put(r, response) { entries.set(url(r), response.clone()); },
        async addAll(requests) {
          if (storage.failInstall) throw new Error('precache failed');
          storage.requests = requests;
          for (const request of requests) entries.set(request.url, new Response('shell:' + request.url));
        }
      };
    }
  };
  return storage;
}
function worker(caches, code = source, fetchImpl = async () => { throw new Error('offline'); }) {
  const listeners = {};
  const flags = {skip: 0, claim: 0};
  const context = {
    URL, Request, Response, Set, Promise, caches, fetch: fetchImpl,
    self: {
      registration: {scope},
      skipWaiting: async () => {flags.skip++;},
      clients: {claim: async () => {flags.claim++;}},
      addEventListener: (name, callback) => {listeners[name] = callback;}
    }
  };
  context.importScripts = path => {
    assert.equal(path, './service-worker.js');
    vm.runInContext(source, context);
  };
  vm.createContext(context);
  vm.runInContext(code, context);
  return {
    flags,
    async dispatch(name, request) {
      const pending = [];
      let response;
      listeners[name]({request, waitUntil: promise => pending.push(promise), respondWith: promise => {response = promise;}});
      const result = await response;
      await Promise.all(pending);
      return result;
    }
  };
}
async function seed(caches, name, path, value = name) {
  const cache = await caches.open(name);
  await cache.put(new URL(path, scope).href, new Response(value));
}

test('activation removes only owned cache generations; sibling apps and deployments survive', async () => {
  const caches = cacheStorage();
  const keep = ['spawn-note-v1.7.11', 'other-webapp-v2', 'rabic-gongsu-pro-v1-backup',
    'rabic-gongsu-pro:' + encodeURIComponent('https://example.test/other/') + ':v5.6.8'];
  for (const name of keep) await seed(caches, name, '/spwn-note/index.html');
  await seed(caches, 'rabic-gongsu-pro-v5-6-8', './index.html');
  await seed(caches, 'labor-settlement-pro-v201', './index.html');
  await seed(caches, prefix + '5.6.8', './index.html');
  // An unscoped legacy cache containing another app must be preserved.
  await seed(caches, 'rabic-gongsu-pro-v4-0', '/other/index.html');
  await seed(caches, current, './index.html', 'new shell');
  const app = worker(caches);
  await app.dispatch('activate');
  assert.deepEqual((await caches.keys()).sort(), [...keep, 'rabic-gongsu-pro-v4-0', current].sort());
  assert.equal(app.flags.claim, 1);
  assert.equal(await (await (await caches.open('spawn-note-v1.7.11')).match('https://example.test/spwn-note/index.html')).text(), 'spawn-note-v1.7.11');
});

test('installation precaches fresh app files before skipWaiting', async () => {
  const caches = cacheStorage();
  const app = worker(caches);
  await app.dispatch('install');
  assert.equal(caches.requests.length, 10);
  assert.ok(caches.requests.every(r => r.cache === 'reload' && r.url.startsWith(scope)));
  assert.equal(app.flags.skip, 1);
});

test('failed installation preserves the previous offline release and other caches', async () => {
  const caches = cacheStorage();
  await seed(caches, 'rabic-gongsu-pro-v5-6-8', './index.html', 'old working shell');
  await seed(caches, 'spawn-note-v1.7.11', '/spwn-note/index.html');
  caches.failInstall = true;
  const app = worker(caches);
  await assert.rejects(app.dispatch('install'), /precache failed/);
  assert.equal(app.flags.skip, 0);
  assert.deepEqual(caches.deleted, []);
  assert.equal(await (await (await caches.open('rabic-gongsu-pro-v5-6-8')).match(scope + 'index.html')).text(), 'old working shell');
});

test('offline release URLs and navigation use only the active app cache', async () => {
  const caches = cacheStorage();
  await seed(caches, 'unrelated', './index.html', 'wrong app');
  await seed(caches, current, './index.html', 'correct app');
  await seed(caches, current, './', 'correct root');
  const app = worker(caches);
  for (const [path, expected] of [['index.html?v=5.6.9&t=123', 'correct app'], ['?v=5.6.9&t=123', 'correct root'], ['unknown-route', 'correct app']]) {
    const result = await app.dispatch('fetch', {url: new URL(path, scope).href, method: 'GET', mode: 'navigate'});
    assert.equal(await result.text(), expected);
  }
  const missing = await app.dispatch('fetch', new Request(scope + 'missing.png'));
  assert.equal(missing.type, 'error');
  const meaningfulQuery = await app.dispatch('fetch', new Request(scope + 'index.html?account=other'));
  assert.equal(meaningfulQuery.type, 'error');
});

test('worker ignores sibling paths, external URLs and non-GET requests', async () => {
  const caches = cacheStorage();
  const app = worker(caches, source, async () => {throw new Error('must not fetch');});
  for (const request of [new Request('https://example.test/spwn-note/'), new Request('https://cdn.test/asset.js'), new Request(scope, {method: 'POST'})]) {
    assert.equal(await app.dispatch('fetch', request), undefined);
  }
  assert.deepEqual(await caches.keys(), []);
});

test('online responses refresh the active cache, but error responses do not overwrite it', async () => {
  const caches = cacheStorage();
  await seed(caches, current, './index.html', 'offline shell');
  let status = 200;
  const app = worker(caches, source, async () => new Response('network', {status}));
  await app.dispatch('fetch', new Request(scope + 'index.html?v=5.6.9'));
  const cache = await caches.open(current);
  assert.equal(await (await cache.match(scope + 'index.html')).text(), 'network');
  status = 503;
  await app.dispatch('fetch', new Request(scope + 'index.html'));
  assert.equal(await (await cache.match(scope + 'index.html')).text(), 'network');
});

test('legacy sw.js delegates to the safe scoped lifecycle', async () => {
  const caches = cacheStorage();
  await seed(caches, 'spawn-note-v1.7.11', '/spwn-note/');
  await seed(caches, 'labor-settlement-pro-v201', './index.html');
  const app = worker(caches, readFileSync(join(root, 'sw.js'), 'utf8'));
  await app.dispatch('install');
  await app.dispatch('activate');
  assert.ok((await caches.keys()).includes('spawn-note-v1.7.11'));
  assert.ok(!(await caches.keys()).includes('labor-settlement-pro-v201'));
});

function updater({online = true, fail = false, initialState = 'activated', supported = true} = {}) {
  const nodes = new Map();
  const records = new Map([['work-ledger-pro-v1', '{"entries":{"saved":true},"payments":{"saved":true},"settings":{"saved":true}}']]);
  const before = [...records];
  let replaced;
  const calls = [];
  const active = new EventTarget();
  active.state = initialState;
  const reg = {active, update: async () => {calls.push('update'); if (fail) throw new Error('network');}};
  const navigator = {onLine: online};
  if (supported) navigator.serviceWorker = {
    register: async (url, options) => {calls.push({url, options}); return reg;},
    getRegistrations: () => {throw new Error('must not enumerate/unregister');}
  };
  const context = {
    URL, setTimeout, clearTimeout, navigator, console,
    el: selector => {
      if (!nodes.has(selector)) nodes.set(selector, {classList: {add() {}, remove() {}}});
      return nodes.get(selector);
    },
    localStorage: {getItem: key => records.get(key), setItem: (key, value) => records.set(key, value)},
    indexedDB: new Proxy({}, {get() {throw new Error('must preserve receipt database');}}),
    caches: new Proxy({}, {get() {throw new Error('page must not clear cache storage');}}),
    location: {href: scope + 'index.html?v=old', replace: value => {replaced = value;}},
    fetch: async () => ({ok: true, json: async () => ({version: '5.6.10'})})
  };
  vm.createContext(context);
  vm.runInContext(html.slice(html.indexOf('var APP_VERSION='), html.indexOf('\nfunction boot(){')), context);
  return {context, nodes, calls, records, before, active, get replaced() {return replaced;}};
}

test('update button updates only the exact app scope and preserves all user storage', async () => {
  const app = updater();
  await app.context.checkAppUpdate();
  await app.nodes.get('#updateNow').onclick();
  assert.equal(app.calls[0].url, scope + 'service-worker.js');
  assert.equal(app.calls[0].options.scope, scope);
  assert.equal(app.calls[0].options.updateViaCache, 'none');
  assert.equal(app.calls[1], 'update');
  assert.match(app.replaced, /^\.\/\?v=5.6.10&t=\d+$/);
  assert.deepEqual([...app.records], app.before);
});

test('update waits for activation before navigating', async () => {
  const app = updater({initialState: 'installing'});
  await app.context.checkAppUpdate();
  const pending = app.nodes.get('#updateNow').onclick();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.replaced, undefined);
  assert.equal(app.nodes.get('#updateNow').disabled, true);
  app.active.state = 'activated';
  app.active.dispatchEvent(new Event('statechange'));
  await pending;
  assert.ok(app.replaced);
});

for (const options of [{online: false}, {fail: true}, {initialState: 'redundant'}]) {
  test('failed/offline update keeps the current page, data and offline files: ' + JSON.stringify(options), async () => {
    const app = updater(options);
    await app.context.checkAppUpdate();
    await app.nodes.get('#updateNow').onclick();
    assert.equal(app.replaced, undefined);
    assert.equal(app.nodes.get('#updateNow').disabled, false);
    assert.match(app.nodes.get('#updateMessage').textContent, /기존 기록과 오프라인 파일은 유지/);
    assert.deepEqual([...app.records], app.before);
  });
}

test('release metadata and JavaScript syntax remain consistent', () => {
  assert.equal(JSON.parse(readFileSync(join(root, 'version.json'))).version, '5.6.9');
  assert.match(html, /var APP_VERSION="5.6.9"/);
  assert.match(source, /CACHE_PREFIX \+ "5.6.9"/);
  for (const match of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) new vm.Script(match[1]);
});
