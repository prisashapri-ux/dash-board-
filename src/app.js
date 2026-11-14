import * as L from './logic.js';
import { loadState, saveState, flush, persist, saveSnapshot, loadPhotos, savePhotos } from './store.js';
import { setKeepAwake } from './awake.js';

const VERSION = new URL(import.meta.url).searchParams.get('v') || 'dev';
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const todayISO = () => L.isoDate(new Date());

function defaults() {
  return {
    v: 1, tasks: [], notes: [],
    habits: { list: L.DEFAULT_HABITS.map((name, i) => ({ id: 'h' + (i + 1), name })), checks: {} },
    finance: { entries: [], budget: 0 },
    settings: { ...L.DEFAULT_SETTINGS },
    projects: [], remote: { updated: null, projects: [] }, weather: null, claude: null,
    goals: [], countdowns: [], journal: {}, shopping: [], menu: ['', '', '', '', '', '', ''], rates: null, news: null, savedNews: [], schedule: null,
    routines: { morning: L.DEFAULT_ROUTINES.morning.map((title, i) => ({ id: 'rm' + (i + 1), title })), evening: L.DEFAULT_ROUTINES.evening.map((title, i) => ({ id: 're' + (i + 1), title })), checks: {} },
  };
}
let S = defaults();
const ui = { schDay: '', newsTopic: 'all', nwState: '', tab: 'home', more: 'habits', noteQuery: '', modal: null, addDate: null, habitEdit: false, routineEdit: false, cityResults: null, wxState: '', lastKey: '', photos: [], ambient: false, lastTouch: Date.now() };

function normalize(raw) {
  const d = defaults();
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    ...d, ...r,
    tasks: Array.isArray(r.tasks) ? r.tasks : [], notes: Array.isArray(r.notes) ? r.notes : [],
    habits: { list: Array.isArray(r.habits?.list) ? r.habits.list : d.habits.list, checks: r.habits?.checks || {} },
    finance: { entries: Array.isArray(r.finance?.entries) ? r.finance.entries : [], budget: Number(r.finance?.budget) || 0 },
    settings: { ...d.settings, ...(r.settings || {}), newsHidden: Array.isArray(r.settings?.newsHidden) ? r.settings.newsHidden : [] },
    projects: Array.isArray(r.projects) ? r.projects : [],
    remote: r.remote?.projects ? r.remote : d.remote,
    goals: Array.isArray(r.goals) ? r.goals : [], countdowns: Array.isArray(r.countdowns) ? r.countdowns : [],
    journal: r.journal && typeof r.journal === 'object' ? r.journal : {}, shopping: Array.isArray(r.shopping) ? r.shopping : [],
    menu: Array.isArray(r.menu) && r.menu.length === 7 ? r.menu : d.menu,
    savedNews: Array.isArray(r.savedNews) ? r.savedNews.filter((x) => x && /^https?:\/\//.test(x.link || '')) : [],
    routines: { morning: Array.isArray(r.routines?.morning) ? r.routines.morning : d.routines.morning, evening: Array.isArray(r.routines?.evening) ? r.routines.evening : d.routines.evening, checks: r.routines?.checks || {} },
  };
}
const save = () => saveState(S);
const projects = () => L.mergeProjects(S.remote.projects, S.projects);
const projectById = (id) => projects().find((p) => p.id === id);
const hour = () => new Date().getHours();
const mode = () => L.effectiveMode(S.settings, hour());

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 2600);
}
window.addEventListener('pult-save-failed', () => toast('Не удалось сохранить: нет места в браузере'));

/* ---------- общие кусочки ---------- */
function taskRow(t, opts = {}) {
  const today = todayISO();
  const p = t.projectId ? projectById(t.projectId) : null;
  const late = !t.done && t.date < today;
  return `<div class="item ${t.done ? 'done' : ''}"><button class="chk ${t.done ? 'on' : ''}" data-act="toggle-task" data-id="${esc(t.id)}" aria-label="Отметить"></button>
<button class="ttl" data-act="edit-task" data-id="${esc(t.id)}">${esc(t.title)}${t.time ? `<span class="chip">${esc(t.time)}</span>` : ''}${p ? `<span class="chip">${esc(p.emoji)} ${esc(p.name.slice(0, 22))}</span>` : ''}${opts.date || late ? `<span class="chip ${late ? 'bad' : ''}">${L.formatShortRu(t.date)}</span>` : ''}</button></div>`;
}
const taskList = (list, opts) => (list.length ? list.map((t) => taskRow(t, opts)).join('') : '<div class="empty">Пока пусто</div>');
function quickTask(date, ph) {
  return `<form data-form="quick-task" data-date="${date}" class="addrow"><input class="wide" name="title" placeholder="${esc(ph)}" autocomplete="off" required><button class="btn primary">Добавить</button></form>`;
}
function ring(pct) {
  const c = 2 * Math.PI * 40;
  return `<div class="ring"><svg width="96" height="96" viewBox="0 0 96 96"><circle cx="48" cy="48" r="40" fill="none" stroke="var(--line)" stroke-width="10"/><circle cx="48" cy="48" r="40" fill="none" stroke="var(--accent2)" stroke-width="10" stroke-linecap="round" stroke-dasharray="${(c * pct / 100).toFixed(1)} ${c.toFixed(1)}"/></svg><b>${pct}%</b></div>`;
}
const stageBar = (stage) => `<div class="steps" title="${esc(stage)}">${L.STAGES.map((s, i) => `<i class="${i <= L.STAGES.indexOf(stage) ? 'on' : ''}"></i>`).join('')}</div>`;
const money = L.formatMoney;

/* ---------- Главная ---------- */
function weatherCard() {
  const w = S.weather, d = w?.data;
  const refresh = '<button class="btn small ghost" data-act="weather-refresh">Обновить</button>';
  if (!d) return `<section class="card"><h3>Погода</h3><p class="muted">${esc(S.settings.city)}: данных пока нет. ${ui.wxState === 'loading' ? 'Загружаю…' : 'Нет сети или сервис не ответил.'}</p>${ui.wxError ? `<p class="muted tiny">${esc(ui.wxError)}</p>` : ''}${refresh}</section>`;
  const info = L.wmoInfo(d.code), tm = d.tomorrow ? L.wmoInfo(d.tomorrow.code) : null;
  const at = new Date(w.at);
  return `<section class="card"><div class="row space"><h3>Погода · ${esc(S.settings.city)}</h3>${refresh}</div>
<div class="row"><span class="wx-ic">${info.icon}</span><div><div class="wx-t">${L.formatTemp(d.temp)}</div><div>${esc(info.text)}</div></div></div>
<div class="kv" style="margin-top:10px"><span>Сегодня</span><span>${L.formatTemp(d.today.min)} … ${L.formatTemp(d.today.max)} · ${esc(L.wmoInfo(d.today.code).text)}</span></div>
${tm ? `<div class="kv"><span>Завтра</span><span>${L.formatTemp(d.tomorrow.min)} … ${L.formatTemp(d.tomorrow.max)} · ${esc(tm.text)}</span></div>` : ''}
${wxExtras(w)}<div class="muted tiny">Обновлено в ${L.formatTime(at)}${ui.wxState === 'fail' ? ' · сейчас нет сети, показаны прошлые данные' : ''}</div></section>`;
}
function wxExtras(w) {
  const d = w.data, nc = L.rainNowcast(d.rain, Date.now()), air = w.air;
  let out = '';
  if (nc) out += `<div class="kv"><span>${nc.wet ? '☔' : '🌂'} 2 часа</span><span class="${nc.wet ? 'warnt' : ''}">${esc(nc.text)}</span></div>`;
  if (d.sunrise || d.sunset) out += `<div class="kv"><span>Солнце</span><span>↑ ${esc(d.sunrise || '—')} · ↓ ${esc(d.sunset || '—')}</span></div>`;
  if (air) out += `<div class="kv"><span>Воздух</span><span class="${air.level === 'bad' ? 'badt' : air.level === 'warn' ? 'warnt' : ''}">${esc(air.text)} (${air.aqi})${air.pm25 != null ? ` · PM2.5 ${air.pm25}` : ''}</span></div>`;
  return out;
}
function claudeCard() {
  if (!S.settings.claudeGist) return '';
  const c = S.claude, now = new Date();
  const bar = (title, w, resetLbl) => `<div class="grow climit"><div class="row space"><b>${title}</b><span class="muted">${w ? 'Использовано: ' + w.pct + '%' : '—'}</span></div><div class="bar big"><span style="width:${w ? w.pct : 0}%;${w && w.pct >= 90 ? 'background:var(--bad)' : w && w.pct >= 70 ? 'background:var(--warn)' : ''}"></span></div><div class="muted tiny">${w && w.resetsAt ? (w.resetsAt < now.getTime() ? 'Уже сбросился' : resetLbl + ' ' + L.formatReset(w.resetsAt, now)) : ''}</div></div>`;
  const foot = c ? `Обновлено ${L.formatAgo(c.updatedAt || c.at, now.getTime())}${ui.clState === 'fail' ? ' · сейчас нет связи с GitHub' : ''}` : (ui.clState === 'fail' ? 'Не удалось загрузить. Проверь ID гиста в настройках.' : 'Загружаю…');
  return `<section class="card"><div class="row space"><h3>Лимиты Claude</h3><button class="btn small ghost" data-act="claude-refresh">Обновить</button></div><div class="row wrap gap">${bar('Текущая сессия', c && c.session, 'Сбросится')}${bar('Все модели за неделю', c && c.week, 'Следующий сброс:')}</div><div class="muted tiny">${esc(foot)}</div></section>`;
}
function projectsNext() {
  const top = L.topProjects(projects(), 3);
  return `<section class="card"><h2>Главные проекты</h2>${top.map((p) => `<div class="item"><div class="grow"><div>${esc(p.emoji)} <b>${esc(p.name)}</b></div><div class="muted">Дальше: ${esc(p.next || '—')}</div></div><span class="chip">${p.progress}%</span></div>`).join('') || '<div class="empty">Нет активных проектов</div>'}</section>`;
}
function projectsSummary() {
  return `<section class="card"><h2>Проекты</h2>${projects().map((p) => `<div class="item"><span style="font-size:22px;margin-right:10px">${esc(p.emoji)}</span><div class="grow">${esc(p.name)}<div class="bar"><span style="width:${p.progress}%"></span></div></div><span class="chip">${p.progress}%</span></div>`).join('')}</section>`;
}
function homeView() {
  const now = new Date(), today = todayISO(), tomorrow = L.addDays(today, 1), m = mode();
  const g = L.groupTasks(S.tasks, today);
  const seg = ['auto', 'morning', 'day', 'evening'].map((k, i) => `<button class="${S.settings.mode === k ? 'on' : ''}" data-act="mode" data-mode="${k}">${['Авто', 'Утро', 'День', 'Вечер'][i]}</button>`).join('');
  let out = `<div class="grid2"><section class="card"><div class="clock" id="clock">${L.formatTime(now)}</div><div class="date" id="date">${esc(L.formatDateRu(now))}</div><div class="muted tiny" style="margin-top:8px">Режим: ${{ morning: 'утро', day: 'день', evening: 'вечер' }[m]}${S.settings.mode === 'auto' ? ' (по времени)' : ' (вручную)'}</div></section>${weatherCard()}</div><div class="seg">${seg}</div>${claudeCard()}`;
  const todayCard = `<section class="card"><h2>Сегодня</h2>${g.overdue.length ? `<div class="chip bad">Просрочено: ${g.overdue.length}</div>${taskList(g.overdue)}` : ''}${taskList(g.today)}${quickTask(today, '+ задача на сегодня')}</section>`;
  out = reviewCard() + out + shiftCard();
  if (m === 'morning') out += `<div class="grid2">${todayCard}${projectsNext()}</div><div class="grid2">${routineCard('morning')}${timeCard()}</div>${newsCard()}`;
  else if (m === 'day') out += `<div class="grid2">${todayCard}${projectsSummary()}</div><div class="grid2">${timeCard()}${ratesCard(true)}</div>`;
  else {
    const s = L.daySummary({ tasks: S.tasks, habits: S.habits.list, checks: S.habits.checks, entries: S.finance.entries, today, monthlyBudget: S.finance.budget });
    out += `<div class="grid2"><section class="card"><h2>Итоги дня</h2><div class="row">${ring(s.pct)}<div class="grow">
<div class="stat">Задачи: <b>${s.done} из ${s.total}</b></div><div class="stat">Привычки: <b>${s.habitsDone} из ${s.habitsTotal}</b></div>
<div class="stat">Потрачено: <b>${money(s.spent)}</b>${s.dailyBudget ? ` из ${money(s.dailyBudget)} в день` : ' <span class="muted">(бюджет не задан)</span>'}</div></div></div></section>
<section class="card"><h2>Завтра</h2>${taskList(g.tomorrow)}${quickTask(tomorrow, '+ задача на завтра')}</section></div>
<div class="grid2">${journalCard()}${routineCard('evening')}</div>
<section class="card"><h2>Заметка</h2><form data-form="quick-note" class="addrow"><input class="wide" name="text" placeholder="+ заметка" autocomplete="off" required><button class="btn primary">Сохранить</button></form></section>`;
  }
  return out;
}

