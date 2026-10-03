import { useSyncExternalStore } from 'react';

// The voice call lives in App so it survives moving between the lobby and the table; each screen
// marks where its toolbar button goes with <span ref={voiceSlotRef} />, and VoiceChat draws there.
let slot = null;
const listeners = new Set();

export function voiceSlotRef(node) {
  if (node) slot = node;
  else if (slot && !slot.isConnected) slot = null;
  listeners.forEach((listener) => listener());
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useVoiceSlot() {
  return useSyncExternalStore(subscribe, () => (slot?.isConnected ? slot : null));
}
