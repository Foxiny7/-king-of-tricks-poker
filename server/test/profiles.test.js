import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createProfileStore, weekStart, normalizeNameplate } from '../src/profiles.js';

const at = (iso) => Date.parse(iso);

test('weeks start on Monday 00:00 Beijing time', () => {
  const monday = at('2026-09-20T16:00:00Z'); // 2026-09-21 00:00 in Beijing
  assert.equal(weekStart(at('2026-09-26T04:00:00Z')), monday);
  assert.equal(weekStart(monday), monday);
  assert.equal(weekStart(monday - 1), at('2026-09-13T16:00:00Z'));
  assert.equal(weekStart(at('2026-09-27T15:59:59Z')), monday);
});

test('only a stronger hand replaces the weekly best, and a new week starts empty', () => {
  const store = createProfileStore();
  const now = at('2026-09-23T12:00:00Z');
  assert.equal(store.recordWin('阿杰', ['Ah', 'Ad'], ['7c', '8d', 'Ks', '2c', '3d'], now), true);
  assert.equal(store.weeklyBest('阿杰', now).handName, 'Pair');
  assert.equal(store.recordWin('阿杰', ['9h', '4h'], ['2h', 'Kh', 'Th', '3c', '5d'], now), true);
  const flush = store.weeklyBest('阿杰', now);
  assert.equal(flush.handName, 'Flush');
  assert.deepEqual(flush.cards.slice().sort(), ['2h', '4h', '9h', 'Kh', 'Th'].sort());
  assert.equal(store.recordWin('阿杰', ['Qs', 'Qd'], ['7c', '8d', 'Ks', '2c', '3d'], now), false);
  assert.equal(store.weeklyBest('阿杰', now).handName, 'Flush');
  assert.equal(store.weeklyBest('阿杰', at('2026-09-28T16:00:00Z')), null);
  assert.equal(store.weeklyBest('别人', now), null);
});

test('a royal flush is recorded under its own name', () => {
  const store = createProfileStore();
  store.recordWin('王小明', ['Ah', 'Kh'], ['Qh', 'Jh', 'Th', '2c', '3d']);
  assert.equal(store.weeklyBest('王小明').handName, 'Royal Flush');
});

test('records survive a restart through the data file', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'poker-profiles-')), 'nested', 'profiles.json');
  const store = createProfileStore({ file });
  store.recordWin('阿杰', ['Ah', 'Ad'], ['Ac', '8d', 'Ks', '2c', '3d']);
  t.mock.timers.tick(600);
  const reloaded = createProfileStore({ file });
  assert.equal(reloaded.weeklyBest('阿杰').handName, 'Three of a Kind');
});

test('unknown nameplates fall back to the plain one', () => {
  assert.equal(normalizeNameplate('dragon'), 'dragon');
  assert.equal(normalizeNameplate('<script>'), 'plain');
  assert.equal(normalizeNameplate(undefined), 'plain');
});

test('match records keep the newest first, cap their length, and leave the weekly best alone', () => {
  const store = createProfileStore();
  const now = at('2026-09-23T12:00:00Z');
  store.recordWin('阿杰', ['Ah', 'Ad'], ['Ac', '8d', 'Ks', '2c', '3d'], now);
  for (let i = 0; i < 35; i++) store.recordMatch('阿杰', { mode: 'normal', score: 1000 + i }, now + i);
  store.recordMatch('阿杰', { mode: 'tricks', score: 4200 }, now + 99);
  const matches = store.matches('阿杰');
  assert.equal(matches.length, 30);
  assert.deepEqual(matches[0], { at: now + 99, mode: 'tricks', score: 4200 });
  assert.equal(matches[1].score, 1034);
  assert.equal(store.weeklyBest('阿杰', now).handName, 'Three of a Kind');
  assert.deepEqual(store.matches('别人'), []);
  assert.deepEqual(store.stats('阿杰'), { played: 36, bestScore: 4200 });
  assert.deepEqual(store.stats('别人'), { played: 0, bestScore: null });
});
