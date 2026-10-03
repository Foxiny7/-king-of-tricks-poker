import { useState } from 'react';
import GameWindow from './GameWindow';
import { useTheme } from '../ThemeContext';
import { UI_SCALES } from '../themes';
import { useSetting } from '../settings';
import { VOICE_CHARACTERS, voiceCredit } from '../voiceLines';
import { preloadVoice, previewVoice } from '../speech';

const TABS = [
  { id: 'display', label: '画面' },
  { id: 'audio', label: '声音' },
];
// Skins are changed on the 个人页面 (Profile.jsx), not here.
const ON_OFF = [{ value: true, label: '开' }, { value: false, label: '关' }];
const MOTION = [{ value: 'system', label: '跟随系统' }, { value: 'on', label: '开启' }, { value: 'off', label: '关闭' }];
const VOICES = [{ value: 'ja', label: '日语 · VOICEVOX' }, { value: 'zh', label: '中文' }, { value: 'en', label: 'English' }];
const LANGUAGES = [{ value: 'zh', label: '中文' }, { value: 'en', label: 'English' }];
const CHARACTERS = VOICE_CHARACTERS.map((character) => ({ id: character.id, name: character.label }));
// Every character can be heard at the table, so every credit is shown.
const CREDITS = VOICE_CHARACTERS.map(voiceCredit).join('、');
const SCALES = UI_SCALES.map((scale) => ({ value: scale.id, label: scale.name }));
const VOLUME = [25, 50, 75, 100].map((value) => ({ value, label: `${value}%` }));

// One setting row: ◀ value ▶ with a pip per choice. Left and right step it while the row has focus.
function SettingRow({ label, options, value, onChange }) {
  const index = Math.max(0, options.findIndex((option) => option.value === value));
  const step = (delta) => onChange(options[(index + delta + options.length) % options.length].value);

  function onKeyDown(event) {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      step(event.key === 'ArrowLeft' ? -1 : 1);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const rows = [...event.currentTarget.parentElement.querySelectorAll('.setting-row')];
      rows[rows.indexOf(event.currentTarget) + (event.key === 'ArrowDown' ? 1 : -1)]?.focus();
    }
  }

  return (
    <div className="setting-row" tabIndex={0} role="group" aria-label={label} onKeyDown={onKeyDown}>
      <span className="setting-label">{label}</span>
      <div className="setting-stepper">
        <button type="button" tabIndex={-1} aria-label={`${label}上一项`} onClick={() => step(-1)}>◀</button>
        <strong aria-live="polite">{options[index].label}</strong>
        <button type="button" tabIndex={-1} aria-label={`${label}下一项`} onClick={() => step(1)}>▶</button>
        <span className="setting-pips" aria-hidden="true">
          {options.map((option, i) => <i key={String(option.value)} className={i === index ? 'on' : ''} />)}
        </span>
      </div>
    </div>
  );
}

function SettingSelect({ label, options, value, onChange }) {
  return <label className="setting-row setting-select">
    <span className="setting-label">{label}</span>
    <select value={value} onChange={(event) => onChange(event.target.value)}>
      {options.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
    </select>
  </label>;
}

export default function Settings({ onClose }) {
  const [tab, setTab] = useState('display');
  const { uiScale, setUiScale } = useTheme();
  const [motion, setMotion] = useSetting('motion');
  const [language, setLanguage] = useSetting('language');
  const [sound, setSound] = useSetting('sound');
  const [speech, setSpeech] = useSetting('speech');
  const [voice, setVoice] = useSetting('voice');
  const [voiceCharacter, setVoiceCharacter] = useSetting('voiceCharacter');
  const [soundVolume, setSoundVolume] = useSetting('soundVolume');
  const [speechVolume, setSpeechVolume] = useSetting('speechVolume');

  return (
    <GameWindow title="设置" tabs={TABS} tab={tab} onTab={setTab} onClose={onClose} className="settings-window">
      <div className="setting-list">
        {tab === 'display' && (
          <>
            <SettingRow label="游戏语言" options={LANGUAGES} value={language} onChange={setLanguage} />
            <SettingRow label="界面缩放" options={SCALES} value={uiScale} onChange={setUiScale} />
            <SettingRow label="动画效果" options={MOTION} value={motion} onChange={setMotion} />
          </>
        )}
        {tab === 'audio' && (
          <>
            <SettingRow label="音效" options={ON_OFF} value={sound} onChange={setSound} />
            <SettingRow label="音效音量" options={VOLUME} value={soundVolume} onChange={setSoundVolume} />
            <SettingRow label="语音播报" options={ON_OFF} value={speech} onChange={setSpeech} />
            <SettingRow label="播报语言" options={VOICES} value={voice} onChange={setVoice} />
            <SettingRow label="播报音量" options={VOLUME} value={speechVolume} onChange={setSpeechVolume} />
            {voice === 'ja' && <SettingSelect label="播报角色" options={CHARACTERS} value={voiceCharacter}
              onChange={(id) => { setVoiceCharacter(id); preloadVoice(); previewVoice(); }} />}
            <button type="button" className="setting-preview" onClick={previewVoice}>试听播报</button>
            {voice === 'ja' && <p className="setting-credit">{CREDITS}</p>}
          </>
        )}
      </div>
    </GameWindow>
  );
}
