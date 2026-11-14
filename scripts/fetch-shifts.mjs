// Запускается в GitHub Actions перед выкладкой: читает Google Таблицу «График Мими Руш» и кладёт на сайт
// только смены одного человека, без имён коллег (сайт публичный): dist/data/shifts.json.
// ID таблицы и имя строки берутся из секретов репозитория SCHEDULE_SHEET_ID и SCHEDULE_NAME, в коде их нет.
import fs from 'node:fs';
import path from 'node:path';
import { sheetIdFromLink, scheduleSheetName, scheduleUrl, parseSchedule, findPerson } from '../src/logic.js';

const root = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const out = path.join(root, 'dist', 'data');
const id = sheetIdFromLink(process.env.SCHEDULE_SHEET_ID), name = String(process.env.SCHEDULE_NAME || '').trim();

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

if (!id || !name) {
  console.log('График: секреты SCHEDULE_SHEET_ID и SCHEDULE_NAME не заданы, пропускаю');
} else {
  try {
    // Дата по Москве (Сочи), а не по UTC раннера.
    const [y, m] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit' }).format(new Date()).split('-').map(Number);
    const months = [];
    for (const [yy, mm] of [[y, m], m === 12 ? [y + 1, 1] : [y, m + 1]]) {
      const sch = await month(yy, mm);
      if (!sch) { console.log(`График: листа «${scheduleSheetName(yy, mm)}» нет`); continue; }
      const p = findPerson(sch, name);
      if (!p) { console.log(`График: в листе «${scheduleSheetName(yy, mm)}» нет строки с этим именем`); continue; }
      months.push({ y: yy, m: mm, days: sch.days, shifts: p.days });
    }
    if (!months.length) throw new Error('нет данных');
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'shifts.json'), JSON.stringify({ fetchedAt: new Date().toISOString(), months }));
    console.log('shifts.json готов, месяцев:', months.length);
  } catch (e) {
    // Без графика сайт всё равно выкладываем.
    console.log('График забрать не удалось:', e.message);
  }
}
