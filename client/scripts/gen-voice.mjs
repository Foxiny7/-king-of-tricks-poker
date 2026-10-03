// Records every announcer line for every character in src/voiceLines.js into
// public/voice/<character>/<line>.wav. Usage: open the VOICEVOX app (its engine listens on
// 127.0.0.1:50021), then run
//   node scripts/gen-voice.mjs                       all characters, all lines
//   node scripts/gen-voice.mjs --only=himari,ritsu    just these characters
//   node scripts/gen-voice.mjs --lines=title,flop     just these lines
// Each character's terms ask for the credit VOICEVOX:<name>; the settings screen shows them all.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { VOICE_CHARACTERS, VOICE_LINES } from '../src/voiceLines.js';

const ENGINE = process.env.VOICEVOX_URL || 'http://127.0.0.1:50021';
// A touch brisker and more sharply inflected than the default read, so the calls land like a dealer's.
const DELIVERY = { speedScale: 1.1, pitchScale: -0.03, intonationScale: 1.25, volumeScale: 1.1,
  prePhonemeLength: 0.05, postPhonemeLength: 0.08, outputSamplingRate: 24000, outputStereo: false };

const option = (name) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.split('=')[1].split(',');
const onlyCharacters = option('only');
const onlyLines = option('lines');

async function call(path, options) {
  const response = await fetch(`${ENGINE}${path}`, options);
  if (!response.ok) throw new Error(`${path} → ${response.status} ${await response.text()}`);
  return response;
}

const speakers = await (await call('/speakers')).json();
for (const character of VOICE_CHARACTERS) {
  if (onlyCharacters && !onlyCharacters.includes(character.id)) continue;
  const style = speakers.find((speaker) => speaker.name === character.speaker)?.styles.find((item) => item.name === character.style);
  if (!style) throw new Error(`VOICEVOX 里找不到 ${character.speaker}（${character.style}）`);
  const out = fileURLToPath(new URL(`../public/voice/${character.id}/`, import.meta.url));
  fs.mkdirSync(out, { recursive: true });
  for (const [id, text] of Object.entries(VOICE_LINES)) {
    if (onlyLines && !onlyLines.includes(id)) continue;
    const query = await (await call(`/audio_query?text=${encodeURIComponent(text)}&speaker=${style.id}`, { method: 'POST' })).json();
    const wav = await (await call(`/synthesis?speaker=${style.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...query, ...DELIVERY, ...character.delivery }),
    })).arrayBuffer();
    fs.writeFileSync(`${out}${id}.wav`, Buffer.from(wav));
  }
  console.log(`${character.speaker}（${character.style}）→ ${out}`);
}
