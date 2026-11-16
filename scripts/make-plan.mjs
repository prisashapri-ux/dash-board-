// Собирает data/plan.json (план контента по дням) и шифрует тем же паролем, что и график смен.
//   SCHEDULE_KEY=<пароль> node scripts/make-plan.mjs <файл.json>
// Входной файл (вне репозитория!): { "title": "...", "items": [ { "d": "2026-11-17", "s": "14:00", "e": "20:00", "t": "", "note": "2D RU: сценарий" } ] }
// t пустой — пункт подписывает событие календаря с тем же днём и временем начала; иначе это отдельное событие.
import fs from 'node:fs';
import path from 'node:path';
import { parseSitePlan, encryptJson } from '../src/logic.js';

const root = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const [file] = process.argv.slice(2);
const pass = String(process.env.SCHEDULE_KEY || '');
if (!file || !pass) { console.error('Нужны файл с планом и SCHEDULE_KEY'); process.exit(1); }
const input = JSON.parse(fs.readFileSync(file, 'utf8'));
const items = parseSitePlan(input);
if (!items || !items.length) { console.error('В плане нет пунктов, файл не меняю'); process.exit(1); }
const madeAt = new Date().toISOString();
fs.writeFileSync(path.join(root, 'data', 'plan.json'), JSON.stringify({ madeAt, enc: await encryptJson({ madeAt, title: input.title || '', items }, pass) }) + '\n');
console.log(`data/plan.json готов: ${items.length} пунктов`);
