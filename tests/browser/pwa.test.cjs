const {test, before, after} = require('node:test');
const assert = require('node:assert/strict');
const {createServer} = require('node:http');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const {chromium} = require('playwright');
const root = join(__dirname, '../..');
const html = readFileSync(join(root, 'index.html'), 'utf8');
const worker = readFileSync(join(root, 'service-worker.js'), 'utf8');
// The actual v5.6.8 lifecycle, used before sibling caches are seeded.
const legacyWorker = `const CACHE_NAME="rabic-gongsu-pro-v5-6-8";
const APP_FILES=["./","./index.html","./manifest.webmanifest","./version.json","./favicon.ico","./favicon-32.png","./icon-180.png","./icon-192.png","./icon-512.png","./icon-maskable-512.png"];
self.addEventListener("install",e=>{e.waitUntil(caches.open(CACHE_NAME).then(c=>c.addAll(APP_FILES)));self.skipWaiting()});
self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k)))));self.clients.claim()});
self.addEventListener("fetch",e=>{if(e.request.method!=="GET")return;e.respondWith(fetch(e.request).then(r=>{const copy=r.clone();caches.open(CACHE_NAME).then(c=>c.put(e.request,copy));return r}).catch(()=>caches.match(e.request).then(r=>r||caches.match("./index.html"))))});`;
let browser, server, origin;
let release = '5.6.9';
let legacy = false;
let failAsset = false;
let latest = '5.6.9';

before(async () => {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.PWA_CHROMIUM_PATH ? {executablePath: process.env.PWA_CHROMIUM_PATH} : {}),
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  server = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    res.setHeader('Cache-Control', 'no-store');
    if (url.pathname === '/setup') return res.end('<h1>Test setup</h1>');
    for (const [path, name] of [['spwn-note', 'spawn-note-v1.7.11'], ['other-app', 'other-app-v3']]) {
      if (url.pathname === '/' + path + '/sw.js') {
        res.setHeader('Content-Type', 'application/javascript');
        return res.end(`const CACHE=${JSON.stringify(name)};
          self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(['./','./index.html'])).then(()=>self.skipWaiting())));
          self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
          self.addEventListener('fetch',e=>e.respondWith(fetch(e.request).catch(()=>caches.open(CACHE).then(c=>c.match(e.request)))));`);
      }
      if (url.pathname === '/' + path + '/' || url.pathname === '/' + path + '/index.html') {
        res.setHeader('Content-Type', 'text/html');
        return res.end('<h1>' + path + ' offline sentinel</h1>');
      }
    }
    if (!url.pathname.startsWith('/daily-pay-app/')) {res.statusCode = 404; return res.end();}
    const file = url.pathname.slice('/daily-pay-app/'.length) || 'index.html';
    if (failAsset && file === 'icon-512.png') {res.statusCode = 503; return res.end('unavailable');}
    if (file === 'service-worker.js') {
      res.setHeader('Content-Type', 'application/javascript');
      return res.end(legacy ? legacyWorker : worker.replaceAll('5.6.9', release));
    }
    if (file === 'sw.js') {
      res.setHeader('Content-Type', 'application/javascript');
      return res.end(readFileSync(join(root, file)));
    }
    if (file === 'version.json') {
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({version: latest, message: 'Regression release'}));
    }
    if (file === 'index.html') {
      res.setHeader('Content-Type', 'text/html');
      return res.end(html.replaceAll('5.6.9', release));
    }
    if (!['manifest.webmanifest', 'favicon.ico', 'favicon-32.png', 'icon-180.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png'].includes(file)) {
      res.statusCode = 404; return res.end();
    }
    res.setHeader('Content-Type', file.endsWith('.png') ? 'image/png' : file.endsWith('.ico') ? 'image/x-icon' : 'application/manifest+json');
    res.end(readFileSync(join(root, file)));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = 'http://127.0.0.1:' + server.address().port;
});

