import { useState } from 'react';
import { isWeChatBrowser } from '../wechatDetect';

export default function WeChatBanner() {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return sessionStorage.getItem('poker_wechat_banner_dismissed') === '1';
    } catch {
      return false;
    }
  });

  if (!isWeChatBrowser() || dismissed) return null;

  function dismiss() {
    setDismissed(true);
    try {
      sessionStorage.setItem('poker_wechat_banner_dismissed', '1');
    } catch {
      // storage unavailable, ignore
    }
  }

  return (
    <div className="wechat-banner">
      <span>
        检测到你在微信内打开，语音播报/语音聊天可能无法使用。建议点右上角 ⋯ 选择"在浏览器打开"。
      </span>
      <button className="wechat-banner-close" onClick={dismiss}>
        ✕
      </button>
    </div>
  );
}
