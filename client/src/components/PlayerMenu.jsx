import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import GesturePicker from './GesturePicker';

const GIFTS = [
  '🌹', '🍺', '👑', '🎉', '💎', '🍕', '🚀', '🐷',
  '🍾', '🏆', '💰', '🎂', '🍫', '🧧', '🎁', '🌟', '🍷', '🦄', '🎈', '🍀',
];

// The ··· beside another player, at the table and in the lobby list. The list is drawn on
// document.body so no scrolling panel or seat clips it, and it opens towards whichever side has
// room, staying clear of the pinned action bar. Actions without a handler are left out.
export default function PlayerMenu({ name, onProfile, onAddFriend, onGift, onRebuy, onKick, className = '' }) {
  const [open, setOpen] = useState(false);
  const [giftOpen, setGiftOpen] = useState(false);
  const [place, setPlace] = useState(null);
  const toggleRef = useRef(null);
  const listRef = useRef(null);

  useLayoutEffect(() => {
    if (!open) return;
    const anchor = toggleRef.current.getBoundingClientRect();
    const list = listRef.current.getBoundingClientRect();
    const floor = Math.min(window.innerHeight, document.querySelector('.action-bar')?.getBoundingClientRect().top ?? Infinity);
    let left = anchor.right - list.width;
    if (left < 8) left = anchor.left;
    left = Math.max(8, Math.min(left, window.innerWidth - list.width - 8));
    let top = anchor.bottom + 4;
    if (top + list.height > floor - 4) top = anchor.top - 4 - list.height;
    setPlace({ left, top: Math.max(8, top) });
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const close = () => setOpen(false);
    const outside = (event) => {
      if (!toggleRef.current?.contains(event.target) && !listRef.current?.contains(event.target)) close();
    };
    const escape = (event) => { if (event.key === 'Escape') close(); };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [open]);

  const choose = (action) => () => { setOpen(false); action(); };
  return (
    <div className={`player-menu ${className}`}>
      <button type="button" ref={toggleRef} className="player-menu-toggle" aria-haspopup="menu" aria-expanded={open}
        aria-label={`${name}的操作`} onClick={() => { setPlace(null); setOpen((value) => !value); }}>···</button>
      {open && createPortal(
        <div className="player-menu-list" role="menu" ref={listRef}
          style={place ? { left: place.left, top: place.top } : { left: 0, top: 0, visibility: 'hidden' }}>
          {onProfile && <button type="button" role="menuitem" onClick={choose(onProfile)}>个人页面</button>}
          {onAddFriend && <button type="button" role="menuitem" onClick={choose(onAddFriend)}>加好友</button>}
          {onGift && <button type="button" role="menuitem" onClick={choose(() => setGiftOpen(true))}>送礼物</button>}
          {onRebuy && <button type="button" role="menuitem" onClick={choose(onRebuy)}>补筹码</button>}
          {onKick && <button type="button" role="menuitem" className="danger" onClick={choose(onKick)}>移出房间</button>}
        </div>,
        document.body,
      )}
      {giftOpen && (
        <GesturePicker title={`送礼物给 ${name}`} icons={GIFTS} onSelect={onGift} onClose={() => setGiftOpen(false)} />
      )}
    </div>
  );
}