function timeCard() {
  const now = new Date(), today = todayISO(), p = L.periodProgress(now);
  const bar = (t, v) => `<div class="pp"><div class="row space"><span>${t}</span><span class="muted">${v}%</span></div><div class="bar"><span style="width:${v}%"></span></div></div>`;
  const cds = L.upcomingCountdowns(S.countdowns, today, 3);
  const month = today.slice(0, 7), goals = S.goals.filter((g) => g.period === month);
  return `<section class="card"><div class="row space"><h2>Время и цели</h2><button class="btn small ghost" data-act="go-more" data-k="goals">Изменить</button></div>
${bar('Год ' + now.getFullYear(), p.year)}${bar('Месяц', p.month)}${bar('Неделя', p.week)}
${cds.length ? cds.map((c) => `<div class="kv"><span>${esc(c.title)}</span><b>${L.formatDaysLeft(c.left)}</b></div>`).join('') : '<div class="muted tiny" style="margin-top:6px">Отсчётов нет. Добавь дату в «Ещё → Цели».</div>'}
${goals.length ? `<div class="muted tiny" style="margin-top:8px">Цели на ${esc(L.periodName(month))}: ${goals.filter((g) => g.status === 'done').length} из ${goals.length}</div>${goals.map((g) => `<div class="item"><button class="chk ${g.status === 'done' ? 'on' : ''}" data-act="goal-toggle" data-id="${esc(g.id)}" aria-label="Отметить"></button><div class="ttl">${esc(g.title)}</div></div>`).join('')}` : ''}</section>`;
}
function reviewCard() {
  const list = L.goalsToReview(S.goals, todayISO());
  if (!list.length) return '';
  const periods = [...new Set(list.map((g) => g.period))];
  return `<section class="card accentcard"><h2>Подведи итоги: ${esc(periods.map(L.periodName).join(', '))}</h2><p class="muted">Как получилось с каждой целью?</p>
${list.map((g) => `<div class="goalrow"><div class="grow"><b>${esc(g.title)}</b> <span class="muted tiny">${esc(L.periodName(g.period))}</span></div><div class="row gap">${Object.entries(L.GOAL_STATUS).map(([k, t]) => `<button class="btn small" data-act="goal-status" data-id="${esc(g.id)}" data-s="${k}">${t}</button>`).join('')}</div></div>`).join('')}</section>`;
}
function routineCard(kind) {
  const steps = S.routines[kind], today = todayISO(), checks = (S.routines.checks[today] || {})[kind] || [];
  const pr = L.routineProgress(steps, checks);
  return `<section class="card"><div class="row space"><h2>${kind === 'morning' ? 'Утренняя рутина' : 'Вечерняя рутина'}</h2><span class="chip">${pr.done} из ${pr.total}</span></div>
${steps.map((st, i) => { const on = checks.includes(st.id); return `<div class="item ${on ? 'done' : ''}"><button class="chk ${on ? 'on' : ''}" data-act="routine-toggle" data-kind="${kind}" data-id="${esc(st.id)}" aria-label="Отметить"></button><div class="ttl"><span class="muted">${i + 1}.</span> ${esc(st.title)}</div></div>`; }).join('') || '<div class="empty">Шагов нет. Добавь их в «Ещё → Рутины».</div>'}</section>`;
}
function journalCard() {
  const today = todayISO(), e = S.journal[today] || {}, series = L.moodSeries(S.journal, today, 14), avg = L.moodAverage(series);
  return `<section class="card"><h2>Как прошёл день</h2><div class="moods">${L.MOODS.map((m, i) => `<button class="${e.mood === i + 1 ? 'on' : ''}" data-act="mood" data-v="${i + 1}" aria-label="Оценка ${i + 1}">${m}</button>`).join('')}</div>
<form data-form="journal"><label class="lbl">Что получилось сегодня?</label><input name="good" value="${esc(e.good || '')}" autocomplete="off" placeholder="Одна вещь, которой доволен">
<label class="lbl">За что спасибо?</label><input name="thanks" value="${esc(e.thanks || '')}" autocomplete="off" placeholder="Человек, момент, мелочь"><div style="margin-top:8px"><button class="btn primary">Сохранить</button></div></form>
<div class="moodbars">${series.map((x) => `<div class="mb ${x.date === today ? 'today' : ''}"><i style="height:${x.mood ? 8 + x.mood * 8 : 3}px" class="${x.mood ? 'm' + x.mood : ''}"></i><span>${x.weekday}</span></div>`).join('')}</div>
<div class="muted tiny">${avg ? `Средняя оценка за 2 недели: ${String(avg).replace('.', ',')} из 5` : 'Оценки появятся здесь'}</div></section>`;
}
function ratesCard(compact) {
  const r = S.rates && S.rates.data;
  const body = r ? r.list.map((x) => `<div class="kv"><span>${{ USD: '$ Доллар', EUR: '€ Евро', CNY: '¥ Юань' }[x.code]}</span><span><b>${L.formatRate(x.value)} ₽</b> <span class="${x.diff > 0 ? 'badt' : x.diff < 0 ? 'okt' : 'muted'} tiny">${x.diff > 0 ? '▲' : x.diff < 0 ? '▼' : ''}${x.diff ? L.formatRate(Math.abs(x.diff)) : '0'}</span></span></div>`).join('') + `<div class="muted tiny">Курс ЦБ на ${esc(L.formatShortRu(r.date || todayISO()))}${ui.rtState === 'fail' ? ' · сейчас нет сети' : ''}</div>`
    : `<p class="muted">${ui.rtState === 'fail' ? 'Не удалось загрузить курсы.' : 'Загружаю…'}</p>`;
  return `<section class="card"><div class="row space"><h2>${compact ? 'Курсы ЦБ' : 'Курсы валют'}</h2><button class="btn small ghost" data-act="rates-refresh">Обновить</button></div>${body}</section>`;
}

/* ---------- Новости ---------- */
const topicName = (k) => (L.NEWS_TOPICS.find((t) => t[0] === k) || [k, ''])[1];
const isSaved = (link) => S.savedNews.some((s) => s.link === link);
function newsItem(x, short) {
  const on = isSaved(x.link);
  return `<div class="newsrow"><a class="news" href="${esc(x.link)}" target="_blank" rel="noopener noreferrer"><span class="nt">${esc(x.title)}</span>${!short && x.desc ? `<span class="nd">${esc(x.desc)}</span>` : ''}<span class="nm">${esc(x.source)} · ${esc(L.timeAgoRu(x.date))}${(ui.newsTopic === 'all' || short) && topicName(x.topic) ? ` · ${esc(topicName(x.topic))}` : ''}</span></a><button class="bm ${on ? 'on' : ''}" data-act="news-save" data-link="${esc(x.link)}" aria-label="${on ? 'Убрать из «На потом»' : 'Изучить позже'}">${on ? '★' : '☆'}</button></div>`;
}
function savedItem(x) {
  return `<div class="newsrow ${x.done ? 'done' : ''}"><button class="chk ${x.done ? 'on' : ''}" data-act="saved-done" data-link="${esc(x.link)}" aria-label="Изучено"></button><a class="news" href="${esc(x.link)}" target="_blank" rel="noopener noreferrer"><span class="nt">${esc(x.title)}</span>${x.desc ? `<span class="nd">${esc(x.desc)}</span>` : ''}<span class="nm">${esc(x.source)}${topicName(x.topic) ? ' · ' + esc(topicName(x.topic)) : ''} · отложено ${esc(L.timeAgoRu(x.savedAt))}</span></a><button class="bm" data-act="saved-del" data-link="${esc(x.link)}" aria-label="Удалить">✕</button></div>`;
}
function savedView() {
  const l = L.sortSavedNews(S.savedNews), left = l.filter((x) => !x.done).length;
  return `<section class="card"><div class="row space"><h2>На потом: ${left}</h2>${l.length > left ? '<button class="btn small ghost" data-act="saved-clear">Убрать изученные</button>' : ''}</div>
${l.length ? l.map(savedItem).join('') : '<div class="empty">Пока пусто. Нажми ☆ рядом с новостью, чтобы отложить её для подробного изучения.</div>'}
<p class="muted tiny" style="margin-top:8px">Отметки хранятся на этом устройстве и входят в резервную копию.</p></section>`;
}
function newsStatus() {
  const n = S.news;
  if (!n) return ui.nwState === 'fail' ? 'Не удалось загрузить новости. Проверь интернет.' : 'Загружаю…';
  return `Собраны ${esc(L.timeAgoRu(n.fetchedAt || new Date(n.at).toISOString()))}${ui.nwState === 'fail' ? ' · сейчас нет сети' : ''}`;
}
function newsCard() {
  const list = L.newsFor(S.news && S.news.items, 'all', S.settings.newsHidden).slice(0, 5);
  return `<section class="card"><div class="row space"><h2>Новости</h2><button class="btn small ghost" data-act="go-news">Все новости</button></div>${list.length ? list.map((x) => newsItem(x, true)).join('') : `<p class="muted">${newsStatus()}</p>`}</section>`;
}
function newsView() {
  const hidden = S.settings.newsHidden, left = S.savedNews.filter((x) => !x.done).length;
  const topics = [['saved', `★ На потом${left ? ' (' + left + ')' : ''}`], ['all', 'Все'], ...L.NEWS_TOPICS];
  const seg = `<div class="seg wrap">${topics.map(([k, t]) => `<button class="${ui.newsTopic === k ? 'on' : ''}" data-act="news-topic" data-k="${k}">${t}</button>`).join('')}</div>`;
  if (ui.newsTopic === 'saved') return seg + savedView();
  const list = L.newsFor(S.news && S.news.items, ui.newsTopic, hidden);
  return `${seg}
<section class="card"><div class="row space"><span class="muted tiny">${newsStatus()}</span><button class="btn small ghost" data-act="news-refresh">Обновить</button></div>
${list.length ? list.map((x) => newsItem(x, false)).join('') : S.news ? '<div class="empty">В этой теме пока нет свежих новостей.</div>' : ''}</section>
<section class="card"><h2>Темы во вкладке «Все»</h2><p class="muted tiny">Нажми, чтобы скрыть тему из общей ленты и с главной. Отдельной кнопкой она остаётся.</p><div class="row wrap gap">${L.NEWS_TOPICS.map(([k, t]) => `<button class="btn small ${hidden.includes(k) ? '' : 'primary'}" data-act="news-hide" data-k="${k}">${hidden.includes(k) ? '' : '✓ '}${t}</button>`).join('')}</div></section>`;
}

