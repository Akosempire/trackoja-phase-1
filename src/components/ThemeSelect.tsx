import { useEffect, useState } from 'react';

export type ThemePreference = 'light' | 'dark' | 'system';
const key = 'trackoja-theme';

export function readTheme(): ThemePreference {
  try {
    const value = localStorage.getItem(key);
    if (value === 'light' || value === 'dark') return value;
  } catch { /* Storage can be unavailable in private browsing. */ }
  return 'system';
}

export function applyTheme(preference: ThemePreference) {
  const dark = preference === 'dark' || (preference === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0b0b0b' : '#ffffff');
}

export function ThemeSelect() {
  const [preference, setPreference] = useState(readTheme);
  useEffect(() => {
    applyTheme(preference);
    const media = matchMedia('(prefers-color-scheme: dark)');
    const update = () => applyTheme(preference);
    media.addEventListener('change', update);
    const sync = () => setPreference(readTheme());
    window.addEventListener('storage', sync);
    window.addEventListener('trackoja-theme-change', sync);
    return () => {
      media.removeEventListener('change', update);
      window.removeEventListener('storage', sync);
      window.removeEventListener('trackoja-theme-change', sync);
    };
  }, [preference]);
  return (
    <label className="theme-select">
      <span>Appearance</span>
      <select aria-label="Appearance" value={preference} onChange={event => {
        const value = event.target.value as ThemePreference;
        setPreference(value);
        applyTheme(value);
        try {
          localStorage.setItem(key, value);
          window.dispatchEvent(new Event('trackoja-theme-change'));
        } catch { /* The selection still works for this visit. */ }
      }}>
        <option value="system">System</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
    </label>
  );
}
