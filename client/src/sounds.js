import { getSetting } from './settings';

const victoryAudio = typeof Audio !== 'undefined' ? new Audio('/sounds/victory.ogg') : null;
const booAudio = typeof Audio !== 'undefined' ? new Audio('/sounds/boo.ogg') : null;

function playClip(audio) {
  if (!audio || !getSetting('sound')) return;
  audio.volume = getSetting('soundVolume') / 100;
  audio.currentTime = 0;
  audio.play().catch(() => {
    // playback blocked (e.g. not yet unlocked by a user gesture); ignore
  });
}

// Most mobile browsers block audio playback triggered by something other
// than a direct user gesture (like our socket-driven sound effects). Call
// this once from inside a real click handler to unlock both clips; later
// programmatic playback will then be allowed to actually produce sound.
export function unlockAudioContext() {
  [victoryAudio, booAudio].forEach((audio) => {
    if (!audio) return;
    const prevVolume = audio.volume;
    audio.volume = 0;
    audio
      .play()
      .then(() => {
        audio.pause();
        audio.currentTime = 0;
        audio.volume = prevVolume;
      })
      .catch(() => {
        audio.volume = prevVolume;
      });
  });
}

export function playVictorySound() {
  playClip(victoryAudio);
}

export function playBooSound() {
  playClip(booAudio);
}