/* ---------- Проекты ---------- */
function projectsView() {
  return `<div class="pgrid">${projects().map((p) => {
    const st = L.projectTaskStats(p);
    return `<button class="pcard" data-act="open-project" data-id="${esc(p.id)}"><div class="row"><span class="em">${esc(p.emoji)}</span><div class="grow"><div class="pname">${esc(p.name)}</div>${p.subtitle ? `<div class="psub">${esc(p.subtitle)}</div>` : ''}</div><b>${p.progress}%</b></div>
${stageBar(p.stage)}<div class="row space tiny muted"><span>${esc(p.stage)}</span><span>Задач: ${st.done}/${st.total}</span></div>
<div class="bar"><span style="width:${p.progress}%"></span></div>
<div>Дальше: <b>${esc(p.next || '—')}</b></div>${p.deadline ? `<div class="muted tiny">Дедлайн: ${L.formatShortRu(p.deadline)}</div>` : ''}</button>`;
  }).join('')}</div>`;
}
/** Кнопка с датой: настоящий выбор даты лежит прозрачно поверх, так на iPad открывается родное колесо дат. */
function dateBtn(attr, value, empty, cls = '') {
  return `<label class="datebtn ${cls} ${value ? 'has' : ''}"><span>📅 ${value ? L.formatShortRu(value) : esc(empty)}</span><input type="date" ${attr} value="${esc(value || '')}"></label>`;
}
function projectModal(p) {
  const done = p.tasks.filter((t) => t.done).length, today = todayISO();
  const tasks = [...p.tasks].sort((a, b) => (a.done ? 1 : 0) - (b.done ? 1 : 0));
  return `<div class="sheet psheet"><div class="sheet-head"><button class="btn back" data-act="close-modal" aria-label="Назад">‹ Назад</button><div class="grow"><h2>${esc(p.emoji)} ${esc(p.name)}</h2>${p.subtitle ? `<div class="muted">${esc(p.subtitle)}</div>` : ''}</div><button class="btn" data-act="close-modal">Готово</button></div>
<div class="sheet-body">
<label class="lbl">Этап</label><div class="seg stages">${L.STAGES.map((s) => `<button class="${s === p.stage ? 'on' : ''}" data-act="p-stage" data-v="${esc(s)}">${esc(s)}</button>`).join('')}</div>
<label class="lbl">Прогресс</label><div class="progrow"><button class="btn big-btn" data-act="p-prog" data-d="-10" aria-label="Меньше на 10">−</button><div class="grow"><div class="progval">${p.progress}%</div><div class="bar big"><span style="width:${p.progress}%"></span></div></div><button class="btn big-btn" data-act="p-prog" data-d="10" aria-label="Больше на 10">+</button></div>
<div class="chips">${[0, 25, 50, 75, 100].map((v) => `<button class="chipbtn ${p.progress === v ? 'on' : ''}" data-act="p-prog-set" data-v="${v}">${v}%</button>`).join('')}</div>
<label class="lbl">Следующий шаг</label><input data-pfield="next" value="${esc(p.next)}" autocomplete="off" placeholder="Что сделать дальше">
<label class="lbl">Дедлайн</label><div class="row gap">${dateBtn('data-pfield="deadline"', p.deadline, 'Без дедлайна')}${p.deadline ? `<button class="btn ghost" data-act="p-deadline-clear">Убрать</button><span class="muted">${(() => { const n = L.daysUntil(today, p.deadline); return n < 0 ? 'просрочен' : L.formatDaysLeft(n); })()}</span>` : ''}</div>
<div class="row space" style="margin-top:18px"><h2 style="margin:0">Задачи</h2><span class="chip">${done} из ${p.tasks.length}</span></div>
<div class="bar"><span style="width:${p.tasks.length ? Math.round((done / p.tasks.length) * 100) : 0}%"></span></div>
${tasks.map((t) => { const late = !t.done && t.due && t.due < today; return `<div class="item ptask ${t.done ? 'done' : ''}"><button class="chk ${t.done ? 'on' : ''}" data-act="toggle-ptask" data-id="${esc(t.id)}" aria-label="Отметить"></button><button class="ttl" data-act="toggle-ptask" data-id="${esc(t.id)}">${esc(t.title)}</button>
${dateBtn(`data-ptask-due="${esc(t.id)}"`, t.due, 'срок', 'small' + (late ? ' late' : ''))}<button class="btn ghost danger xbtn" data-act="del-ptask" data-id="${esc(t.id)}" aria-label="Удалить">✕</button></div>`; }).join('') || '<div class="empty">Задач нет</div>'}
<form data-form="add-ptask" class="addrow" style="margin-top:10px"><input class="wide" name="title" placeholder="Новая задача проекта" autocomplete="off" required><button class="btn primary">Добавить</button></form>
${p.note ? `<p class="muted">${esc(p.note)}</p>` : ''}<p class="muted tiny">Изменено: ${esc(String(p.updated || '').slice(0, 16).replace('T', ' '))}</p></div></div>`;
}

/* ---------- Задачи ---------- */
function projectOptions(sel) { return `<option value="">Без проекта</option>${projects().map((p) => `<option value="${esc(p.id)}" ${p.id === sel ? 'selected' : ''}>${esc(p.emoji)} ${esc(p.name)}</option>`).join('')}`; }
function tasksView() {
  const today = todayISO(), g = L.groupTasks(S.tasks, today), strip = L.weekStrip(S.tasks, today), sel = ui.addDate || today;
  const grp = (title, list, opts, always = true) => (always || list.length ? `<section class="card"><h2>${title}${list.length ? ` · ${list.length}` : ''}</h2>${taskList(list, opts)}</section>` : '');
  return `<div class="strip">${strip.map((d) => `<button class="${d.date === sel ? 'on' : ''}" data-act="strip-day" data-date="${d.date}"><span class="wd">${d.weekday}</span><span class="dn">${d.day}</span><span class="cn ${d.count ? 'has' : ''}">${d.count}</span></button>`).join('')}</div>
<section class="card"><form data-form="add-task"><div class="addrow"><input class="wide" name="title" placeholder="Новая задача" autocomplete="off" required></div>
<div class="addrow"><input type="date" name="date" value="${sel}" required><input type="time" name="time"><select name="projectId">${projectOptions('')}</select><button class="btn primary">Добавить</button></div></form></section>
<div class="grid2"><div>${grp('Просрочено', g.overdue, { date: true }, false)}${grp('Сегодня', g.today)}${grp('Завтра', g.tomorrow)}</div><div>${grp('Неделя', g.week, { date: true })}${grp('Позже', g.later, { date: true }, false)}</div></div>`;
}
function taskModal(t) {
  return `<div class="sheet"><div class="row space"><h2>Задача</h2><button class="btn" data-act="close-modal">Закрыть</button></div>
<form data-form="save-task" data-id="${esc(t.id)}"><label class="lbl">Название</label><input name="title" value="${esc(t.title)}" required autocomplete="off">
<label class="lbl">Дата</label><input type="date" name="date" value="${esc(t.date)}" required><label class="lbl">Время</label><input type="time" name="time" value="${esc(t.time || '')}">
<label class="lbl">Проект</label><select name="projectId">${projectOptions(t.projectId)}</select>
<div class="row gap" style="margin-top:14px"><button class="btn primary">Сохранить</button><button type="button" class="btn danger" data-act="del-task" data-id="${esc(t.id)}">Удалить</button></div></form></div>`;
}

/* ---------- Заметки ---------- */
function noteCards() {
  const q = ui.noteQuery.trim().toLowerCase();
  const list = S.notes.filter((n) => !q || n.text.toLowerCase().includes(q)).sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.createdAt.localeCompare(a.createdAt));
  if (!list.length) return `<div class="empty center">${q ? 'Ничего не найдено' : 'Заметок пока нет'}</div>`;
  return list.map((n) => `<section class="card"><div class="note">${n.pinned ? '<span class="pin">📌</span> ' : ''}${esc(n.text)}</div><div class="row space" style="margin-top:8px"><span class="muted tiny">${L.formatShortRu(n.createdAt.slice(0, 10))}, ${esc(n.createdAt.slice(11, 16))}</span>
<span><button class="btn small ghost" data-act="note-pin" data-id="${esc(n.id)}">${n.pinned ? 'Открепить' : 'Закрепить'}</button> <button class="btn small ghost danger" data-act="note-del" data-id="${esc(n.id)}">Удалить</button></span></div></section>`).join('');
}
function notesView() {
  return `<section class="card"><form data-form="add-note"><textarea name="text" placeholder="Напиши или нажми «Диктовать»" required></textarea><div class="row gap" style="margin-top:8px"><button type="button" class="btn mic ${ui.rec ? 'rec' : ''}" id="micbtn" data-act="dictate">${ui.rec ? '■ Стоп' : '🎤 Диктовать'}</button><button class="btn primary">Сохранить заметку</button></div></form></section>
<input type="search" id="notesearch" placeholder="Поиск по заметкам" value="${esc(ui.noteQuery)}" style="margin-bottom:12px"><div id="notelist">${noteCards()}</div>`;
}
/* Диктовка: распознавание речи Safari (работает через Siri). Если его нет или оно не разрешено — подсказываем микрофон клавиатуры. */
function micBtn(on) { const b = $('#micbtn'); if (b) { b.textContent = on ? '■ Стоп' : '🎤 Диктовать'; b.classList.toggle('rec', on); } }
// В Safari 15 на iPad распознавание иногда подвисает и не присылает ни результата, ни конца.
// Поэтому: короткая фраза без промежуточных результатов, сторож по времени, и если раз зависло —
// неделю кнопка сразу ведёт на микрофон клавиатуры.
const MIC_BROKEN = 'pult-mic-broken';
const micBroken = () => { try { return Date.now() - Number(localStorage.getItem(MIC_BROKEN) || 0) < 7 * 864e5; } catch { return false; } };
const markMicBroken = () => { try { localStorage.setItem(MIC_BROKEN, String(Date.now())); } catch { /* без хранилища */ } };
function dictate() {
  const ta = document.querySelector('form[data-form="add-note"] textarea');
  const keyboard = (msg) => { if (ta) ta.focus(); toast(msg || 'Нажми 🎤 на клавиатуре, чтобы надиктовать'); };
  if (ui.rec) { ui.rec.finishSoon(); return; }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR || !ta || micBroken()) { keyboard(); return; }
  let rec;
  try { rec = new SR(); } catch { keyboard(); return; }
  rec.lang = 'ru-RU'; rec.interimResults = false; rec.continuous = false; rec.maxAlternatives = 1;
  const base = ta.value ? ta.value.replace(/\s*$/, ' ') : '';
  let heard = false, done = false, guard = 0, soon = 0;
  const finish = (broken, msg) => {
    if (done) return; done = true;
    clearTimeout(guard); clearTimeout(soon);
    ui.rec = null; micBtn(false);
    try { rec.onresult = rec.onerror = rec.onend = null; rec.abort(); } catch { /* уже остановлено */ }
    if (broken) { markMicBroken(); keyboard('Встроенная диктовка не ответила. Нажми 🎤 на клавиатуре — так надёжнее.'); return; }
    if (msg) toast(msg);
    else if (heard) { ta.focus(); toast('Готово — проверь текст и сохрани'); }
  };
  rec.finishSoon = () => { try { rec.stop(); } catch { /* ignore */ } soon = setTimeout(() => finish(!heard), 1500); };
  rec.onresult = (e) => { let t = ''; for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript; if (t) { heard = true; ta.value = base + t; } };
  rec.onerror = (e) => {
    const why = e && e.error;
    if (why === 'not-allowed' || why === 'service-not-allowed') { finish(false); keyboard('Диктовка не разрешена: Настройки → Основные → Клавиатура → Диктовка. Или нажми 🎤 на клавиатуре.'); }
    else if (why === 'no-speech') finish(false, 'Ничего не услышал, попробуй ещё раз');
    else if (why !== 'aborted') finish(true);
  };
  rec.onend = () => finish(false);
  guard = setTimeout(() => finish(!heard), 20000);
  try { rec.start(); } catch { finish(true); return; }
  ui.rec = rec; micBtn(true); toast('Говори — запишу одну фразу');
}
const stamp = () => { const d = new Date(); return `${L.isoDate(d)}T${L.formatTime(d)}`; };

