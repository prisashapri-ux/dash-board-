// Хранение данных в браузере: IndexedDB, запасной вариант localStorage.
// Сервера нет: всё остаётся на этом устройстве, переносится резервной копией.

const DB_NAME = 'pult';
const STORE = 'kv';
const KEY = 'state';
const LS_KEY = 'pult-state';

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) return reject(new Error('no idb'));
    // Если база зависла без ответа, через 3 секунды уходим на localStorage.
    const t = setTimeout(() => { dbPromise = null; reject(new Error('idb timeout')); }, 3000);
    let req;
    try { req = indexedDB.open(DB_NAME, 1); } catch (e) { clearTimeout(t); return reject(e); }
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => { clearTimeout(t); resolve(req.result); };
    req.onerror = () => { clearTimeout(t); reject(req.error); };
  });
  return dbPromise;
}

function idb(mode, fn) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }));
}

export async function loadState() {
  try {
    const v = await idb('readonly', (s) => s.get(KEY));
    if (v) return v;
  } catch { /* перейдём на localStorage */ }
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* нет хранилища */ }
  return null;
}

let timer = null;
let pending = null;

async function write(state) {
  try {
    await idb('readwrite', (s) => s.put(state, KEY));
    try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ }
    return true;
  } catch {
    try { localStorage.setItem(LS_KEY, JSON.stringify(state)); return true; } catch { notifyFail(); return false; }
  }
}

let failNotified = 0;
function notifyFail() {
  if (Date.now() - failNotified < 60000) return;
  failNotified = Date.now();
  globalThis.dispatchEvent?.(new Event('pult-save-failed'));
}

const SNAP = 'before-restore';
/** Копия данных перед восстановлением из файла, чтобы можно было вернуть как было. */
export async function saveSnapshot(state) {
  try { await idb('readwrite', (s) => s.put({ at: new Date().toISOString(), state }, SNAP)); return true; } catch { return false; }
}
export async function loadSnapshot() {
  try { return (await idb('readonly', (s) => s.get(SNAP))) || null; } catch { return null; }
}

/** Сохраняет с небольшой задержкой, чтобы не писать на каждое нажатие клавиши. */
export function saveState(state) {
  pending = state;
  clearTimeout(timer);
  timer = setTimeout(flush, 300);
}

export function flush() {
  clearTimeout(timer);
  if (!pending) return Promise.resolve(true);
  const s = pending;
  pending = null;
  return write(s);
}

/** Просит браузер не удалять данные при нехватке места. */
export async function persist() {
  try {
    if (navigator.storage?.persisted && (await navigator.storage.persisted())) return true;
    return (await navigator.storage?.persist?.()) || false;
  } catch {
    return false;
  }
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
  addEventListener('pagehide', () => flush());
}
