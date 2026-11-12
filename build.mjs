// Собирает сайт в dist/: исходники, иконки и список файлов для офлайн-кэша.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root = path.dirname(new URL(import.meta.url).pathname);
const src = path.join(root, 'src');
const dist = path.join(root, 'dist');
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

const copy = (from, to) => fs.copyFileSync(from, path.join(dist, to));
for (const f of fs.readdirSync(src)) if (!['sw.js', 'index.html'].includes(f)) copy(path.join(src, f), f);
const icons = path.join(root, 'icons');
for (const f of fs.existsSync(icons) ? fs.readdirSync(icons) : []) copy(path.join(icons, f), f);
fs.writeFileSync(path.join(dist, '.nojekyll'), '');

const files = [];
const walk = (dir) => { for (const f of fs.readdirSync(dir)) { const p = path.join(dir, f); if (fs.statSync(p).isDirectory()) walk(p); else if (!f.startsWith('.')) files.push(path.relative(dist, p)); } };
walk(dist);
const hash = crypto.createHash('sha256');
for (const f of files.sort()) hash.update(f).update(fs.readFileSync(path.join(dist, f)));
hash.update(fs.readFileSync(path.join(src, 'index.html'))).update(fs.readFileSync(path.join(src, 'sw.js')));
const version = 'pult-' + hash.digest('hex').slice(0, 10);

let html = fs.readFileSync(path.join(src, 'index.html'), 'utf8').replaceAll('__VERSION__', version);
// Политика безопасности: скрипты только свои (встроенные разрешены по хешу), сеть только к своему сайту и Open-Meteo.
const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => `'sha256-${crypto.createHash('sha256').update(m[1]).digest('base64')}'`);
const csp = ["default-src 'self'", `script-src 'self' ${inline.join(' ')}`, "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:",
  "connect-src 'self' https://api.open-meteo.com https://geocoding-api.open-meteo.com", "worker-src 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'none'"].join('; ');
html = html.replace('<meta charset="utf-8">', `<meta charset="utf-8">\n<meta http-equiv="Content-Security-Policy" content="${csp}">`);
fs.writeFileSync(path.join(dist, 'index.html'), html);
const list = ['./', './index.html', ...files.map((f) => './' + f)];
fs.writeFileSync(path.join(dist, 'sw.js'), fs.readFileSync(path.join(src, 'sw.js'), 'utf8').replace('__VERSION__', version).replace('__FILES__', JSON.stringify(list)));
console.log(`dist/ готов: ${files.length + 2} файлов, версия ${version}`);