after(async () => {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
});

async function register(page, path) {
  await page.evaluate(async path => {
    const reg = await navigator.serviceWorker.register(path, {updateViaCache: 'none'});
    const worker = reg.installing || reg.waiting || reg.active;
    if (worker.state !== 'activated') await new Promise((resolve, reject) => {
      worker.addEventListener('statechange', () => {
        if (worker.state === 'activated') resolve();
        if (worker.state === 'redundant') reject(new Error('worker install failed'));
      });
    });
  }, path);
}

async function seedUserData(page) {
  return page.evaluate(async () => {
    const ledger = JSON.stringify({version: 5,
      companies: [{id: 'default', name: '회귀검사 업체', rate: 200000, tax: 3.3, fixed: 0, color: '#2d6fbb'}],
      entries: {'2026-10-28': {companyId: 'default', units: 1.5, rate: 200000, type: '공사', memo: '보존할 공수', expenses: [{id: 'expense', type: 'fuel', amount: 50000, memo: '영수증', receiptIds: ['receipt-test']}]}},
      payments: {'2026-10|default': {amount: 100000, memo: '보존할 정산'}}, settings: {theme: 'navy', custom: '보존할 설정'}});
    localStorage.setItem('work-ledger-pro-v1', ledger);
    localStorage.setItem('user-setting-sentinel', 'settings survive');
    await new Promise((resolve, reject) => {
      const req = indexedDB.open('rabic-receipts-v1', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('receipts', {keyPath: 'id'});
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('receipts', 'readwrite');
        tx.objectStore('receipts').put({id: 'receipt-test', blob: new Blob(['receipt survives'], {type: 'text/plain'})});
        tx.oncomplete = () => {db.close(); resolve();};
        tx.onerror = () => reject(tx.error);
      };
    });
    return ledger;
  });
}

async function assertUserData(page, ledger) {
  const result = await page.evaluate(async () => {
    const receipt = await new Promise((resolve, reject) => {
      const req = indexedDB.open('rabic-receipts-v1', 1);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const get = db.transaction('receipts').objectStore('receipts').get('receipt-test');
        get.onsuccess = () => {db.close(); resolve(get.result);};
      };
    });
    return {ledger: localStorage.getItem('work-ledger-pro-v1'), setting: localStorage.getItem('user-setting-sentinel'), receipt: await receipt.blob.text()};
  });
  assert.deepEqual(result, {ledger, setting: 'settings survive', receipt: 'receipt survives'});
}

async function waitForRelease(page, version) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const ready = await page.evaluate(async version => {
      const reg = await navigator.serviceWorker.getRegistration('./');
      const key = 'rabic-gongsu-pro:' + encodeURIComponent(new URL('./', location.href).href) + ':v' + version;
      const keys = await caches.keys();
      return reg?.active?.state === 'activated' && !reg.installing && keys.includes(key) && !keys.includes('rabic-gongsu-pro-v5-6-8');
    }, version);
    if (ready) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.fail('release did not activate: ' + version);
}

