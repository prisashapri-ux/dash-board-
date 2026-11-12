import * as L from './logic.js';
import { loadState, saveState, flush, persist, saveSnapshot } from './store.js';

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
  };
}
let S = defaults();
const ui = { tab: 'home', more: 'habits', noteQuery: '', modal: null, addDate: null, habitEdit: false, cityResults: null, wxState: '', lastKey: '' };

function normalize(raw) {
  const d = defaults();
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    ...d, ...r,
    tasks: Array.isArray(r.tasks) ? r.tasks : [], notes: Array.isArray(r.notes) ? r.notes : [],
    habits: { list: Array.isArray(r.habits?.list) ? r.habits.list : d.habits.list, checks: r.habits?.checks || {} },
    finance: { entries: Array.isArray(r.finance?.entries) ? r.finance.entries : [], budget: Number(r.finance?.budget) || 0 },
    settings: { ...d.settings, ...(r.settings || {}) },
    projects: Array.isArray(r.projects) ? r.projects : [],
    remote: r.remote?.projects ? r.remote : d.remote,
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
<div class="muted tiny">Обновлено в ${L.formatTime(at)}${ui.wxState === 'fail' ? ' · сейчас нет сети, показаны прошлые данные' : ''}</div></section>`;
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
  return `<section class="card"><h2>Проекты</h2>${projects().map((p) => `<div class="item"><span style="font-size:22px;margin-right:10px">${esc(p.emoji)}</span><div class="grow">${esc(p.name)}<div class="bar"><span style="width:${p.progress}%"></div></div></div><span class="chip">${p.progress}%</span></div>`).join('')}</section>`;
}
function homeView() {
  const now = new Date(), today = todayISO(), tomorrow = L.addDays(today, 1), m = mode();
  const g = L.groupTasks(S.tasks, today);
  const seg = ['auto', 'morning', 'day', 'evening'].map((k, i) => `<button class="${S.settings.mode === k ? 'on' : ''}" data-act="mode" data-mode="${k}">${['Авто', 'Утро', 'День', 'Вечер'][i]}</button>`).join('');
  let out = `<div class="grid2"><section class="card"><div class="clock" id="clock">${L.formatTime(now)}</div><div class="date" id="date">${esc(L.formatDateRu(now))}</div><div class="muted tiny" style="margin-top:8px">Режим: ${{ morning: 'утро', day: 'день', evening: 'вечер' }[m]}${S.settings.mode === 'auto' ? ' (по времени)' : ' (вручную)'}</div></section>${weatherCard()}</div><div class="seg">${seg}</div>${claudeCard()}`;
  const todayCard = `<section class="card"><h2>Сегодня</h2>${g.overdue.length ? `<div class="chip bad">Просрочено: ${g.overdue.length}</div>${taskList(g.overdue)}` : ''}${taskList(g.today)}${quickTask(today, '+ задача на сегодня')}</section>`;
  if (m === 'morning') out += `<div class="grid2">${todayCard}${projectsNext()}</div>`;
  else if (m === 'day') out += `<div class="grid2">${todayCard}${projectsSummary()}</div>`;
  else {
    const s = L.daySummary({ tasks: S.tasks, habits: S.habits.list, checks: S.habits.checks, entries: S.finance.entries, today, monthlyBudget: S.finance.budget });
    out += `<div class="grid2"><section class="card"><h2>Итоги дня</h2><div class="row">${ring(s.pct)}<div class="grow">
<div class="stat">Задачи: <b>${s.done} из ${s.total}</b></div><div class="stat">Привычки: <b>${s.habitsDone} из ${s.habitsTotal}</b></div>
<div class="stat">Потрачено: <b>${money(s.spent)}</b>${s.dailyBudget ? ` из ${money(s.dailyBudget)} в день` : ' <span class="muted">(бюджет не задан)</span>'}</div></div></div></section>
<section class="card"><h2>Завтра</h2>${taskList(g.tomorrow)}${quickTask(tomorrow, '+ задача на завтра')}</section></div>
<section class="card"><h2>Заметка</h2><form data-form="quick-note" class="addrow"><input class="wide" name="text" placeholder="+ заметка" autocomplete="off" required><button class="btn primary">Сохранить</button></form></section>`;
  }
  return out;
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
function projectModal(p) {
  return `<div class="sheet"><div class="row space"><h2>${esc(p.emoji)} ${esc(p.name)}</h2><button class="btn" data-act="close-modal">Закрыть</button></div>${p.subtitle ? `<p class="muted">${esc(p.subtitle)}</p>` : ''}
<label class="lbl">Этап</label><select data-pfield="stage">${L.STAGES.map((s) => `<option ${s === p.stage ? 'selected' : ''}>${s}</option>`).join('')}</select>
<label class="lbl">Прогресс: <span id="pprog">${p.progress}</span>%</label><input type="range" min="0" max="100" step="5" value="${p.progress}" data-pfield="progress">
<label class="lbl">Следующий шаг</label><input data-pfield="next" value="${esc(p.next)}" autocomplete="off">
<label class="lbl">Дедлайн</label><input type="date" data-pfield="deadline" value="${esc(p.deadline || '')}">
<h3 style="margin-top:16px">Задачи (${p.tasks.filter((t) => t.done).length}/${p.tasks.length})</h3>
${p.tasks.map((t) => `<div class="item ${t.done ? 'done' : ''}"><button class="chk ${t.done ? 'on' : ''}" data-act="toggle-ptask" data-id="${esc(t.id)}" aria-label="Отметить"></button><div class="ttl" style="padding:8px 4px">${esc(t.title)}${t.due ? `<span class="chip">до ${L.formatShortRu(t.due)}</span>` : ''}</div>
<input type="date" style="width:150px" data-ptask-due="${esc(t.id)}" value="${esc(t.due || '')}" aria-label="Срок"><button class="btn ghost danger" data-act="del-ptask" data-id="${esc(t.id)}" aria-label="Удалить">✕</button></div>`).join('') || '<div class="empty">Задач нет</div>'}
<form data-form="add-ptask" class="addrow" style="margin-top:10px"><input class="wide" name="title" placeholder="Новая задача проекта" autocomplete="off" required><input type="date" name="due"><button class="btn primary">Добавить</button></form>
${p.note ? `<p class="muted">${esc(p.note)}</p>` : ''}<p class="muted tiny">Изменено: ${esc(String(p.updated || '').slice(0, 16).replace('T', ' '))}</p></div>`;
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
  return `<section class="card"><form data-form="add-note"><textarea name="text" placeholder="Нажми микрофон на клавиатуре, чтобы надиктовать" required></textarea><div style="margin-top:8px"><button class="btn primary">Сохранить заметку</button></div></form></section>
<input type="search" id="notesearch" placeholder="Поиск по заметкам" value="${esc(ui.noteQuery)}" style="margin-bottom:12px"><div id="notelist">${noteCards()}</div>`;
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
  return `<section class="card"><h2>Новая трата</h2><form data-form="add-fin"><div class="addrow"><input class="num" name="amount" type="number" inputmode="decimal" step="any" min="0" placeholder="Сумма, ₽" required><select name="category">${L.CATEGORIES.map((c) => `<option>${c}</option>`).join('')}</select><input type="date" name="date" value="${today}" required></div>
<div class="addrow"><input class="wide" name="note" placeholder="Заметка (необязательно)" autocomplete="off"><button class="btn primary">Добавить</button></div></form></section>
<section class="card"><h2>Траты</h2><div class="tot"><div><span class="muted tiny">Сегодня</span><b>${money(f.today)}</b></div><div><span class="muted tiny">7 дней</span><b>${money(f.week)}</b></div><div><span class="muted tiny">Месяц</span><b>${money(f.month)}</b></div></div></section>
<section class="card"><h2>Бюджет на месяц</h2><form data-form="save-budget" class="addrow"><input class="num" name="budget" type="number" inputmode="decimal" min="0" step="any" value="${S.finance.budget || ''}" placeholder="Сумма, ₽"><button class="btn primary">Сохранить</button></form>
${S.finance.budget ? `<div class="kv"><span>Осталось</span><b style="color:${f.remaining < 0 ? 'var(--bad)' : 'inherit'}">${money(f.remaining)}</b></div><div class="kv"><span>Можно тратить в день (осталось дней: ${f.daysLeft})</span><b>${money(f.allowance)}</b></div>` : '<p class="muted">Задай бюджет, и здесь появится остаток и дневной лимит.</p>'}</section>
<section class="card"><h2>Записи за месяц</h2>${list.map((e) => `<div class="item"><div class="grow">${money(e.amount)} <span class="chip">${esc(e.category)}</span><div class="muted tiny">${L.formatShortRu(e.date)}${e.note ? ' · ' + esc(e.note) : ''}</div></div><button class="btn ghost danger" data-act="fin-del" data-id="${esc(e.id)}" aria-label="Удалить">✕</button></div>`).join('') || '<div class="empty">Трат пока нет</div>'}</section>`;
}
function statsView() {
  return `<section class="card"><h2>Статистика Twitch и YouTube</h2><p class="muted">Подключим позже — нужны ключи API.</p><p class="muted tiny">Пока можно сохранить названия каналов.</p>
<form data-form="save-stats"><label class="lbl">Twitch-канал</label><input name="twitch" value="${esc(S.settings.twitch)}" placeholder="deadsints" autocomplete="off"><label class="lbl">YouTube-канал</label><input name="youtube" value="${esc(S.settings.youtube)}" placeholder="@название" autocomplete="off"><div style="margin-top:10px"><button class="btn primary">Сохранить</button></div></form></section>`;
}
const hourOpts = (sel) => Array.from({ length: 24 }, (_, h) => `<option value="${h}" ${h === sel ? 'selected' : ''}>${String(h).padStart(2, '0')}:00</option>`).join('');
function settingsView() {
  const s = S.settings;
  return `<section class="card"><h2>Город для погоды</h2><p>Сейчас: <b>${esc(s.city)}</b> <span class="muted">(${s.lat}, ${s.lon})</span></p>
<form data-form="city-search" class="addrow"><input class="wide" name="q" placeholder="Название города" autocomplete="off" required><button class="btn primary">Найти</button></form>
${ui.cityResults ? (ui.cityResults.length ? ui.cityResults.map((c, i) => `<div class="item"><button class="ttl" data-act="city-pick" data-i="${i}">${esc(c.name)}<span class="chip">${esc([c.admin1, c.country].filter(Boolean).join(', '))}</span></button></div>`).join('') : '<div class="empty">Ничего не найдено или нет сети</div>') : ''}</section>
<section class="card"><h2>Режимы главной</h2><div class="addrow"><div style="flex:1 1 140px"><label class="lbl">Утро с</label><select data-set="morningFrom">${hourOpts(s.morningFrom)}</select></div><div style="flex:1 1 140px"><label class="lbl">День с</label><select data-set="dayFrom">${hourOpts(s.dayFrom)}</select></div><div style="flex:1 1 140px"><label class="lbl">Вечер с</label><select data-set="eveningFrom">${hourOpts(s.eveningFrom)}</select></div></div>
<label class="lbl">Ночная тема (тёмно-красная)</label><select data-set="night">${[['auto', 'Авто: вечером и ночью'], ['on', 'Всегда включена'], ['off', 'Выключена']].map(([v, t]) => `<option value="${v}" ${s.night === v ? 'selected' : ''}>${t}</option>`).join('')}</select></section>
<section class="card"><h2>Резервная копия</h2><p class="muted">Данные лежат только на этом устройстве. Сохрани копию, чтобы перенести их или не потерять.</p>
<div class="row wrap gap"><button class="btn primary" data-act="export-copy">Скопировать в буфер</button><a class="btn" id="dl" download="pult-backup.json" href="${backupUrl()}" style="display:inline-block;line-height:28px;text-decoration:none;color:var(--text)">Скачать файл</a></div>
<label class="lbl" style="margin-top:12px">Загрузить копию из файла (заменит данные)</label><input type="file" accept="application/json,.json" data-act-change="import"></section>
<section class="card"><h2>Лимиты Claude</h2><p class="muted">ID гиста, куда строка состояния Claude Code на ПК пишет лимиты. Как настроить — в README репозитория, раздел «Лимиты Claude».</p>
<form data-form="save-claude" class="addrow"><input class="wide" name="gist" value="${esc(s.claudeGist)}" placeholder="например, 3f2a…c91" autocomplete="off"><button class="btn primary">Сохранить</button></form></section>
<section class="card"><h2>Проекты</h2><p class="muted">projects.json обновлён: <b>${esc(S.remote.updated || 'ещё не загружен')}</b></p><button class="btn" data-act="projects-refresh">Обновить проекты</button></section>
<section class="card"><p class="muted tiny">Пульт · версия ${esc(VERSION)}</p></section>`;
}
function moreView() {
  const subs = [['habits', 'Привычки'], ['finance', 'Финансы'], ['stats', 'Статистика'], ['settings', 'Настройки']];
  return `<div class="seg">${subs.map(([k, t]) => `<button class="${ui.more === k ? 'on' : ''}" data-act="more" data-k="${k}">${t}</button>`).join('')}</div>${{ habits: habitsView, finance: financeView, stats: statsView, settings: settingsView }[ui.more]()}`;
}

/* ---------- Резервная копия ---------- */
function backupObject() {
  return { app: 'pult', version: 1, exportedAt: new Date().toISOString(), data: { tasks: S.tasks, notes: S.notes, habits: S.habits, finance: S.finance, settings: S.settings, projects: S.projects } };
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
const TABS = [['home', '🏠', 'Главная'], ['projects', '📁', 'Проекты'], ['tasks', '✅', 'Задачи'], ['notes', '📝', 'Заметки'], ['more', '⋯', 'Ещё']];
const VIEWS = { home: homeView, projects: projectsView, tasks: tasksView, notes: notesView, more: moreView };
function renderTabs() {
  $('#tabs').innerHTML = TABS.map(([k, ic, t]) => `<button class="${ui.tab === k ? 'on' : ''}" data-tab="${k}"><span class="ic">${ic}</span>${t}</button>`).join('');
}
function renderModal() {
  const m = $('#modal'), md = ui.modal;
  let html = '';
  if (md?.type === 'project') { const p = projectById(md.id); if (p) html = projectModal(p); }
  if (md?.type === 'task') { const t = S.tasks.find((x) => x.id === md.id); if (t) html = taskModal(t); }
  m.innerHTML = html; m.hidden = !html;
  document.body.style.overflow = html ? 'hidden' : '';
}
function applyTheme() {
  const night = L.isNight(S.settings, hour());
  document.body.classList.toggle('night', night);
  const meta = document.querySelector('meta[name=theme-color]'); if (meta) meta.content = night ? '#120a0a' : '#0f1115';
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
  ui.lastKey = renderKey();
}
const renderKey = () => `${mode()}|${L.isNight(S.settings, hour())}|${todayISO()}`;
function tick() {
  const now = new Date();
  const c = $('#clock'); if (c) { c.textContent = L.formatTime(now); $('#date').textContent = L.formatDateRu(now); }
  if (renderKey() !== ui.lastKey && !ui.modal && !document.activeElement?.matches?.('input, textarea, select')) render();
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
    if (!data) { try { data = L.parseWttr(await getJson(L.wttrUrl(lat, lon))); if (!data) errs.push('wttr.in: формат'); } catch (e) { errs.push('wttr.in: ' + (e && e.name === 'AbortError' ? 'таймаут' : (e && e.message) || 'ошибка')); } }
    if (!data) throw new Error(errs.join('; '));
    S.weather = { lat, lon, at: Date.now(), data }; ui.wxState = 'ok'; ui.wxError = ''; save();
  } catch (e) { ui.wxState = 'fail'; ui.wxError = (e && e.message) || ''; }
  if (ui.tab === 'home') render();
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
  'del-ptask': (d) => { editProject(ui.modal.id, (p) => { p.tasks = p.tasks.filter((t) => t.id !== d.id); }); render(); },
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
  'projects-refresh': () => fetchProjects(true),
};
const FORMS = {
  'quick-task': (f, el) => { const v = fd(el); S.tasks.push({ id: uid(), title: v.title.trim(), date: el.dataset.date, time: '', projectId: '', done: false }); },
  'add-task': (f, el) => { const v = fd(el); S.tasks.push({ id: uid(), title: v.title.trim(), date: v.date, time: v.time || '', projectId: v.projectId || '', done: false }); ui.addDate = null; },
  'save-task': (f, el) => { const t = byId(S.tasks, el.dataset.id), v = fd(el); if (t) Object.assign(t, { title: v.title.trim(), date: v.date, time: v.time || '', projectId: v.projectId || '' }); ui.modal = null; },
  'quick-note': (f, el) => { S.notes.push({ id: uid(), text: fd(el).text.trim(), createdAt: stamp(), pinned: false }); toast('Заметка сохранена'); },
  'add-note': (f, el) => { S.notes.push({ id: uid(), text: fd(el).text.trim(), createdAt: stamp(), pinned: false }); },
  'add-ptask': (f, el) => { const v = fd(el); editProject(ui.modal.id, (p) => p.tasks.push({ id: 'l' + uid(), title: v.title.trim(), done: false, due: v.due || null })); },
  'add-habit': (f, el) => { S.habits.list.push({ id: 'h' + uid(), name: fd(el).name.trim() }); },
  'add-fin': (f, el) => { const v = fd(el); S.finance.entries.push({ id: uid(), date: v.date, amount: Number(v.amount), category: v.category, note: v.note.trim() }); toast('Трата добавлена'); },
  'save-budget': (f, el) => { S.finance.budget = Number(fd(el).budget) || 0; toast('Бюджет сохранён'); },
  'save-claude': (f, el) => { S.settings.claudeGist = fd(el).gist.trim().replace(/^.*gist\.github\.com\/[^/]+\//, '').replace(/[^a-zA-Z0-9]/g, ''); S.claude = null; toast('Сохранено'); loadClaude(); },
  'save-stats': (f, el) => { const v = fd(el); S.settings.twitch = v.twitch.trim(); S.settings.youtube = v.youtube.trim(); toast('Сохранено'); },
  'city-search': (f, el) => { searchCity(fd(el).q.trim()); return 'skip'; },
};
document.addEventListener('submit', (e) => {
  e.preventDefault();
  const el = e.target, fn = FORMS[el.dataset.form]; if (!fn) return;
  if (fn(el.dataset.form, el) === 'skip') return;
  save(); el.reset?.();
  if (ui.modal?.type === 'project') renderModal();
  render();
});
document.addEventListener('click', (e) => {
  if (e.target.id === 'modal') { ui.modal = null; render(); return; }
  const tab = e.target.closest('[data-tab]');
  if (tab) { ui.tab = tab.dataset.tab; ui.modal = null; render(); window.scrollTo(0, 0); return; }
  const a = e.target.closest('[data-act]');
  if (a && ACTS[a.dataset.act]) ACTS[a.dataset.act](a.dataset);
});
document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.id === 'notesearch') { ui.noteQuery = t.value; $('#notelist').innerHTML = noteCards(); }
  if (t.dataset.pfield === 'progress') { const l = $('#pprog'); if (l) l.textContent = t.value; }
  if (t.dataset.hname) { const h = byId(S.habits.list, t.dataset.hname); if (h) { h.name = t.value; save(); } }
});
document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset.actChange === 'import' && t.files?.[0]) { importBackup(t.files[0]); t.value = ''; return; }
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
    S.settings[k] = ['morningFrom', 'dayFrom', 'eveningFrom'].includes(k) ? Number(t.value) : t.value;
    save(); render();
  }
});

/* ---------- Запуск ---------- */
async function boot() {
  S = normalize(await loadState());
  render();
  window.__pultBooted = true;
  persist();
  setInterval(tick, 15000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { tick(); loadWeather(false); loadClaude(); } });
  setInterval(() => { if (document.visibilityState === 'visible') loadClaude(); }, 120000);
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('sw.js').catch(() => {});
  fetchProjects(false);
  loadWeather(false);
  loadClaude();
}
boot().catch((e) => { console.error(e); window.__pultFail?.(); });
