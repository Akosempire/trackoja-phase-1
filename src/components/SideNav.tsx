import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useAppNav } from '../hooks/useAppNav';
import { StoreSwitcher } from './StoreSwitcher';
import { ArrowLeftIcon, LogoutIcon, ScanIcon, SalesIcon, SettingsIcon, SidebarIcon } from './icons';
import { ThemeSelect } from './ThemeSelect';
import { APP_MARK, APP_NAME } from '../config/brand';
import { cn } from './kit';

interface SideNavProps { onLogout: () => void; mobile?: boolean; onClose?: () => void; }

const GROUPS = ['Business operations', 'Management', 'Payments and connections', 'Account'];
const GROUP_TITLES: Record<string, string> = {
  'Business operations': 'Sell', Management: 'Manage', 'Payments and connections': 'Money', Account: 'Account',
};

export function SideNav({ onLogout, mobile = false, onClose }: SideNavProps) {
  const { profile } = useAuth();
  const { allItems, handleScan, canScan, primaryAction } = useAppNav();
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('trackoja-sidebar-collapsed') === 'true'; } catch { return false; }
  });
  const compact = collapsed && !mobile;
  const initials = profile
    ? (((profile.firstName?.[0] ?? '') + (profile.lastName?.[0] ?? '')) || (profile.email?.[0] ?? '?')).toUpperCase()
    : '?';
  const displayName = profile?.firstName
    ? `${profile.firstName}${profile.lastName ? ' ' + profile.lastName : ''}`
    : profile?.email?.split('@')[0] ?? 'User';

  const linkClass = ({ isActive }: { isActive: boolean }) => cn(
    'tl-nav-link flex h-9 items-center gap-3 rounded-lg px-2.5 text-sm font-medium no-underline transition-colors',
    compact && 'justify-center px-0',
    isActive ? 'active bg-brand-soft text-brand-ink' : 'text-ink-2 hover:bg-hover hover:text-ink',
  );

  return (
    <aside
      aria-label="Workspace"
      className={cn('tl-side flex flex-col bg-surface',
        mobile ? 'h-full w-full' : 'sticky top-0 hidden h-dvh shrink-0 border-r border-line lg:flex',
        !mobile && (compact ? 'w-[72px]' : 'w-64'))}
    >
      <div className={cn('flex h-16 items-center gap-2.5 px-4', compact && 'justify-center px-0')}>
        <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand text-[15px] font-bold text-white" aria-label={APP_NAME}>{APP_MARK}</span>
        {!compact && <span className="flex-1 truncate text-[15px] font-semibold text-ink">{APP_NAME}</span>}
        {!mobile && !compact && <CollapseButton compact={compact} onToggle={() => {
          setCollapsed(!collapsed);
          try { localStorage.setItem('trackoja-sidebar-collapsed', String(!collapsed)); } catch { /* Session-only is fine. */ }
        }} />}
        {mobile && <button type="button" className="inline-flex size-9 items-center justify-center rounded-lg text-ink-2 hover:bg-hover" onClick={onClose} aria-label="Close navigation"><ArrowLeftIcon width={18} height={18} /></button>}
      </div>
      {!compact && <div className="px-3 pb-3"><StoreSwitcher /></div>}

      <nav className="flex-1 overflow-y-auto px-3 pb-3" aria-label="Main navigation">
        {GROUPS.map(group => {
          const items = allItems.filter(item => (item.group ?? 'Account') === group);
          if (items.length === 0) return null;
          return (
            <div key={group} className="mt-3 first:mt-0">
              {!compact && <p className="m-0 mb-1 px-2.5 text-[11px] font-semibold uppercase tracking-[.06em] text-ink-3">{GROUP_TITLES[group] ?? group}</p>}
              <div className="flex flex-col gap-0.5">
                {items.map(item => (
                  <NavLink key={item.to} to={item.to} end={item.end} aria-label={item.label} title={compact ? item.label : undefined} onClick={onClose} className={linkClass}>
                    <item.icon width={18} height={18} />{!compact && <span className="truncate">{item.label}</span>}
                  </NavLink>
                ))}
              </div>
            </div>
          );
        })}
        {collapsed && !mobile && <div className="mt-3 flex justify-center"><CollapseButton compact onToggle={() => {
          setCollapsed(false);
          try { localStorage.setItem('trackoja-sidebar-collapsed', 'false'); } catch { /* Session-only is fine. */ }
        }} /></div>}
      </nav>

      <div className="border-t border-line p-3">
        <button
          type="button"
          aria-label={primaryAction.label}
          title={compact ? primaryAction.label : undefined}
          disabled={!canScan}
          onClick={() => { handleScan(); onClose?.(); }}
          className={cn('tl-nav-scan flex h-10 w-full items-center justify-center gap-2 rounded-md bg-brand text-sm font-semibold text-white transition-colors hover:bg-brand-hover disabled:opacity-50')}
        >
          {primaryAction.scan ? <ScanIcon width={18} height={18} /> : <SalesIcon width={18} height={18} />}
          {!compact && <span>{primaryAction.label}</span>}
        </button>
        {profile?.isPlatformAdmin && (
          <NavLink to="/platform" aria-label="Platform" title={compact ? 'Platform' : undefined} onClick={onClose} className={cn(linkClass({ isActive: false }), 'mt-2')}>
            <SettingsIcon width={18} height={18} />{!compact && <span>Platform</span>}
          </NavLink>
        )}
        {!compact && <div className="mt-3"><ThemeSelect /></div>}
        <div className={cn('mt-3 flex items-center gap-2.5', compact && 'flex-col')}>
          <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-tray text-xs font-semibold text-ink-2" title={displayName}>{initials}</span>
          {!compact && (
            <div className="min-w-0 flex-1 leading-tight">
              <p className="m-0 truncate text-[13px] font-semibold text-ink">{displayName}</p>
              <p className="m-0 truncate text-xs text-ink-3">{profile?.email}</p>
            </div>
          )}
          <button type="button" onClick={onLogout} aria-label="Log out" title="Log out" className="inline-flex size-9 items-center justify-center rounded-lg text-ink-2 hover:bg-hover hover:text-ink">
            <LogoutIcon width={17} height={17} />
          </button>
        </div>
      </div>
    </aside>
  );
}

function CollapseButton({ compact, onToggle }: { compact: boolean; onToggle: () => void }) {
  return (
    <button type="button" className="inline-flex size-8 items-center justify-center rounded-lg text-ink-3 hover:bg-hover hover:text-ink" aria-label={compact ? 'Expand navigation' : 'Collapse navigation'} aria-expanded={!compact} onClick={onToggle}>
      <SidebarIcon width={17} height={17} />
    </button>
  );
}
