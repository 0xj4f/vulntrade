import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';

/**
 * Dark / light theme. The choice lives in localStorage['vt-theme'] (falls back to the
 * OS preference); public/index.html applies it before first paint so there is no flash.
 */
const ThemeContext = createContext({ theme: 'dark', toggle: () => {}, setTheme: () => {} });

const STORAGE_KEY = 'vt-theme';

function initialTheme() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch (e) { /* ignore */ }
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(initialTheme);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem(STORAGE_KEY, theme); } catch (e) { /* ignore */ }
  }, [theme]);

  const setTheme = useCallback((t) => setThemeState(t === 'light' ? 'light' : 'dark'), []);
  const toggle = useCallback(() => setThemeState(t => (t === 'dark' ? 'light' : 'dark')), []);

  return <ThemeContext.Provider value={{ theme, toggle, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}

/**
 * Resolved colour values for canvas-based widgets (charts) that can't read CSS variables.
 * Re-computed whenever the theme changes.
 */
export function useThemeColors() {
  const { theme } = useTheme();
  const [palette, setPalette] = useState(() => readPalette());
  useEffect(() => {
    // Read after the data-theme attribute has been applied.
    const id = requestAnimationFrame(() => setPalette(readPalette()));
    return () => cancelAnimationFrame(id);
  }, [theme]);
  return palette;
}

function readPalette() {
  const css = getComputedStyle(document.documentElement);
  const v = (name, fallback) => (css.getPropertyValue(name) || '').trim() || fallback;
  return {
    bg: v('--vt-surface', '#0f1521'),
    text: v('--vt-chart-text', '#7f8a9d'),
    textStrong: v('--vt-text', '#e6eaf2'),
    grid: v('--vt-chart-grid', 'rgba(148,163,184,0.07)'),
    border: v('--vt-border', '#1c2433'),
    up: v('--vt-up', '#16c784'),
    down: v('--vt-down', '#ea3943'),
    upSoft: v('--vt-up-soft', 'rgba(22,199,132,0.12)'),
    downSoft: v('--vt-down-soft', 'rgba(234,57,67,0.12)'),
    accent: v('--vt-accent', '#3b82f6'),
  };
}

export default ThemeContext;
