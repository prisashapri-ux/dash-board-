import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../src/logic.js';

const ev = (summary, start, end, extra = {}) => ({ summary, status: 'confirmed', start: start.length > 10 ? { dateTime: start } : { date: start }, end: end.length > 10 ? { dateTime: end } : { date: end }, ...extra });

test('событие со временем', () => {
  assert.deepEqual(L.calEventFromGoogle(ev('Бассейн', '2026-11-09T08:00:00+03:00', '2026-11-09T10:00:00+03:00', { colorId: '10', location: 'ул. Тестовая, 1' })),
    { t: 'Бассейн', d: '2026-11-09', d2: '2026-11-09', s: '08:00', e: '10:00', col: '#0b8043', loc: 'ул. Тестовая, 1' });
});
test('событие на весь день: конец не включительно', () => {
  const x = L.calEventFromGoogle(ev('Поездка', '2026-11-13', '2026-11-15'));
  assert.equal(x.d, '2026-11-13'); assert.equal(x.d2, '2026-11-14'); assert.equal(x.s, ''); assert.equal(x.col, L.CAL_DEFAULT_COLOR);
});
test('событие до полуночи и через полночь', () => {
  const a = L.calEventFromGoogle(ev('Эфир', '2026-11-09T20:00:00+03:00', '2026-11-10T00:00:00+03:00'));
  assert.equal(a.d2, '2026-11-09'); assert.equal(a.e, '24:00');
  const b = L.calEventFromGoogle(ev('Эфир', '2026-11-17T22:00:00+03:00', '2026-11-18T02:00:00+03:00'));
  assert.equal(b.d2, '2026-11-18');
  assert.equal(L.eventsOn([b], '2026-11-17')[0].e, '24:00');
  const next = L.eventsOn([b], '2026-11-18')[0];
  assert.equal(next.s, '00:00'); assert.equal(next.e, '02:00'); assert.equal(L.eventTime(next), '…–02:00');
});
test('отменённые пропускаются, повторы убираются, праздники помечаются', () => {
  const list = L.calEventsFromGoogle([
    { items: [ev('Б', '2026-11-09T14:00:00+03:00', '2026-11-09T15:00:00+03:00'), ev('А', '2026-11-09T08:00:00+03:00', '2026-11-09T09:00:00+03:00'), ev('А', '2026-11-09T08:00:00+03:00', '2026-11-09T09:00:00+03:00'), { ...ev('Х', '2026-11-09', '2026-11-10'), status: 'cancelled' }] },
    { holiday: true, items: [ev('Праздник', '2026-11-09', '2026-11-10')] },
  ]);
  assert.deepEqual(list.map((x) => x.t), ['Праздник', 'А', 'Б']);
  assert.equal(list[0].hol, true); assert.equal(list[0].col, L.CAL_HOLIDAY_COLOR);
});
test('разбор файла с сайта и события дня', () => {
  const j = { events: [{ t: 'Позже', d: '2026-11-09', d2: '2026-11-09', s: '20:00', e: '21:00', col: '#123456' }, { t: 'Весь день', d: '2026-11-08', d2: '2026-11-10', s: '', e: '', col: 'плохой' }, { t: 'битое', d: '9 ноября' }] };
  const c = L.parseSiteCalendar(j);
  assert.equal(c.events.length, 2); assert.equal(c.events[0].col, L.CAL_DEFAULT_COLOR);
  assert.deepEqual(L.eventsOn(c.events, '2026-11-09').map((x) => x.t), ['Весь день', 'Позже']);
  assert.equal(L.eventTime(c.events[0]), '8 ноября – 10 ноября');
  assert.equal(L.parseSiteCalendar({}), null);
});
test('сетка месяца с понедельника', () => {
  const g = L.monthGrid(2026, 11);
  assert.equal(g[0][0], '2026-10-26'); assert.equal(g[0][6], '2026-11-01'); assert.equal(g.length, 6); assert.equal(g[5][0], '2026-11-30');
  assert.equal(L.monthGrid(2027, 2).length, 4);
});
test('ближайшие события', () => {
  const evs = L.parseSiteCalendar({ events: [{ t: 'Утро', d: '2026-11-16', d2: '2026-11-16', s: '08:00', e: '10:00' }, { t: 'Вечер', d: '2026-11-16', d2: '2026-11-16', s: '20:00', e: '21:00' }, { t: 'Завтра', d: '2026-11-17', d2: '2026-11-17', s: '', e: '' }] }).events;
  assert.deepEqual(L.upcomingEvents(evs, '2026-11-16', '12:00').map((x) => x.t), ['Вечер', 'Завтра']);
});
test('шифрование календаря туда и обратно', async () => {
  const enc = await L.encryptJson({ events: [{ t: 'А', d: '2026-11-09', d2: '2026-11-09', s: '', e: '' }] }, 'пароль');
  assert.equal(L.parseSiteCalendar(await L.decryptJson(enc, 'пароль')).events[0].t, 'А');
});
