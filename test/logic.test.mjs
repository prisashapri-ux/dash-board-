import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as L from '../src/logic.js';

const T = '2026-11-12'; // четверг

test('режим главной по часу: утро, день, вечер, ночь', () => {
  assert.equal(L.modeByHour(5), 'morning');
  assert.equal(L.modeByHour(11), 'morning');
  assert.equal(L.modeByHour(12), 'day');
  assert.equal(L.modeByHour(17), 'day');
  assert.equal(L.modeByHour(18), 'evening');
  assert.equal(L.modeByHour(2), 'evening');
});
test('режим по настраиваемым часам и ручное переопределение', () => {
  const s = { ...L.DEFAULT_SETTINGS, morningFrom: 7, dayFrom: 10, eveningFrom: 20 };
  assert.equal(L.modeByHour(6, s), 'evening');
  assert.equal(L.modeByHour(9, s), 'morning');
  assert.equal(L.modeByHour(19, s), 'day');
  assert.equal(L.effectiveMode({ ...s, mode: 'evening' }, 9), 'evening');
  assert.equal(L.effectiveMode({ ...s, mode: 'auto' }, 9), 'morning');
});
test('ночная тема: авто вечером, вручную всегда или никогда', () => {
  const s = L.DEFAULT_SETTINGS;
  assert.equal(L.isNight(s, 22), true);
  assert.equal(L.isNight(s, 9), false);
  assert.equal(L.isNight({ ...s, night: 'on' }, 9), true);
  assert.equal(L.isNight({ ...s, night: 'off' }, 22), false);
});
test('слияние проектов: побеждает более новый updated, локальные-одиночки остаются', () => {
  const remote = [{ id: 'a', next: 'удалённый', updated: '2026-11-12T12:00:00Z' }, { id: 'b', next: 'b-удалённый', updated: '2026-11-12T12:00:00Z' }];
  const local = [
    { id: 'a', next: 'локальный новее', updated: '2026-11-13T08:00:00Z' },
    { id: 'b', next: 'локальный старее', updated: '2026-11-01' },
    { id: 'c', next: 'только у меня', updated: '2026-11-10' },
  ];
  const m = L.mergeProjects(remote, local);
  assert.deepEqual(m.map((p) => p.id), ['a', 'b', 'c']);
  assert.equal(m[0].next, 'локальный новее');
  assert.equal(m[1].next, 'b-удалённый');
  assert.equal(m[2].next, 'только у меня');
});
test('слияние: дата без времени сравнивается корректно', () => {
  const m = L.mergeProjects([{ id: 'a', v: 1, updated: '2026-11-12T12:00:00Z' }], [{ id: 'a', v: 2, updated: '2026-11-12' }]);
  assert.equal(m[0].v, 1);
});
test('главные проекты: «В работе» вперёд, готовые скрыты', () => {
  const ps = [{ id: 1, stage: 'Идея', progress: 90 }, { id: 2, stage: 'В работе', progress: 30 }, { id: 3, stage: 'Готово', progress: 100 }, { id: 4, stage: 'В работе', progress: 60 }, { id: 5, stage: 'План', progress: 10 }];
  assert.deepEqual(L.topProjects(ps, 3).map((p) => p.id), [4, 2, 5]);
});
test('группировка задач по датам', () => {
  const tasks = [
    { id: 1, date: '2026-11-10', done: false }, { id: 2, date: '2026-11-10', done: true }, { id: 3, date: T, time: '15:00' }, { id: 4, date: T, time: '09:00' },
    { id: 5, date: '2026-11-13' }, { id: 6, date: '2026-11-17' }, { id: 7, date: '2026-11-19' }, { id: 8, date: '2026-12-30' },
  ];
  const g = L.groupTasks(tasks, T);
  assert.deepEqual(g.overdue.map((t) => t.id), [1]);
  assert.deepEqual(g.today.map((t) => t.id), [4, 3]);
  assert.deepEqual(g.tomorrow.map((t) => t.id), [5]);
  assert.deepEqual(g.week.map((t) => t.id), [6, 7]);
  assert.deepEqual(g.later.map((t) => t.id), [8]);
});
test('полоса недели считает невыполненные задачи по дням', () => {
  const s = L.weekStrip([{ date: T, done: false }, { date: T, done: true }, { date: '2026-11-14', done: false }, { date: '2026-11-30', done: false }], T);
  assert.equal(s.length, 7);
  assert.equal(s[0].weekday, 'Чт');
  assert.equal(s[0].count, 1);
  assert.equal(s[0].total, 2);
  assert.equal(s[2].count, 1);
  assert.equal(s[6].date, '2026-11-18');
});
test('арифметика дат через границу месяца и года', () => {
  assert.equal(L.addDays('2026-11-30', 1), '2026-12-01');
  assert.equal(L.addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(L.daysInMonth('2026-02-10'), 28);
});
test('дата по-русски', () => {
  assert.equal(L.formatDateRu(new Date(2026, 10, 12)), 'четверг, 12 ноября');
  assert.equal(L.formatShortRu('2026-03-01'), '1 марта');
  assert.equal(L.formatTime(new Date(2026, 0, 1, 7, 5)), '07:05');
});
test('серия привычки: считает подряд, вчерашняя серия не рвётся', () => {
  const checks = { '2026-11-12': ['h'], '2026-11-11': ['h'], '2026-11-10': ['h'], '2026-11-08': ['h'] };
  assert.equal(L.habitStreak(checks, 'h', T), 3);
  assert.equal(L.habitStreak({ '2026-11-11': ['h'], '2026-11-10': ['h'] }, 'h', T), 2);
  assert.equal(L.habitStreak({ '2026-11-09': ['h'] }, 'h', T), 0);
  assert.equal(L.habitStreak(checks, 'x', T), 0);
});
test('неделя привычки: 7 дней, последний — сегодня', () => {
  const w = L.habitWeek({ [T]: ['h'] }, 'h', T);
  assert.equal(w.length, 7);
  assert.equal(w[6].date, T);
  assert.equal(w[6].on, true);
  assert.equal(w[0].on, false);
});
test('финансы: суммы за день, неделю, месяц', () => {
  const e = [{ date: T, amount: 300 }, { date: '2026-11-08', amount: 200 }, { date: '2026-11-05', amount: 100 }, { date: '2026-10-31', amount: 999 }];
  const f = L.financeTotals(e, T, 0);
  assert.equal(f.today, 300);
  assert.equal(f.week, 500);
  assert.equal(f.month, 600);
});
test('финансы: остаток бюджета и дневной лимит', () => {
  // ноябрь: 30 дней, сегодня 12-е, осталось 19 дней включая сегодня
  const e = [{ date: '2026-11-03', amount: 3000 }, { date: T, amount: 500 }];
  const f = L.financeTotals(e, T, 30000);
  assert.equal(f.remaining, 26500);
  assert.equal(f.daysLeft, 19);
  assert.equal(f.allowance, Math.floor(27000 / 19));
  assert.equal(f.dailyBudget, 1000);
  assert.equal(L.financeTotals(e, T, 1000).allowance, 0);
});
test('итоги дня: задачи, привычки, траты', () => {
  const s = L.daySummary({
    tasks: [{ date: T, done: true }, { date: T, done: false }, { date: T, done: true }, { date: '2026-11-13', done: false }],
    habits: [{ id: 'a' }, { id: 'b' }], checks: { [T]: ['a', 'удалённая'] }, entries: [{ date: T, amount: 450 }], today: T, monthlyBudget: 30000,
  });
  assert.deepEqual(s, { total: 3, done: 2, pct: 67, habitsDone: 1, habitsTotal: 2, spent: 450, dailyBudget: 1000 });
  assert.equal(L.daySummary({ tasks: [], habits: [], checks: {}, entries: [], today: T }).pct, 0);
});
test('коды погоды WMO по-русски', () => {
  assert.equal(L.wmoInfo(0).text, 'Ясно');
  assert.equal(L.wmoInfo(3).text, 'Пасмурно');
  assert.equal(L.wmoInfo(63).text, 'Дождь');
  assert.equal(L.wmoInfo(95).text, 'Гроза');
  assert.equal(L.wmoInfo(12345).text, 'Погода неизвестна');
});
test('разбор ответа Open-Meteo и формат температуры', () => {
  const w = L.parseWeather({ current: { temperature_2m: 12.4, weather_code: 2 }, daily: { time: [T, '2026-11-13'], weather_code: [2, 61], temperature_2m_max: [14, 11], temperature_2m_min: [7.6, 6] } });
  assert.equal(w.temp, 12.4);
  assert.deepEqual(w.tomorrow, { date: '2026-11-13', min: 6, max: 11, code: 61 });
  assert.equal(L.parseWeather({}), null);
  assert.equal(L.formatTemp(12.4), '+12°');
  assert.equal(L.formatTemp(-3.6), '−4°');
  assert.equal(L.formatTemp(0), '0°');
});
test('адрес запроса погоды идёт только на Open-Meteo', () => {
  assert.ok(L.weatherUrl(43.585, 39.72).startsWith('https://api.open-meteo.com/v1/forecast?latitude=43.585&longitude=39.72'));
});
test('projects.json: 10 проектов, корректные этапы и уникальные id', () => {
  const j = JSON.parse(fs.readFileSync(new URL('../src/projects.json', import.meta.url), 'utf8'));
  assert.equal(j.projects.length, 10);
  const ids = new Set();
  for (const p of j.projects) {
    assert.ok(L.STAGES.includes(p.stage), p.id);
    assert.ok(p.progress >= 0 && p.progress <= 100);
    assert.ok(p.tasks.length > 0 && p.updated === '2026-11-12T12:00:00Z' && p.deadline === null);
    for (const t of p.tasks) { assert.ok(!ids.has(t.id)); ids.add(t.id); }
  }
  assert.equal(j.projects.find((p) => p.id === 'video2d').subtitle, 'Жизнь на каждом уровне');
});
