import { useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { PLATFORM_AREAS, PLATFORM_GROUPS, canSeeArea, platformAreaPath, type PlatformArea } from '../../config/platformAreas';
import { usePlatform } from './PlatformContext';
import { EnvironmentMarker } from './EnvironmentBadge';
import { ContractIcon } from './icons';

interface PlatformSideNavProps {
  mobile?: boolean;
  onClose?: () => void;
}

/**
 * Platform console navigation.
 *
 * Built from the same WAYA sidebar primitives as the merchant workspace
 * (247px, collapses to 60px, tooltips when collapsed, modal drawer on mobile),
 * so the two halves of the product feel like one system. Entries are grouped so
 * ten destinations stay scannable.
 */
export function PlatformSideNav({ mobile = false, onClose }: PlatformSideNavProps) {
  const { access, environment } = usePlatform();
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
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="M9 4v16" />
          </svg>
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
              <p className="side-nav-group-label nav-label">{group.label}</p>
              {areas.map(renderLink)}
            </div>
          );
        })}
      </nav>

      <div className="side-nav-env">
        <EnvironmentMarker environment={environment} />
      </div>

      <div className="side-nav-footer">
        <Link to="/dashboard" className="side-nav-link" onClick={onClose}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
            <path d="M3 11.5 12 4l9 7.5" />
            <path d="M5 10v9a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1v-9" />
          </svg>
          <span className="nav-label">Customer workspace</span>
        </Link>
      </div>
    </aside>
  );
}
