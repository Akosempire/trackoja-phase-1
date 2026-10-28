import { useEffect, useState } from 'react';

export type ThemePreference = 'light' | 'dark' | 'system';
const key = 'trackoja-theme';

export function readTheme(): ThemePreference {
  try {
    const value = localStorage.getItem(key);
    if (value === 'light' || value === 'dark') return value;
  } catch { /* Storage can be unavailable in private browsing. */ }
  // The Waya dashboard is a light system by default. Falling back to the OS
  // preference silently rendered the whole dashboard dark for anyone on a dark OS.
  return 'light';
}

export function applyTheme(preference: ThemePreference) {
  const dark = preference === 'dark' || (preference === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#141414' : '#f5f7fa');
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
    <label className="tl-theme flex items-center justify-between gap-2 text-[13px] text-ink-2">
      <span>Appearance</span>
      <select className="h-8 rounded-md border border-line-strong bg-surface px-2 text-[13px] text-ink" aria-label="Appearance" value={preference} onChange={event => {
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
