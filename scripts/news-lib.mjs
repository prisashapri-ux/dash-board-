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
  if (a.link === b.link || a.key === b.key || (a.desc && a.desc === b.desc)) return true;
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
    const d = norm(x.desc || ''), c = { link: x.link.replace(/[?#].*$/, '').replace(/\/$/, ''), key: norm(x.title), stems: titleStems(x.title), desc: d.length >= 40 ? d : '' };
    if (kept.some((k) => sameStory(c, k))) continue;
    kept.push(c); count[x.topic] = (count[x.topic] || 0) + 1; out.push(x);
  }
  return out;
}

/**
 * Новые репозитории из ответа GitHub Search API без спама: клоны с одним именем или описанием
 * у разных авторов (накрутка звёзд) убираются целиком, если их 3 и больше; из пары остаётся тот, у кого больше звёзд.
 */
export function githubRepos(j) {
  const list = (j && Array.isArray(j.items) ? j.items : []).filter((r) => r && r.full_name && !r.fork && /^https:\/\/github\.com\//.test(r.html_url || ''));
  const nameKey = (r) => String(r.name || r.full_name.split('/')[1] || '').toLowerCase();
  const descKey = (r) => norm(r.description || '');
  const count = (key) => { const m = {}; for (const r of list) { const k = key(r); if (k) m[k] = (m[k] || 0) + 1; } return m; };
  // Основа имени без последнего слова: blender-ai-copilot-hub и blender-ai-copilot-lab — одна серия.
  const baseKey = (r) => { const n = nameKey(r).split(/[-_.]/).filter(Boolean); return n.length >= 3 ? n.slice(0, -1).join('-') : ''; };
  const byName = count(nameKey), byDesc = count(descKey), byBase = count(baseKey);
  // Почти одинаковые описания (больше 60% общих слов) у 3 и больше репозиториев — тоже серия клонов.
  const stems = list.map((r) => titleStems(r.description || ''));
  const near = (i, k) => { const a = stems[i], b = stems[k]; if (Math.min(a.size, b.size) < 4) return false; let c = 0; for (const w of a) if (b.has(w)) c++; return c / (a.size + b.size - c) > 0.6; };
  const nearCount = list.map((_, i) => list.reduce((n, __, k) => n + (near(i, k) ? 1 : 0), 0)); // считает и себя
  const spam = (r) => { const i = list.indexOf(r); return byName[nameKey(r)] >= 3 || (descKey(r).length >= 20 && byDesc[descKey(r)] >= 3) || byBase[baseKey(r)] >= 3 || nearCount[i] >= 3; };
  const seen = new Set(), out = [];
  for (const r of [...list].sort((a, b) => (b.stargazers_count || 0) - (a.stargazers_count || 0))) {
    if (spam(r)) continue;
    const keys = [nameKey(r), descKey(r).length >= 20 ? 'd:' + descKey(r) : ''].filter(Boolean);
    if (keys.some((k) => seen.has(k))) continue;
    keys.forEach((k) => seen.add(k));
    out.push({
      title: `${r.full_name} · ★ ${Number(r.stargazers_count || 0).toLocaleString('ru-RU')}`,
      link: r.html_url, date: r.created_at || '', owner: (r.owner && r.owner.login) || r.full_name.split('/')[0],
      desc: cleanText([r.description || '', r.language ? `(${r.language})` : ''].join(' '), 220),
    });
  }
  return out;
}
/** ID YouTube-канала со страницы канала. */
export function youtubeChannelId(html) {
  const m = String(html).match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/) || String(html).match(/"(?:externalId|channelId)":"(UC[\w-]{22})"/);
  return m ? m[1] : null;
}

/** Текст нужно переводить: есть латинские буквы и нет кириллицы. */
export function needsTranslation(text) {
  const t = String(text || '');
  return /[a-z]{3}/i.test(t) && !/[а-яё]/i.test(t);
}
/** Ответ бесплатного переводчика Google (client=gtx): [[["перевод","оригинал",...],...],...]. */
export function parseGtx(j) {
  if (!Array.isArray(j) || !Array.isArray(j[0])) return '';
  return j[0].map((x) => (Array.isArray(x) && typeof x[0] === 'string' ? x[0] : '')).join('').trim();
}
/**
 * Переводит на русский заголовки и описания на английском. tr(text) возвращает перевод или бросает ошибку;
 * cache — переводы прошлой сборки { оригинал: перевод }. Без перевода новость остаётся как была.
 * Возвращает { items, cache } — новый кэш только с текстами текущих новостей.
 */
export async function translateItems(items, tr, cache = {}, { concurrency = 4 } = {}) {
  const fresh = {}, todo = new Set();
  for (const x of items) {
    if (!x.github && needsTranslation(x.title)) todo.add(x.title);
    if (needsTranslation(x.desc)) todo.add(x.desc);
  }
  const list = [...todo];
  let i = 0;
  const worker = async () => {
    while (i < list.length) {
      const t = list[i++];
      if (cache[t]) { fresh[t] = cache[t]; continue; }
      try { const r = await tr(t); if (r && !needsTranslation(r)) fresh[t] = r; } catch { /* оставим оригинал */ }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  const out = items.map((x) => {
    const title = !x.github && fresh[x.title] ? fresh[x.title] : x.title, desc = fresh[x.desc] || x.desc;
    return title !== x.title || desc !== x.desc ? { ...x, title, desc, translated: true } : x;
  });
  return { items: out, cache: fresh };
}
