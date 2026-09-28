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
import { ContractIcon } from './icons';
import { HomeIcon, LogoutIcon, SidebarIcon } from '../icons';
import { DownloadIcon } from '../icons';
import { InstallAppAction } from '../InstallAppAction';

interface PlatformSideNavProps {
  mobile?: boolean;
  onClose?: () => void;
  onLogout: () => void;
  loggingOut?: boolean;
}

/**
 * Platform console navigation.
 *
 * Built from the same WAYA sidebar primitives as the merchant workspace
 * (247px, collapses to 60px, tooltips when collapsed, modal drawer on mobile),
 * so the two halves of the product feel like one system. Entries are grouped so
 * ten destinations stay scannable.
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
  const [tooltipTop, setTooltipTop] = useState(0);

  const compact = collapsed && !mobile;
  const visible = access
    ? PLATFORM_AREAS.filter((area) => canSeeArea(area, access))
    : [];

  // Which group the current screen belongs to, so the group label reinforces
  // where you are rather than leaving ten peer links to scan.
  const activeGroup = findPlatformArea(location.pathname)?.group ?? null;

  function renderLink(area: PlatformArea) {
    const to = platformAreaPath(area);
    const isIndex = area.path === '';
    return (
      <span
        key={area.id}
        className="nav-tooltip-wrap t-tt-wrap"
        onMouseEnter={(event) => setTooltipTop(event.currentTarget.getBoundingClientRect().top)}
        onFocus={(event) => setTooltipTop(event.currentTarget.getBoundingClientRect().top)}
      >
        <NavLink
          to={to}
          end={isIndex}
          aria-label={area.label}
          // The area's description lives here rather than at the top of the page:
          // it is useful once, on hover, and noise on every visit.
          title={area.description}
          onClick={onClose}
          className={({ isActive }) => `side-nav-link t-tt-trigger${isActive ? ' active' : ''}`}
        >
          <area.icon width={17} height={17} />
          <span className="nav-label">{area.short}</span>
        </NavLink>
        {compact && (
          <span className="t-tt nav-tooltip" role="tooltip" style={{ top: tooltipTop }}>
            {area.label}
          </span>
        )}
      </span>
    );
  }

  return (
    <aside
      className={`side-nav${compact ? ' is-collapsed' : ''}${mobile ? ' is-mobile' : ''}`}
      aria-label="Platform administration"
    >
      <div className="side-nav-brand">
        <span className="workspace-mark" aria-label="TrackOja Platform">
          <ContractIcon width={16} height={16} />
        </span>
        <span className="side-nav-logo nav-label">Platform</span>
        {mobile && (
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close navigation">
            ×
          </button>
        )}
      </div>

      {!mobile && (
        <button
          type="button"
          className="sidebar-toggle"
          aria-label={compact ? 'Expand navigation' : 'Collapse navigation'}
          aria-expanded={!compact}
          onClick={() => {
            const next = !collapsed;
            setCollapsed(next);
            try {
              localStorage.setItem('trackoja-platform-sidebar-collapsed', String(next));
            } catch {
              /* Session-only is acceptable. */
            }
          }}
        >
          <SidebarIcon width={17} height={17} />
          <span className="nav-label">Collapse sidebar</span>
        </button>
      )}

      <nav className="side-nav-items" aria-label="Platform areas">
        {visible
          .filter((area) => area.group === null)
          .map(renderLink)}

        {PLATFORM_GROUPS.map((group) => {
          const areas = visible.filter((area) => area.group === group.id);
          if (areas.length === 0) return null;
          return (
            <div className="side-nav-group" key={group.id}>
              <p className={`side-nav-group-label nav-label${activeGroup === group.id ? ' is-active' : ''}`}>
                {group.label}
              </p>
              {areas.map(renderLink)}
            </div>
          );
        })}
      </nav>

      <div className="side-nav-env">
        <EnvironmentMarker environment={environment} />
      </div>

      <div className="side-nav-footer">
        <InstallAppAction className="side-nav-link" label="Install TrackOja" labelClassName="nav-label" icon={<DownloadIcon width={17} height={17} />} />
        <Link to="/dashboard" className="side-nav-link" onClick={onClose}>
          <HomeIcon width={17} height={17} />
          <span className="nav-label">Customer workspace</span>
        </Link>
        <button
          type="button"
          className="side-nav-link platform-logout"
          onClick={() => {
            onClose?.();
            onLogout();
          }}
          disabled={loggingOut}
          aria-label="Log out"
          title={compact ? 'Log out' : undefined}
        >
          <LogoutIcon width={17} height={17} />
          <span className="nav-label">{loggingOut ? 'Logging out…' : 'Log out'}</span>
        </button>
      </div>
    </aside>
  );
}
