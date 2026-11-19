import test from 'node:test';
import assert from 'node:assert/strict';
import { makeBackup, validateBackup, encodeBackup, decodeBackup, sourceFreshness } from '../src/backup.js';

const data = { tasks: [], notes: [], projects: [], settings: { scheduleKey: 'local-only', theme: 'aurora' }, knowledge: [], channelStats: [] };

test('Резервная копия включает актуальные проекты и не содержит пароль календаря', () => {
  const project = { id: 'example', name: 'Пример' };
  const backup = makeBackup(data, [project]);
  assert.deepEqual(backup.data.projects, [project]);
  assert.equal(backup.data.settings.scheduleKey, undefined);
  assert.equal(data.settings.scheduleKey, 'local-only');
  assert.equal(backup.version, 2);
});

test('Поддерживаются старые копии, отклоняются неполные документы', () => {
  assert.deepEqual(validateBackup({ app: 'pult', version: 1, data }), data);
  assert.throws(() => validateBackup({ app: 'pult', version: 2, data: {} }));
  assert.throws(() => validateBackup({ app: 'pult', version: 2, data: { ...data, notes: [null] } }));
});

test('Защищённая копия переносится с отдельным паролем', async () => {
  const backup = makeBackup(data, []);
  const encrypted = await encodeBackup(backup, 'example-secret-only');
  assert.equal(encrypted.app, 'pult-encrypted');
  assert.deepEqual(await decodeBackup(encrypted, 'example-secret-only'), backup.data);
});

test('Отличает время источника от свежести получения файла', () => {
  const now = Date.parse('2026-11-19T12:00:00Z');
  assert.equal(sourceFreshness('2026-11-19T10:00:00Z', 30, now), 'fresh');
  assert.equal(sourceFreshness('2026-11-16T10:00:00Z', 30, now), 'stale');
  assert.equal(sourceFreshness('', 30, now), 'unknown');
});
