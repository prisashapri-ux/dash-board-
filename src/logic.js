// Чистая логика «Пульта»: без доступа к DOM и сети, чтобы её можно было проверять тестами.

export const STAGES = ['Идея', 'План', 'В работе', 'Проверка', 'Готово'];
export const CATEGORIES = ['Еда', 'Кафе', 'Дом', 'Транспорт', 'Здоровье', 'Развлечения', 'Проекты', 'Другое'];
export const DEFAULT_HABITS = ['Зал', 'Прогулка с собаками', 'Вода', 'Сон 8 ч'];
export const DEFAULT_SETTINGS = {
  city: 'Сочи', lat: 43.585, lon: 39.72,
  morningFrom: 5, dayFrom: 12, eveningFrom: 18,
  night: 'auto', mode: 'auto', twitch: '', youtube: '', claudeGist: '',
  keepAwake: true, ambientMin: 5, ambientPhotos: true, nightDim: 30,
};
export const DEFAULT_ROUTINES = {
  morning: ['Стакан воды', 'Зарядка', 'Прогулка с собаками', 'План на день'],
  evening: ['Итоги дня', 'План на завтра', 'Телефон на зарядку', 'Лечь до полуночи'],
};

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
const WD_SHORT = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

const p2 = (n) => String(n).padStart(2, '0');

/** Локальная дата в виде ГГГГ-ММ-ДД. */
export function isoDate(d) { return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; }
export function fromISO(iso) { const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d, 12); }
export function addDays(iso, n) { const d = fromISO(iso); d.setDate(d.getDate() + n); return isoDate(d); }
export function daysInMonth(iso) { const d = fromISO(iso); return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); }

/** «четверг, 12 ноября» */
export function formatDateRu(date) { return `${WEEKDAYS[date.getDay()]}, ${date.getDate()} ${MONTHS[date.getMonth()]}`; }
/** «12 ноября» из строки ГГГГ-ММ-ДД. */
export function formatShortRu(iso) { const d = fromISO(iso); return `${d.getDate()} ${MONTHS[d.getMonth()]}`; }
export function formatTime(date) { return `${p2(date.getHours())}:${p2(date.getMinutes())}`; }
export function weekdayShort(iso) { return WD_SHORT[fromISO(iso).getDay()]; }

/** Режим главной по часу: утро / день / вечер. Вечер переходит через полночь. */
export function modeByHour(hour, s = DEFAULT_SETTINGS) {
  const m = s.morningFrom ?? 5, d = s.dayFrom ?? 12, e = s.eveningFrom ?? 18;
  if (hour >= m && hour < d) return 'morning';
  if (hour >= d && hour < e) return 'day';
  return 'evening';
}
export function effectiveMode(settings, hour) {
  const o = settings.mode;
  return o === 'morning' || o === 'day' || o === 'evening' ? o : modeByHour(hour, settings);
}
/** Ночная палитра: включена вручную, либо автоматически вечером и ночью. */
export function isNight(settings, hour) {
  if (settings.night === 'on') return true;
  if (settings.night === 'off') return false;
  return modeByHour(hour, settings) === 'evening';
}

const t = (s) => Date.parse(s) || 0;
/** Слияние проектов из projects.json и локальных правок: по каждому проекту побеждает более новый `updated`. */
export function mergeProjects(remote = [], local = []) {
  const map = new Map();
  for (const p of remote) map.set(p.id, p);
  for (const p of local) {
    const r = map.get(p.id);
    if (!r || t(p.updated) > t(r.updated)) map.set(p.id, p);
  }
  const order = remote.map((p) => p.id);
  return [...map.values()].sort((a, b) => {
    const ia = order.indexOf(a.id), ib = order.indexOf(b.id);
    return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
  });
}

