// Разбор RSS 2.0 и Atom без сторонних пакетов. Используется в GitHub Actions (scripts/fetch-news.mjs) и в тестах.

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', laquo: '«', raquo: '»', mdash: '—', ndash: '–', hellip: '…', bdquo: '„', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', thinsp: ' ', shy: '' };

export function decodeEntities(s) {
  return String(s || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); try { return String.fromCodePoint(n); } catch { return ''; } }
    const v = NAMED[e.toLowerCase()]; return v === undefined ? m : v;
  });
}

/** Текст без тегов, CDATA и лишних пробелов. */
export function cleanText(s, max = 0) {
  let t = String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  t = decodeEntities(t); // в RSS HTML часто экранирован: сначала раскрываем, потом снимаем теги
  t = t.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]*>/g, ' ');
  t = decodeEntities(t).replace(/\s+/g, ' ').trim();
  if (max && t.length > max) { t = t.slice(0, max); const sp = t.lastIndexOf(' '); t = (sp > max * 0.6 ? t.slice(0, sp) : t).replace(/[\s,.;:—–-]+$/, '') + '…'; }
  return t;
}

const tag = (block, name) => { const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i')); return m ? m[1] : ''; };

/** Кодировка из XML-заголовка или Content-Type (у части русских лент windows-1251). */
export function decodeFeed(buf, contentType = '') {
  const head = Buffer.from(buf).subarray(0, 200).toString('latin1');
  const cs = (head.match(/encoding=["']([\w-]+)["']/i) || String(contentType).match(/charset=([\w-]+)/i) || [])[1] || 'utf-8';
  try { return new TextDecoder(cs.toLowerCase()).decode(buf); } catch { return new TextDecoder('utf-8').decode(buf); }
}

/** Новости из RSS или Atom: [{ title, link, date (ISO или ''), desc }]. */
export function parseFeed(xml) {
  const out = [];
  const isAtom = !/<item[\s>]/i.test(xml) && /<entry[\s>]/i.test(xml);
  const blocks = xml.match(isAtom ? /<entry[\s>][\s\S]*?<\/entry>/gi : /<item[\s>][\s\S]*?<\/item>/gi) || [];
  for (const b of blocks) {
    const title = cleanText(tag(b, 'title'));
    let link = '';
    if (isAtom) { const m = b.match(/<link[^>]*rel=["']alternate["'][^>]*>/i) || b.match(/<link[^>]*>/i); link = m ? ((m[0].match(/href=["']([^"']+)["']/i) || [])[1] || '') : ''; }
    else link = cleanText(tag(b, 'link')) || cleanText(tag(b, 'guid'));
    link = decodeEntities(link).trim();
    const rawDate = cleanText(tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'dc:date'));
    const t = Date.parse(rawDate);
    const desc = cleanText(tag(b, 'description') || tag(b, 'summary') || tag(b, 'content'), 220);
    if (title && /^https?:\/\//i.test(link)) out.push({ title, link, date: Number.isFinite(t) ? new Date(t).toISOString() : '', desc: desc === title ? '' : desc });
  }
  return out;
}

/** У Google Новостей источник дописан в заголовок: «Текст - Источник». */
export function splitGoogleTitle(title) {
  const i = title.lastIndexOf(' - ');
  return i > 10 ? { title: title.slice(0, i).trim(), source: title.slice(i + 3).trim() } : { title, source: '' };
}

const norm = (s) => s.toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/g, ' ').trim();
const STOP = new Set(['это', 'будет', 'может', 'стал', 'стала', 'после', 'более', 'about', 'with', 'from', 'that', 'this', 'what', 'your', 'have', 'will', 'новый', 'новая', 'новое', 'новые']);
/** Основы значимых слов заголовка: первые 5 букв слов от 4 букв. */
export function titleStems(title) {
  return new Set(norm(title).split(' ').filter((w) => w.length >= 4 && !STOP.has(w)).map((w) => w.slice(0, 5)));
}
/** Одна и та же новость: совпадает ссылка, заголовок или почти все значимые слова. */
export function sameStory(a, b) {
  if (a.link === b.link || a.key === b.key) return true;
  if (Math.min(a.stems.size, b.stems.size) < 3) return false;
  let common = 0; for (const w of a.stems) if (b.stems.has(w)) common++;
  return common / (a.stems.size + b.stems.size - common) > 0.6; // доля общих слов среди всех
}

/**
 * Собирает итоговый список: свежие (не старше maxAgeH, у тем из ageByTopic своё окно), новые сверху,
 * без повторов одной новости из разных лент и тем, не больше perTopic на тему.
 */
export function buildNews(items, now = Date.now(), { maxAgeH = 48, perTopic = 30, ageByTopic = {} } = {}) {
  const kept = [], count = {}, out = [];
  const fresh = items.filter((x) => x.date && now - Date.parse(x.date) < (ageByTopic[x.topic] || maxAgeH) * 3600000 && Date.parse(x.date) < now + 3600000)
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  for (const x of fresh) {
    if ((count[x.topic] || 0) >= perTopic) continue;
    const c = { link: x.link.replace(/[?#].*$/, '').replace(/\/$/, ''), key: norm(x.title), stems: titleStems(x.title) };
    if (kept.some((k) => sameStory(c, k))) continue;
    kept.push(c); count[x.topic] = (count[x.topic] || 0) + 1; out.push(x);
  }
  return out;
}

/** Новые репозитории из ответа GitHub Search API. */
export function githubRepos(j) {
  return (j && Array.isArray(j.items) ? j.items : []).filter((r) => r && r.full_name && /^https:\/\/github\.com\//.test(r.html_url || '')).map((r) => ({
    title: `${r.full_name} · ★ ${Number(r.stargazers_count || 0).toLocaleString('ru-RU')}`,
    link: r.html_url, date: r.created_at || '',
    desc: cleanText([r.description || '', r.language ? `(${r.language})` : ''].join(' '), 220),
  }));
}
/** ID YouTube-канала со страницы канала. */
export function youtubeChannelId(html) {
  const m = String(html).match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/) || String(html).match(/"(?:externalId|channelId)":"(UC[\w-]{22})"/);
  return m ? m[1] : null;
}