/* ---------- Ещё ---------- */
function habitsView() {
  const today = todayISO(), { list, checks } = S.habits;
  return `<section class="card"><div class="row space"><h2>Привычки</h2><button class="btn small ghost" data-act="habit-edit">${ui.habitEdit ? 'Готово' : 'Изменить'}</button></div>
${list.map((h) => {
    const week = L.habitWeek(checks, h.id, today), st = L.habitStreak(checks, h.id, today);
    return `<div class="hrow"><div class="row space"><b>${ui.habitEdit ? `<input data-hname="${esc(h.id)}" value="${esc(h.name)}">` : esc(h.name)}</b>${ui.habitEdit ? `<button class="btn ghost danger" data-act="habit-del" data-id="${esc(h.id)}">✕</button>` : `<span class="chip">🔥 серия: ${st}</span>`}</div>
<div class="days">${week.map((d) => `<button class="${d.on ? 'on' : ''} ${d.date === today ? 'today' : ''}" data-act="habit-toggle" data-id="${esc(h.id)}" data-date="${d.date}">${d.weekday}<br>${d.on ? '✓' : '·'}</button>`).join('')}</div></div>`;
  }).join('') || '<div class="empty">Привычек нет</div>'}
<form data-form="add-habit" class="addrow" style="margin-top:12px"><input class="wide" name="name" placeholder="Новая привычка" autocomplete="off" required><button class="btn primary">Добавить</button></form></section>`;
}
function financeView() {
  const today = todayISO(), f = L.financeTotals(S.finance.entries, today, S.finance.budget);
  const list = S.finance.entries.filter((e) => L.monthKey(e.date) === L.monthKey(today)).sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  return `${ratesCard(false)}<section class="card"><h2>Новая трата</h2><form data-form="add-fin"><div class="addrow"><input class="num" name="amount" type="number" inputmode="decimal" step="any" min="0" placeholder="Сумма, ₽" required><select name="category">${L.CATEGORIES.map((c) => `<option>${c}</option>`).join('')}</select><input type="date" name="date" value="${today}" required></div>
<div class="addrow"><input class="wide" name="note" placeholder="Заметка (необязательно)" autocomplete="off"><button class="btn primary">Добавить</button></div></form></section>
<section class="card"><h2>Траты</h2><div class="stot"><div><span class="muted tiny">Сегодня</span><b>${money(f.today)}</b></div><div><span class="muted tiny">7 дней</span><b>${money(f.week)}</b></div><div><span class="muted tiny">Месяц</span><b>${money(f.month)}</b></div></div></section>
<section class="card"><h2>Бюджет на месяц</h2><form data-form="save-budget" class="addrow"><input class="num" name="budget" type="number" inputmode="decimal" min="0" step="any" value="${S.finance.budget || ''}" placeholder="Сумма, ₽"><button class="btn primary">Сохранить</button></form>
${S.finance.budget ? `<div class="kv"><span>Осталось</span><b style="color:${f.remaining < 0 ? 'var(--bad)' : 'inherit'}">${money(f.remaining)}</b></div><div class="kv"><span>Можно тратить в день (осталось дней: ${f.daysLeft})</span><b>${money(f.allowance)}</b></div>` : '<p class="muted">Задай бюджет, и здесь появится остаток и дневной лимит.</p>'}</section>
<section class="card"><h2>Записи за месяц</h2>${list.map((e) => `<div class="item"><div class="grow">${money(e.amount)} <span class="chip">${esc(e.category)}</span><div class="muted tiny">${L.formatShortRu(e.date)}${e.note ? ' · ' + esc(e.note) : ''}</div></div><button class="btn ghost danger" data-act="fin-del" data-id="${esc(e.id)}" aria-label="Удалить">✕</button></div>`).join('') || '<div class="empty">Трат пока нет</div>'}</section>`;
}
function statsView() {
  return `<section class="card"><h2>Статистика Twitch и YouTube</h2><p class="muted">Подключим позже — нужны ключи API.</p><p class="muted tiny">Пока можно сохранить названия каналов.</p>
<form data-form="save-stats"><label class="lbl">Twitch-канал</label><input name="twitch" value="${esc(S.settings.twitch)}" placeholder="deadsints" autocomplete="off"><label class="lbl">YouTube-канал</label><input name="youtube" value="${esc(S.settings.youtube)}" placeholder="@название" autocomplete="off"><div style="margin-top:10px"><button class="btn primary">Сохранить</button></div></form></section>`;
}
function routinesView() {
  const edit = ui.routineEdit;
  const block = (kind, title) => `<section class="card"><h2>${title}</h2>${S.routines[kind].map((st, i) => `<div class="item"><span class="muted" style="width:28px">${i + 1}.</span>${edit ? `<input data-rname="${kind}/${esc(st.id)}" value="${esc(st.title)}" style="flex:1"><button class="btn ghost" data-act="routine-up" data-kind="${kind}" data-id="${esc(st.id)}" aria-label="Выше">↑</button><button class="btn ghost danger" data-act="routine-del" data-kind="${kind}" data-id="${esc(st.id)}" aria-label="Удалить">✕</button>` : `<div class="ttl">${esc(st.title)}</div>`}</div>`).join('') || '<div class="empty">Шагов нет</div>'}
<form data-form="add-routine" data-kind="${kind}" class="addrow" style="margin-top:10px"><input class="wide" name="title" placeholder="Новый шаг" autocomplete="off" required><button class="btn primary">Добавить</button></form></section>`;
  return `<div class="row space" style="margin-bottom:10px"><p class="muted" style="margin:0">Рутина показывается на главной: утренняя утром, вечерняя вечером.</p><button class="btn small ghost" data-act="routine-edit">${edit ? 'Готово' : 'Изменить'}</button></div>
<div class="grid2">${block('morning', 'Утро')}${block('evening', 'Вечер')}</div>`;
}
function goalsView() {
  const today = todayISO(), month = today.slice(0, 7), year = today.slice(0, 4);
  const row = (g) => `<div class="item"><div class="ttl">${esc(g.title)}</div><select data-goal-status="${esc(g.id)}" style="width:150px"><option value="">В процессе</option>${Object.entries(L.GOAL_STATUS).map(([k, t]) => `<option value="${k}" ${g.status === k ? 'selected' : ''}>${t}</option>`).join('')}</select><button class="btn ghost danger" data-act="goal-del" data-id="${esc(g.id)}" aria-label="Удалить">✕</button></div>`;
  const list = (period) => S.goals.filter((g) => g.period === period).map(row).join('') || '<div class="empty">Целей пока нет</div>';
  const past = [...new Set(S.goals.map((g) => g.period))].filter((p) => p !== month && p !== year).sort().reverse();
  const cds = [...S.countdowns].sort((a, b) => a.date.localeCompare(b.date));
  return `<div class="grid2"><section class="card"><h2>Цели на ${esc(L.periodName(month))}</h2>${list(month)}
<h2 style="margin-top:14px">Цели на ${esc(year)} год</h2>${list(year)}
<form data-form="add-goal" style="margin-top:10px"><div class="addrow"><input class="wide" name="title" placeholder="Новая цель" autocomplete="off" required><select name="period"><option value="${month}">На месяц</option><option value="${year}">На год</option></select><button class="btn primary">Добавить</button></div></form>
<p class="muted tiny">В последний день месяца (и года) Пульт попросит оценить каждую цель.</p></section>
<section class="card"><h2>Обратные отсчёты</h2>${cds.map((c) => { const left = L.daysUntil(today, c.date); return `<div class="item"><div class="ttl">${esc(c.title)}<span class="chip">${L.formatShortRu(c.date)}</span></div><span class="muted" style="margin-right:6px">${left < 0 ? 'прошло' : L.formatDaysLeft(left)}</span><button class="btn ghost danger" data-act="cd-del" data-id="${esc(c.id)}" aria-label="Удалить">✕</button></div>`; }).join('') || '<div class="empty">Отсчётов нет</div>'}
<form data-form="add-cd" class="addrow" style="margin-top:10px"><input class="wide" name="title" placeholder="Событие, например «Отпуск»" autocomplete="off" required><input type="date" name="date" min="${today}" required><button class="btn primary">Добавить</button></form></section></div>
${past.length ? `<section class="card"><h2>Прошлые итоги</h2>${past.map((p) => { const c = L.goalsSummary(S.goals, p); return `<div class="kv"><span>${esc(L.periodName(p))}</span><span>выполнено ${c.done} из ${c.total}${c.partial ? `, частично ${c.partial}` : ''}</span></div>`; }).join('')}</section>` : ''}`;
}
function shoppingView() {
  const today = todayISO(), wi = L.weekdayIndex(today), bought = S.shopping.filter((x) => x.done).length;
  const items = [...S.shopping].sort((a, b) => (a.done ? 1 : 0) - (b.done ? 1 : 0));
  return `<div class="grid2"><section class="card"><div class="row space"><h2>Список покупок${S.shopping.length ? ` · ${S.shopping.length - bought}` : ''}</h2>${bought ? `<button class="btn small ghost" data-act="shop-clear">Убрать купленное</button>` : ''}</div>
<form data-form="add-shop" class="addrow"><input class="wide" name="title" placeholder="Что купить" autocomplete="off" required><button class="btn primary">Добавить</button></form>
${items.map((x) => `<div class="item ${x.done ? 'done' : ''}"><button class="chk ${x.done ? 'on' : ''}" data-act="shop-toggle" data-id="${esc(x.id)}" aria-label="Куплено"></button><div class="ttl">${esc(x.title)}</div><button class="btn ghost danger" data-act="shop-del" data-id="${esc(x.id)}" aria-label="Удалить">✕</button></div>`).join('') || '<div class="empty">Список пуст</div>'}</section>
<section class="card"><h2>Меню на неделю</h2>${L.WEEK_RU.map((d, i) => `<label class="lbl ${i === wi ? 'todaylbl' : ''}">${d}${i === wi ? ' · сегодня' : ''}</label><input data-menu="${i}" value="${esc(S.menu[i])}" placeholder="Что готовим" autocomplete="off">`).join('')}</section></div>`;
}
const hourOpts = (sel) => Array.from({ length: 24 }, (_, h) => `<option value="${h}" ${h === sel ? 'selected' : ''}>${String(h).padStart(2, '0')}:00</option>`).join('');
function settingsView() {
  const s = S.settings;
  return `<section class="card"><h2>Город для погоды</h2><p>Сейчас: <b>${esc(s.city)}</b> <span class="muted">(${s.lat}, ${s.lon})</span></p>
<form data-form="city-search" class="addrow"><input class="wide" name="q" placeholder="Название города" autocomplete="off" required><button class="btn primary">Найти</button></form>
${ui.cityResults ? (ui.cityResults.length ? ui.cityResults.map((c, i) => `<div class="item"><button class="ttl" data-act="city-pick" data-i="${i}">${esc(c.name)}<span class="chip">${esc([c.admin1, c.country].filter(Boolean).join(', '))}</span></button></div>`).join('') : '<div class="empty">Ничего не найдено или нет сети</div>') : ''}</section>
<section class="card"><h2>Режимы главной</h2><div class="addrow"><div style="flex:1 1 140px"><label class="lbl">Утро с</label><select data-set="morningFrom">${hourOpts(s.morningFrom)}</select></div><div style="flex:1 1 140px"><label class="lbl">День с</label><select data-set="dayFrom">${hourOpts(s.dayFrom)}</select></div><div style="flex:1 1 140px"><label class="lbl">Вечер с</label><select data-set="eveningFrom">${hourOpts(s.eveningFrom)}</select></div></div>
<label class="lbl">Ночная тема (тёмно-красная)</label><select data-set="night">${[['auto', 'Авто: вечером и ночью'], ['on', 'Всегда включена'], ['off', 'Выключена']].map(([v, t]) => `<option value="${v}" ${s.night === v ? 'selected' : ''}>${t}</option>`).join('')}</select></section>
<section class="card"><h2>Экран</h2>
<label class="lbl">Не гасить экран, пока открыт Пульт</label><select data-set="keepAwake">${[['on', 'Да'], ['off', 'Нет']].map(([v, t]) => `<option value="${v}" ${(s.keepAwake ? 'on' : 'off') === v ? 'selected' : ''}>${t}</option>`).join('')}</select>
<label class="lbl">Режим «рамки» после простоя</label><select data-set="ambientMin">${[[0, 'Выключен'], [1, 'Через 1 минуту'], [2, 'Через 2 минуты'], [5, 'Через 5 минут'], [10, 'Через 10 минут'], [15, 'Через 15 минут']].map(([v, t]) => `<option value="${v}" ${Number(s.ambientMin) === v ? 'selected' : ''}>${t}</option>`).join('')}</select>
<label class="lbl">Фото в «рамке» днём (ночью только часы)</label><select data-set="ambientPhotos">${[['on', 'Показывать'], ['off', 'Только часы']].map(([v, t]) => `<option value="${v}" ${(s.ambientPhotos ? 'on' : 'off') === v ? 'selected' : ''}>${t}</option>`).join('')}</select>
<div class="row wrap gap" style="margin-top:10px"><label class="btn" style="display:inline-block;line-height:28px">Добавить фото<input type="file" accept="image/*" multiple data-act-change="photos" style="display:none"></label><span class="muted">Фото: ${ui.photos.length}</span>${ui.photos.length ? '<button class="btn ghost danger" data-act="photos-clear">Удалить все фото</button>' : ''}<button class="btn ghost" data-act="ambient-show">Показать сейчас</button></div>
<p class="muted tiny">Фото хранятся только на этом устройстве и не входят в резервную копию.</p>
<label class="lbl">Затемнение ночью</label><select data-set="nightDim">${[0, 20, 30, 40, 50, 60, 70].map((v) => `<option value="${v}" ${Number(s.nightDim) === v ? 'selected' : ''}>${v ? v + '%' : 'Без затемнения'}</option>`).join('')}</select>
<p class="muted tiny">На iPad дополнительно: Настройки → Экран и яркость → Автоблокировка → «Никогда», а Универсальный доступ → Гид-доступ держит Пульт открытым (тройное нажатие кнопки «Домой»).</p></section>
<section class="card"><h2>Резервная копия</h2><p class="muted">Данные лежат только на этом устройстве. Сохрани копию, чтобы перенести их или не потерять.</p>
<div class="row wrap gap"><button class="btn primary" data-act="export-copy">Скопировать в буфер</button><a class="btn" id="dl" download="pult-backup.json" href="${backupUrl()}" style="display:inline-block;line-height:28px;text-decoration:none;color:var(--text)">Скачать файл</a></div>
<label class="lbl" style="margin-top:12px">Загрузить копию из файла (заменит данные)</label><input type="file" accept="application/json,.json" data-act-change="import"></section>
<section class="card"><h2>Лимиты Claude</h2><p class="muted">ID гиста, куда строка состояния Claude Code на ПК пишет лимиты. Как настроить — в README репозитория, раздел «Лимиты Claude».</p>
<form data-form="save-claude" class="addrow"><input class="wide" name="gist" value="${esc(s.claudeGist)}" placeholder="например, 3f2a…c91" autocomplete="off"><button class="btn primary">Сохранить</button></form></section>
<section class="card"><h2>Проекты</h2><p class="muted">projects.json обновлён: <b>${esc(S.remote.updated || 'ещё не загружен')}</b></p><button class="btn" data-act="projects-refresh">Обновить проекты</button></section>
<section class="card"><h2>Обновления</h2><p class="muted">Пульт обновляется сам: новая версия скачивается в фоне, и страница перезагружается, когда ты ничего не вводишь. Кнопка ниже — если хочется прямо сейчас.</p><button class="btn" data-act="app-update">Обновить Пульт</button><p class="muted tiny" style="margin-top:8px">Версия ${esc(VERSION)}</p></section>`;
}
/* ---------- График смен ---------- */
const schKey = (iso) => iso.slice(0, 7);
const schMonths = () => Object.values((S.schedule && S.schedule.months) || {}).sort((a, b) => (a.y - b.y) || (a.m - b.m));
const schFor = (iso) => (S.schedule && S.schedule.months && S.schedule.months[schKey(iso)]) || null;
const schMe = () => (S.schedule && S.schedule.me) || '';
const isMe = (name) => !!schMe() && L.findPerson({ people: [{ name }] }, schMe()) !== null;
const hhmm = (t) => t.replace(/^0/, '').replace(':00', '');
const shiftText = (c) => (!c ? '' : c.off ? 'выходной' : c.from ? hhmm(c.from) + '–' + hhmm(c.to) : c.note);
const dayLabel = (iso) => `${L.weekdayShort(iso)}, ${L.formatShortRu(iso)}`;
const hoursRu = (h) => `${String(h).replace('.', ',')} ${L.plural(Math.floor(h), 'час', 'часа', 'часов')}`;
// Цвет человека: один и тот же во всём разделе, чтобы глаз сразу находил его.
const PCOL = ['#8fb8de', '#7fcfa6', '#e0a36a', '#c79be0', '#e07a9a', '#d8d070', '#6fc9c9', '#b0a090'];
function personColor(name) { const all = [...new Set(schMonths().flatMap((m) => m.people.map((p) => p.name)))]; const i = all.indexOf(name); return PCOL[(i < 0 ? 0 : i) % PCOL.length]; }
function schStatus() {
  const s = S.schedule;
  if (ui.schState === 'loading' && !s) return 'Загружаю график…';
  if (!s) return ui.schState === 'fail' ? `Не удалось загрузить график: ${esc(ui.schError || 'нет сети')}` : 'График ещё не загружен';
  return `Таблица прочитана ${esc(L.timeAgoRu(s.fetchedAt || new Date(s.at).toISOString()))}${ui.schState === 'fail' ? ` · <span class="warnc">сейчас не обновился (${esc(ui.schError || 'нет сети')}), показан сохранённый</span>` : ''}`;
}
function changesBlock(limit) {
  const ch = (S.schedule && S.schedule.changes) || [];
  if (!ch.length || S.schedule.changesSeen) return '';
  const list = [...ch].sort((a, b) => (isMe(b.name) - isMe(a.name)) || a.date.localeCompare(b.date)).slice(0, limit);
  return `<div class="schchg"><div class="row space"><b class="warnc">График изменился</b><button class="btn small ghost" data-act="sch-seen">Понятно</button></div>${list.map((x) => `<div class="tiny">${esc(dayLabel(x.date))} · ${isMe(x.name) ? '<b>ты</b>' : esc(x.name)}: ${esc(x.was)} → <b>${esc(x.now)}</b></div>`).join('')}${ch.length > limit ? `<div class="muted tiny">и ещё ${ch.length - limit}</div>` : ''}</div>`;
}
function shiftCard() {
  if (!S.schedule) return '';
  const today = todayISO(), tomorrow = L.addDays(today, 1), me = schMe();
  const mine = (iso) => { const sch = schFor(iso), p = L.findPerson(sch, me), c = p && p.days[Number(iso.slice(8))]; return c && c.from ? 'смена ' + shiftText(c) : c && c.note ? c.note : 'выходной'; };
  const team = L.workingOn(schFor(today), Number(today.slice(8)));
  const next = me ? L.nextShifts(schMonths(), me, tomorrow, 1)[0] : null;
  return `<section class="card"><div class="row space"><h2>🧋 Смены Мими Руш</h2><button class="btn small ghost" data-act="go-shifts">График</button></div>${changesBlock(3)}
${me && schFor(today) ? `<div class="stat">Ты сегодня: <b>${esc(mine(today))}</b> · завтра: <b>${esc(mine(tomorrow))}</b></div>${next ? `<div class="stat">Следующая смена: <b>${esc(dayLabel(next.date))}, ${esc(shiftText(next))}</b></div>` : ''}` : ''}
${schFor(today) ? `<div class="stat">Сегодня в кафе: ${team.length ? team.map((x) => `<span class="pdot" style="background:${personColor(x.name)}"></span>${esc(x.name)} <span class="muted">${esc(shiftText(x))}</span>`).join(' &nbsp; ') : 'никого'}</div>` : `<p class="muted">${schStatus()}</p>`}</section>`;
}
// Один день: полосы смен на шкале часов, как в календаре.
function dayTimeline(sch, iso) {
  const d = Number(iso.slice(8)), H0 = 8, H1 = 23, pct = (t) => { const [h, m] = t.split(':').map(Number); return Math.max(0, Math.min(100, ((h + m / 60 - H0) / (H1 - H0)) * 100)); };
  const work = sch.people.filter((p) => p.days[d] && p.days[d].from), off = sch.people.filter((p) => p.days[d] && p.days[d].off), notes = sch.people.filter((p) => p.days[d] && p.days[d].note), none = sch.people.filter((p) => !p.days[d]);
  const ticks = []; for (let h = H0; h <= H1; h += 1) ticks.push(`<span style="left:${((h - H0) / (H1 - H0)) * 100}%">${h % 2 ? '' : h}</span>`);
  const now = new Date(), nowLine = iso === todayISO() && now.getHours() >= H0 && now.getHours() < H1 ? `<div class="tlnow" style="left:${pct(L.formatTime(now))}%"></div>` : '';
  const rows = work.map((p) => { const c = p.days[d]; return `<div class="tlrow"><div class="tlname ${isMe(p.name) ? 'me' : ''}">${esc(p.name)}</div><div class="tltrack">${nowLine}<div class="tlbar" style="left:${pct(c.from)}%;width:${pct(c.to) - pct(c.from)}%;background:${personColor(p.name)}">${esc(shiftText(c))} · ${esc(hoursRu(L.shiftHours(c)))}</div></div></div>`; }).join('');
  const isToday = iso === todayISO(), prev = L.addDays(iso, -1), next = L.addDays(iso, 1);
  const can = (x) => !!schFor(x);
  return `<section class="card"><div class="row space"><button class="btn" data-act="sch-day" data-k="${prev}" ${can(prev) ? '' : 'disabled'} aria-label="Предыдущий день">◀</button><h2 style="margin:0;text-align:center">${isToday ? 'Сегодня, ' : ''}${esc(L.formatDateRu(L.fromISO(iso)))}</h2><button class="btn" data-act="sch-day" data-k="${next}" ${can(next) ? '' : 'disabled'} aria-label="Следующий день">▶</button></div>
<div class="muted" style="margin:8px 0">На смене: <b>${work.length}</b>${work.length ? ` · всего ${esc(hoursRu(Math.round(work.reduce((s, p) => s + L.shiftHours(p.days[d]), 0) * 10) / 10))}` : ''}${isToday ? '' : ` · <button class="linkbtn" data-act="sch-day" data-k="${todayISO()}">к сегодня</button>`}</div>
${work.length ? `<div class="tl"><div class="tlrow"><div class="tlname"></div><div class="tlticks">${ticks.join('')}</div></div>${rows}</div>` : '<div class="empty">В этот день в графике никого нет</div>'}
${off.length ? `<div class="stat">Выходной: ${off.map((p) => esc(p.name)).join(', ')}</div>` : ''}${notes.length ? `<div class="stat">${notes.map((p) => `${esc(p.name)}: ${esc(p.days[d].note)}`).join(', ')}</div>` : ''}${none.length ? `<div class="muted tiny">Не в графике: ${none.map((p) => esc(p.name)).join(', ')}</div>` : ''}</section>`;
}
function monthTable(sch, key, sel) {
  const today = todayISO(), iso = (d) => `${key}-${String(d).padStart(2, '0')}`;
  const ds = Array.from({ length: sch.days }, (_, i) => i + 1);
  const cls = (c) => (!c ? '' : c.off ? 'off' : c.from ? (L.shiftHours(c) >= 12 ? 'full' : 'part') : 'note');
  const cell = (p, d) => { const c = p.days[d]; return `<td class="${cls(c)} ${iso(d) === today ? 'today' : ''} ${iso(d) === sel ? 'sel' : ''}" ${c && c.from ? `style="background:${personColor(p.name)}33"` : ''}>${!c ? '' : c.off ? 'вых' : c.from ? `${hhmm(c.from)}–${hhmm(c.to)}` : esc(c.note)}</td>`; };
  const count = (d) => sch.people.filter((p) => p.days[d] && p.days[d].from).length;
  return `<section class="card"><h2>${esc(L.MONTHS_RU[sch.m - 1])} ${sch.y} · все сотрудники</h2><p class="muted tiny">Нажми на число, чтобы увидеть день подробно. В клетке — часы смены, справа — сумма часов и смен за месяц.</p><div class="schwrap"><table class="sch"><thead><tr><th class="nm">Сотрудник</th>${ds.map((d) => { const wd = L.fromISO(iso(d)).getDay(); return `<th class="${iso(d) === today ? 'today' : ''} ${iso(d) === sel ? 'sel' : ''} ${wd === 0 || wd === 6 ? 'we' : ''}" data-act="sch-day" data-k="${iso(d)}">${d}<br><span>${L.weekdayShort(iso(d))}</span></th>`; }).join('')}<th class="stot">Часы</th><th class="stot">Смен</th></tr></thead>
<tbody>${sch.people.map((p) => `<tr class="${isMe(p.name) ? 'me' : ''}"><th class="nm"><span class="pdot" style="background:${personColor(p.name)}"></span>${esc(p.name)}${isMe(p.name) ? ' (ты)' : ''}</th>${ds.map((d) => cell(p, d)).join('')}<td class="stot">${String(L.monthHours(p)).replace('.', ',')}</td><td class="stot">${Object.values(p.days).filter((c) => c.from).length}</td></tr>`).join('')}
<tr class="cnt"><th class="nm">На смене</th>${ds.map((d) => `<td class="${iso(d) === today ? 'today' : ''} ${count(d) < 2 ? 'low' : ''}">${count(d)}</td>`).join('')}<td class="stot"></td><td class="stot"></td></tr></tbody></table></div>
<div class="legend"><span><i class="lg full"></i>смена 12 ч и больше</span><span><i class="lg part"></i>короткая смена</span><span><i class="lg off"></i>вых — выходной</span><span><i class="lg none"></i>пусто — нет в графике</span><span><i class="lg low"></i>на смене меньше двух</span></div></section>`;
}
function scheduleKeyCard() {
  return `<section class="card"><h2>Пароль графика</h2><p class="muted">График всех сотрудников лежит на сайте Пульта в зашифрованном виде, чтобы чужие не увидели имена и часы. Введи пароль из секрета SCHEDULE_KEY. Он хранится только на этом устройстве.</p>
<form data-form="save-schkey" class="addrow"><input class="wide" type="password" name="key" placeholder="пароль" autocomplete="off" required><button class="btn primary">${S.settings.scheduleKey ? 'Сменить' : 'Сохранить'}</button></form></section>`;
}
function shiftsView() {
  const today = todayISO(), me = schMe();
  const head = `<section class="card"><div class="row space"><span class="muted tiny">${schStatus()} · обновляется раз в 30 минут</span><button class="btn small ghost" data-act="sch-refresh">Обновить</button></div>${changesBlock(12)}</section>`;
  if (!S.schedule) return head + (ui.schState === 'nokey' || ui.schError === 'неверный пароль' || !S.settings.scheduleKey ? scheduleKeyCard() : '');
  const months = schMonths();
  const sel = ui.schDay && schFor(ui.schDay) ? ui.schDay : today;
  const key = schKey(sel), sch = schFor(sel);
  let out = head + (sch ? dayTimeline(sch, sel) : `<div class="empty">В таблице пока нет листа «${esc(L.scheduleSheetName(Number(key.slice(0, 4)), Number(key.slice(5))))}».</div>`);
  if (months.length > 1) out += `<div class="seg">${months.map((m) => { const k = `${m.y}-${String(m.m).padStart(2, '0')}`; return `<button class="${k === key ? 'on' : ''}" data-act="sch-day" data-k="${k === schKey(today) ? today : k + '-01'}">${esc(L.MONTHS_RU[m.m - 1])}</button>`; }).join('')}</div>`;
  if (sch) out += monthTable(sch, key, sel);
  if (me) {
    const list = L.nextShifts(months, me, today, 10);
    out += `<section class="card"><h2>Мои ближайшие смены</h2>${list.length ? list.map((x) => `<div class="item"><div class="grow">${x.date === today ? '<b>Сегодня</b>' : esc(dayLabel(x.date))}</div><span class="chip">${esc(shiftText(x))} · ${esc(hoursRu(L.shiftHours(x)))}</span></div>`).join('') : '<div class="empty">Ближайших смен в графике нет</div>'}</section>`;
  }
  return out + scheduleKeyCard();
}
function moreView() {
  const subs = [['habits', 'Привычки'], ['routines', 'Рутины'], ['goals', 'Цели'], ['shopping', 'Покупки'], ['finance', 'Финансы'], ['stats', 'Статистика'], ['settings', 'Настройки']];
  return `<div class="seg wrap">${subs.map(([k, t]) => `<button class="${ui.more === k ? 'on' : ''}" data-act="more" data-k="${k}">${t}</button>`).join('')}</div>${{ habits: habitsView, routines: routinesView, goals: goalsView, shopping: shoppingView, finance: financeView, stats: statsView, settings: settingsView }[ui.more]()}`;
}

