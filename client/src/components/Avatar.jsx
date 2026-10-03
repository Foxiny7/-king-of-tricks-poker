export const DEFAULT_AVATAR = 'preset-1';

export function avatarSource(avatar) {
  if (/^preset-[1-7]$/.test(avatar || '')) return `/avatars/${avatar}.png`;
  if (/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(avatar || '')) return avatar;
  return null;
}

export default function Avatar({ avatar, name, className = '' }) {
  const source = avatarSource(avatar);
  return (
    <span className={`avatar ${className}`} aria-label={`${name || '玩家'}的头像`}>
      {source ? <img src={source} alt="" draggable="false" /> : Array.from(name || '玩')[0]}
    </span>
  );
}
