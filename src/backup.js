import { encryptJson, decryptJson } from './logic.js';

const fields = ['tasks', 'notes', 'habits', 'finance', 'settings', 'projects', 'goals', 'countdowns', 'journal', 'routines', 'shopping', 'menu', 'savedNews', 'pipes', 'knowledge', 'channelStats'];
const arrays = ['tasks', 'notes', 'projects', 'goals', 'countdowns', 'shopping', 'menu', 'savedNews', 'knowledge', 'channelStats'];

export function makeBackup(state, projects, now = new Date()) {
  const data = {};
  for (const key of fields) if (state[key] !== undefined) data[key] = state[key];
  data.projects = projects;
  data.settings = { ...state.settings };
  delete data.settings.scheduleKey;
  return { app: 'pult', version: 2, exportedAt: now.toISOString(), data };
}

export function validateBackup(value) {
  if (!value || value.app !== 'pult' || ![1, 2].includes(value.version) || !value.data || typeof value.data !== 'object' || Array.isArray(value.data)) throw new Error('Неизвестный формат резервной копии');
  for (const key of arrays) {
    if (value.data[key] !== undefined && !Array.isArray(value.data[key])) throw new Error('Неверный формат: ' + key);
  }
  if (!Array.isArray(value.data.tasks) || !Array.isArray(value.data.notes) || !Array.isArray(value.data.projects)) throw new Error('Копия неполная');
  for (const item of value.data.notes) if (!item || typeof item.text !== 'string' || typeof item.createdAt !== 'string') throw new Error('Неверная заметка');
  for (const item of value.data.projects) if (!item || typeof item.id !== 'string' || typeof item.name !== 'string') throw new Error('Неверный проект');
  return value.data;
}

export async function encodeBackup(backup, password) {
  if (typeof password !== 'string' || password.length < 12) throw new Error('Пароль копии должен содержать минимум 12 символов');
  return { app: 'pult-encrypted', version: 1, enc: await encryptJson(backup, password) };
}

export async function decodeBackup(value, password) {
  return validateBackup(value?.app === 'pult-encrypted' ? await decryptJson(value.enc, password) : value);
}

export function sourceFreshness(date, maxHours = 30, now = Date.now()) {
  const time = Date.parse(date || '');
  if (!Number.isFinite(time)) return 'unknown';
  return now - time > maxHours * 3600000 ? 'stale' : 'fresh';
}
