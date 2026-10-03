import { createContext, useContext, useEffect, useState } from 'react';
import {
  CARD_THEMES,
  TABLE_THEMES,
  HAND_STYLES,
  UI_SCALES,
  loadCardTheme,
  loadTableTheme,
  loadUiScale,
  loadHandStyle,
  saveCardTheme,
  saveTableTheme,
  saveUiScale,
  saveHandStyle,
} from './themes';

const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  const [cardTheme, setCardThemeState] = useState(loadCardTheme);
  const [tableTheme, setTableThemeState] = useState(loadTableTheme);
  const [uiScale, setUiScaleState] = useState(loadUiScale);
  const [handStyle, setHandStyleState] = useState(loadHandStyle);

  function setCardTheme(id) {
    setCardThemeState(id);
    saveCardTheme(id);
  }

  function setTableTheme(id) {
    setTableThemeState(id);
    saveTableTheme(id);
  }

  function setUiScale(id) {
    setUiScaleState(id);
    saveUiScale(id);
  }

  function setHandStyle(id) {
    if (!HAND_STYLES.some((style) => style.id === id)) return;
    setHandStyleState(id);
    saveHandStyle(id);
  }

  function surpriseMe() {
    let nextCard = cardTheme;
    let nextTable = tableTheme;
    while (nextCard === cardTheme && nextTable === tableTheme) {
      nextCard = CARD_THEMES[Math.floor(Math.random() * CARD_THEMES.length)].id;
      nextTable = TABLE_THEMES[Math.floor(Math.random() * TABLE_THEMES.length)].id;
    }
    setCardTheme(nextCard);
    setTableTheme(nextTable);
    return { cardTheme: nextCard, tableTheme: nextTable };
  }

  useEffect(() => {
    document.documentElement.dataset.tableTheme = tableTheme;
    return () => delete document.documentElement.dataset.tableTheme;
  }, [tableTheme]);

  // Every screen is laid out for a reference size and zoomed to fit the window, so a small phone
  // gets the same layout with smaller buttons instead of a page that scrolls. Portrait screens use
  // the phone layout; landscape phones share the desktop layout. The chosen UI size multiplies in.
  useEffect(() => {
    const chosen = UI_SCALES.find((s) => s.id === uiScale)?.value || 1;
    function apply() {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const fit = h >= w
        ? Math.min(1, Math.max(0.8, Math.min(w / 390, h / 780)))
        : Math.min(1, Math.max(0.5, Math.min(w / 1100, h / 640)));
      const scale = Math.round(chosen * fit * 1000) / 1000;
      document.documentElement.style.setProperty('--ui-scale', String(scale));
      // How far a small window shrinks the page (never above 1): fixed-width columns divide by it so
      // they keep their on-screen width there, while a larger chosen UI size still widens them.
      document.documentElement.style.setProperty('--ui-shrink', String(Math.min(1, scale)));
    }
    apply();
    window.addEventListener('resize', apply);
    window.addEventListener('orientationchange', apply);
    return () => {
      window.removeEventListener('resize', apply);
      window.removeEventListener('orientationchange', apply);
    };
  }, [uiScale]);

  return (
    <ThemeContext.Provider
      value={{ cardTheme, tableTheme, uiScale, handStyle, setCardTheme, setTableTheme, setUiScale, setHandStyle, surpriseMe }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