/** Главные проекты для утра: не завершённые, сначала «В работе», потом по прогрессу. */
export function topProjects(projects, n = 3) {
  const rank = { 'В работе': 0, 'Проверка': 1, 'План': 2, 'Идея': 3 };
  return projects.filter((p) => p.stage !== 'Готово')
    .map((p, i) => ({ p, i }))
    .sort((a, b) => (rank[a.p.stage] ?? 9) - (rank[b.p.stage] ?? 9) || b.p.progress - a.p.progress || a.i - b.i)
    .slice(0, n).map((x) => x.p);
}
export function projectTaskStats(p) { const all = p.tasks || []; return { total: all.length, done: all.filter((x) => x.done).length }; }

const byTime = (a, b) => (a.date + (a.time || '99:99')).localeCompare(b.date + (b.time || '99:99'));
/** Группы задач: просрочено, сегодня, завтра, неделя (до +7 дней), позже. Выполненные прошлых дней не показываются. */
export function groupTasks(tasks, today) {
  const tomorrow = addDays(today, 1), weekEnd = addDays(today, 7);
  const g = { overdue: [], today: [], tomorrow: [], week: [], later: [] };
  for (const x of [...tasks].sort(byTime)) {
    if (x.date < today) { if (!x.done) g.overdue.push(x); }
    else if (x.date === today) g.today.push(x);
    else if (x.date === tomorrow) g.tomorrow.push(x);
    else if (x.date <= weekEnd) g.week.push(x);
    else g.later.push(x);
  }
  return g;
}
/** Полоса недели: 7 дней начиная с сегодня, число невыполненных задач в каждом. */
export function weekStrip(tasks, today) {
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDays(today, i);
    const day = tasks.filter((x) => x.date === date);
    return { date, weekday: weekdayShort(date), day: fromISO(date).getDate(), count: day.filter((x) => !x.done).length, total: day.length };
  });
}

export function monthKey(iso) { return iso.slice(0, 7); }
export function sumEntries(entries) { return Math.round(entries.reduce((s, e) => s + (Number(e.amount) || 0), 0) * 100) / 100; }
/** Траты: сегодня, последние 7 дней, текущий месяц, остаток бюджета и сколько можно тратить в день. */
export function financeTotals(entries, today, monthlyBudget = 0) {
  const from7 = addDays(today, -6);
  const today$ = sumEntries(entries.filter((e) => e.date === today));
  const week = sumEntries(entries.filter((e) => e.date >= from7 && e.date <= today));
  const month = sumEntries(entries.filter((e) => monthKey(e.date) === monthKey(today)));
  const dim = daysInMonth(today), dayNo = fromISO(today).getDate();
  const daysLeft = dim - dayNo + 1;
  const remaining = monthlyBudget ? Math.round((monthlyBudget - month) * 100) / 100 : 0;
  const allowance = monthlyBudget ? Math.max(0, Math.floor((monthlyBudget - (month - today$)) / daysLeft)) : 0;
  const dailyBudget = monthlyBudget ? Math.round(monthlyBudget / dim) : 0;
  return { today: today$, week, month, remaining, allowance, dailyBudget, daysLeft };
}

/** Серия подряд идущих дней с отметкой; если сегодня ещё не отмечено, считаем от вчера. */
export function habitStreak(checks, habitId, today) {
  const has = (d) => (checks[d] || []).includes(habitId);
  let d = has(today) ? today : addDays(today, -1), n = 0;
  while (has(d)) { n++; d = addDays(d, -1); }
  return n;
}
export function habitWeek(checks, habitId, today) {
  return Array.from({ length: 7 }, (_, i) => { const date = addDays(today, i - 6); return { date, weekday: weekdayShort(date), on: (checks[date] || []).includes(habitId) }; });
}

/** Итоги дня: задачи, привычки, траты против дневного бюджета. */
export function daySummary({ tasks, habits, checks, entries, today, monthlyBudget = 0 }) {
  const day = tasks.filter((x) => x.date === today);
  const done = day.filter((x) => x.done).length;
  const ids = new Set(habits.map((h) => h.id));
  const hDone = (checks[today] || []).filter((id) => ids.has(id)).length;
  const f = financeTotals(entries, today, monthlyBudget);
  return { total: day.length, done, pct: day.length ? Math.round((done / day.length) * 100) : 0, habitsDone: hDone, habitsTotal: habits.length, spent: f.today, dailyBudget: f.dailyBudget };
}

