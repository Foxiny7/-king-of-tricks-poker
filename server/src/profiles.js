import fs from 'node:fs';
import path from 'node:path';
import { solve, pickWinners } from './handEvaluator.js';

export const NAMEPLATE_IDS = ['plain', 'gold', 'jade', 'sakura', 'neon', 'wave', 'nebula',
  'flame', 'frost', 'bamboo', 'royal', 'dragon'];

export function normalizeNameplate(id) {
  return NAMEPLATE_IDS.includes(id) ? id : 'plain';
}

const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;

// Records reset every Monday 00:00 Beijing time, shared by players in every timezone.
export function weekStart(now = Date.now()) {
  const local = new Date(now + BEIJING_OFFSET_MS);
  const daysSinceMonday = (local.getUTCDay() + 6) % 7;
  return Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - daysSinceMonday)
    - BEIJING_OFFSET_MS;
}

const cardCode = (card) => `${card.value}${card.suit}`;
const MATCH_LIMIT = 30;

export function createProfileStore({ file = null } = {}) {
  let records = {};
  let saveTimer = null;
  if (file) {
    try {
      records = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      records = {};
    }
  }

  function persist() {
    if (!file || saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const temp = `${file}.tmp`;
      fs.writeFileSync(temp, JSON.stringify(records));
      fs.renameSync(temp, file);
    }, 500);
    saveTimer.unref?.();
  }

  function recordFor(name) {
    if (!records[name]) records[name] = {};
    return records[name];
  }

  function weeklyBest(name, now = Date.now()) {
    const record = records[name];
    return record?.best && record.weekStart === weekStart(now) ? record.best : null;
  }

  function recordWin(name, holeCards, community, now = Date.now()) {
    if (!name || !holeCards?.every(Boolean) || community.length < 3) return false;
    const hand = solve([...holeCards, ...community]);
    const current = weeklyBest(name, now);
    if (current) {
      const previous = solve(current.cards);
      const winners = pickWinners([previous, hand]);
      if (winners.length !== 1 || winners[0] !== hand) return false;
    }
    const record = recordFor(name);
    record.weekStart = weekStart(now);
    record.best = {
      handName: hand.descr === 'Royal Flush' ? 'Royal Flush' : hand.name,
      cards: hand.cards.map(cardCode),
      at: now,
    };
    persist();
    return true;
  }

  // Newest first; only the final score of each finished match is kept for now.
  function recordMatch(name, { mode, score }, now = Date.now()) {
    if (!name) return;
    const record = recordFor(name);
    record.matches = [{ at: now, mode, score }, ...(record.matches || [])].slice(0, MATCH_LIMIT);
    // Totals outlive the capped list, so the profile can show every match ever played.
    record.played = (record.played || 0) + 1;
    record.bestScore = Math.max(record.bestScore ?? score, score);
    persist();
  }

  function matches(name) {
    return records[name]?.matches || [];
  }

  function stats(name) {
    const record = records[name];
    return { played: record?.played || 0, bestScore: record?.bestScore ?? null };
  }

  return { weeklyBest, recordWin, recordMatch, matches, stats };
}
