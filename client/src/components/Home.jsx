import { useEffect, useRef, useState } from 'react';
import Settings from './Settings';
import Avatar, { DEFAULT_AVATAR } from './Avatar';
import Profile from './Profile';
import Friends from './Friends';
import { Events, EmptyPage } from './Extras';
import Collection from './Collection';
import TitleBackdrop from './TitleBackdrop';
import { nameplateProps } from '../nameplates';
import { loadBio, saveBio } from '../bio';

function rememberedName() {
  try {
    return localStorage.getItem('poker_lastName') || localStorage.getItem('poker_name') || '';
  } catch {
    return '';
  }
}

function rememberedAvatar() {
  try {
    return localStorage.getItem('poker_lastAvatar') || localStorage.getItem('poker_avatar') || DEFAULT_AVATAR;
  } catch {
    return DEFAULT_AVATAR;
  }
}

// Arrow keys walk the menu the way a controller would; Enter already clicks the focused button.
function moveFocus(event) {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  const items = [...event.currentTarget.querySelectorAll('button')];
  const index = items.indexOf(document.activeElement);
  const step = event.key === 'ArrowDown' ? 1 : -1;
  items[(index + step + items.length) % items.length]?.focus();
  event.preventDefault();
}

function PanelHeading({ children }) {
  return <h2 className="title-panel-heading"><span>{children}</span></h2>;
}

