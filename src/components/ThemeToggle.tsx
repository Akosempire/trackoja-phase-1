import { useEffect, useState } from 'react';
import { applyTheme } from './ThemeSelect';

/**
 * Topbar light/dark toggle, matching the reference topbar's `toggle-theme`
 * control: an icon button whose icon shows the CURRENT theme (sun when light,
 * moon when dark) and whose label says what clicking it does.
 *
 * The preference is stored explicitly (never left as "system") when the user
 * toggles, so a system-theme visitor who presses the button gets a concrete,
 * predictable switch rather than a no-op.
 */
const SUN = 'M12 3v2M12 19v2M5.6 5.6 7 7M17 17l1.4 1.4M3 12h2M19 12h2M5.6 18.4 7 17M17 7l1.4-1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0';
const MOON = 'M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z';

function isDark(): boolean {
  return document.documentElement.dataset.theme === 'dark';
}

export function ThemeToggle() {
  const [dark, setDark] = useState(isDark);

  useEffect(() => {
    const sync = () => setDark(isDark());
    window.addEventListener('trackoja-theme-change', sync);
    return () => window.removeEventListener('trackoja-theme-change', sync);
  }, []);

  const toggle = () => {
    const next = dark ? 'light' : 'dark';
    applyTheme(next);
    try {
      localStorage.setItem('trackoja-theme', next);
      window.dispatchEvent(new Event('trackoja-theme-change'));
    } catch { /* The toggle still applies for this visit. */ }
  };

  const label = dark ? 'Switch to light mode' : 'Switch to dark mode';

  return (
    <button
      type="button"
      className="icon-button theme-toggle"
      onClick={toggle}
      aria-label={label}
      aria-pressed={dark}
      title={label}
    >
      <svg
        className="svg-icon"
        aria-hidden="true"
        viewBox="0 0 24 24"
        width={18}
        height={18}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={dark ? MOON : SUN} />
      </svg>
    </button>
  );
}
