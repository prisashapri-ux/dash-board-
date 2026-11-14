import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../src/logic.js';

// Так лист «ноябрь 2026» отдаёт gviz CSV (часть ячеек числовых столбцов пустые).
const CSV = `"","","НОЯБРЬ 2026","","","","","","","","","","","","","","","","","","","","","","","","","","","","","","",""
"","","","","","","","","","","","","","","","","","","","","","","","","","","","","","","","","",""
"","часы 1-15","","","вс","пн","вт","ср","чт","пт","сб","вс","пн","вт","ср","чт","пт","сб","вс","пн","вт","ср","чт","пт","сб","вс","пн","вт","ср","чт","пт","сб","вс","пн"
"","","","","","","","","","","","","","","","","","","","","","","","","","","","","","","","","",""
"Софи","91","87","178","Х","Х","9-22","9-22","Х","9-20","9-22","Х","Х","10-18","11-19","9-22","9-22","Х","Х","10-18","10-18","Х","Х","10-18","10-18","9-22","Х","10-18","10-18","9-22","9-22","Х","Х","Х"
"Саша","78","78","156","9-22","9-22","Х","Х","9-22","9-22","","","9-22","9-22","","","","","","","9-22","9-22","","","9-22","","9-22","","","","","9-22","9-22",""
"Прияткин","91","78","169","","","9-22","9-22","","","9-22","9-22","","","9-22","9-22","","","9-22","9-22","","","9-22","9-22","","","","9-22","9-22","9-22","","","","9-22"
"","","","","","","","","","","","","","","","","","","","","","","","","","","","","","","","","",""
"","","ДАТА","ИМЯ","ПРИХОД","УХОД","","ДАТА","ИМЯ","ПРИХОД","УХОД","","ПЯТИМИНУТКИ","","","","","","","","","","","","","","","","","","","","",""
"","","01.11","Ася","8:50","22:10","","16.11","Елизавета","","","","день недели","что убирать","","","","","","","","","","","","","","","","","","","",""`;

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
  assert.deepEqual(s.people.map((p) => p.name), ['Софи', 'Саша', 'Прияткин']);
  assert.equal(s.days, 30);
  const sasha = L.findPerson(s, 'саша');
  assert.equal(sasha.days[1].text, '9-22');
  assert.ok(sasha.days[3].off);
  assert.equal(sasha.days[7], undefined);
  assert.equal(L.findPerson(s, 'Софи').days[6].text, '9-20');
  assert.deepEqual(L.workingOn(s, 12).map((p) => p.name), ['Софи', 'Прияткин']);
});
test('лист другого месяца отвергается по дням недели', () => {
  assert.equal(L.parseSchedule(CSV, 2026, 10), null);
});
test('ближайшие смены идут через границу месяца', () => {
  const nov = L.parseSchedule(CSV, 2026, 11);
  const dec = { y: 2026, m: 12, days: 31, people: [{ name: 'Саша', days: { 2: { from: '09:00', to: '22:00', text: '9-22' } } }] };
  const r = L.nextShifts([dec, nov], 'Саша', '2026-11-25', 5);
  assert.deepEqual(r.map((x) => x.date), ['2026-11-28', '2026-11-29', '2026-12-02']);
});
test('изменения графика: только с сегодняшнего дня', () => {
  const a = L.parseSchedule(CSV, 2026, 11);
  const b = JSON.parse(JSON.stringify(a));
  L.findPerson(b, 'Саша').days[20] = { off: true };
  L.findPerson(b, 'Саша').days[2] = { off: true };
  assert.deepEqual(L.scheduleChanges(a, b, '2026-11-14'), [{ date: '2026-11-20', name: 'Саша', was: 'нет в графике', now: 'выходной' }]);
});
test('смены с сайта: только свои, в виде месяца', () => {
  const r = L.parseSiteShifts({ fetchedAt: '2026-11-14T10:00:00Z', months: [{ y: 2026, m: 11, days: 30, shifts: { 17: { from: '09:00', to: '22:00', text: '9-22' }, 3: { off: true } } }, { y: 'x' }] });
  assert.deepEqual(Object.keys(r.months), ['2026-11']);
  assert.deepEqual(L.nextShifts(Object.values(r.months), L.SHIFTS_ME, '2026-11-14').map((x) => x.date), ['2026-11-17']);
  assert.equal(L.parseSiteShifts({}), null);
});
