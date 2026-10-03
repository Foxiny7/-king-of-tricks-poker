export function isWeChatBrowser() {
  return typeof navigator !== 'undefined' && /MicroMessenger/i.test(navigator.userAgent);
}

// WeChat on Android scales page text with its own font-size setting, which CSS cannot turn off.
// Its bridge can: size 0 is the standard size, and the menu's font control is kept at it too.
export function lockWeChatFontSize() {
  if (!isWeChatBrowser()) return;
  const lock = () => {
    const bridge = window.WeixinJSBridge;
    if (typeof bridge?.invoke !== 'function') return;
    bridge.invoke('setFontSizeCallback', { fontSize: 0 });
    bridge.on?.('menu:setfont', () => bridge.invoke('setFontSizeCallback', { fontSize: 0 }));
  };
  if (window.WeixinJSBridge) lock();
  else document.addEventListener('WeixinJSBridgeReady', lock, false);
}
