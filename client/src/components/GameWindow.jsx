import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

// Landscape in-game window shared by the profile and settings screens: a title tab on the frame,
// a close button, a column of tabs on the left and the chosen page on the right.
export default function GameWindow({ title, tabs, tab, onTab, onClose, className = '', children }) {
  const dialogRef = useRef(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog.showModal();
    dialog.focus({ preventScroll: true });
    return () => dialog.close();
  }, []);

  // Arrow keys walk the tab column the way a controller would.
  function stepTab(event) {
    const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const index = tabs.findIndex((item) => item.id === tab);
    const next = tabs[(index + step + tabs.length) % tabs.length];
    onTab(next.id);
    event.currentTarget.querySelector(`[data-tab="${next.id}"]`)?.focus();
  }

  return createPortal(
    <dialog tabIndex={-1} className={`game-window ${className}`} ref={dialogRef} aria-label={title}
      onClose={() => { if (!dialogRef.current?.open) onClose(); }}
      onClick={(event) => { if (event.target === dialogRef.current) dialogRef.current.close(); }}>
      <header className="game-window-bar">
        <h2>{title}</h2>
        <button type="button" className="game-window-close" aria-label={`关闭${title}`}
          onClick={() => dialogRef.current.close()}>✕</button>
      </header>
      <div className="game-window-body">
        <nav className="game-window-tabs" role="tablist" aria-orientation="vertical" onKeyDown={stepTab}>
          {tabs.map((item) => (
            <button key={item.id} type="button" role="tab" data-tab={item.id}
              aria-selected={item.id === tab} tabIndex={item.id === tab ? 0 : -1}
              className={item.id === tab ? 'active' : ''} onClick={() => onTab(item.id)}>
              {item.label}
            </button>
          ))}
        </nav>
        <div className="game-window-page" role="tabpanel" key={tab}>{children}</div>
      </div>
    </dialog>,
    document.body,
  );
}