test('real v5.6.8 migration preserves sibling registrations/caches and user data; all apps work offline', {timeout: 60000}, async () => {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin + '/setup');
    legacy = true; release = '5.6.8'; latest = '5.6.8';
    await register(page, '/daily-pay-app/service-worker.js');
    await register(page, '/spwn-note/sw.js');
    await register(page, '/other-app/sw.js');
    const ledger = await seedUserData(page);
    const siblingScopes = await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).filter(r => !r.scope.endsWith('/daily-pay-app/')).map(r => r.scope).sort());
    legacy = false; release = latest = '5.6.9';
    await page.goto(origin + '/daily-pay-app/');
    await waitForRelease(page, release);
    assert.equal(await page.locator('.brand em').textContent(), 'v5.6.9');
    await assertUserData(page, ledger);
    const preserved = await page.evaluate(async () => ({keys: await caches.keys(), scopes: (await navigator.serviceWorker.getRegistrations()).filter(r => !r.scope.endsWith('/daily-pay-app/')).map(r => r.scope).sort()}));
    assert.ok(preserved.keys.includes('spawn-note-v1.7.11'));
    assert.ok(preserved.keys.includes('other-app-v3'));
    assert.deepEqual(preserved.scopes, siblingScopes);
    await context.setOffline(true);
    await page.goto(origin + '/daily-pay-app/?v=5.6.9&t=98765');
    assert.equal(await page.locator('.brand em').textContent(), 'v5.6.9');
    await assertUserData(page, ledger);
    const sibling = await context.newPage();
    for (const name of ['spwn-note', 'other-app']) {
      await sibling.goto(origin + '/' + name + '/');
      assert.equal(await sibling.locator('h1').textContent(), name + ' offline sentinel');
    }
    assert.deepEqual(errors, []);
    assert.ok(!(await page.locator('body').innerText()).includes('앱 실행 오류:'));
  } finally {legacy = false; release = latest = '5.6.9'; await context.close();}
});

test('update button installs the next release before reload; offline and failed updates preserve working cache', {timeout: 60000}, async () => {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto(origin + '/setup');
    await register(page, '/spwn-note/sw.js');
    const ledger = await seedUserData(page);
    // Announce a future release while serving the installed release.
    latest = '5.6.10'; release = '5.6.9';
    await page.goto(origin + '/daily-pay-app/');
    await waitForRelease(page, release);
    await page.locator('#updateBanner.show').waitFor();
    const beforeKeys = await page.evaluate(() => caches.keys());
    await context.setOffline(true);
    await page.locator('#updateNow').click();
    await page.waitForFunction(() => document.querySelector('#updateMessage').textContent.includes('기존 기록'));
    assert.deepEqual(await page.evaluate(() => caches.keys()), beforeKeys);
    await assertUserData(page, ledger);
    await context.setOffline(false);
    release = '5.6.10'; failAsset = true;
    await page.locator('#updateNow').click();
    await page.waitForFunction(() => !document.querySelector('#updateNow').disabled);
    assert.equal(await page.locator('.brand em').textContent(), 'v5.6.9');
    assert.ok((await page.evaluate(() => caches.keys())).includes(beforeKeys.find(k => k.endsWith(':v5.6.9'))));
    await assertUserData(page, ledger);
    await context.setOffline(true);
    await page.reload();
    assert.equal(await page.locator('.brand em').textContent(), 'v5.6.9');
    await assertUserData(page, ledger);
    await context.setOffline(false);
    await page.locator('#updateBanner.show').waitFor();
    failAsset = false;
    await page.locator('#updateNow').click();
    await page.waitForURL(/v=5.6.10/);
    await waitForRelease(page, release);
    assert.equal(await page.locator('.brand em').textContent(), 'v5.6.10');
    const keys = await page.evaluate(() => caches.keys());
    assert.ok(!keys.some(k => k.endsWith(':v5.6.9')));
    assert.ok(keys.includes('spawn-note-v1.7.11'));
    await assertUserData(page, ledger);
    await context.setOffline(true);
    await page.reload();
    assert.equal(await page.locator('.brand em').textContent(), 'v5.6.10');
    await assertUserData(page, ledger);
  } finally {failAsset = false; release = latest = '5.6.9'; await context.close();}
});

test('legacy sw.js registration uses the same isolated offline cache', {timeout: 30000}, async () => {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto(origin + '/setup');
    await register(page, '/spwn-note/sw.js');
    await register(page, '/daily-pay-app/sw.js');
    assert.ok((await page.evaluate(() => caches.keys())).includes('spawn-note-v1.7.11'));
    await context.setOffline(true);
    await page.goto(origin + '/daily-pay-app/?v=5.6.9');
    assert.equal(await page.locator('.brand em').textContent(), 'v5.6.9');
  } finally {await context.close();}
});
