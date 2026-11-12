// Запускается в GitHub Actions перед выкладкой: забирает погоду и качество воздуха для города по умолчанию
// и кладёт в dist/data/weather.json. Так iPad получает погоду с сайта Пульта, даже если сам Open-Meteo из его сети не открывается.
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_SETTINGS, weatherUrl, airUrl } from '../src/logic.js';

const root = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const out = path.join(root, 'dist', 'data');
const { lat, lon } = DEFAULT_SETTINGS;
const get = async (url) => { const r = await fetch(url, { signal: AbortSignal.timeout(15000) }); if (!r.ok) throw new Error('http ' + r.status); return r.json(); };

try {
  const forecast = await get(weatherUrl(lat, lon));
  let air = null; try { air = await get(airUrl(lat, lon)); } catch { /* воздух не обязателен */ }
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'weather.json'), JSON.stringify({ lat, lon, fetchedAt: new Date().toISOString(), forecast, air }));
  console.log('weather.json готов');
} catch (e) {
  // Без погоды сайт всё равно выкладываем.
  console.log('Погоду забрать не удалось:', e.message);
}
