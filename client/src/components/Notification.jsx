import { useEffect } from 'react';

export default function Notification({ message, onDone }) {
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(onDone, 3000);
    return () => clearTimeout(t);
  }, [message, onDone]);

  if (!message) return null;

  return (
    <div className="notification-backdrop">
      <div className="notification-box">{message}</div>
    </div>
  );
}
