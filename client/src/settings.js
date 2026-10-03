import { useSyncExternalStore } from 'react';
import { VOICE_CHARACTERS } from './voiceLines';

// Player preferences kept on this device. Components read them with useSetting, so a change
// made on the settings screen reaches the table immediately.
const SETTINGS = {
  language: { key: 'poker_language', fallback: 'en', parse: (v) => (v === 'en' ? 'en' : 'zh'), store: (v) => v },
  sound: { key: 'poker_sound_enabled', fallback: true, parse: (v) => v !== '0', store: (v) => (v ? '1' : '0') },
  speech: { key: 'poker_speech_enabled', fallback: true, parse: (v) => v !== '0', store: (v) => (v ? '1' : '0') },
  voice: { key: 'poker_voice', fallback: 'ja', parse: (v) => (['ja', 'zh', 'en'].includes(v) ? v : 'ja'), store: (v) => v },
  voiceCharacter: { key: 'poker_voice_character', fallback: VOICE_CHARACTERS[0].id, parse: (v) => (VOICE_CHARACTERS.some((c) => c.id === v) ? v : VOICE_CHARACTERS[0].id), store: (v) => v },
  speechVolume: { key: 'poker_speech_volume', fallback: 75, parse: (v) => ([25, 50, 75, 100].includes(Number(v)) ? Number(v) : 75), store: String },
  soundVolume: { key: 'poker_sound_volume', fallback: 75, parse: (v) => ([25, 50, 75, 100].includes(Number(v)) ? Number(v) : 75), store: String },
  motion: { key: 'poker_motion', fallback: 'system', parse: (v) => (['system', 'on', 'off'].includes(v) ? v : 'system'), store: (v) => v },
};

// New visitors start in English. A device that has played before (it already has a name, player id
// or friend token) keeps Chinese, the language it has always had. The first choice is saved right away,
// so a newcomer who enters a name still sees English on the next visit.
function settleLanguage() {
  try {
    if (localStorage.getItem('poker_language') !== null) return;
    const returning = ['poker_lastName', 'poker_name', 'poker_playerId', 'poker_friend_token']
      .some((key) => localStorage.getItem(key) !== null);
    localStorage.setItem('poker_language', returning ? 'zh' : 'en');
  } catch {
    // storage unavailable: the English fallback applies for this visit
  }
}
settleLanguage();

const listeners = new Set();
const values = {};

function read(name) {
  const { key, fallback, parse } = SETTINGS[name];
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : parse(raw);
  } catch {
    return fallback;
  }
}

for (const name of Object.keys(SETTINGS)) values[name] = read(name);

function applyMotion() {
  if (typeof document !== 'undefined') document.documentElement.dataset.motion = values.motion;
}
applyMotion();

export function getSetting(name) {
  return values[name];
}

export function setSetting(name, value) {
  values[name] = value;
  try {
    localStorage.setItem(SETTINGS[name].key, SETTINGS[name].store(value));
  } catch {
    // storage unavailable, the choice lasts for this visit
  }
  if (name === 'motion') applyMotion();
  listeners.forEach((listener) => listener());
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSetting(name) {
  const value = useSyncExternalStore(subscribe, () => values[name]);
  return [value, (next) => setSetting(name, next)];
}

// Animation off either by choice here, or by the system when left on "follow system".
export function motionReduced() {
  if (values.motion === 'on') return false;
  if (values.motion === 'off') return true;
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