/* ---------- Резервная копия ---------- */
function backupObject() {
  return { app: 'pult', version: 1, exportedAt: new Date().toISOString(), data: { tasks: S.tasks, notes: S.notes, habits: S.habits, finance: S.finance, settings: S.settings, projects: S.projects, goals: S.goals, countdowns: S.countdowns, journal: S.journal, routines: S.routines, shopping: S.shopping, menu: S.menu, savedNews: S.savedNews } };
}
let blobUrl = '';
function backupUrl() {
  if (blobUrl) URL.revokeObjectURL(blobUrl);
  blobUrl = URL.createObjectURL(new Blob([JSON.stringify(backupObject(), null, 1)], { type: 'application/json' }));
  return blobUrl;
}
async function copyBackup() {
  const text = JSON.stringify(backupObject(), null, 1);
  try { await navigator.clipboard.writeText(text); toast('Скопировано в буфер'); return; } catch { /* запасной путь */ }
  const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
  let ok = false; try { ok = document.execCommand('copy'); } catch { /* ignore */ }
  ta.remove(); toast(ok ? 'Скопировано в буфер' : 'Не удалось скопировать, скачай файл');
}
function importBackup(file) {
  const fr = new FileReader();
  fr.onload = async () => {
    try {
      const j = JSON.parse(fr.result);
      if (j?.app !== 'pult' || !j.data) throw new Error('не копия Пульта');
      await saveSnapshot(S);
      S = normalize({ ...j.data, remote: S.remote, weather: S.weather });
      save(); render(); toast('Копия загружена');
    } catch (e) { toast('Не получилось: ' + e.message); }
  };
  fr.readAsText(file);
}

