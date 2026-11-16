// Запускается в GitHub Actions перед выкладкой: собирает RSS-ленты и кладёт dist/data/news.json.
// iPad берёт новости с сайта Пульта, поэтому ему не нужен доступ к самим новостным сайтам и CORS.
// Список лент: NEWS_FEEDS в src/logic.js. Ленты, которые не ответили, просто пропускаются.
import fs from 'node:fs';
import path from 'node:path';
import { NEWS_FEEDS, NEWS_MAX_AGE_H, NEWS_SKIP } from '../src/logic.js';
import { parseFeed, decodeFeed, splitGoogleTitle, buildNews, githubRepos, youtubeChannelId, translateItems, parseGtx } from './news-lib.mjs';

const root = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const out = path.join(root, 'dist', 'data');
const UA = 'Mozilla/5.0 (compatible; PultNews/1.0; RSS reader)';

const get = (url, headers = {}) => fetch(url, { headers: { 'User-Agent': UA, ...headers }, signal: AbortSignal.timeout(15000), redirect: 'follow' })
  .then((r) => { if (!r.ok) throw new Error('http ' + r.status); return r; });

// Все запросы к GitHub собираем в один список, а клоны и спам ищем по нему целиком:
// серия клонов часто разбросана по разным запросам.
let githubAll = null;
function loadGithubAll() {
  if (githubAll) return githubAll;
  const since = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const h = { Accept: 'application/vnd.github+json' };
  if (process.env.GITHUB_TOKEN) h.Authorization = 'Bearer ' + process.env.GITHUB_TOKEN;
  githubAll = (async () => {
    const raw = new Map();
    for (const f of NEWS_FEEDS.filter((x) => x.github)) {
      const q = `${f.github} in:name,description,topics created:>${since} stars:>20`;
      try { for (const r of (await (await get(`https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=50`, h)).json()).items || []) raw.set(r.id, r); } catch (e) { console.log('  GitHub-поиск: ' + e.message); }
    }
    const repos = githubRepos({ items: [...raw.values()] });
    // Спам с накрученными звёздами обычно идёт с только что созданных аккаунтов: авторов моложе 30 дней пропускаем.
    const ages = {};
    await Promise.all([...new Set(repos.map((x) => x.owner))].map(async (login) => {
      try { ages[login] = Date.parse((await (await get('https://api.github.com/users/' + encodeURIComponent(login), h)).json()).created_at); } catch { /* не узнали, оставляем */ }
    }));
    const items = repos.filter((x) => !(Date.now() - ages[x.owner] < 30 * 86400000)).slice(0, 20);
    console.log(`  GitHub: найдено ${raw.size}, без клонов и спама ${repos.length}, после проверки авторов ${items.length}`);
    return items;
  })();
  return githubAll;
}
async function loadGithub(feed) {
  const first = NEWS_FEEDS.find((x) => x.github) === feed;
  const items = first ? await loadGithubAll() : [];
  if (first && !items.length) throw new Error('пусто');
  return items.map(({ owner, ...x }) => ({ topic: feed.topic, source: feed.source, ...x, github: true }));
}

async function load(feed) {
  if (feed.github) return loadGithub(feed);
  if (feed.yt) {
    const id = youtubeChannelId(await (await get('https://www.youtube.com/' + feed.yt, { 'Accept-Language': 'en' })).text());
    if (!id) throw new Error('не нашёл ID канала');
    feed = { ...feed, url: 'https://www.youtube.com/feeds/videos.xml?channel_id=' + id };
  }
  const r = await fetch(feed.url, { headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' }, signal: AbortSignal.timeout(15000), redirect: 'follow' });
  if (!r.ok) throw new Error('http ' + r.status);
  const items = parseFeed(decodeFeed(new Uint8Array(await r.arrayBuffer()), r.headers.get('content-type')));
  if (!items.length) throw new Error('пустая лента');
  return items.filter((x) => !NEWS_SKIP.test(x.title)).slice(0, feed.limit || 25).map((x) => {
    let { title } = x, source = feed.source;
    if (feed.google) { const g = splitGoogleTitle(title); title = g.title; source = g.source || source; }
    return { topic: feed.topic, source, title, link: x.link, date: x.date, desc: feed.google ? '' : x.desc };
  });
}

const results = await Promise.allSettled(NEWS_FEEDS.map(load));
const all = [], status = [];
results.forEach((r, i) => {
  const f = NEWS_FEEDS[i];
  if (r.status === 'fulfilled') { all.push(...r.value); status.push({ source: f.source, topic: f.topic, ok: true, n: r.value.length }); console.log(`✓ ${f.source} (${f.topic}): ${r.value.length}`); }
  else { status.push({ source: f.source, topic: f.topic, ok: false }); console.log(`✗ ${f.source} (${f.topic}): ${r.reason && r.reason.message}`); }
});
// Английские заголовки и описания переводим на русский бесплатным переводчиком Google (без ключа).
// Переводы прошлой сборки берём из news.json на самом сайте, чтобы не переводить одно и то же каждые 30 минут.
const tr = async (text) => parseGtx(await (await get('https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=ru&dt=t&q=' + encodeURIComponent(text))).json());
let prevCache = {};
const [owner, repo] = (process.env.GITHUB_REPOSITORY || '').split('/');
if (owner && repo) { try { prevCache = (await (await get(`https://${owner}.github.io/${repo}/data/news.json?t=${Date.now()}`)).json()).translations || {}; } catch { /* первая сборка или сайт не ответил */ } }
const opts = { ageByTopic: NEWS_MAX_AGE_H };
const t = await translateItems(buildNews(all, Date.now(), opts), tr, prevCache);
// Второй проход убирает повторы, которые стали видны после перевода (одна новость на русском и английском).
const items = buildNews(t.items, Date.now(), opts).map(({ github, ...x }) => x);
console.log(`перевод: ${t.items.filter((x) => x.translated).length} новостей, из кэша ${Object.keys(t.cache).filter((k) => prevCache[k]).length} текстов`);
if (items.length) {
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'news.json'), JSON.stringify({ fetchedAt: new Date().toISOString(), feeds: status, items, translations: t.cache }));
  console.log(`news.json готов: ${items.length} новостей`);
} else console.log('Новости собрать не удалось, news.json не записан');
