// Собирает data/shifts.json из листов Google Таблицы «График Мими Руш» и шифрует паролем.
// Запускает Claude раз в день: читает листы месяца и следующего (A1:AK40) и передаёт их сюда.
//   SCHEDULE_KEY=<пароль> SCHEDULE_NAME=<своё имя в таблице> node scripts/make-shifts.mjs <файл.json>
// Входной файл (вне репозитория!): { "months": [ { "y": 2026, "m": 11, "rows": [[...], ...] } ] }
// Сайт публичный, поэтому в репозиторий попадает только зашифрованный файл.
import fs from 'node:fs';
import path from 'node:path';
import { parseSchedule, encryptJson, scheduleSheetName } from '../src/logic.js';

const root = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const [file] = process.argv.slice(2);
const pass = String(process.env.SCHEDULE_KEY || ''), name = String(process.env.SCHEDULE_NAME || '').trim();
if (!file || !pass) { console.error('Нужны файл с листами и SCHEDULE_KEY'); process.exit(1); }
const input = JSON.parse(fs.readFileSync(file, 'utf8'));
const months = [];
for (const x of input.months || []) {
  const sch = parseSchedule(x.rows || [], x.y, x.m);
  if (!sch) { console.log(`Лист «${scheduleSheetName(x.y, x.m)}» не разобрался, пропускаю`); continue; }
  months.push(sch);
  console.log(`Лист «${scheduleSheetName(x.y, x.m)}» разобран`);
}
if (!months.length) { console.error('Нет ни одного разобранного месяца, файл не меняю'); process.exit(1); }
const fetchedAt = new Date().toISOString();
fs.mkdirSync(path.join(root, 'data'), { recursive: true });
fs.writeFileSync(path.join(root, 'data', 'shifts.json'), JSON.stringify({ fetchedAt, enc: await encryptJson({ fetchedAt, me: name, months }, pass) }) + '\n');
console.log('data/shifts.json готов');
