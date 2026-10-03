import { getSetting } from './settings';
import { HAND_LINES, VOICE_CHARACTERS, VOICE_LINES } from './voiceLines';
import { translateHandName } from './handNames';

// Table announcements. Japanese plays the chosen VOICEVOX character's recorded clips (no names or
// amounts); Chinese, English, and any clip that fails to load, are read by the browser's own
// voice. A new announcement always cuts off the one still playing, so the voice keeps up with play.
const CHINESE = {
  fold: (p) => `${p.name} 弃牌`,
  check: (p) => `${p.name} 过牌`,
  call: (p) => `${p.name} 跟注 ${p.betThisRound}`,
  raise: (p) => `${p.name} 加注到 ${p.betThisRound}`,
  allin: (p) => `${p.name} 全下`,
};
const CHINESE_LINES = {
  title: '千王之王', start: '游戏开始', flop: '翻牌', turn: '转牌', river: '河牌',
  ten_seconds: '还剩十秒', trick_pick: '请选择千术', trick_used: '千术发动',
  win: '你赢了', lose: '可惜', decided: '胜负已分',
};
const ENGLISH_LINES = {
  title: 'King of Kings', start: 'The game begins', flop: 'The flop', turn: 'The turn', river: 'The river',
  ten_seconds: 'Ten seconds left', trick_pick: 'Choose your trick', trick_used: 'Trick activated',
  win: 'You win', lose: 'Too bad', decided: 'Hand over',
};
const ENGLISH = {
  fold: (p) => `${p.name} folds`,
  check: (p) => `${p.name} checks`,
  call: (p) => `${p.name} calls ${p.betThisRound}`,
  raise: (p) => `${p.name} raises to ${p.betThisRound}`,
  allin: (p) => `${p.name} is all in`,
};

const VOICE = {
  ja: { lang: 'ja-JP', pitch: 0.88, rate: 1.08, preferred: [/Nanami|七海/i, /Mayu|真夕/i, /Haruka|春香|ハルカ/i, /Ayumi|歩美|あゆみ/i, /Google 日本語/i, /Kyoko/i, /O-?ren/i, /Mizuki/i] },
  zh: { lang: 'zh-CN', pitch: 1, rate: 1.15, preferred: [/Xiaoxiao|晓晓/i, /Huihui|慧慧/i, /Google 普通话/i, /Ting-?Ting/i] },
  en: { lang: 'en-US', pitch: 1, rate: 1.08, preferred: [/Samantha/i, /Jenny/i, /Aria/i, /Google US English/i] },
};
// System voices that are male (browsers may list them under their local names); never picked.
const MALE_VOICES = /Ichiro|一郎|Keita|圭太|Otoya|Hattori|Naoki|直樹|Takumi|Daichi|大地|Yunxi|云希|Yunjian|云健|Kangkang|康康/i;

export function isSpeechAvailable() {
  return typeof window !== 'undefined' && (!!window.speechSynthesis || !!(window.AudioContext || window.webkitAudioContext));
}

// ---------- recorded clips ----------
let context = null;
const clips = new Map();
const missingClips = new Set();
let playing = null;
let sequence = 0;

function audioContext() {
  if (!context) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) context = new AudioContextClass();
  }
  return context;
}

// Clips are kept per character, so switching character never plays the previous voice.
function clipKey(id) {
  const chosen = getSetting('voiceCharacter');
  const character = VOICE_CHARACTERS.find((c) => c.id === chosen) || VOICE_CHARACTERS[0];
  return `${character.id}/${id}`;
}

function loadClip(id) {
  const key = clipKey(id);
  if (!clips.has(key)) {
    clips.set(key, fetch(`/voice/${key}.wav`)
      .then((response) => {
        if (!response.ok) throw new Error(`voice clip ${key} unavailable`);
        return response.arrayBuffer();
      })
      .then((data) => audioContext().decodeAudioData(data))
      .catch((error) => {
        clips.delete(key);
        missingClips.add(key);
        throw error;
      }));
  }
  return clips.get(key);
}

// Lines waiting for the clip now playing to finish; `busy` is true from the moment a clip is
// asked for until its chain and this queue have run out.
let queue = [];
let busy = false;

function stopEverything() {
  sequence += 1;
  try { playing?.stop(); } catch { /* already finished */ }
  playing = null;
  queue = [];
  busy = false;
  clearTimeout(pendingLine);
  if (window.speechSynthesis) window.speechSynthesis.cancel();
}

// Plays a clip, then each line in `next` after it, unless a newer announcement cuts in.
function playClip(id, next = []) {
  stopEverything();
  busy = true;
  playChain([id, ...next], sequence);
}

// Plays the lines once the clip now playing ends, or straight away if nothing is playing.
function queueClips(lines) {
  if (busy) queue.push(...lines.filter((line) => !queue.includes(line)));
  else playClip(lines[0], lines.slice(1));
}

async function playChain([id, ...next], token) {
  const followUp = () => {
    if (token !== sequence) return;
    if (!next.length) [next, queue] = [queue, []];
    if (next.length) playChain(next, token);
    else busy = false;
  };
  const fallback = () => {
    busy = false;
    speakWithBrowser([id, ...next, ...queue.splice(0)].map((line) => VOICE_LINES[line]).join(''), 'ja', false);
  };
  if (missingClips.has(clipKey(id)) || !audioContext()) return fallback();
  try {
    const buffer = await loadClip(id);
    if (token !== sequence) return; // a newer announcement arrived while this one loaded
    const ctx = audioContext();
    // A context the page was never allowed to start stays suspended; don't wait on it forever.
    if (ctx.state !== 'running') await Promise.race([ctx.resume().catch(() => {}), new Promise((done) => setTimeout(done, 250))]);
    if (token !== sequence) return;
    if (ctx.state !== 'running') throw new Error('audio is still locked');
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = getSetting('speechVolume') / 100;
    source.connect(gain);
    gain.connect(ctx.destination);
    source.onended = () => {
      if (playing === source) playing = null;
      followUp();
    };
    source.start();
    playing = source;
  } catch {
    if (token === sequence) fallback();
  }
}