/* ---------- Отрисовка ---------- */
const TABS = [['home', '🏠', 'Главная'], ['projects', '📁', 'Проекты'], ['tasks', '✅', 'Задачи'], ['notes', '📝', 'Заметки'], ['news', '📰', 'Новости'], ['shifts', '🧋', 'Смены'], ['more', '⋯', 'Ещё']];
const VIEWS = { home: homeView, projects: projectsView, tasks: tasksView, notes: notesView, news: newsView, shifts: shiftsView, more: moreView };
function renderTabs() {
  $('#tabs').innerHTML = TABS.map(([k, ic, t]) => `<button class="${ui.tab === k ? 'on' : ''}" data-tab="${k}"><span class="ic">${ic}</span>${t}</button>`).join('');
}
function renderModal() {
  const m = $('#modal'), md = ui.modal;
  let html = '';
  if (md?.type === 'project') { const p = projectById(md.id); if (p) html = projectModal(p); }
  if (md?.type === 'task') { const t = S.tasks.find((x) => x.id === md.id); if (t) html = taskModal(t); }
  const keepScroll = m.hidden ? 0 : m.scrollTop;
  m.innerHTML = html; m.hidden = !html; m.scrollTop = keepScroll;
  document.body.style.overflow = html ? 'hidden' : '';
}
function applyTheme() {
  const night = L.isNight(S.settings, hour());
  document.body.classList.toggle('night', night);
  const meta = document.querySelector('meta[name=theme-color]'); if (meta) meta.content = night ? '#120a0a' : '#0f1115';
  const dim = $('#dim'), a = night ? Number(S.settings.nightDim) || 0 : 0;
  if (dim) { dim.style.opacity = String(a / 100); dim.hidden = !a; }
  setKeepAwake(S.settings.keepAwake);
}
function render() {
  const view = $('#view');
  // Сохраняем то, что уже напечатано в полях, чтобы фоновое обновление не стёрло ввод.
  const keep = [...view.querySelectorAll('form input[name], form textarea[name]')].filter((e) => e.value && e.type !== 'date' && e.type !== 'time').map((e) => [e.form?.dataset.form + '/' + e.name, e.value]);
  const scroll = window.scrollY;
  applyTheme(); renderTabs();
  view.innerHTML = VIEWS[ui.tab]();
  for (const [k, v] of keep) { const [f, n] = k.split('/'); const el = view.querySelector(`form[data-form="${f}"] [name="${n}"]`); if (el && !el.value) el.value = v; }
  renderModal();
  window.scrollTo(0, scroll);
  // В таблице смен сразу видно сегодняшнее число.
  const wrap = view.querySelector('.schwrap'), td = wrap && (wrap.querySelector('th.sel') || wrap.querySelector('th.today'));
  if (td) wrap.scrollLeft = Math.max(0, td.offsetLeft - 260);
  ui.lastKey = renderKey();
}
const renderKey = () => `${mode()}|${L.isNight(S.settings, hour())}|${todayISO()}|${ui.tab === 'home' ? Math.floor(Date.now() / 900000) : ''}`;
function tick() {
  const now = new Date();
  const c = $('#clock'); if (c) { c.textContent = L.formatTime(now); $('#date').textContent = L.formatDateRu(now); }
  ambientTick();
  if (renderKey() !== ui.lastKey && !ui.modal && !document.activeElement?.matches?.('input, textarea, select')) render();
}

/* ---------- Режим «рамки» при простое ---------- */
function ambientHtml() {
  const now = new Date(), night = L.isNight(S.settings, hour()), w = S.weather && S.weather.data;
  const usePhoto = !night && S.settings.ambientPhotos && ui.photos.length;
  const photo = usePhoto ? ui.photos[Math.floor(Date.now() / 60000) % ui.photos.length] : '';
  const narrow = window.innerWidth < 700, x = 4 + Math.floor(Math.random() * (narrow ? 18 : 40)), y = 8 + Math.floor(Math.random() * (narrow ? 60 : 46));
  return `${photo ? `<img class="amb-photo" src="${photo}" alt="">` : ''}<div class="amb-box ${photo ? 'onphoto' : ''}" style="left:${x}%;top:${y}%"><div class="amb-clock">${L.formatTime(now)}</div><div class="amb-date">${esc(L.formatDateRu(now))}${w ? ` · ${L.wmoInfo(w.code).icon} ${L.formatTemp(w.temp)}` : ''}</div></div>`;
}
function showAmbient() {
  const el = $('#ambient'); if (!el) return;
  ui.ambient = true; ui.ambMin = new Date().getMinutes(); el.innerHTML = ambientHtml(); el.hidden = false;
}
function hideAmbient() { const el = $('#ambient'); ui.ambient = false; ui.lastTouch = Date.now(); if (el) { el.hidden = true; el.innerHTML = ''; } }
function ambientTick() {
  if (ui.ambient) { const m = new Date().getMinutes(); if (m !== ui.ambMin) { ui.ambMin = m; $('#ambient').innerHTML = ambientHtml(); } return; }
  const min = Number(S.settings.ambientMin) || 0;
  if (!min || ui.modal || document.activeElement?.matches?.('input, textarea, select')) return;
  if (Date.now() - ui.lastTouch >= min * 60000) showAmbient();
}
['touchstart', 'mousedown', 'keydown', 'scroll'].forEach((ev) => document.addEventListener(ev, () => { ui.lastTouch = Date.now(); }, { passive: true, capture: true }));

