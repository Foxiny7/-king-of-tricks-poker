import { useRef, useState } from 'react';
import Avatar from './Avatar';

const PRESET_AVATARS = Array.from({ length: 7 }, (_, index) => `preset-${index + 1}`);

// Preset portraits plus an upload slot; uploads are shrunk to 256px JPEG so they fit in a room message.
export default function AvatarPicker({ avatar, name, onPick }) {
  const uploadRef = useRef(null);
  const [error, setError] = useState('');

  function upload(file) {
    setError('');
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('请选择图片文件');
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => setError('图片读取失败');
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => setError('无法读取这张图片');
      image.onload = () => {
        const scale = Math.min(1, 256 / Math.max(image.naturalWidth, image.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
        const compressed = canvas.toDataURL('image/jpeg', 0.78);
        if (compressed.length > 120000) {
          setError('图片太大');
          return;
        }
        onPick(compressed);
      };
      image.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  }

  const uploaded = avatar.startsWith('data:');
  return (
    <div className="avatar-picker-grid" role="group" aria-label="选择头像">
      {PRESET_AVATARS.map((preset, index) => (
        <button key={preset} type="button" className={avatar === preset ? 'chosen' : ''}
          aria-label={`预设头像 ${index + 1}`} aria-pressed={avatar === preset} onClick={() => onPick(preset)}>
          <Avatar avatar={preset} name={`预设头像 ${index + 1}`} />
        </button>
      ))}
      <button type="button" className={uploaded ? 'chosen' : ''} onClick={() => uploadRef.current?.click()}>
        {uploaded ? <Avatar avatar={avatar} name={name} /> : <span>上传</span>}
      </button>
      <input ref={uploadRef} className="avatar-file-input" type="file" accept="image/*"
        onChange={(event) => { upload(event.target.files?.[0]); event.target.value = ''; }} />
      {error && <span className="avatar-error" role="alert">{error}</span>}
    </div>
  );
}