// ---------- browser voice ----------
function pickVoice(language) {
  const { lang, preferred } = VOICE[language];
  const voices = window.speechSynthesis.getVoices()
    .filter((voice) => voice.lang.replace('_', '-').toLowerCase().startsWith(lang.slice(0, 2)) && !MALE_VOICES.test(voice.name));
  for (const pattern of preferred) {
    const match = voices.find((voice) => pattern.test(voice.name));
    if (match) return match;
  }
  return voices[0] || null;
}

// Mobile Safari silently stops firing speech audio ~15s after the tab lost
// direct-gesture focus unless something keeps nudging it. Pausing/resuming
// the queue while an utterance is active works around this.
let keepAliveTimer = null;
function startKeepAlive() {
  if (keepAliveTimer) return;
  keepAliveTimer = setInterval(() => {
    if (!window.speechSynthesis.speaking) {
      clearInterval(keepAliveTimer);
      keepAliveTimer = null;
      return;
    }
    window.speechSynthesis.pause();
    window.speechSynthesis.resume();
  }, 4000);
}

// The short delay lets cancel() settle; a burst of calls only reads the last one.
let pendingLine = null;
function speakWithBrowser(text, language, interrupt = true) {
  if (!window.speechSynthesis) return;
  if (interrupt) stopEverything();
  pendingLine = setTimeout(() => {
    const utter = new SpeechSynthesisUtterance(text);
    const voice = pickVoice(language);
    utter.lang = voice?.lang || VOICE[language].lang;
    if (voice) utter.voice = voice;
    utter.pitch = VOICE[language].pitch;
    utter.rate = VOICE[language].rate;
    utter.volume = getSetting('speechVolume') / 100;
    window.speechSynthesis.speak(utter);
    startKeepAlive();
  }, 60);
}

// ---------- announcements ----------
// `after` waits for the line now playing instead of cutting it off, so a street or a
// result is heard after the action that caused it.
function speakLine(lines, { after = false } = {}) {
  if (!getSetting('speech')) return;
  const voice = getSetting('voice');
  if (voice === 'ja') return after ? queueClips(lines) : playClip(lines[0], lines.slice(1));
  const words = voice === 'en' ? ENGLISH_LINES : CHINESE_LINES;
  speakWithBrowser(lines.map((id) => words[id]).join(voice === 'en' ? '. ' : '，'), voice, !after);
}

export function speakAction(player) {
  if (!getSetting('speech') || !CHINESE[player.lastAction]) return;
  const voice = getSetting('voice');
  if (voice === 'ja') playClip(player.lastAction);
  else speakWithBrowser((voice === 'en' ? ENGLISH : CHINESE)[player.lastAction](player), voice);
}

export const speakTitle = () => speakLine(['title']);
// The first trick pick of a match follows the opening line rather than replacing it.
export const speakMatchStart = ({ trickPick = false } = {}) => speakLine(['title', 'start', ...(trickPick ? ['trick_pick'] : [])]);
export const speakTrickPick = () => speakLine(['trick_pick'], { after: true });
export const speakTrickUsed = () => speakLine(['trick_used']);
export const speakTimeWarning = () => speakLine(['ten_seconds']);
export function speakStreet(stage) {
  const line = { FLOP: 'flop', TURN: 'turn', RIVER: 'river' }[stage];
  if (line) speakLine([line], { after: true });
}

// The settings preview plays even with announcements switched off.
export function previewVoice() {
  const voice = getSetting('voice');
  if (voice === 'ja') playClip('title', ['start']);
  else speakWithBrowser(voice === 'en' ? 'King of Kings. The game begins' : '千王之王，游戏开始', voice);
}

// winners: [{ name, amount, handName }]; iPlayed and iWon describe the viewer's own seat.
// At a showdown the winning hand is called first, then the result.
export function speakOutcome(winners, { iPlayed, iWon }) {
  if (!getSetting('speech') || !winners.length) return;
  const voice = getSetting('voice');
  const result = iWon ? 'win' : iPlayed ? 'lose' : 'decided';
  if (voice === 'ja') {
    const hand = HAND_LINES[winners[0].handName];
    return queueClips(hand ? [hand, result] : [result]);
  }
  speakWithBrowser(winners.map(({ name, amount, handName }) => {
    if (voice === 'en') return `${name} wins ${amount}${handName ? ` with ${handName}` : ''}`;
    return `${name} ${handName ? `${translateHandName(handName)} ` : ''}赢了 ${amount}`;
  }).join(voice === 'en' ? '. ' : '，'), voice, false);
}

// Most browsers only allow speech and Web Audio to produce sound once a real user gesture
// has unlocked the tab. Call this from inside a direct click handler; later announcements
// triggered by socket events will then be allowed to play.
export function unlockSpeech() {
  if (window.speechSynthesis) {
    const utter = new SpeechSynthesisUtterance(' ');
    utter.volume = 0;
    window.speechSynthesis.speak(utter);
    window.speechSynthesis.getVoices();
  }
  const ctx = audioContext();
  if (ctx?.state === 'suspended') ctx.resume().catch(() => {});
  preloadVoice();
}

// Fetches the chosen character's clips ahead of their first use.
export function preloadVoice() {
  if (audioContext() && getSetting('voice') === 'ja') Object.keys(VOICE_LINES).forEach((id) => loadClip(id).catch(() => {}));
}
