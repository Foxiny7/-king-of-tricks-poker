// A one-line self-introduction shown under the player's name; kept on this device.
export const BIO_MAX_LENGTH = 40;

export function loadBio() {
  try {
    return (localStorage.getItem('poker_bio') || '').slice(0, BIO_MAX_LENGTH);
  } catch {
    return '';
  }
}

export function saveBio(bio) {
  try {
    localStorage.setItem('poker_bio', bio.slice(0, BIO_MAX_LENGTH));
  } catch {
    // storage unavailable, the text lasts for this visit
  }
}
