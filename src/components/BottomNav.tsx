import { NavLink } from 'react-router-dom';
import { useAppNav, type NavItem } from '../hooks/useAppNav';
import { ScanIcon, SalesIcon } from './icons';
import { useCartCount } from '../utils/cart-count';

/**
 * Mobile bottom navigation.
 *
 * Scan sits in the centre slot and rises above the bar, because a cashier adds
 * products far more often than they visit any one page and the action has to be
 * findable by thumb without looking. The other four stay deliberately quiet so
 * nothing competes with it.
 *
 * Layout is a fixed five-column grid rather than a flex row, so the centre slot is
 * geometrically centred whatever the labels are - long labels must not push Scan
 * off centre, which is what happens when items size themselves.
 */
export function BottomNav() {
  const { leftItems, rightItems, handleScan, canScan, primaryAction } = useAppNav();
  const cartCount = useCartCount();

  const renderLink = (item: NavItem, slot: number) => {
    // The checkout slot carries the live item count for the sale in progress.
    const isCheckout = item.to === '/sales/checkout';
    return (
      <NavLink
        key={item.to}
        to={item.to}
        end={item.end}
        className={({ isActive }) => `bottom-nav-link bottom-nav-slot-${slot}${isActive ? ' active' : ''}`}
        aria-label={isCheckout && cartCount > 0 ? `${item.label}, ${cartCount} items in the sale` : item.label}
      >
        <span className="bottom-nav-icon">
          <item.icon width={22} height={22} />
          {isCheckout && cartCount > 0 && (
            <span className="bottom-nav-badge" aria-hidden="true">
              {cartCount > 99 ? '99+' : cartCount}
            </span>
          )}
        </span>
        <span className="bottom-nav-label">{item.label}</span>
      </NavLink>
    );
  };

  return (
    <nav className="bottom-nav" aria-label="Primary">
      {leftItems.map((item, index) => renderLink(item, index + 1))}

      <button
        type="button"
        className="bottom-nav-scan"
        onClick={handleScan}
        disabled={!canScan}
        aria-label={primaryAction.scan ? 'Scan a barcode' : primaryAction.label}
      >
        <span className="bottom-nav-scan-face">
          {primaryAction.scan ? <ScanIcon width={26} height={26} /> : <SalesIcon width={26} height={26} />}
        </span>
        <span className="bottom-nav-label bottom-nav-scan-label">{primaryAction.label}</span>
      </button>

      {rightItems.map((item, index) => renderLink(item, item.to === '/more' ? 5 : index + 4))}
    </nav>
  );
}
