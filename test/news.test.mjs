import test from 'node:test';
import assert from 'node:assert/strict';
import * as N from '../scripts/news-lib.mjs';
import * as L from '../src/logic.js';

const RSS = `<?xml version="1.0" encoding="UTF-8"?><rss><channel><title>Лента</title>
<item><title><![CDATA[Новость &laquo;один&raquo;]]></title><link>https://example.ru/1?a=1&amp;b=2</link><pubDate>Fri, 13 Nov 2026 10:00:00 +0300</pubDate>
<description>&lt;p&gt;Текст &lt;b&gt;важной&lt;/b&gt; новости&lt;/p&gt;</description></item>
<item><title>Без ссылки</title><pubDate>Fri, 13 Nov 2026 10:00:00 +0300</pubDate></item>
</channel></rss>`;
const ATOM = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title type="html">Atom &amp; новость</title><link rel="alternate" href="https://ex.com/a"/><updated>2026-11-13T08:00:00Z</updated><summary>Коротко</summary></entry></feed>`;

test('RSS: заголовок, ссылка, дата, описание без тегов', () => {
  const r = N.parseFeed(RSS);
  assert.equal(r.length, 1);
  assert.equal(r[0].title, 'Новость «один»');
  assert.equal(r[0].link, 'https://example.ru/1?a=1&b=2');
  assert.equal(r[0].date, '2026-11-13T07:00:00.000Z');
  assert.equal(r[0].desc, 'Текст важной новости');
});
test('Atom разбирается', () => {
  assert.deepEqual(N.parseFeed(ATOM), [{ title: 'Atom & новость', link: 'https://ex.com/a', date: '2026-11-13T08:00:00.000Z', desc: 'Коротко' }]);
});
test('windows-1251 по заголовку XML', () => {
  const head = Buffer.from('<?xml version="1.0" encoding="windows-1251"?><t>', 'latin1');
  const body = Buffer.from([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2]); // «Привет»
  assert.match(N.decodeFeed(Buffer.concat([head, body])), /Привет/);
});
test('описание обрезается по слову', () => {
  const t = N.cleanText('слово '.repeat(100), 50);
  assert.ok(t.length <= 51 && t.endsWith('…'));
});
test('Google Новости: источник отделяется от заголовка', () => {
  assert.deepEqual(N.splitGoogleTitle('В Сочи открыли новый парк - Кубань 24'), { title: 'В Сочи открыли новый парк', source: 'Кубань 24' });
});
test('сборка: свежие, без повторов, новые сверху, лимит на тему', () => {
  const now = Date.parse('2026-11-14T08:00:00Z');
  const it = (title, h, topic = 'tech') => ({ topic, source: 's', title, link: 'https://x', date: new Date(now - h * 3600000).toISOString() });
  const r = N.buildNews([it('Старая', 60), it('А', 5), it('Б', 1), it('а!', 2), it('В', 3, 'games'), { ...it('Без даты', 1), date: '' }], now, { perTopic: 5 });
  assert.deepEqual(r.map((x) => x.title), ['Б', 'а!', 'В']);
  assert.equal(N.buildNews([it('1', 1), it('2', 2), it('3', 3)], now, { perTopic: 2 }).length, 2);
});
test('news.json с сайта: проверка формата и фильтр по темам', () => {
  assert.equal(L.parseSiteNews({}), null);
  const d = L.parseSiteNews({ fetchedAt: 'x', items: [{ topic: 'tech', title: 'a', link: 'https://a' }, { topic: 'games', title: 'b', link: 'javascript:alert(1)' }, { topic: 'sochi', title: 'c', link: 'https://c' }] });
  assert.equal(d.items.length, 2);
  assert.deepEqual(L.newsFor(d.items, 'all', ['sochi']).map((x) => x.title), ['a']);
  assert.deepEqual(L.newsFor(d.items, 'sochi', ['sochi']).map((x) => x.title), ['c']);
});
test('время по-русски', () => {
  const now = Date.parse('2026-11-14T12:00:00');
  assert.equal(L.timeAgoRu(new Date(now - 30000).toISOString(), now), 'только что');
  assert.equal(L.timeAgoRu(new Date(now - 5 * 60000).toISOString(), now), '5 мин назад');
  assert.equal(L.timeAgoRu(new Date(now - 3 * 3600000).toISOString(), now), '3 ч назад');
  assert.equal(L.timeAgoRu(new Date(now - 26 * 3600000).toISOString(), now), 'вчера');
  assert.equal(L.timeAgoRu('2026-11-10T10:00:00', now), '10 ноября');
  assert.equal(L.timeAgoRu('', now), '');
});
test('у каждой ленты есть тема из списка и https', () => {
  const keys = L.NEWS_TOPICS.map((t) => t[0]);
  for (const f of L.NEWS_FEEDS) { assert.ok(keys.includes(f.topic), f.source); assert.match(f.url, /^https:\/\//); }
});
