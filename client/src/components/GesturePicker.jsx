import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { emojiIconSrc } from '../emojiIcons';

export default function GesturePicker({ title, icons, onSelect, onClose }) {
  const dialogRef = useRef(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog.showModal();
    dialog.focus({ preventScroll: true });
    return () => dialog.close();
  }, []);

  return createPortal(
    <dialog tabIndex={-1} ref={dialogRef} className="gesture-dialog" aria-labelledby={titleId}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="gesture-sheet">
        <header className="gesture-sheet-header">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="gesture-close" onClick={onClose} aria-label="关闭选择器" autoFocus>✕</button>
        </header>
        <div className="gesture-grid">
          {icons.map((icon) => (
            <button type="button" key={icon} aria-label={`发送 ${icon}`}
              onClick={() => onSelect(icon)}>
              <img src={emojiIconSrc(icon)} alt="" draggable={false} />
            </button>
          ))}
        </div>
      </div>
    </dialog>,
    document.body
  );
}