const WMO = [
  [[0], 'Ясно', '☀️'], [[1], 'Преимущественно ясно', '🌤'], [[2], 'Переменная облачность', '⛅'], [[3], 'Пасмурно', '☁️'],
  [[45, 48], 'Туман', '🌫'], [[51, 53, 55], 'Морось', '🌦'], [[56, 57], 'Ледяная морось', '🌧'],
  [[61], 'Небольшой дождь', '🌦'], [[63], 'Дождь', '🌧'], [[65], 'Сильный дождь', '🌧'], [[66, 67], 'Ледяной дождь', '🌧'],
  [[71, 73, 75], 'Снег', '🌨'], [[77], 'Снежные зёрна', '🌨'], [[80, 81, 82], 'Ливень', '🌧'], [[85, 86], 'Снегопад', '🌨'],
  [[95], 'Гроза', '⛈'], [[96, 99], 'Гроза с градом', '⛈'],
];
/** Код погоды WMO → текст по-русски и значок. */
export function wmoInfo(code) {
  const hit = WMO.find((x) => x[0].includes(Number(code)));
  return hit ? { text: hit[1], icon: hit[2] } : { text: 'Погода неизвестна', icon: '🌡' };
}
export function formatTemp(v) { if (v == null || Number.isNaN(Number(v))) return '—'; const n = Math.round(Number(v)); return (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n) + '°'; }
/** Ответ Open-Meteo → то, что показываем на карточке. */
export function parseWeather(j) {
  if (!j?.current || !j?.daily?.time) return null;
  const d = j.daily, row = (i) => ({ date: d.time[i], min: d.temperature_2m_min[i], max: d.temperature_2m_max[i], code: d.weather_code[i] });
  const m = j.minutely_15;
  const rain = m && Array.isArray(m.time) && Array.isArray(m.precipitation) ? { time: m.time, mm: m.precipitation, offset: Number(j.utc_offset_seconds) || 0 } : null;
  const hm = (v) => (typeof v === 'string' && v.length >= 16 ? v.slice(11, 16) : null);
  return {
    temp: j.current.temperature_2m, code: j.current.weather_code, today: row(0), tomorrow: d.time.length > 1 ? row(1) : null,
    sunrise: hm(d.sunrise && d.sunrise[0]), sunset: hm(d.sunset && d.sunset[0]), rain,
  };
}
export function weatherUrl(lat, lon) {
  return `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset&minutely_15=precipitation&forecast_minutely_15=16&timezone=auto&forecast_days=2`;
}
/** Осадки на ближайшие 2 часа по 15-минутному прогнозу. nowMs — текущее время, offset — сдвиг часового пояса места. */
export function rainNowcast(rain, nowMs) {
  if (!rain || !rain.time || !rain.time.length) return null;
  const local = new Date(nowMs + rain.offset * 1000).toISOString().slice(0, 16);
  const next = rain.time.findIndex((t) => t > local);
  if (next < 0) return null; // прогноз устарел
  const i = Math.max(0, next - 1); // текущий 15-минутный отрезок
  const slots = rain.time.slice(i, i + 8).map((t, k) => ({ t, mm: Number(rain.mm[i + k]) || 0 }));
  if (slots.length < 4) return null;
  const wet = (s) => s.mm >= 0.1;
  const mins = (k) => k * 15;
  const fmt = (m) => (m < 60 ? `${m} мин` : m % 60 ? `${Math.floor(m / 60)} ч ${m % 60} мин` : `${m / 60} ч`);
  if (wet(slots[0])) {
    const end = slots.findIndex((s) => !wet(s));
    return { wet: true, text: end < 0 ? 'Осадки идут и не закончатся в ближайшие 2 часа' : `Осадки сейчас, закончатся примерно через ${fmt(mins(end))}` };
  }
  const start = slots.findIndex(wet);
  return start < 0 ? { wet: false, text: 'Без осадков в ближайшие 2 часа' } : { wet: true, text: `Осадки начнутся примерно через ${fmt(mins(start))}` };
}
/** Погода с сайта Пульта (data/weather.json из GitHub Actions) — только если это тот же город и данные не старше 3 часов. */
export function parseSiteWeather(j, lat, lon, nowMs) {
  if (!j || !j.forecast) return null;
  if (Math.abs(Number(j.lat) - lat) > 0.25 || Math.abs(Number(j.lon) - lon) > 0.25) return null;
  const at = Date.parse(j.fetchedAt) || 0;
  if (!at || nowMs - at > 3 * 3600000) return null;
  const data = parseWeather(j.forecast);
  return data ? { data, air: parseAir(j.air), at } : null;
}
export function airUrl(lat, lon) { return `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&current=european_aqi,pm2_5`; }
/** Европейский индекс качества воздуха → оценка по-русски. */
export function parseAir(j) {
  const v = j && j.current && j.current.european_aqi;
  if (v == null || Number.isNaN(Number(v))) return null;
  const n = Math.round(Number(v));
  const lvl = n <= 20 ? ['хороший', 'ok'] : n <= 40 ? ['нормальный', 'ok'] : n <= 60 ? ['умеренный', 'warn'] : n <= 80 ? ['плохой', 'bad'] : ['очень плохой', 'bad'];
  return { aqi: n, text: lvl[0], level: lvl[1], pm25: j.current.pm2_5 == null ? null : Math.round(Number(j.current.pm2_5)) };
}
/** Запасной источник — wttr.in: его коды погоды (WWO) → коды WMO. */
const WWO = [[[113], 0], [[116], 2], [[119, 122], 3], [[143, 248, 260], 45], [[176, 263, 266, 293, 296, 353], 61],
  [[299, 302, 305, 308, 356, 359], 63], [[200, 386, 389, 392, 395], 95], [[179, 227, 230, 323, 326, 329, 332, 335, 338, 368, 371], 73],
  [[182, 185, 281, 284, 311, 314, 317, 320, 350, 362, 365, 374, 377], 66]];
