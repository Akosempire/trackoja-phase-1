import { NavLink } from 'react-router-dom';
import { useAppNav, type NavItem } from '../hooks/useAppNav';
import { ScanIcon, SalesIcon } from './icons';
import { useCartCount } from '../utils/cart-count';
import { cn } from './kit';

/**
 * Mobile bottom navigation.
 *
 * The primary action (Scan, New order, New job) sits in the centre and rises
 * above the bar: a cashier reaches for it far more than any page. The bar is a
 * fixed five-column grid so long labels never push the centre off centre.
 */
export function BottomNav() {
  const { leftItems, rightItems, handleScan, canScan, primaryAction } = useAppNav();
  const cartCount = useCartCount();

  const renderLink = (item: NavItem) => {
    const isCheckout = item.to === '/sales/checkout';
    return (
      <NavLink
        key={item.to}
        to={item.to}
        end={item.end}
        data-tour={`nav:${item.to}`}
        className={({ isActive }) => cn('tl-tab flex min-w-0 flex-col items-center justify-center gap-1 text-[11px] font-medium no-underline',
          isActive ? 'active text-brand-ink' : 'text-ink-3')}
        aria-label={isCheckout && cartCount > 0 ? `${item.label}, ${cartCount} items in the sale` : item.label}
      >
        <span className="relative">
          <item.icon width={22} height={22} />
          {isCheckout && cartCount > 0 && (
            <span className="bottom-nav-badge absolute -right-2.5 -top-1.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-brand px-1 text-[10px] font-semibold text-white" aria-hidden="true">
              {cartCount > 99 ? '99+' : cartCount}
            </span>
          )}
        </span>
        <span className="max-w-full truncate">{item.label}</span>
      </NavLink>
    );
  };

  return (
    <nav
      aria-label="Primary"
      className="tl-tabbar fixed inset-x-0 bottom-0 z-30 grid h-[calc(64px+env(safe-area-inset-bottom))] grid-cols-5 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
    >
      {leftItems.map(renderLink)}
      {leftItems.length < 2 && Array.from({ length: 2 - leftItems.length }, (_, i) => <span key={`l${i}`} />)}
      <button
        type="button"
        className="bottom-nav-scan flex flex-col items-center justify-end gap-1 pb-2 text-[11px] font-semibold text-brand-ink disabled:opacity-50"
        data-tour="scan"
        onClick={handleScan}
        disabled={!canScan}
        aria-label={primaryAction.scan ? 'Scan a barcode' : primaryAction.label}
      >
        <span className="-mt-7 inline-flex size-14 items-center justify-center rounded-full bg-brand text-white shadow-pop ring-4 ring-surface">
          {primaryAction.scan ? <ScanIcon width={26} height={26} /> : <SalesIcon width={26} height={26} />}
        </span>
        <span className="truncate">{primaryAction.label}</span>
      </button>
      {rightItems.length < 2 && Array.from({ length: 2 - rightItems.length }, (_, i) => <span key={`r${i}`} />)}
      {rightItems.map(renderLink)}
    </nav>
  );
}
