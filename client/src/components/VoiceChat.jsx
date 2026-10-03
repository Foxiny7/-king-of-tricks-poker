import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useVoiceSlot } from '../voiceSlot';
import { socket, SERVER_URL } from '../socket';
import Avatar from './Avatar';

const FALLBACK_ICE = [{ urls: 'stun:stun.l.google.com:19302' }];

function VoiceIcon({ type, muted = false }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {type === 'mic' ? <><rect x="9" y="3" width="6" height="12" rx="3" /><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M9 22h6" /></>
        : type === 'volume' ? <><path d="m11 5-6 4H2v6h3l6 4V5Z" />{!muted && <path d="M15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14" />}</>
        : type === 'leave' ? <><path d="M10 4H4v16h6M9 12h12m-4-4 4 4-4 4" /></>
        : type === 'chevron' ? <path d="m6 9 6 6 6-6" />
        : <><path d="M4 14v-3a8 8 0 0 1 16 0v3" /><rect x="3" y="12" width="4" height="8" rx="2" /><rect x="17" y="12" width="4" height="8" rx="2" /></>}
      {muted && <path d="m3 3 18 18" />}
    </svg>
  );
}

export default function VoiceChat({ room, me }) {
  const [micOn, setMicOn] = useState(false);
  const [micMuted, setMicMuted] = useState(false);
  const [inputVolume, setInputVolume] = useState(100);
  const [joining, setJoining] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [mix, setMix] = useState({});
  const [micError, setMicError] = useState('');
  const [peerStatus, setPeerStatus] = useState({});
  const localStreamRef = useRef(null);
  const rawStreamRef = useRef(null);
  const inputGainRef = useRef(null);
  const peersRef = useRef(new Map());
  const audioElsRef = useRef(new Map());
  const pendingCandidatesRef = useRef(new Map()); // playerId -> candidates queued before remoteDescription is set
  const iceServersRef = useRef(null); // null = not loaded yet
  const joinedRef = useRef(false);
  const joinAttemptRef = useRef(0);
  const mixRef = useRef({});
  const audioContextRef = useRef(null);
  const audioNodesRef = useRef(new Map());

  function updateMix(peerId, changes) {
    const next = { volume: 100, muted: false, ...mixRef.current[peerId], ...changes };
    mixRef.current = { ...mixRef.current, [peerId]: next };
    setMix(mixRef.current);
    const volume = next.muted ? 0 : next.volume / 100;
    const nodes = audioNodesRef.current.get(peerId);
    const audioEl = audioElsRef.current.get(peerId);
    if (nodes) {
      nodes.gain.gain.value = volume;
    } else if (audioEl) {
      audioEl.volume = volume;
      audioEl.muted = next.muted || next.volume === 0;
    }
  }

  useEffect(() => {
    fetch(`${SERVER_URL}/ice-servers`)
      .then((r) => r.json())
      .then((servers) => {
        iceServersRef.current = Array.isArray(servers) && servers.length ? servers : FALLBACK_ICE;
      })
      .catch(() => {
        iceServersRef.current = FALLBACK_ICE;
      });
  }, []);

  const teardownPeer = useCallback((peerId) => {
    const nodes = audioNodesRef.current.get(peerId);
    if (nodes) {
      nodes.source.disconnect();
      nodes.gain.disconnect();
      audioNodesRef.current.delete(peerId);
    }
    const pc = peersRef.current.get(peerId);
    if (pc) {
      pc.close();
      peersRef.current.delete(peerId);
    }
    const audioEl = audioElsRef.current.get(peerId);
    if (audioEl) {
      audioEl.srcObject = null;
      audioEl.remove();
      audioElsRef.current.delete(peerId);
    }
    pendingCandidatesRef.current.delete(peerId);
    setPeerStatus((s) => {
      const next = { ...s };
      delete next[peerId];
      return next;
    });
  }, []);

  function getAudioEl(peerId) {
    let audioEl = audioElsRef.current.get(peerId);
    if (!audioEl) {
      audioEl = document.createElement('audio');
      audioEl.autoplay = true;
      audioEl.style.display = 'none';
      document.body.appendChild(audioEl);
      audioElsRef.current.set(peerId, audioEl);
    }
    return audioEl;
  }

  const createPeer = useCallback((peerId, initiator) => {
    if (peersRef.current.has(peerId)) return peersRef.current.get(peerId);
    const pc = new RTCPeerConnection({ iceServers: iceServersRef.current || FALLBACK_ICE });
    peersRef.current.set(peerId, pc);
    setPeerStatus((s) => ({ ...s, [peerId]: 'connecting' }));

    if (initiator) {
      pc.onnegotiationneeded = async () => {
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          socket.emit('voice_signal', { to: peerId, data: { type: 'offer', sdp: pc.localDescription } });
        } catch {
          // negotiation race, ignore
        }
      };
    }

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => pc.addTrack(t, localStreamRef.current));
    }

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        socket.emit('voice_signal', { to: peerId, data: { type: 'ice', candidate: e.candidate } });
      }
    };
    pc.ontrack = (e) => {
      const settings = mixRef.current[peerId] || { volume: 100, muted: false };
      // GainNode also supports independent volume on mobile browsers where
      // HTMLMediaElement.volume may be controlled only by the device.
      const context = audioContextRef.current;
      if (context) {
        const previous = audioNodesRef.current.get(peerId);
        previous?.source.disconnect();
        previous?.gain.disconnect();
        const source = context.createMediaStreamSource(e.streams[0]);
        const gain = context.createGain();
        gain.gain.value = settings.muted ? 0 : settings.volume / 100;
        source.connect(gain).connect(context.destination);
        audioNodesRef.current.set(peerId, { source, gain });
        // Chromium feeds silence into Web Audio from a remote WebRTC stream
        // unless that stream is also attached to a media element.
        const sink = getAudioEl(peerId);
        sink.muted = true;
        sink.srcObject = e.streams[0];
        sink.play().catch(() => {});
        return;
      }
      const audioEl = getAudioEl(peerId);
      audioEl.volume = settings.volume / 100;
      audioEl.muted = settings.muted || settings.volume === 0;
      audioEl.srcObject = e.streams[0];
      audioEl.play().catch(() => {
        // will retry once the tab/document has a user gesture
      });
    };
    pc.onconnectionstatechange = () => {
      setPeerStatus((s) => ({ ...s, [peerId]: pc.connectionState }));
    };

    return pc;
  }, []);

  useEffect(() => {
    const onSignal = async ({ from, data }) => {
      if (!joinedRef.current) return;
      let pc = peersRef.current.get(from);
      try {
        if (data.type === 'offer') {
          if (!pc) pc = createPeer(from, false);
          await pc.setRemoteDescription(data.sdp);
          const queued = pendingCandidatesRef.current.get(from);
          if (queued) {
            for (const c of queued) await pc.addIceCandidate(c).catch(() => {});
            pendingCandidatesRef.current.delete(from);
          }
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          socket.emit('voice_signal', { to: from, data: { type: 'answer', sdp: pc.localDescription } });
        } else if (data.type === 'answer') {
          if (pc) {
            await pc.setRemoteDescription(data.sdp);
            const queued = pendingCandidatesRef.current.get(from);
            if (queued) {
              for (const c of queued) await pc.addIceCandidate(c).catch(() => {});
              pendingCandidatesRef.current.delete(from);
            }
          }
        } else if (data.type === 'ice') {
          if (pc && pc.remoteDescription) {
            await pc.addIceCandidate(data.candidate).catch(() => {});
          } else {
            // remote description not set yet -- queue until it is
            const list = pendingCandidatesRef.current.get(from) || [];
            list.push(data.candidate);
            pendingCandidatesRef.current.set(from, list);
          }
        }
      } catch {
        // stale/late signal, ignore
      }
    };
    socket.on('voice_signal', onSignal);
    return () => socket.off('voice_signal', onSignal);
  }, [createPeer]);

  const otherIds = room.players
    .filter((p) => p.id !== me.playerId && p.connected && !p.kicked && p.inVoice)
    .map((p) => p.id);
  const otherIdsKey = otherIds.join(',');

  useEffect(() => {
    if (!micOn) return;
    otherIds.forEach((pid) => {
      if (!peersRef.current.has(pid)) {
        createPeer(pid, me.playerId < pid);
      }
    });
    [...peersRef.current.keys()].forEach((pid) => {
      if (!otherIds.includes(pid)) teardownPeer(pid);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [micOn, otherIdsKey, createPeer, teardownPeer]);

  useEffect(
    () => () => {
      joinedRef.current = false;
      joinAttemptRef.current += 1;
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      rawStreamRef.current?.getTracks().forEach((t) => t.stop());
      [...peersRef.current.keys()].forEach(teardownPeer);
      audioContextRef.current?.close().catch(() => {});
    },
    [teardownPeer]
  );

  useEffect(() => {
    const onDisconnect = () => {
      const wasJoined = joinedRef.current || !!localStreamRef.current;
      joinedRef.current = false;
      joinAttemptRef.current += 1;
      localStreamRef.current?.getTracks().forEach((track) => track.stop());
      rawStreamRef.current?.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
      rawStreamRef.current = null;
      inputGainRef.current = null;
      [...peersRef.current.keys()].forEach(teardownPeer);
      audioContextRef.current?.close().catch(() => {});
      audioContextRef.current = null;
      setMicOn(false);
      setMicMuted(false);
      setJoining(false);
      if (wasJoined) {
        setMicError('网络中断，语音已退出；连接恢复后请重新加入。');
        setExpanded(true);
      }
    };
    socket.on('disconnect', onDisconnect);
    return () => socket.off('disconnect', onDisconnect);
  }, [teardownPeer]);

  async function toggleMic() {
    if (micOn) {
      joinedRef.current = false;
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      rawStreamRef.current?.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
      rawStreamRef.current = null;
      inputGainRef.current = null;
      [...peersRef.current.keys()].forEach(teardownPeer);
      setMicOn(false);
      setMicMuted(false);
      audioContextRef.current?.close().catch(() => {});
      audioContextRef.current = null;
      socket.emit('voice_state', { inVoice: false });
      return;
    }
    if (joining) return;
    const attempt = ++joinAttemptRef.current;
    setJoining(true);
    setMicError('');
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) {
        audioContextRef.current = new AudioContext();
        await audioContextRef.current.resume();
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      if (attempt !== joinAttemptRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      rawStreamRef.current = stream;
      if (audioContextRef.current) {
        const source = audioContextRef.current.createMediaStreamSource(stream);
        const gain = audioContextRef.current.createGain();
        const output = audioContextRef.current.createMediaStreamDestination();
        gain.gain.value = inputVolume / 100;
        source.connect(gain).connect(output);
        inputGainRef.current = gain;
        localStreamRef.current = output.stream;
      } else {
        localStreamRef.current = stream;
      }
      joinedRef.current = true;
      setMicOn(true);
      setExpanded(true);
      socket.emit('voice_state', { inVoice: true });
    } catch {
      rawStreamRef.current?.getTracks().forEach((track) => track.stop());
      rawStreamRef.current = null;
      inputGainRef.current = null;
      audioContextRef.current?.close().catch(() => {});
      audioContextRef.current = null;
      setMicError('无法访问麦克风，检查浏览器权限或是否为 HTTPS 访问');
      setExpanded(true);
    } finally {
      setJoining(false);
    }
  }

  function toggleMute() {
    const muted = !micMuted;
    localStreamRef.current?.getAudioTracks().forEach((track) => { track.enabled = !muted; });
    setMicMuted(muted);
  }

  function changeInputVolume(value) {
    setInputVolume(value);
    if (inputGainRef.current) inputGainRef.current.gain.value = value / 100;
  }

  const roster = room.players.filter((p) => p.connected && !p.kicked &&
    (p.id === me.playerId ? micOn : p.inVoice));
  const connectedCount = Object.values(peerStatus).filter((s) => s === 'connected').length;

  const panel = (
  <div id="voice-panel" className="voice-panel">
      <div className="voice-panel-caption"><span>房间 {room.code}</span><span className="voice-link-status">
        <i className={micOn ? 'online' : ''} />{micOn ? (otherIds.length ? `已连接 ${connectedCount}/${otherIds.length}` : '等待其他玩家加入') : '未连接'}
      </span></div>
      <div className="voice-members">
        {roster.length === 0 && <div className="voice-empty"><VoiceIcon type="headphones" /><strong>暂无玩家加入语音</strong></div>}
        {roster.map((player) => {
          const isMe = player.id === me.playerId;
          const settings = mix[player.id] || { volume: 100, muted: false };
          const status = peerStatus[player.id];
          const label = !micOn ? '在语音频道中'
            : status === 'connected' ? (settings.muted || settings.volume === 0 ? '已为你静音' : '已连接')
            : status === 'failed' || status === 'disconnected' ? '连接中断，可退出后重试' : '正在连接…';
          return <div className="voice-member" key={player.id}>
            <div className="voice-member-top"><Avatar avatar={player.avatar} name={player.name}
              className={`voice-avatar${isMe || status === 'connected' ? ' connected' : ''}`} />
              <div className="voice-member-name"><strong>{player.name}{isMe && <em>你</em>}</strong>{!isMe && <small>{label}</small>}</div>
              {isMe ? <button type="button" className={`voice-icon-btn voice-self-mic${micMuted ? ' muted' : ''}`}
                  onClick={toggleMute} aria-label={micMuted ? '开启麦克风' : '静音麦克风'} aria-pressed={micMuted}
                  title={micMuted ? '开启麦克风' : '静音麦克风'}><VoiceIcon type="mic" muted={micMuted} /></button>
                : <button className={`voice-icon-btn${settings.muted ? ' muted' : ''}`} disabled={!micOn}
                  aria-label={`${settings.muted ? '取消静音' : '静音'} ${player.name}`} aria-pressed={settings.muted}
                  onClick={() => updateMix(player.id, { muted: !settings.muted })}>
                  <VoiceIcon type="volume" muted={settings.muted || settings.volume === 0} />
                </button>}
            </div>
            {isMe && <label className="voice-volume"><span>输入音量</span><input type="range" min="0" max="100" step="1"
              aria-label="自己的麦克风输入音量" value={inputVolume} disabled={!inputGainRef.current}
              style={{ '--voice-volume': `${inputVolume}%` }}
              onChange={(event) => changeInputVolume(Number(event.target.value))} />
              <output>{`${inputVolume}%`}</output></label>}
            {!isMe && <label className="voice-volume"><span>音量</span><input type="range" min="0" max="100" step="1"
              aria-label={`${player.name}的收听音量`} value={settings.volume} disabled={!micOn}
              style={{ '--voice-volume': `${settings.volume}%` }}
              onChange={(event) => updateMix(player.id, { volume: Number(event.target.value), muted: false })} />
              <output>{settings.muted ? '静音' : `${settings.volume}%`}</output></label>}
          </div>;
        })}
      </div>
      {micError && <p className="voice-error" role="alert">{micError}</p>}
      {micOn && <div className="voice-footer"><span />
        <button className="voice-leave" onClick={toggleMic}><VoiceIcon type="leave" />退出语音</button>
      </div>}
    </div>
  );

  // On the lobby and table the control is one toolbar button (see voiceSlot.js) and the panel
  // pops out beside it; other screens keep the full bar at the top.
  const slot = useVoiceSlot();
  const buttonRef = useRef(null);
  const popoverRef = useRef(null);
  const [place, setPlace] = useState(null);

  useLayoutEffect(() => {
    if (!slot || !expanded || !buttonRef.current || !popoverRef.current) return;
    const anchor = buttonRef.current.getBoundingClientRect();
    const box = popoverRef.current.getBoundingClientRect();
    const left = Math.max(8, Math.min(anchor.right - box.width, window.innerWidth - box.width - 8));
    setPlace({ left, top: Math.min(anchor.bottom + 6, Math.max(8, window.innerHeight - box.height - 8)) });
  }, [slot, expanded, micOn, roster.length]);

  useEffect(() => {
    if (!slot || !expanded) return undefined;
    const outside = (event) => {
      if (!buttonRef.current?.contains(event.target) && !popoverRef.current?.contains(event.target)) setExpanded(false);
    };
    const escape = (event) => { if (event.key === 'Escape') setExpanded(false); };
    const close = () => setExpanded(false);
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
      window.removeEventListener('resize', close);
    };
  }, [slot, expanded]);

  const wakeAudio = () => { audioContextRef.current?.resume().catch(() => {}); };

  if (slot) return createPortal(
    <>
      <button type="button" ref={buttonRef} className={`table-voice-btn${micOn ? ' active' : ''}`} onPointerDown={wakeAudio}
        onClick={() => { setPlace(null); setExpanded(!expanded); }} aria-expanded={expanded} aria-controls="voice-panel"
        aria-label={`牌桌语音，${roster.length} 人在线`}>
        <VoiceIcon type="headphones" /><span>语音</span>{roster.length > 0 && <small>{roster.length}</small>}
      </button>
      {/* Muting is in the panel, beside the player's own name; the toolbar keeps one button. */}
      {expanded && createPortal(
        <aside className="voice-console expanded voice-popover" ref={popoverRef} aria-label="牌桌语音" onPointerDown={wakeAudio}
          style={place ? { left: place.left, top: place.top } : { left: 0, top: 0, visibility: 'hidden' }}>
          <div className="voice-popover-head">
            <strong>牌桌语音</strong>
            {!micOn && <button className="voice-join" onClick={toggleMic} disabled={joining}>{joining ? '连接中' : '加入语音'}</button>}
          </div>
          {panel}
        </aside>,
        document.body,
      )}
    </>,
    slot,
  );

  return (
    <aside className={`voice-console${expanded ? ' expanded' : ''}`} aria-label="牌桌语音"
      onPointerDown={() => { audioContextRef.current?.resume().catch(() => {}); }}
      onKeyDown={(event) => { if (event.key === 'Escape') setExpanded(false); }}>
      <div className="voice-dock">
        <button className="voice-summary" onClick={() => setExpanded(!expanded)} aria-expanded={expanded} aria-controls="voice-panel">
          <span className={`voice-emblem${micOn ? ' active' : ''}`}><VoiceIcon type="headphones" /></span>
          <span className="voice-heading"><strong>牌桌语音</strong><small>
            {joining ? '正在开启麦克风…' : micOn ? `${roster.length} 人在线 · ${micMuted ? '麦克风已静音' : '语音已开启'}` : `${roster.length} 人在线 · 尚未加入`}
          </small></span>
          <span className="voice-chevron"><VoiceIcon type="chevron" /></span>
        </button>
        {micOn ? <button className={`voice-icon-btn${micMuted ? ' muted' : ''}`} onClick={toggleMute}
          aria-label={micMuted ? '开启麦克风' : '静音麦克风'} aria-pressed={micMuted} title={micMuted ? '开启麦克风' : '静音麦克风'}>
          <VoiceIcon type="mic" muted={micMuted} />
        </button> : <button className="voice-join" onClick={toggleMic} disabled={joining}>{joining ? '连接中' : '加入'}</button>}
      </div>
      {expanded && panel}
    </aside>
  );
}
