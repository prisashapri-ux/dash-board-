// Собирает data/calendar.json из событий Google Календаря и шифрует тем же паролем, что и график смен.
// Запускает Claude раз в день: читает события через коннектор Google Календаря и передаёт их сюда.
//   SCHEDULE_KEY=<пароль> node scripts/make-calendar.mjs <файл.json>
// Входной файл (вне репозитория!): { "from": "2026-11-01", "to": "2027-02-01",
//   "calendars": [ { "items": [<события из list_events>] }, { "holiday": true, "items": [...] } ] }
// Сайт публичный, поэтому в репозиторий попадает только зашифрованный файл.
import fs from 'node:fs';
import path from 'node:path';
import { calEventsFromGoogle, encryptJson } from '../src/logic.js';

const root = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const [file] = process.argv.slice(2);
const pass = String(process.env.SCHEDULE_KEY || '');
if (!file || !pass) { console.error('Нужны файл с событиями и SCHEDULE_KEY'); process.exit(1); }
const input = JSON.parse(fs.readFileSync(file, 'utf8'));
if (!Array.isArray(input.calendars) || !input.calendars.length) { console.error('В файле нет calendars, файл не меняю'); process.exit(1); }
const events = calEventsFromGoogle(input.calendars);
const fetchedAt = new Date().toISOString();
fs.mkdirSync(path.join(root, 'data'), { recursive: true });
fs.writeFileSync(path.join(root, 'data', 'calendar.json'), JSON.stringify({ fetchedAt, enc: await encryptJson({ fetchedAt, from: input.from || '', to: input.to || '', events }, pass) }) + '\n');
console.log(`data/calendar.json готов: ${events.length} событий`);