export function wwoToWmo(code) { const hit = WWO.find((x) => x[0].includes(Number(code))); return hit ? hit[1] : -1; }
export function wttrUrl(lat, lon) { return `https://wttr.in/${lat},${lon}?format=j1`; }
export function parseWttr(j) {
  const c = j?.current_condition?.[0], w = j?.weather;
  if (!c || !w || !w.length) return null;
  const row = (x) => ({ date: x.date, min: Number(x.mintempC), max: Number(x.maxtempC), code: wwoToWmo((x.hourly?.[4] || x.hourly?.[0] || {}).weatherCode) });
  return { temp: Number(c.temp_C), code: wwoToWmo(c.weatherCode), today: row(w[0]), tomorrow: w.length > 1 ? row(w[1]) : null };
}
export function formatMoney(n) { return Math.round(Number(n) || 0).toLocaleString('ru-RU').replace(/ /g, ' ') + ' ₽'; }

/* ---------- Лимиты Claude (из гиста, который обновляет строка состояния Claude Code на ПК) ---------- */
export const CLAUDE_USAGE_FILE = 'claude-usage.json';
const toMs = (t) => { const n = Number(t); if (!n) return null; return n < 1e12 ? n * 1000 : n; };
/** Ответ GitHub API /gists/:id → { session, week, updatedAt } или null. */
export function parseClaudeUsage(gist) {
  const f = gist && gist.files && gist.files[CLAUDE_USAGE_FILE];
  if (!f || !f.content) return null;
  let j; try { j = JSON.parse(f.content); } catch (e) { return null; }
  const win = (w) => (w && w.used_percentage != null ? { pct: Math.max(0, Math.min(100, Math.round(Number(w.used_percentage)))), resetsAt: toMs(w.resets_at) } : null);
  const session = win(j.five_hour), week = win(j.seven_day);
  if (!session && !week) return null;
  return { session, week, updatedAt: toMs(j.updated_at) };
}
const WD = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const hhmm = (d) => String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
/** Время сброса: «в 22:50» сегодня, иначе «Чт 10:00». */
export function formatReset(ms, now) {
  if (!ms) return '';
  const d = new Date(ms), n = now || new Date();
  const same = d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
  return same ? 'в ' + hhmm(d) : WD[d.getDay()] + ' ' + hhmm(d);
}
/** «только что», «5 мин назад», «2 ч назад», «3 дн. назад». */
export function formatAgo(ms, now) {
  if (!ms) return '';
  const m = Math.max(0, Math.round(((now || Date.now()) - ms) / 60000));
  if (m < 1) return 'только что';
  if (m < 60) return m + ' мин назад';
  if (m < 48 * 60) return Math.round(m / 60) + ' ч назад';
  return Math.round(m / 1440) + ' дн. назад';
}