/** Уменьшает фото до 1280 px, чтобы старый iPad не тратил память. */
function shrinkPhoto(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const k = Math.min(1, 1280 / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      try { resolve(c.toDataURL('image/jpeg', 0.8)); } catch { resolve(null); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}
async function addPhotos(files) {
  toast('Обрабатываю фото…');
  const out = [];
  for (const f of [...files].slice(0, 40)) { const d = await shrinkPhoto(f); if (d) out.push(d); }
  ui.photos = [...ui.photos, ...out].slice(-40);
  toast((await savePhotos(ui.photos)) ? `Добавлено фото: ${out.length}` : 'Не хватило места для фото');
  render();
}

/* ---------- Данные: проекты и погода ---------- */
async function fetchProjects(manual) {
  try {
    const r = await fetch('./projects.json', { cache: 'no-cache' });
    if (!r.ok) throw new Error('http ' + r.status);
    const j = await r.json();
    if (!Array.isArray(j.projects)) throw new Error('формат');
    S.remote = { updated: j.updated || null, projects: j.projects }; save();
    if (manual) toast('Проекты обновлены');
  } catch { if (manual) toast('Нет сети: показаны сохранённые проекты'); }
  render();
}
async function getJson(url) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 8000);
  try { const r = await fetch(url, { signal: ctl.signal }); if (!r.ok) throw new Error('http ' + r.status); return await r.json(); } finally { clearTimeout(t); }
}
async function loadClaude() {
  const id = S.settings.claudeGist; if (!id) return;
  try {
    const d = L.parseClaudeUsage(await getJson('https://api.github.com/gists/' + encodeURIComponent(id)));
    if (!d) throw new Error('формат');
    S.claude = { ...d, at: Date.now() }; ui.clState = 'ok'; save();
  } catch (e) { ui.clState = 'fail'; }
  if (ui.tab === 'home' && !ui.modal && !document.activeElement?.matches?.('input, textarea, select')) render();
}
async function loadWeather(force) {
  const { lat, lon } = S.settings, w = S.weather;
  if (!force && w && w.lat === lat && w.lon === lon && Date.now() - w.at < 30 * 60000) return;
  ui.wxState = 'loading'; if (ui.tab === 'home') render();
  try {
    let data = null, errs = [];
    try { data = L.parseWeather(await getJson(L.weatherUrl(lat, lon))); if (!data) errs.push('Open-Meteo: формат'); } catch (e) { errs.push('Open-Meteo: ' + (e && e.name === 'AbortError' ? 'таймаут' : (e && e.message) || 'ошибка')); }
    let site = null;
    if (!data) { try { site = L.parseSiteWeather(await getJson('./data/weather.json'), lat, lon, Date.now()); if (site) data = site.data; else errs.push('сайт Пульта: нет свежей погоды для этого города'); } catch (e) { errs.push('сайт Пульта: ' + (e && e.name === 'AbortError' ? 'таймаут' : (e && e.message) || 'ошибка')); } }
    if (!data) { try { data = L.parseWttr(await getJson(L.wttrUrl(lat, lon))); if (!data) errs.push('wttr.in: формат'); } catch (e) { errs.push('wttr.in: ' + (e && e.name === 'AbortError' ? 'таймаут' : (e && e.message) || 'ошибка')); } }
    if (!data) throw new Error(errs.join('; '));
    let air = site ? site.air : null;
    if (!site) { try { air = L.parseAir(await getJson(L.airUrl(lat, lon))); } catch { /* воздух не обязателен */ } }
    S.weather = { lat, lon, at: site ? site.at : Date.now(), data, air, via: site ? 'site' : '' }; ui.wxState = 'ok'; ui.wxError = ''; save();
  } catch (e) { ui.wxState = 'fail'; ui.wxError = (e && e.message) || ''; }
  if (ui.tab === 'home') render();
}
async function loadNews(force) {
  if (!force && S.news && Date.now() - S.news.at < 20 * 60000) return;
  ui.nwState = 'loading';
  try {
    const d = L.parseSiteNews(await getJson('./data/news.json?t=' + Math.floor(Date.now() / 60000)));
    if (!d) throw new Error('формат');
    S.news = { at: Date.now(), fetchedAt: d.fetchedAt, items: d.items }; ui.nwState = 'ok'; save();
    if (force) toast('Новости обновлены');
  } catch { ui.nwState = 'fail'; if (force) toast('Не удалось обновить новости'); }
  if ((ui.tab === 'news' || ui.tab === 'home') && !ui.modal && !document.activeElement?.matches?.('input, textarea, select')) render();
}
async function loadSchedule(force) {
  if (!force && S.schedule && Date.now() - S.schedule.at < 9 * 60000) return;
  if (loadSchedule.busy) return; loadSchedule.busy = true;
  ui.schState = 'loading';
  try {
    const today = todayISO();
    let j;
    try { j = await getJson('./data/shifts.json?t=' + Math.floor(Date.now() / 60000)); } catch (e) { throw new Error(/404/.test(e && e.message) ? 'на сайте графика пока нет' : e && e.name === 'AbortError' ? 'таймаут' : 'нет сети'); }
    if (!S.settings.scheduleKey) { ui.schState = 'nokey'; throw Object.assign(new Error('нужен пароль'), { nokey: true }); }
    if (!window.crypto || !crypto.subtle) throw new Error('браузер не умеет расшифровывать');
    const d = L.parseSiteSchedule(await L.decryptJson(j && j.enc, S.settings.scheduleKey)); if (!d) throw new Error('формат');
    const prev = S.schedule;
    let changes = [];
    if (prev && prev.months) for (const k of Object.keys(d.months)) changes = changes.concat(L.scheduleChanges(prev.months[k], d.months[k], today));
    const keep = prev && !changes.length ? { changes: (prev.changes || []).filter((x) => x.date >= today), changesSeen: prev.changesSeen } : { changes, changesSeen: false };
    S.schedule = { at: Date.now(), fetchedAt: j.fetchedAt || null, me: d.me, months: d.months, ...keep };
    ui.schState = 'ok'; ui.schError = ''; save();
    const mine = changes.filter((x) => isMe(x.name));
    if (mine.length) toast('Твой график в Мими Руш изменился');
    else if (changes.length) toast('График Мими Руш изменился');
    else if (force) toast('График обновлён');
  } catch (e) { if (!(e && e.nokey)) ui.schState = 'fail'; ui.schError = (e && e.message) || 'ошибка'; if (force && !(e && e.nokey)) toast('Не удалось обновить график: ' + ui.schError); }
  loadSchedule.busy = false;
  if ((ui.tab === 'shifts' || ui.tab === 'home') && !ui.modal && !document.activeElement?.matches?.('input, textarea, select')) render();
}
async function loadRates(force) {
  if (!force && S.rates && Date.now() - S.rates.at < 6 * 3600000) return;
  try {
    const d = L.parseRates(await getJson(L.RATES_URL));
    if (!d) throw new Error('формат');
    S.rates = { at: Date.now(), data: d }; ui.rtState = 'ok'; save();
  } catch { ui.rtState = 'fail'; }
  if ((ui.tab === 'home' || ui.more === 'finance') && !ui.modal && !document.activeElement?.matches?.('input, textarea, select')) render();
}
async function searchCity(q) {
  try {
    const j = await getJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=6&language=ru&format=json`);
    ui.cityResults = j.results || [];
  } catch { ui.cityResults = []; }
  render();
}

/* ---------- События ---------- */
function editProject(id, fn) {
  const p = projectById(id); if (!p) return;
  const c = JSON.parse(JSON.stringify(p)); fn(c); c.updated = new Date().toISOString();
  S.projects = [...S.projects.filter((x) => x.id !== id), c]; save();
}
const fd = (form) => Object.fromEntries(new FormData(form).entries());
const byId = (list, id) => list.find((x) => x.id === id);

const ACTS = {
  mode: (d) => { S.settings.mode = d.mode; save(); render(); },
  'toggle-task': (d) => { const t = byId(S.tasks, d.id); if (t) { t.done = !t.done; save(); render(); } },
  'edit-task': (d) => { ui.modal = { type: 'task', id: d.id }; renderModal(); },
  'del-task': (d) => { S.tasks = S.tasks.filter((t) => t.id !== d.id); ui.modal = null; save(); render(); },
  'close-modal': () => { ui.modal = null; render(); },
  'open-project': (d) => { ui.modal = { type: 'project', id: d.id }; renderModal(); },
  'toggle-ptask': (d) => { editProject(ui.modal.id, (p) => { const t = byId(p.tasks, d.id); if (t) t.done = !t.done; }); renderModal(); render(); },
  'del-ptask': (d) => { const t = byId(projectById(ui.modal.id)?.tasks || [], d.id); if (t && !confirm(`Удалить задачу «${t.title}»?`)) return; editProject(ui.modal.id, (p) => { p.tasks = p.tasks.filter((x) => x.id !== d.id); }); render(); },
  'p-stage': (d) => { editProject(ui.modal.id, (p) => { p.stage = d.v; if (d.v === 'Готово') p.progress = 100; }); render(); },
  'p-prog': (d) => { editProject(ui.modal.id, (p) => { p.progress = Math.max(0, Math.min(100, Math.round((p.progress + Number(d.d)) / 5) * 5)); }); render(); },
  'p-prog-set': (d) => { editProject(ui.modal.id, (p) => { p.progress = Number(d.v); }); render(); },
  'p-deadline-clear': () => { editProject(ui.modal.id, (p) => { p.deadline = null; }); render(); },
  'strip-day': (d) => { ui.addDate = d.date; render(); },
  'note-pin': (d) => { const n = byId(S.notes, d.id); if (n) { n.pinned = !n.pinned; save(); $('#notelist').innerHTML = noteCards(); } },
  'note-del': (d) => { if (confirm('Удалить заметку?')) { S.notes = S.notes.filter((n) => n.id !== d.id); save(); $('#notelist').innerHTML = noteCards(); } },
  'habit-toggle': (d) => {
    const c = S.habits.checks, set = new Set(c[d.date] || []);
    if (set.has(d.id)) set.delete(d.id); else set.add(d.id);
    if (set.size) c[d.date] = [...set]; else delete c[d.date];
    save(); render();
  },
  'habit-edit': () => { ui.habitEdit = !ui.habitEdit; render(); },
  'habit-del': (d) => { if (confirm('Удалить привычку вместе с отметками?')) { S.habits.list = S.habits.list.filter((h) => h.id !== d.id); save(); render(); } },
  more: (d) => { ui.more = d.k; render(); },
  'fin-del': (d) => { S.finance.entries = S.finance.entries.filter((e) => e.id !== d.id); save(); render(); },
  'weather-refresh': () => loadWeather(true),
  'claude-refresh': () => loadClaude(),
  'city-pick': (d) => { const c = ui.cityResults?.[Number(d.i)]; if (!c) return; Object.assign(S.settings, { city: c.name, lat: c.latitude, lon: c.longitude }); ui.cityResults = null; S.weather = null; save(); render(); loadWeather(true); toast('Город: ' + c.name); },
  'export-copy': copyBackup,
  'rates-refresh': () => loadRates(true),
  'news-refresh': () => loadNews(true),
  'sch-refresh': () => loadSchedule(true),
  'sch-seen': () => { if (S.schedule) { S.schedule.changesSeen = true; save(); render(); } },
  'sch-day': (d) => { ui.schDay = d.k; render(); },
  'go-shifts': () => { ui.tab = 'shifts'; ui.modal = null; render(); window.scrollTo(0, 0); loadSchedule(false); },
  'news-save': (d) => {
    const x = (S.news && S.news.items || []).find((n) => n.link === d.link) || S.savedNews.find((n) => n.link === d.link); if (!x) return;
    const was = isSaved(x.link); S.savedNews = L.toggleSavedNews(S.savedNews, x); save(); render(); toast(was ? 'Убрано из «На потом»' : 'Отложено в «На потом»');
  },
  'saved-done': (d) => { const x = S.savedNews.find((n) => n.link === d.link); if (x) { x.done = !x.done; save(); render(); } },
  'saved-del': (d) => { S.savedNews = S.savedNews.filter((n) => n.link !== d.link); save(); render(); },
  'saved-clear': () => { S.savedNews = S.savedNews.filter((n) => !n.done); save(); render(); },
  'news-topic': (d) => { ui.newsTopic = d.k; render(); window.scrollTo(0, 0); },
  'news-hide': (d) => { const h = S.settings.newsHidden; S.settings.newsHidden = h.includes(d.k) ? h.filter((x) => x !== d.k) : [...h, d.k]; save(); render(); },
  'go-news': () => { ui.tab = 'news'; ui.modal = null; render(); window.scrollTo(0, 0); loadNews(false); },
  'go-more': (d) => { ui.tab = 'more'; ui.more = d.k; render(); window.scrollTo(0, 0); },
  'goal-toggle': (d) => { const g = byId(S.goals, d.id); if (g) { g.status = g.status === 'done' ? null : 'done'; save(); render(); } },
  'goal-status': (d) => { const g = byId(S.goals, d.id); if (g) { g.status = d.s; save(); render(); } },
  'goal-del': (d) => { S.goals = S.goals.filter((g) => g.id !== d.id); save(); render(); },
  'cd-del': (d) => { S.countdowns = S.countdowns.filter((c) => c.id !== d.id); save(); render(); },
  mood: (d) => { const t = todayISO(); S.journal[t] = { ...(S.journal[t] || {}), mood: Number(d.v) }; save(); render(); },
  'routine-toggle': (d) => {
    const t = todayISO(), day = S.routines.checks[t] || (S.routines.checks[t] = {}), set = new Set(day[d.kind] || []);
    if (set.has(d.id)) set.delete(d.id); else set.add(d.id);
    day[d.kind] = [...set]; save(); render();
  },
  'routine-edit': () => { ui.routineEdit = !ui.routineEdit; render(); },
  'routine-del': (d) => { S.routines[d.kind] = S.routines[d.kind].filter((x) => x.id !== d.id); save(); render(); },
  'routine-up': (d) => { const l = S.routines[d.kind], i = l.findIndex((x) => x.id === d.id); if (i > 0) { [l[i - 1], l[i]] = [l[i], l[i - 1]]; save(); render(); } },
  'shop-toggle': (d) => { const x = byId(S.shopping, d.id); if (x) { x.done = !x.done; save(); render(); } },
  'shop-del': (d) => { S.shopping = S.shopping.filter((x) => x.id !== d.id); save(); render(); },
  'shop-clear': () => { S.shopping = S.shopping.filter((x) => !x.done); save(); render(); },
  'photos-clear': async () => { if (!confirm('Удалить все фото из «рамки»?')) return; ui.photos = []; await savePhotos([]); render(); },
  'ambient-show': () => showAmbient(),
  dictate: () => dictate(),
  'app-update': () => appUpdate(),
  'projects-refresh': () => fetchProjects(true),
};
const FORMS = {
  'quick-task': (f, el) => { const v = fd(el); S.tasks.push({ id: uid(), title: v.title.trim(), date: el.dataset.date, time: '', projectId: '', done: false }); },
  'add-task': (f, el) => { const v = fd(el); S.tasks.push({ id: uid(), title: v.title.trim(), date: v.date, time: v.time || '', projectId: v.projectId || '', done: false }); ui.addDate = null; },
  'save-task': (f, el) => { const t = byId(S.tasks, el.dataset.id), v = fd(el); if (t) Object.assign(t, { title: v.title.trim(), date: v.date, time: v.time || '', projectId: v.projectId || '' }); ui.modal = null; },
  'quick-note': (f, el) => { S.notes.push({ id: uid(), text: fd(el).text.trim(), createdAt: stamp(), pinned: false }); toast('Заметка сохранена'); },
  'add-note': (f, el) => { if (ui.rec) ui.rec.finishSoon(); S.notes.push({ id: uid(), text: fd(el).text.trim(), createdAt: stamp(), pinned: false }); },
  'add-ptask': (f, el) => { const v = fd(el); editProject(ui.modal.id, (p) => p.tasks.push({ id: 'l' + uid(), title: v.title.trim(), done: false, due: null })); },
  'add-habit': (f, el) => { S.habits.list.push({ id: 'h' + uid(), name: fd(el).name.trim() }); },
  'add-fin': (f, el) => { const v = fd(el); S.finance.entries.push({ id: uid(), date: v.date, amount: Number(v.amount), category: v.category, note: v.note.trim() }); toast('Трата добавлена'); },
  'save-budget': (f, el) => { S.finance.budget = Number(fd(el).budget) || 0; toast('Бюджет сохранён'); },
  'save-schkey': (f, el) => { S.settings.scheduleKey = fd(el).key; S.schedule = null; toast('Пароль сохранён, загружаю график'); loadSchedule(true); },
  'save-claude': (f, el) => { S.settings.claudeGist = fd(el).gist.trim().replace(/^.*gist\.github\.com\/[^/]+\//, '').replace(/[^a-zA-Z0-9]/g, ''); S.claude = null; toast('Сохранено'); loadClaude(); },
  'save-stats': (f, el) => { const v = fd(el); S.settings.twitch = v.twitch.trim(); S.settings.youtube = v.youtube.trim(); toast('Сохранено'); },
  'city-search': (f, el) => { searchCity(fd(el).q.trim()); return 'skip'; },
  'add-goal': (f, el) => { const v = fd(el); S.goals.push({ id: uid(), title: v.title.trim(), period: v.period, status: null }); },
  'add-cd': (f, el) => { const v = fd(el); S.countdowns.push({ id: uid(), title: v.title.trim(), date: v.date }); },
  journal: (f, el) => { const v = fd(el), t = todayISO(); S.journal[t] = { ...(S.journal[t] || {}), good: v.good.trim(), thanks: v.thanks.trim() }; toast('Записано'); return 'keep'; },
  'add-routine': (f, el) => { S.routines[el.dataset.kind].push({ id: 'r' + uid(), title: fd(el).title.trim() }); },
  'add-shop': (f, el) => { S.shopping.push({ id: uid(), title: fd(el).title.trim(), done: false }); },
};
document.addEventListener('submit', (e) => {
  e.preventDefault();
  const el = e.target, fn = FORMS[el.dataset.form]; if (!fn) return;
  const res = fn(el.dataset.form, el);
  if (res === 'skip') return;
  save(); if (res !== 'keep') el.reset?.();
  if (ui.modal?.type === 'project') renderModal();
  render();
});
document.addEventListener('click', (e) => {
  if (ui.ambient) { hideAmbient(); return; }
  if (e.target.id === 'modal') { ui.modal = null; render(); return; }
  const tab = e.target.closest('[data-tab]');
  if (tab) { if (ui.rec && tab.dataset.tab !== 'notes') ui.rec.finishSoon(); ui.tab = tab.dataset.tab; ui.modal = null; render(); if (ui.tab === 'news') loadNews(false); if (ui.tab === 'shifts') loadSchedule(false); window.scrollTo(0, 0); return; }
  const a = e.target.closest('[data-act]');
  if (a && ACTS[a.dataset.act]) ACTS[a.dataset.act](a.dataset);
});
/* Закрыть окно: Esc на клавиатуре или свайп вниз, когда окно прокручено до верха. */
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && ui.modal) { ui.modal = null; render(); } });
(() => {
  const m = $('#modal'); let y0 = null, x0 = 0, dy = 0, sheet = null;
  const reset = () => { if (sheet) { sheet.classList.remove('dragging'); sheet.style.transform = ''; sheet.style.webkitTransform = ''; } y0 = null; dy = 0; sheet = null; };
  m.addEventListener('touchstart', (e) => {
    reset();
    if (e.touches.length !== 1 || m.scrollTop > 0 || e.target.closest('input, textarea, select, label.datebtn')) return;
    y0 = e.touches[0].clientY; x0 = e.touches[0].clientX; sheet = m.querySelector('.sheet');
  }, { passive: true });
  m.addEventListener('touchmove', (e) => {
    if (y0 === null || !sheet) return;
    const t = e.touches[0]; dy = t.clientY - y0;
    if (m.scrollTop > 0 || dy < 0 || Math.abs(t.clientX - x0) > Math.abs(dy)) { if (dy < 0 || m.scrollTop > 0) reset(); return; }
    const tr = `translateY(${Math.round(dy * 0.8)}px)`;
    sheet.classList.add('dragging'); sheet.style.transform = tr; sheet.style.webkitTransform = tr;
  }, { passive: true });
  m.addEventListener('touchend', () => {
    if (y0 !== null && dy > 110 && ui.modal) { reset(); ui.modal = null; render(); return; }
    reset();
  }, { passive: true });
  m.addEventListener('touchcancel', reset, { passive: true });
})();
document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.id === 'notesearch') { ui.noteQuery = t.value; $('#notelist').innerHTML = noteCards(); }
  if (t.dataset.pfield === 'progress') { const l = $('#pprog'); if (l) l.textContent = t.value; }
  if (t.dataset.hname) { const h = byId(S.habits.list, t.dataset.hname); if (h) { h.name = t.value; save(); } }
  if (t.dataset.rname) { const [k, id] = t.dataset.rname.split('/'); const x = byId(S.routines[k], id); if (x) { x.title = t.value; save(); } }
  if (t.dataset.menu !== undefined) { S.menu[Number(t.dataset.menu)] = t.value; save(); }
});
document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset.actChange === 'import' && t.files?.[0]) { importBackup(t.files[0]); t.value = ''; return; }
  if (t.dataset.actChange === 'photos' && t.files?.length) { addPhotos(t.files); t.value = ''; return; }
  if (t.dataset.goalStatus) { const g = byId(S.goals, t.dataset.goalStatus); if (g) { g.status = t.value || null; save(); render(); } return; }
  if (t.dataset.pfield && ui.modal?.type === 'project') {
    const k = t.dataset.pfield;
    editProject(ui.modal.id, (p) => { p[k] = k === 'progress' ? Number(t.value) : k === 'deadline' ? (t.value || null) : t.value; });
    renderModal(); render(); return;
  }
  if (t.dataset.ptaskDue !== undefined && ui.modal?.type === 'project') {
    editProject(ui.modal.id, (p) => { const x = byId(p.tasks, t.dataset.ptaskDue); if (x) x.due = t.value || null; });
    renderModal(); render(); return;
  }
  if (t.dataset.set) {
    const k = t.dataset.set;
    S.settings[k] = ['morningFrom', 'dayFrom', 'eveningFrom', 'ambientMin', 'nightDim'].includes(k) ? Number(t.value) : ['keepAwake', 'ambientPhotos'].includes(k) ? t.value === 'on' : t.value;
    save(); render();
  }
});

/* ---------- Автообновление ---------- */
// Новая версия сайта ставится сервис-воркером в фоне. Как только она взяла управление, Пульт перезагружается сам,
// но не посреди ввода: если открыто окно или в поле есть текст, ждём, пока освободится.
let pendingReload = false;
const busyNow = () => !!ui.modal || !!document.activeElement?.matches?.('input, textarea, select') ||
  [...document.querySelectorAll('#view form input[name], #view form textarea[name]')].some((e) => e.value && e.type !== 'date' && e.type !== 'time' && !e.defaultValue);
function tryReload() {
  if (!pendingReload || busyNow()) return;
  pendingReload = false;
  try { if (ui.ambient) sessionStorage.setItem('pult-ambient', '1'); } catch { /* без хранилища */ }
  flush().then(() => location.reload());
}
function setupUpdates() {
  if (!('serviceWorker' in navigator) || !(location.protocol === 'https:' || location.hostname === 'localhost')) return;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController) { pendingReload = true; tryReload(); } });
  setInterval(tryReload, 15000);
  navigator.serviceWorker.register('sw.js').then((reg) => {
    const check = () => { if (navigator.onLine !== false) reg.update().catch(() => {}); };
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
    // Пульт открыт круглые сутки и почти не сворачивается, поэтому проверяем новую версию и по таймеру.
    setInterval(() => { if (document.visibilityState === 'visible') check(); }, 10 * 60000);
  }).catch(() => {});
}
/** Ручное обновление: сохраняем данные, сбрасываем кэш сайта и перезапускаемся с новой версией из сети. */
async function appUpdate() {
  if (navigator.onLine === false) { toast('Нет интернета, обновить не получится'); return; }
  toast('Обновляю…');
  await flush();
  try { await (await navigator.serviceWorker?.getRegistration())?.update(); } catch { /* без сервис-воркера */ }
  try { for (const k of await caches.keys()) await caches.delete(k); } catch { /* кэша нет */ }
  setTimeout(() => location.reload(), 400);
}

/* ---------- Запуск ---------- */
async function boot() {
  S = normalize(await loadState());
  render();
  let backToAmbient = false; try { backToAmbient = sessionStorage.getItem('pult-ambient') === '1'; sessionStorage.removeItem('pult-ambient'); } catch { /* без хранилища */ }
  loadPhotos().then((p) => { ui.photos = p; if (backToAmbient) showAmbient(); else if (ui.tab === 'more' && ui.more === 'settings') render(); });
  window.__pultBooted = true;
  persist();
  setInterval(tick, 15000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { ui.lastTouch = Date.now(); tick(); loadWeather(false); loadClaude(); loadRates(false); loadNews(false); loadSchedule(false); } });
  setInterval(() => { if (document.visibilityState === 'visible') loadWeather(false); }, 15 * 60000);
  setInterval(() => { if (document.visibilityState === 'visible') loadClaude(); }, 120000);
  setupUpdates();
  fetchProjects(false);
  loadWeather(false);
  loadClaude();
  loadRates(false);
  loadNews(false);
  setInterval(() => { if (document.visibilityState === 'visible') loadNews(false); }, 30 * 60000);
  loadSchedule(false);
  setInterval(() => { if (document.visibilityState === 'visible') loadSchedule(false); }, 10 * 60000);
}
boot().catch((e) => { console.error(e); window.__pultFail?.(); });
