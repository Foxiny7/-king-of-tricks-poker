import { useEffect, useRef, useState } from 'react';
import { socket } from '../socket';
import { emojiIconSrc } from '../emojiIcons';

// The server's emote list (send_gesture); an emote also flies from the sender's seat at the table.
const EMOTES = [
  '👍', '👎', '😂', '😮', '😢', '🔥', '🤝', '🖕', '🤡', '💤',
  '😱', '🤔', '😎', '🙄', '👏', '🙏', '💪', '🤦', '😏', '🥳',
];
const QUICK_LINES = ['快点吧', '好牌！', '稳住别慌', '我全下了', '运气不错', '再来一局'];
const FADE_MS = 10000;
const MAX_LINES = 40;

const isTyping = (target) => target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

// Room chat in the manner of a MOBA's. At the table ('overlay') new lines show in the corner for a
// few seconds and fade; opening it (tap, or Enter on a keyboard) shows the whole log with the input,
// emotes and quick lines. In the lobby ('dock') it is always open inside its panel.
export default function RoomChat({ me, variant = 'overlay' }) {
  const docked = variant === 'dock';
  const [lines, setLines] = useState([]);
  const [open, setOpen] = useState(docked);
  const [tray, setTray] = useState(null); // 'emote' | 'quick' | null
  const [text, setText] = useState('');
  const [notice, setNotice] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const inputRef = useRef(null);
  const logRef = useRef(null);
  const focusOnOpen = useRef(false);

  // Lines from the history are stamped 0, so only lines that arrive now show in the fading corner.
  useEffect(() => {
    const load = () => socket.emit('chat_history', {}, (result) => {
      if (result?.ok) setLines(result.lines.map((line) => ({ ...line, seenAt: 0 })));
    });
    const onLine = (line) => setLines((all) => [...all, { ...line, seenAt: Date.now() }].slice(-MAX_LINES));
    load();
    socket.on('connect', load);
    socket.on('chat', onLine);
    return () => {
      socket.off('connect', load);
      socket.off('chat', onLine);
    };
  }, []);

  useEffect(() => {
    if (open) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [open]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [lines, open]);

  // Enter opens the chat on a keyboard, as in a MOBA; a tap opens it without raising the phone
  // keyboard, so an emote or quick line is one more tap.
  useEffect(() => {
    if (docked) return;
    const onKey = (event) => {
      if (event.key !== 'Enter' || open || isTyping(event.target) || document.querySelector('dialog[open]')) return;
      event.preventDefault();
      focusOnOpen.current = true;
      setOpen(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [docked, open]);

  useEffect(() => {
    if (open && focusOnOpen.current) inputRef.current?.focus({ preventScroll: true });
    focusOnOpen.current = false;
  }, [open]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 2500);
    return () => clearTimeout(timer);
  }, [notice]);

  function close() {
    if (docked) return;
    setOpen(false);
    setTray(null);
    inputRef.current?.blur();
  }

  function say(message, done) {
    socket.emit('chat_send', { text: message }, (result) => {
      if (result?.ok) done?.();
      else setNotice(result?.error || '发送失败');
    });
  }

  function submit(event) {
    event.preventDefault();
    if (!text.trim()) return close();
    say(text, () => setText(''));
  }

  // The tray stays open, so emotes can be sent one after another.
  function sendEmote(icon) {
    socket.emit('send_gesture', { type: 'emote', icon });
  }

  const visible = open ? lines : lines.filter((line) => now - line.seenAt < FADE_MS).slice(-5);

  return (
    <section className={`room-chat room-chat-${variant}${open ? ' open' : ''}`} aria-label="聊天"
      onKeyDown={(event) => { if (event.key === 'Escape') close(); }}>
      <ol className="room-chat-log" ref={logRef} aria-live="polite">
        {open && !lines.length && <li className="room-chat-empty">还没有人说话</li>}
        {visible.map((line) => (
          <li key={line.id} className={`room-chat-line kind-${line.kind}${line.from === me.playerId ? ' mine' : ''}${
            !open && now - line.seenAt > FADE_MS - 1500 ? ' fading' : ''}`}>
            <b>{line.name}</b>
            {line.kind === 'text' && <span>：{line.text}</span>}
            {line.kind === 'emote' && <span>：<img src={emojiIconSrc(line.icon)} alt={line.icon} /></span>}
            {line.kind === 'gift' && <span> 送给 <b>{line.to}</b> <img src={emojiIconSrc(line.icon)} alt={line.icon} /></span>}
          </li>
        ))}
      </ol>
      {open && tray === 'emote' && (
        <div className="room-chat-tray room-chat-emotes">
          {EMOTES.map((icon) => (
            <button type="button" key={icon} aria-label={`发送 ${icon}`} onClick={() => sendEmote(icon)}>
              <img src={emojiIconSrc(icon)} alt="" draggable={false} />
            </button>
          ))}
        </div>
      )}
      {open && tray === 'quick' && (
        <div className="room-chat-tray room-chat-quick">
          {QUICK_LINES.map((line) => <button type="button" key={line} onClick={() => say(line, () => setTray(null))}>{line}</button>)}
        </div>
      )}
      {notice && <p className="room-chat-notice" role="status">{notice}</p>}
      {open ? (
        <form className="room-chat-bar" onSubmit={submit}>
          <button type="button" className={`room-chat-tool${tray === 'emote' ? ' active' : ''}`} aria-label="表情" aria-pressed={tray === 'emote'}
            onClick={() => setTray(tray === 'emote' ? null : 'emote')}><img src={emojiIconSrc('😂')} alt="" /></button>
          <button type="button" className={`room-chat-tool${tray === 'quick' ? ' active' : ''}`} aria-pressed={tray === 'quick'}
            onClick={() => setTray(tray === 'quick' ? null : 'quick')}>快捷</button>
          <input ref={inputRef} value={text} maxLength={60} placeholder="说点什么…" aria-label="聊天内容" enterKeyHint="send"
            onChange={(event) => setText(event.target.value)} />
          <button type="submit" className="room-chat-send">发送</button>
          {!docked && <button type="button" className="room-chat-close" aria-label="收起聊天" onClick={close}>✕</button>}
        </form>
      ) : (
        <button type="button" className="room-chat-toggle" onClick={() => setOpen(true)}>聊天</button>
      )}
    </section>
  );
}
