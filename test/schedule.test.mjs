import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../src/logic.js';

// Выдуманный лист «ноябрь 2026» в виде gviz CSV (часть ячеек числовых столбцов пустые).
const CSV = `"","","НОЯБРЬ 2026","","","","","","","","","","","","","","","","","","","","","","","","","","","","","","",""
"","","","","","","","","","","","","","","","","","","","","","","","","","","","","","","","","",""
"","часы 1-15","","","вс","пн","вт","ср","чт","пт","сб","вс","пн","вт","ср","чт","пт","сб","вс","пн","вт","ср","чт","пт","сб","вс","пн","вт","ср","чт","пт","сб","вс","пн"
"","","","","","","","","","","","","","","","","","","","","","","","","","","","","","","","","",""
"Аня","80","70","150","Х","Х","9-22","9-22","Х","9-20","9-22","Х","Х","10-18","11-19","9-22","9-22","Х","Х","10-18","10-18","Х","Х","10-18","10-18","9-22","Х","10-18","10-18","9-22","9-22","Х","Х","Х"
"Боря","60","66","126","9-22","9-22","Х","Х","9-22","9-22","","","9-22","9-22","","","","","","","9-22","9-22","","","9-22","","9-22","","","","","9-22","9-22",""
"Вера","77","81","158","","","9-22","9-22","","","9-22","9-22","","","9-22","9-22","","","9-22","9-22","","","9-22","9-22","","","","9-22","9-22","9-22","","","","9-22"
"","","","","","","","","","","","","","","","","","","","","","","","","","","","","","","","","",""
"","","ДАТА","ИМЯ","ПРИХОД","УХОД","","ДАТА","ИМЯ","ПРИХОД","УХОД","","ПЯТИМИНУТКИ","","","","","","","","","","","","","","","","","","","","",""
"","","01.11","Гриша","8:40","21:55","","16.11","Дина","","","","день недели","что убирать","","","","","","","","","","","","","","","","","","","",""`;

test('ID таблицы из ссылки', () => {
  assert.equal(L.sheetIdFromLink('https://docs.google.com/spreadsheets/d/1QiEeHOX5jnGzWqyIVkEhe6i7aUOoTOt3XGgUWmEMdo0/edit?usp=sharing'), '1QiEeHOX5jnGzWqyIVkEhe6i7aUOoTOt3XGgUWmEMdo0');
  assert.equal(L.sheetIdFromLink('просто текст'), '');
});
test('имя листа и адрес', () => {
  assert.equal(L.scheduleSheetName(2026, 11), 'ноябрь 2026');
  assert.match(L.scheduleUrl('abc', 'ноябрь 2026'), /gviz\/tq\?tqx=out:csv.*sheet=%D0%BD/);
});
test('CSV с кавычками и переносами', () => {
  assert.deepEqual(L.parseCsv('"a","b ""c""","x\ny"\n1,2,3'), [['a', 'b "c"', 'x\ny'], ['1', '2', '3']]);
});
test('ячейки смен', () => {
  assert.deepEqual(L.shiftCell('9-22'), { from: '09:00', to: '22:00', text: '9-22' });
  assert.deepEqual(L.shiftCell('Х'), { off: true });
  assert.equal(L.shiftCell(' '), null);
  assert.deepEqual(L.shiftCell('отпуск'), { note: 'отпуск' });
});
test('разбор листа: люди и смены по числам', () => {
  const s = L.parseSchedule(CSV, 2026, 11);
  assert.deepEqual(s.people.map((p) => p.name), ['Аня', 'Боря', 'Вера']);
  assert.equal(s.days, 30);
  const sasha = L.findPerson(s, 'боря');
  assert.equal(sasha.days[1].text, '9-22');
  assert.ok(sasha.days[3].off);
  assert.equal(sasha.days[7], undefined);
  assert.equal(L.findPerson(s, 'Аня').days[6].text, '9-20');
  assert.deepEqual(L.workingOn(s, 12).map((p) => p.name), ['Аня', 'Вера']);
});
test('лист другого месяца отвергается по дням недели', () => {
  assert.equal(L.parseSchedule(CSV, 2026, 10), null);
});
test('ближайшие смены идут через границу месяца', () => {
  const nov = L.parseSchedule(CSV, 2026, 11);
  const dec = { y: 2026, m: 12, days: 31, people: [{ name: 'Боря', days: { 2: { from: '09:00', to: '22:00', text: '9-22' } } }] };
  const r = L.nextShifts([dec, nov], 'Боря', '2026-11-25', 5);
  assert.deepEqual(r.map((x) => x.date), ['2026-11-28', '2026-11-29', '2026-12-02']);
});
test('изменения графика: только с сегодняшнего дня', () => {
  const a = L.parseSchedule(CSV, 2026, 11);
  const b = JSON.parse(JSON.stringify(a));
  L.findPerson(b, 'Боря').days[20] = { off: true };
  L.findPerson(b, 'Боря').days[2] = { off: true };
  assert.deepEqual(L.scheduleChanges(a, b, '2026-11-14'), [{ date: '2026-11-20', name: 'Боря', was: 'нет в графике', now: 'выходной' }]);
});
test('часы смен', () => {
  assert.equal(L.shiftHours({ from: '09:00', to: '22:00' }), 13);
  assert.equal(L.shiftHours({ off: true }), 0);
  const s = L.parseSchedule(CSV, 2026, 11);
  assert.equal(L.monthHours(L.findPerson(s, 'Боря')), 13 * 12);
});
test('шифрование: расшифровка паролем, чужой пароль не подходит', async () => {
  const s = L.parseSchedule(CSV, 2026, 11);
  const enc = await L.encryptJson({ me: 'Боря', months: [s] }, 'секрет');
  assert.ok(!JSON.stringify(enc).includes('Аня'));
  const r = L.parseSiteSchedule(await L.decryptJson(enc, 'секрет'));
  assert.equal(r.me, 'Боря');
  assert.deepEqual(r.months['2026-11'].people.map((p) => p.name), ['Аня', 'Боря', 'Вера']);
  await assert.rejects(L.decryptJson(enc, 'не тот'), /неверный пароль/);
});
