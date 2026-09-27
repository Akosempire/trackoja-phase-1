import { useEffect, useRef, useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { AuthService } from '../../services/auth.service';
import { Button } from '../ui/Button';
import { DeveloperModeBanner } from '../DeveloperModeBanner';
import { OfflineBanner } from '../OfflineBanner';
import { containDialogFocus } from '../../utils/dialog-focus';
import { PlatformSideNav } from './PlatformSideNav';
import { EnvironmentBadge } from './EnvironmentBadge';
import { usePlatform } from './PlatformContext';

/**
 * Shell for the Platform Owner dashboard.
 *
 * Deliberately separate from the merchant shell: a platform operator has no
 * store, so the store switcher, bottom tabs and merchant sidebar have no meaning
 * here. It reuses the same WAYA shell classes, header and drawer behaviour, so
 * the two halves of the product still read as one system.
 */
export function PlatformLayout() {
  const navigate = useNavigate();
  const { environment } = usePlatform();
  const drawer = useRef<HTMLDialogElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!menuOpen) return;
    drawer.current?.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const desktop = matchMedia('(min-width: 901px)');
    const closeOnDesktop = () => {
      if (desktop.matches) setMenuOpen(false);
    };
    desktop.addEventListener('change', closeOnDesktop);
    return () => {
      drawer.current?.close();
      document.body.style.overflow = overflow;
      desktop.removeEventListener('change', closeOnDesktop);
    };
  }, [menuOpen]);

  async function handleLogout() {
    await AuthService.logout();
    navigate('/login', { replace: true });
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#platform-content">
        Skip to content
      </a>

      <header className="app-header">
        <button
          type="button"
          className="icon-button"
          aria-label="Open navigation"
          aria-expanded={menuOpen}
          aria-controls="platform-navigation"
          onClick={() => setMenuOpen(true)}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <span className="app-header-logo">TrackOja Platform</span>
        <div className="app-header-actions">
          <EnvironmentBadge environment={environment} />
          <Button variant="ghost" className="btn-sm" onClick={handleLogout}>
            Log out
          </Button>
        </div>
      </header>

      <PlatformSideNav />

      <dialog
        ref={drawer}
        id="platform-navigation"
        className="mobile-nav-dialog"
        aria-label="Platform navigation"
        onKeyDown={containDialogFocus}
        onCancel={() => setMenuOpen(false)}
        onClick={(event) => {
          if (event.target === event.currentTarget) setMenuOpen(false);
        }}
      >
        {menuOpen && <PlatformSideNav mobile onClose={() => setMenuOpen(false)} />}
      </dialog>

      <div className="app-main">
        <DeveloperModeBanner />
        <OfflineBanner />
        {/* Same nesting as the merchant shell: the page wrapper carries the
            reading padding, and app-content carries the shell's own spacing.
            Note there is no bottom nav here, which is why the merchant's
            bottom clearance is not needed. */}
        <main className="app-content" id="platform-content" tabIndex={-1}>
          <div className="page">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
