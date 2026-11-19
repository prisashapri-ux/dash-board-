import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { chromium, webkit } from 'playwright';

const root = path.resolve('dist');
const contentTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png' };
const project = { id: 'demo', name: 'Пример проекта с длинным названием', emoji: '📁', stage: 'В работе', progress: 40, next: 'Следующий шаг', tasks: [{ id: 't1', title: 'Пример задачи', done: false, due: '2026-11-20' }], updated: '2026-11-18T10:00:00Z' };
const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname === '/projects.json') {
    res.writeHead(200, {'Content-Type':'application/json'});
    res.end(JSON.stringify({updated:'2026-11-18', projects:[project], removed:[]}));
    return;
  }
  try {
    const file = path.resolve(root, pathname === '/' ? 'index.html' : pathname.slice(1));
    if (!file.startsWith(root + path.sep)) { res.writeHead(404); res.end(); return; }
    const bytes = await fs.readFile(file);
    res.writeHead(200, {'Content-Type':contentTypes[path.extname(file)] || 'application/octet-stream'});
    res.end(bytes);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = 'http://127.0.0.1:' + server.address().port;
const cases = [
  ['ПК 1920×1080', 1920, 1080], ['окно ПК 1200×850', 1200, 850],
  ['iPad горизонтально', 1024, 768], ['iPad вертикально', 768, 1024],
  ['iPhone 12 вертикально', 390, 844], ['iPhone 12 горизонтально', 844, 390],
];

async function checkLayout(browser, engine, [name, width, height]) {
  const context = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block', hasTouch: !name.includes('ПК') });
  try {
    await context.route('**/*', route => route.request().url().startsWith(base + '/') ? route.continue() : route.abort());
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base);
    await page.waitForFunction(() => window.__pultBooted);
    const tabs = page.locator('#tabs button');
    assert.equal(await tabs.count(), 8, engine + ' ' + name + ': восемь разделов');
    const nav = await tabs.evaluateAll(items=>items.map(el=>({left:el.getBoundingClientRect().left,right:el.getBoundingClientRect().right,top:el.getBoundingClientRect().top,bottom:el.getBoundingClientRect().bottom,height:el.getBoundingClientRect().height,width:el.getBoundingClientRect().width})));
    for (const bounds of nav) {
      assert.ok(bounds.width >= 44 && bounds.height >= 44, engine + ' ' + name + ': размер кнопки');
      assert.ok(bounds.left >= -1 && bounds.right <= width + 1 && bounds.top >= -1 && bounds.bottom <= height + 1, engine + ' ' + name + ': все разделы доступны');
    }
    const keys = await tabs.evaluateAll(items=>items.map(el=>el.dataset.tab));
    const overflow = [];
    for (const key of keys) {
      await page.locator('#tabs button[data-tab="'+key+'"]').click();
      assert.equal(await page.locator('#tabs button[aria-current="page"]').getAttribute('data-tab'), key);
      if (key === 'more') {
        const sub = await page.locator('[data-act="more"]').evaluateAll(items=>items.map(el=>el.dataset.k));
        for (const k of sub) {
          await page.locator('[data-act="more"][data-k="'+k+'"]').click();
          const excess = await page.evaluate(()=>document.documentElement.scrollWidth - innerWidth);
          if (excess > 2) overflow.push(key + '/' + k + ' (' + excess + 'px)');
        }
      } else {
        const excess = await page.evaluate(()=>document.documentElement.scrollWidth - innerWidth);
        if (excess > 2) overflow.push(key + ' (' + excess + 'px)');
      }
    }
    assert.deepEqual(overflow, [], engine + ' ' + name + ': горизонтальное переполнение страницы');
    await page.locator('#tabs button[data-tab="notes"]').click();
    await page.locator('form[data-form="add-note"] textarea').fill('Тестовая заметка для проверки сохранения');
    await page.locator('form[data-form="add-note"] button[type="submit"], form[data-form="add-note"] button.primary').first().click();
    await page.getByText('Тестовая заметка для проверки сохранения', {exact:true}).waitFor();
    await page.waitForTimeout(600);
    await page.reload();
    await page.waitForFunction(() => window.__pultBooted);
    await page.locator('#tabs button[data-tab="notes"]').click();
    await page.getByText('Тестовая заметка для проверки сохранения', {exact:true}).waitFor();
    assert.deepEqual(errors, [], engine + ' ' + name + ': ошибки приложения');
    console.log('PASS', engine, name);
  } finally { await context.close(); }
}

try {
  for (const [engine, type] of [['Chromium', chromium], ['WebKit', webkit]]) {
    const browser = await type.launch();
    try {
      for (const sample of cases) await checkLayout(browser, engine, sample);
    } finally { await browser.close(); }
  }
} finally { server.close(); }
