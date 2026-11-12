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
test('projects.json: 7 проектов, корректные этапы и уникальные id', () => {
  const j = JSON.parse(fs.readFileSync(new URL('../src/projects.json', import.meta.url), 'utf8'));
  assert.equal(j.projects.length, 7);
  const ids = new Set();
  for (const p of j.projects) {
    assert.ok(L.STAGES.includes(p.stage), p.id);
    assert.ok(p.progress >= 0 && p.progress <= 100);
    assert.ok(p.tasks.length > 0 && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(p.updated) && p.deadline === null);
    for (const t of p.tasks) { assert.ok(!ids.has(t.id)); ids.add(t.id); }
  }
  assert.deepEqual(j.projects.map((p) => p.id), ['mimi', 'twitch', 'gamevideo', 'vlog', 'video2d', 'video2d-ru', 'pult']);
});

test('wttr.in: разбор ответа и перевод кодов', () => {
  const w = L.parseWttr({ current_condition: [{ temp_C: '11', weatherCode: '116' }], weather: [
    { date: '2026-11-12', mintempC: '7', maxtempC: '14', hourly: [{}, {}, {}, {}, { weatherCode: '296' }] },
    { date: '2026-11-13', mintempC: '6', maxtempC: '12', hourly: [{ weatherCode: '113' }] }] });
  assert.equal(w.temp, 11); assert.equal(w.code, 2); assert.equal(w.today.code, 61); assert.equal(w.tomorrow.code, 0); assert.equal(w.tomorrow.max, 12);
  assert.equal(L.parseWttr({}), null);
  assert.equal(L.wwoToWmo(999), -1);
});

test('лимиты Claude: разбор гиста, время сброса, «обновлено»', () => {
  const content = JSON.stringify({ five_hour: { used_percentage: 10.4, resets_at: 1794516600 }, seven_day: { used_percentage: 16, resets_at: 1794740400 }, updated_at: 1794496000 });
  const u = L.parseClaudeUsage({ files: { 'claude-usage.json': { content } } });
  assert.equal(u.session.pct, 10); assert.equal(u.week.pct, 16);
  assert.equal(u.session.resetsAt, 1794516600000); assert.equal(u.updatedAt, 1794496000000);
  assert.equal(L.parseClaudeUsage({ files: {} }), null);
  assert.equal(L.parseClaudeUsage({ files: { 'claude-usage.json': { content: 'не json' } } }), null);
  const now = new Date(2026, 10, 12, 18, 0), later = new Date(2026, 10, 12, 22, 50), thu = new Date(2026, 10, 19, 10, 0);
  assert.equal(L.formatReset(later.getTime(), now), 'в 22:50');
  assert.equal(L.formatReset(thu.getTime(), now), 'Чт 10:00');
  assert.equal(L.formatAgo(now.getTime() - 5 * 60000, now.getTime()), '5 мин назад');
  assert.equal(L.formatAgo(now.getTime(), now.getTime()), 'только что');
});

