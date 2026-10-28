import { useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import {
  PLATFORM_AREAS,
  PLATFORM_GROUPS,
  canSeeArea,
  findPlatformArea,
  platformAreaPath,
  type PlatformArea,
} from '../../config/platformAreas';
import { usePlatform } from './PlatformContext';
import { EnvironmentMarker } from './EnvironmentBadge';
import { ArrowLeftIcon, HomeIcon, LogoutIcon, SidebarIcon, DownloadIcon } from '../icons';
import { InstallAppAction } from '../InstallAppAction';
import { APP_MARK, APP_NAME } from '../../config/brand';
import { cn } from '../kit';

interface PlatformSideNavProps {
  mobile?: boolean;
  onClose?: () => void;
  onLogout: () => void;
  loggingOut?: boolean;
}

const linkBase = 'flex h-9 w-full items-center gap-3 rounded-lg px-2.5 text-sm font-medium no-underline transition-colors';

/**
 * Platform console navigation.
 *
 * The same sidebar anatomy as the merchant workspace (white rail, grouped
 * links, collapses to icons, modal drawer on mobile) so the two halves of the
 * product feel like one system. Entries are grouped so ten destinations stay
 * scannable.
 */
export function PlatformSideNav({ mobile = false, onClose, onLogout, loggingOut = false }: PlatformSideNavProps) {
  const { access, environment } = usePlatform();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('trackoja-platform-sidebar-collapsed') === 'true';
    } catch {
      return false;
    }
  });

  const compact = collapsed && !mobile;
  const visible = access
    ? PLATFORM_AREAS.filter((area) => canSeeArea(area, access))
    : [];

  // Which group the current screen belongs to, so the group label reinforces
  // where you are rather than leaving ten peer links to scan.
  const activeGroup = findPlatformArea(location.pathname)?.group ?? null;

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem('trackoja-platform-sidebar-collapsed', String(next));
    } catch {
      /* Session-only is acceptable. */
    }
  }

  function renderLink(area: PlatformArea) {
    return (
      <NavLink
        key={area.id}
        to={platformAreaPath(area)}
        end={area.path === ''}
        aria-label={area.label}
        // The area's description lives here rather than at the top of the page:
        // it is useful once, on hover, and noise on every visit.
        title={compact ? area.label : area.description}
        onClick={onClose}
        className={({ isActive }) => cn(linkBase, compact && 'justify-center px-0',
          isActive ? 'bg-brand-soft text-brand-ink' : 'text-ink-2 hover:bg-hover hover:text-ink')}
      >
        <area.icon width={18} height={18} className="shrink-0" />
        {!compact && <span className="truncate">{area.short}</span>}
      </NavLink>
    );
  }

  return (
    <aside
      className={cn('flex flex-col bg-surface',
        mobile ? 'h-full w-full' : 'sticky top-0 hidden h-dvh shrink-0 border-r border-line lg:flex',
        !mobile && (compact ? 'w-[72px]' : 'w-64'))}
      aria-label="Platform administration"
    >
      <div className={cn('flex h-16 shrink-0 items-center gap-2.5 px-4', compact && 'justify-center px-0')}>
        <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-ink text-[15px] font-bold text-surface" aria-label={`${APP_NAME} Platform`}>
          {APP_MARK}
        </span>
        {!compact && (
          <span className="min-w-0 flex-1 leading-tight">
            <span className="block truncate text-[15px] font-semibold text-ink">{APP_NAME}</span>
            <span className="block truncate text-xs font-medium text-ink-3">Platform console</span>
          </span>
        )}
        {!mobile && !compact && (
          <button
            type="button"
            className="inline-flex size-8 items-center justify-center rounded-lg text-ink-3 hover:bg-hover hover:text-ink"
            aria-label="Collapse navigation"
            aria-expanded
            onClick={toggle}
          >
            <SidebarIcon width={17} height={17} />
          </button>
        )}
        {mobile && (
          <button type="button" className="inline-flex size-9 items-center justify-center rounded-lg text-ink-2 hover:bg-hover" onClick={onClose} aria-label="Close navigation">
            <ArrowLeftIcon width={18} height={18} />
          </button>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto px-3 pb-3" aria-label="Platform areas">
        <div className="flex flex-col gap-0.5">
          {visible.filter((area) => area.group === null).map(renderLink)}
        </div>

        {PLATFORM_GROUPS.map((group) => {
          const areas = visible.filter((area) => area.group === group.id);
          if (areas.length === 0) return null;
          return (
            <div className="mt-4" key={group.id}>
              {!compact && (
                <p className={cn('m-0 mb-1 px-2.5 text-[11px] font-semibold uppercase tracking-[.06em]', activeGroup === group.id ? 'text-ink-2' : 'text-ink-3')}>
                  {group.label}
                </p>
              )}
              {compact && <div className="mx-auto mb-2 h-px w-8 bg-line" aria-hidden="true" />}
              <div className="flex flex-col gap-0.5">{areas.map(renderLink)}</div>
            </div>
          );
        })}

        {compact && (
          <div className="mt-3 flex justify-center">
            <button
              type="button"
              className="inline-flex size-8 items-center justify-center rounded-lg text-ink-3 hover:bg-hover hover:text-ink"
              aria-label="Expand navigation"
              aria-expanded={false}
              onClick={toggle}
            >
              <SidebarIcon width={17} height={17} />
            </button>
          </div>
        )}
      </nav>

      {!compact && (
        <div className="px-3 pb-2">
          <EnvironmentMarker environment={environment} />
        </div>
      )}

      <div className="flex flex-col gap-0.5 border-t border-line p-3">
        <InstallAppAction
          className={cn(linkBase, 'bg-transparent text-ink-2 hover:bg-hover hover:text-ink', compact && 'justify-center px-0')}
          label={`Install ${APP_NAME}`}
          labelClassName={compact ? 'sr-only' : 'truncate'}
          icon={<DownloadIcon width={18} height={18} className="shrink-0" />}
        />
        <Link to="/dashboard" className={cn(linkBase, 'text-ink-2 hover:bg-hover hover:text-ink', compact && 'justify-center px-0')} onClick={onClose} title={compact ? 'Customer workspace' : undefined}>
          <HomeIcon width={18} height={18} className="shrink-0" />
          <span className={compact ? 'sr-only' : 'truncate'}>Customer workspace</span>
        </Link>
        <button
          type="button"
          className={cn(linkBase, 'bg-transparent text-ink-2 hover:bg-hover hover:text-ink disabled:opacity-50', compact && 'justify-center px-0')}
          onClick={() => {
            onClose?.();
            onLogout();
          }}
          disabled={loggingOut}
          aria-label="Log out"
          title={compact ? 'Log out' : undefined}
        >
          <LogoutIcon width={18} height={18} className="shrink-0" />
          {!compact && <span className="truncate">{loggingOut ? 'Logging out…' : 'Log out'}</span>}
        </button>
      </div>
    </aside>
  );
}