/* ---------- Отсчёты, прогресс периода, цели ---------- */
/** Сколько дней от today до date (ГГГГ-ММ-ДД), отрицательно — уже прошло. */
export function daysUntil(today, date) { return Math.round((fromISO(date) - fromISO(today)) / 86400000); }
export function plural(n, one, few, many) {
  const a = Math.abs(n) % 100, b = a % 10;
  return a > 10 && a < 20 ? many : b === 1 ? one : b >= 2 && b <= 4 ? few : many;
}
export function formatDaysLeft(n) {
  if (n === 0) return 'сегодня';
  if (n === 1) return 'завтра';
  return `через ${n} ${plural(n, 'день', 'дня', 'дней')}`;
}
/** Ближайшие отсчёты: прошедшие убираем, сортируем по дате. */
export function upcomingCountdowns(list, today, n = 3) {
  return (list || []).map((c) => ({ ...c, left: daysUntil(today, c.date) })).filter((c) => c.left >= 0).sort((a, b) => a.left - b.left).slice(0, n);
}
/** Прогресс года, месяца и недели (неделя с понедельника) в процентах. */
export function periodProgress(now) {
  const y = now.getFullYear(), ms = now.getTime();
  const pct = (a, b) => Math.max(0, Math.min(100, Math.floor(((ms - a) / (b - a)) * 100)));
  const wd = (now.getDay() + 6) % 7;
  const w0 = new Date(y, now.getMonth(), now.getDate() - wd).getTime();
  return {
    year: pct(new Date(y, 0, 1).getTime(), new Date(y + 1, 0, 1).getTime()),
    month: pct(new Date(y, now.getMonth(), 1).getTime(), new Date(y, now.getMonth() + 1, 1).getTime()),
    week: pct(w0, new Date(y, now.getMonth(), now.getDate() - wd + 7).getTime()),
  };
}
const MONTHS_NOM = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
/** «ноябрь 2026» для ГГГГ-ММ, «2026 год» для ГГГГ. */
export function periodName(period) {
  if (/^\d{4}-\d{2}$/.test(period)) return `${MONTHS_NOM[Number(period.slice(5)) - 1]} ${period.slice(0, 4)}`;
  return `${period} год`;
}
export const GOAL_STATUS = { done: 'Выполнена', partial: 'Частично', fail: 'Не вышло' };
/** Цели, которые пора оценить: период закончился (или сегодня его последний день), а оценки нет. */
export function goalsToReview(goals, today) {
  const month = today.slice(0, 7), year = today.slice(0, 4);
  const lastDayOfMonth = Number(today.slice(8)) === daysInMonth(today), lastDayOfYear = today.slice(5) === '12-31';
  return (goals || []).filter((g) => {
    if (g.status) return false;
    if (g.period.length === 7) return g.period < month || (g.period === month && lastDayOfMonth);
    return g.period < year || (g.period === year && lastDayOfYear);
  });
}
/** Итог по периоду: сколько целей выполнено, частично, не вышло. */
export function goalsSummary(goals, period) {
  const list = (goals || []).filter((g) => g.period === period);
  const c = { total: list.length, done: 0, partial: 0, fail: 0 };
  for (const g of list) if (c[g.status] != null) c[g.status]++;
  return c;
}