test('осадки на 2 часа: сухо, начнутся, идут и закончатся, устаревший прогноз', () => {
  const time = Array.from({ length: 16 }, (_, k) => { const m = 16 * 60 + k * 15; return `2026-11-12T${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; });
  const now = Date.UTC(2026, 10, 12, 13, 20); // 16:20 в Сочи (UTC+3)
  const mk = (mm) => ({ time, mm, offset: 10800 });
  assert.equal(L.rainNowcast(mk(time.map(() => 0)), now).text, 'Без осадков в ближайшие 2 часа');
  const later = time.map((_, k) => (k >= 3 ? 0.4 : 0));
  assert.equal(L.rainNowcast(mk(later), now).text, 'Осадки начнутся примерно через 30 мин');
  const nowWet = time.map((_, k) => (k < 6 ? 1 : 0));
  assert.equal(L.rainNowcast(mk(nowWet), now).text, 'Осадки сейчас, закончатся примерно через 1 ч 15 мин');
  assert.equal(L.rainNowcast(mk(time.map(() => 1)), now).text, 'Осадки идут и не закончатся в ближайшие 2 часа');
  assert.equal(L.rainNowcast(mk(time.map(() => 0)), Date.UTC(2026, 10, 13, 13, 0)), null);
  assert.equal(L.rainNowcast(null, now), null);
});
test('погода: восход, закат и ряд осадков из ответа Open-Meteo', () => {
  const w = L.parseWeather({ utc_offset_seconds: 10800, current: { temperature_2m: 10, weather_code: 0 }, daily: { time: [T], weather_code: [0], temperature_2m_max: [12], temperature_2m_min: [5], sunrise: ['2026-11-12T07:01'], sunset: ['2026-11-12T16:52'] }, minutely_15: { time: ['2026-11-12T16:00'], precipitation: [0] } });
  assert.equal(w.sunrise, '07:01'); assert.equal(w.sunset, '16:52'); assert.equal(w.rain.offset, 10800);
  assert.ok(L.weatherUrl(1, 2).includes('minutely_15=precipitation'));
});
test('качество воздуха: оценки по европейскому индексу', () => {
  assert.equal(L.parseAir({ current: { european_aqi: 15, pm2_5: 4.2 } }).text, 'хороший');
  assert.equal(L.parseAir({ current: { european_aqi: 55 } }).level, 'warn');
  assert.equal(L.parseAir({ current: { european_aqi: 90 } }).text, 'очень плохой');
  assert.equal(L.parseAir({}), null);
  assert.ok(L.airUrl(1, 2).startsWith('https://air-quality-api.open-meteo.com/'));
});
test('отсчёты: дни до даты, склонение, ближайшие без прошедших', () => {
  assert.equal(L.daysUntil(T, '2026-12-05'), 23);
  assert.equal(L.formatDaysLeft(0), 'сегодня'); assert.equal(L.formatDaysLeft(1), 'завтра');
  assert.equal(L.formatDaysLeft(21), 'через 21 день'); assert.equal(L.formatDaysLeft(23), 'через 23 дня'); assert.equal(L.formatDaysLeft(12), 'через 12 дней');
  const u = L.upcomingCountdowns([{ title: 'b', date: '2027-01-01' }, { title: 'old', date: '2026-11-01' }, { title: 'a', date: '2026-11-20' }], T);
  assert.deepEqual(u.map((c) => c.title), ['a', 'b']);
});
test('прогресс года, месяца и недели', () => {
  const p = L.periodProgress(new Date(2026, 10, 12, 12, 0));
  assert.equal(p.year, 86); assert.equal(p.month, 38); assert.equal(p.week, 50);
  assert.equal(L.periodProgress(new Date(2026, 0, 1, 0, 0)).year, 0);
});
test('цели: что пора оценить и итог периода', () => {
  const goals = [
    { id: 1, period: '2026-10', status: null }, { id: 2, period: '2026-11', status: null },
    { id: 3, period: '2026-10', status: 'done' }, { id: 4, period: '2025', status: null }, { id: 5, period: '2026', status: null },
  ];
  assert.deepEqual(L.goalsToReview(goals, T).map((g) => g.id), [1, 4]);
  assert.deepEqual(L.goalsToReview(goals, '2026-11-30').map((g) => g.id), [1, 2, 4]);
  assert.deepEqual(L.goalsToReview(goals, '2026-12-31').map((g) => g.id), [1, 2, 4, 5]);
  assert.deepEqual(L.goalsSummary(goals, '2026-10'), { total: 2, done: 1, partial: 0, fail: 0 });
  assert.equal(L.periodName('2026-11'), 'ноябрь 2026'); assert.equal(L.periodName('2026'), '2026 год');
});
test('дневник: ряд оценок и среднее, рутина, день недели', () => {
  const s = L.moodSeries({ [T]: { mood: 4 }, '2026-11-11': { mood: 2 } }, T, 3);
  assert.deepEqual(s.map((x) => x.mood), [0, 2, 4]);
  assert.equal(L.moodAverage(s), 3); assert.equal(L.moodAverage([]), 0);
  assert.deepEqual(L.routineProgress([{ id: 'a' }, { id: 'b' }], ['b', 'x']), { done: 1, total: 2 });
  assert.equal(L.weekdayIndex(T), 3); assert.equal(L.weekdayIndex('2026-11-16'), 0);
});
test('курсы ЦБ: разбор, номинал, изменение', () => {
  const r = L.parseRates({ Date: '2026-11-12T11:30:00+03:00', Valute: { USD: { Nominal: 1, Value: 81.234, Previous: 81.5 }, CNY: { Nominal: 10, Value: 112.5, Previous: 112 } } });
  assert.equal(r.date, '2026-11-12');
  assert.deepEqual(r.list.map((x) => x.code), ['USD', 'CNY']);
  assert.equal(r.list[0].value, 81.23); assert.equal(r.list[0].diff, -0.27); assert.equal(r.list[1].value, 11.25);
  assert.equal(L.formatRate(81.2), '81,20');
  assert.equal(L.parseRates({}), null);
});
test('погода с сайта Пульта: только тот же город и свежая', () => {
  const forecast = { current: { temperature_2m: 9, weather_code: 3 }, daily: { time: [T], weather_code: [3], temperature_2m_max: [10], temperature_2m_min: [4] } };
  const now = Date.parse('2026-11-12T14:00:00Z');
  const j = { lat: 43.585, lon: 39.72, fetchedAt: '2026-11-12T13:37:00Z', forecast, air: { current: { european_aqi: 20 } } };
  const w = L.parseSiteWeather(j, 43.6, 39.7, now);
  assert.equal(w.data.temp, 9); assert.equal(w.air.text, 'хороший'); assert.equal(w.at, Date.parse(j.fetchedAt));
  assert.equal(L.parseSiteWeather(j, 55.75, 37.6, now), null);
  assert.equal(L.parseSiteWeather(j, 43.585, 39.72, now + 4 * 3600000), null);
  assert.equal(L.parseSiteWeather(null, 1, 1, now), null);
});
