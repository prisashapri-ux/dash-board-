// Запускается в GitHub Actions перед выкладкой: читает Google Таблицу «График Мими Руш» (все сотрудники)
// и кладёт на сайт в зашифрованном виде: dist/data/shifts.json. Сайт публичный, поэтому без пароля имена и часы не прочитать.
// Секреты репозитория: SCHEDULE_SHEET_ID (ссылка или ID таблицы), SCHEDULE_KEY (пароль, его же вводят на iPad),
// SCHEDULE_NAME (своё имя в таблице, необязательно — для подсветки своей строки).
import fs from 'node:fs';
import path from 'node:path';
import { sheetIdFromLink, scheduleSheetName, scheduleUrl, parseSchedule, encryptJson } from '../src/logic.js';

const root = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const out = path.join(root, 'dist', 'data');
const id = sheetIdFromLink(process.env.SCHEDULE_SHEET_ID), name = String(process.env.SCHEDULE_NAME || '').trim(), pass = String(process.env.SCHEDULE_KEY || '');

async function month(y, m) {
  // Лист называется «ноябрь 2026», иногда с пробелом в конце.
  for (const sheet of [scheduleSheetName(y, m), scheduleSheetName(y, m) + ' ']) {
    try {
      const r = await fetch(scheduleUrl(id, sheet), { signal: AbortSignal.timeout(20000) });
      if (!r.ok) continue;
      const txt = await r.text();
      if (/^\s*</.test(txt)) throw new Error('таблица не открывается по ссылке');
      const sch = parseSchedule(txt, y, m);
      if (sch) return sch;
    } catch (e) { if (/по ссылке/.test(e.message)) throw e; }
  }
  return null;
}

if (!id || !pass) {
  console.log('График: секреты SCHEDULE_SHEET_ID и SCHEDULE_KEY не заданы, пропускаю');
} else {
  try {
    // Дата по Москве (Сочи), а не по UTC раннера.
    const [y, m] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit' }).format(new Date()).split('-').map(Number);
    const months = [];
    for (const [yy, mm] of [[y, m], m === 12 ? [y + 1, 1] : [y, m + 1]]) {
      const sch = await month(yy, mm);
      if (!sch) { console.log(`График: листа «${scheduleSheetName(yy, mm)}» нет`); continue; }
      console.log(`График: лист «${scheduleSheetName(yy, mm)}», сотрудников: ${sch.people.length}`);
      months.push(sch);
    }
    if (!months.length) throw new Error('нет данных');
    fs.mkdirSync(out, { recursive: true });
    const fetchedAt = new Date().toISOString();
    fs.writeFileSync(path.join(out, 'shifts.json'), JSON.stringify({ fetchedAt, enc: await encryptJson({ fetchedAt, me: name, months }, pass) }));
    console.log('shifts.json готов, месяцев:', months.length);
  } catch (e) {
    // Без графика сайт всё равно выкладываем.
    console.log('График забрать не удалось:', e.message);
  }
}