export default function Home({ onCreate, onJoin, onListRooms, initialCode, nameplate, onNameplate }) {
  const [name, setName] = useState(rememberedName);
  const [avatar, setAvatar] = useState(rememberedAvatar);
  const [bio, setBio] = useState(loadBio);
  const [code, setCode] = useState(initialCode || '');
  const [panel, setPanel] = useState(initialCode ? 'join' : 'menu');
  const [afterIdentity, setAfterIdentity] = useState(null);
  const [page, setPage] = useState(null);
  const [rooms, setRooms] = useState([]);
  const [loadingRooms, setLoadingRooms] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    try {
      localStorage.setItem('poker_lastName', name);
      localStorage.setItem('poker_lastAvatar', avatar);
    } catch {
      // storage unavailable, keep the selection for this visit
    }
    saveBio(bio);
  }, [name, avatar, bio]);

  function refreshRooms() {
    setLoadingRooms(true);
    onListRooms((list) => {
      setRooms(list);
      setLoadingRooms(false);
    });
  }

  useEffect(() => {
    if (panel === 'join') refreshRooms();
    if (panel === 'menu') menuRef.current?.querySelector('button')?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel]);

  useEffect(() => {
    if (panel === 'menu') return undefined;
    const back = (event) => { if (event.key === 'Escape') setPanel('menu'); };
    window.addEventListener('keydown', back);
    return () => window.removeEventListener('keydown', back);
  }, [panel]);

  function enterRoom(kind) {
    if (kind === 'create') onCreate(name.trim(), avatar);
    else onJoin(code.trim().toUpperCase(), name.trim(), avatar);
  }

  // Every way into a room needs a nickname first; the identity panel resumes the action afterwards.
  function requireName(kind) {
    if (name.trim()) return enterRoom(kind);
    setAfterIdentity(kind);
    setPanel('identity');
  }

  function join(event) {
    event.preventDefault();
    if (code.trim()) requireName('join');
  }

  function finishIdentity(event) {
    event.preventDefault();
    if (!name.trim()) return;
    const next = afterIdentity;
    setAfterIdentity(null);
    setPanel(next === 'join' ? 'join' : 'menu');
    if (next) enterRoom(next);
  }

  const plate = nameplateProps(nameplate);

  return (
    <main className={`title-screen panel-${panel}`}>
      <TitleBackdrop />
      {page === 'settings' && <Settings onClose={() => setPage(null)} />}
      {page === 'profile' && (
        <Profile name={name} onName={setName} avatar={avatar} onAvatar={setAvatar} bio={bio} onBio={setBio}
          nameplate={nameplate} onNameplate={onNameplate} onClose={() => setPage(null)} />
      )}
      {page === 'friends' && <Friends name={name} avatar={avatar} onClose={() => setPage(null)} />}
      {page === 'events' && <Events onClose={() => setPage(null)} />}
      {page === 'collection' && <Collection onClose={() => setPage(null)} />}
      {page === 'shop' && <EmptyPage title="商店" onClose={() => setPage(null)} />}

      <header className="title-brand">
        {/* Heavy white name over a red dry-brush 千王, the way a film title card pairs a word with its calligraphy. */}
        <h1 className="title-logo" aria-label="千王之王2026">
          <img className="title-logo-brush" src="/textures/title-brush.svg" alt="" aria-hidden="true" draggable="false" />
          <span className="title-logo-word" aria-hidden="true">
            <span className="title-char" data-c="千">千</span>
            {/* 王 is the king, so it gets dealt onto a K of spades. */}
            <span className="title-card">
              <span className="title-card-index">K<i>♠</i></span>
              <span className="title-card-char">王</span>
              <span className="title-card-index flipped">K<i>♠</i></span>
            </span>
            <span className="title-char" data-c="之">之</span>
            <span className="title-char" data-c="王">王</span>
          </span>
          <span className="title-year" aria-hidden="true">2026</span>
        </h1>
      </header>

      <section className="title-stage">
        {panel === 'menu' && (
          <nav className="title-menu" aria-label="主菜单" ref={menuRef} onKeyDown={moveFocus}
            onMouseOver={(event) => event.target.closest('button')?.focus({ preventScroll: true })}>
            <button type="button" onClick={() => requireName('create')}>创建房间</button>
            <button type="button" onClick={() => setPanel('join')}>加入房间</button>
            <button type="button" onClick={() => setPage('settings')}>设置</button>
          </nav>
        )}

        {panel === 'join' && (
          <form className="title-panel" onSubmit={join} aria-label="加入房间">
            <PanelHeading>加入房间</PanelHeading>
            <div className="title-rooms-head">
              <span>可加入的房间</span>
              <button type="button" className="title-text-btn" onClick={refreshRooms}>{loadingRooms ? '刷新中' : '刷新'}</button>
            </div>
            {!loadingRooms && rooms.length === 0 && <p className="title-empty">暂时没有公开的房间</p>}
            {rooms.length > 0 && (
              <ul className="title-rooms">
                {rooms.map((r) => (
                  <li key={r.code}>
                    <button type="button" className={code === r.code ? 'chosen' : ''} onClick={() => setCode(r.code)}>
                      <strong>{r.code}</strong>
                      <span>房主 {r.hostName} · {r.playerCount}/10 人 · 盲注 {r.smallBlind}/{r.bigBlind}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <label className="title-field">
              <span>房间号</span>
              <input type="text" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="例如 A7B2C" maxLength={5} autoFocus={!!initialCode} />
            </label>
            <div className="title-panel-actions">
              <button type="submit" className="title-stamp" disabled={!code.trim()}>进入</button>
              <button type="button" className="title-back-btn" onClick={() => setPanel('menu')}>返回</button>
            </div>
          </form>
        )}

        {panel === 'identity' && (
          <form className="title-panel" onSubmit={finishIdentity} aria-label="我的身份">
            <PanelHeading>我的身份</PanelHeading>
            <label className="title-field">
              <span>昵称</span>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="你的名字"
                maxLength={20} autoFocus />
            </label>
            <div className="title-panel-actions">
              <button type="submit" className="title-stamp" disabled={!name.trim()}>{afterIdentity ? '确认' : '完成'}</button>
              <button type="button" className="title-back-btn" onClick={() => { setAfterIdentity(null); setPanel('menu'); }}>返回</button>
            </div>
          </form>
        )}
      </section>

      <footer className="title-footer">
        <button type="button" className={`title-identity ${plate.className}`} style={plate.style}
          onClick={() => setPage('profile')} aria-label="个人页面">
          <Avatar avatar={avatar} name={name} className="title-identity-avatar" />
          <span className="title-identity-copy">
            <strong>{name.trim() || '未填写昵称'}</strong>
            {bio.trim() && <small>{bio.trim()}</small>}
          </span>
        </button>
        <div className="title-footer-links">
          <button type="button" onClick={() => setPage('friends')}>好友</button>
          <button type="button" onClick={() => setPage('collection')}>藏品</button>
          <button type="button" onClick={() => setPage('shop')}>商店</button>
          <button type="button" onClick={() => setPage('events')}>活动</button>
        </div>
      </footer>
    </main>
  );
}
