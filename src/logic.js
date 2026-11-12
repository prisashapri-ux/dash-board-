// Чистая логика «Пульта»: без доступа к DOM и сети, чтобы её можно было проверять тестами.

export const STAGES = ['Идея', 'План', 'В работе', 'Проверка', 'Готово'];
export const CATEGORIES = ['Еда', 'Кафе', 'Дом', 'Транспорт', 'Здоровье', 'Развлечения', 'Проекты', 'Другое'];
export const DEFAULT_HABITS = ['Зал', 'Прогулка с собаками', 'Вода', 'Сон 8 ч'];
export const DEFAULT_SETTINGS = {
  city: 'Сочи', lat: 43.585, lon: 39.72,
  morningFrom: 5, dayFrom: 12, eveningFrom: 18,
  night: 'auto', mode: 'auto', twitch: '', youtube: '',
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
  return { temp: j.current.temperature_2m, code: j.current.weather_code, today: row(0), tomorrow: d.time.length > 1 ? row(1) : null };
}
export function weatherUrl(lat, lon) {
  return `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=2`;
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