/* ---------- Дневник дня ---------- */
export const MOODS = ['😞', '🙁', '😐', '🙂', '😄'];
/** Оценки дня за последние n дней (старые слева). */
export function moodSeries(journal, today, n = 14) {
  return Array.from({ length: n }, (_, i) => { const date = addDays(today, i - n + 1); const e = journal && journal[date]; return { date, weekday: weekdayShort(date), mood: e && e.mood ? e.mood : 0 }; });
}
export function moodAverage(series) { const v = series.filter((x) => x.mood); return v.length ? Math.round((v.reduce((s, x) => s + x.mood, 0) / v.length) * 10) / 10 : 0; }

/* ---------- Рутины ---------- */
export function routineProgress(steps, checks) { const ids = new Set(checks || []); const done = steps.filter((s) => ids.has(s.id)).length; return { done, total: steps.length }; }

/* ---------- Меню недели ---------- */
export const WEEK_RU = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];
/** Индекс дня недели с понедельника (0) для ГГГГ-ММ-ДД. */
export function weekdayIndex(iso) { return (fromISO(iso).getDay() + 6) % 7; }

/* ---------- Курсы ЦБ ---------- */
export const RATES_URL = 'https://www.cbr-xml-daily.ru/daily_json.js';
/** Ответ cbr-xml-daily.ru → курсы доллара, евро и юаня с изменением. */
export function parseRates(j) {
  const v = j && j.Valute;
  if (!v) return null;
  const one = (code) => { const x = v[code]; if (!x || !x.Value) return null; const nom = Number(x.Nominal) || 1; const val = x.Value / nom, prev = (x.Previous || x.Value) / nom; return { code, value: Math.round(val * 100) / 100, diff: Math.round((val - prev) * 100) / 100 }; };
  const list = ['USD', 'EUR', 'CNY'].map(one).filter(Boolean);
  return list.length ? { date: String(j.Date || '').slice(0, 10), list } : null;
}
export function formatRate(n) { return Number(n).toFixed(2).replace('.', ','); }

/* ---------- Новости ---------- */
// Ленты собирает GitHub Actions (scripts/fetch-news.mjs) в data/news.json на сайте Пульта.
export const NEWS_TOPICS = [['ai', 'ИИ и Claude'], ['github', 'GitHub: ИИ'], ['aianim', 'ИИ-анимация'], ['print3d', '3D-печать и ИИ'], ['russia', 'Россия'], ['sochi', 'Сочи'], ['tech', 'Технологии'], ['games', 'Игры'], ['creators', 'Блогеры']];
/** Сколько часов держать новость темы (по умолчанию 48): у редких тем окно шире. */
export const NEWS_MAX_AGE_H = { github: 7 * 24, aianim: 7 * 24, print3d: 7 * 24 };
const gnews = (q) => `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=ru&gl=RU&ceid=RU:ru`;
const gnewsEn = (q) => `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
// google: заголовок «Текст - Источник»; yt: YouTube-канал по @имени (ID канала ищется при сборке);
// github: поиск новых репозиториев на GitHub за неделю, по звёздам.
export const NEWS_FEEDS = [
  { topic: 'ai', source: 'Google Новости', url: gnews('Claude OR Anthropic when:2d'), google: true },
  { topic: 'ai', source: 'Google News', url: gnewsEn('Claude Anthropic when:2d'), google: true },
  { topic: 'ai', source: 'Google Новости', url: gnews('нейросеть OR "искусственный интеллект" when:1d'), google: true },
  { topic: 'ai', source: 'Хабр: ИИ', url: 'https://habr.com/ru/rss/hubs/artificial_intelligence/articles/?fl=ru' },
  { topic: 'github', source: 'GitHub', github: 'llm OR ai OR agent OR claude OR mcp' },
  { topic: 'github', source: 'GitHub', github: 'claude OR claude-code OR anthropic' },
  { topic: 'github', source: 'GitHub Blog', url: 'https://github.blog/ai-and-ml/feed/' },
  { topic: 'aianim', source: 'Curious Refuge', yt: '@curiousrefuge' },
  { topic: 'aianim', source: 'Theoretically Media', yt: '@TheoreticallyMedia' },
  { topic: 'aianim', source: 'Google Новости', url: gnews('ИИ анимация OR нейросеть мультфильм when:7d'), google: true },
  { topic: 'aianim', source: 'Google News', url: gnewsEn('"AI animation" OR "AI video generator" when:3d'), google: true },
  { topic: 'print3d', source: 'Google Новости', url: gnews('3D-печать нейросеть OR ИИ when:7d'), google: true },
  { topic: 'print3d', source: 'Google News', url: gnewsEn('"3D printing" AI when:7d'), google: true },
  { topic: 'russia', source: 'Лента.ру', url: 'https://lenta.ru/rss/news' },
  { topic: 'russia', source: 'РБК', url: 'https://rssexport.rbc.ru/rbcnews/news/30/full.rss' },
  { topic: 'russia', source: 'ТАСС', url: 'https://tass.ru/rss/v2.xml' },
  { topic: 'russia', source: 'Интерфакс', url: 'https://www.interfax.ru/rss.asp' },
  { topic: 'sochi', source: 'Google Новости', url: gnews('Сочи when:2d'), google: true },
  { topic: 'tech', source: 'Хабр', url: 'https://habr.com/ru/rss/news/?fl=ru' },
  { topic: 'tech', source: '3DNews', url: 'https://3dnews.ru/news/rss/' },
  { topic: 'tech', source: 'iXBT', url: 'https://www.ixbt.com/export/news.rss' },
  { topic: 'games', source: 'StopGame', url: 'https://stopgame.ru/rss/rss_news.xml' },
  { topic: 'games', source: 'DTF', url: 'https://dtf.ru/rss/all' },
  { topic: 'games', source: 'Google Новости', url: gnews('Dota 2 when:2d'), google: true },
  { topic: 'creators', source: 'Google Новости', url: gnews('YouTube OR Twitch блогеры when:2d'), google: true },
  { topic: 'aianim', source: 'Cartoon Brew', url: 'https://www.cartoonbrew.com/feed' },
];

/** Проверка news.json с сайта: только список с заголовком и ссылкой http(s). */
export function parseSiteNews(j) {
  if (!j || !Array.isArray(j.items)) return null;
  const items = j.items.filter((x) => x && typeof x.title === 'string' && /^https?:\/\//.test(x.link || '') && typeof x.topic === 'string');
  return items.length ? { fetchedAt: j.fetchedAt || null, items } : null;
}
/** Новости выбранной темы ('all' — все, кроме скрытых тем). */
export function newsFor(items, topic, hidden = []) {
  return (items || []).filter((x) => (topic === 'all' ? !hidden.includes(x.topic) : x.topic === topic));
}
/** «5 мин назад», «3 ч назад», «вчера», «12 ноя». */
export function timeAgoRu(iso, now = Date.now()) {
  const t = Date.parse(iso); if (!Number.isFinite(t)) return '';
  const min = Math.max(0, Math.floor((now - t) / 60000));
  if (min < 1) return 'только что';
  if (min < 60) return `${min} мин назад`;
  if (min < 24 * 60) return `${Math.floor(min / 60)} ч назад`;
  const d = new Date(t), y = new Date(now); y.setDate(y.getDate() - 1);
  if (isoDate(d) === isoDate(y)) return 'вчера';
  return formatShortRu(isoDate(d));
}
/** Отметка «изучить позже»: добавляет копию новости в начало списка или снимает её (ключ — ссылка). */
export function toggleSavedNews(list, x, now = Date.now()) {
  const l = Array.isArray(list) ? list : [];
  if (l.some((s) => s.link === x.link)) return l.filter((s) => s.link !== x.link);
  return [{ link: x.link, title: x.title, source: x.source || '', topic: x.topic || '', date: x.date || '', desc: x.desc || '', savedAt: new Date(now).toISOString(), done: false }, ...l];
}
/** Список «На потом»: сначала неизученные (новые отметки сверху), изученные в конце. */
export function sortSavedNews(list) {
  return [...(list || [])].sort((a, b) => (a.done - b.done) || (Date.parse(b.savedAt) - Date.parse(a.savedAt)));
}
