import { Link, useLocation } from 'react-router-dom';
import { ArrowLeftIcon } from './icons';

interface BackDestination { to: string; label: string }

function destination(pathname: string): BackDestination | null {
  if (pathname === '/more') return { to: '/dashboard', label: 'Back to dashboard' };

  if (pathname === '/inventory/products/new' || pathname === '/inventory/products/bulk-import') {
    return { to: '/inventory/products', label: 'Back to products' };
  }
  if (/^\/inventory\/products\/[^/]+$/.test(pathname)) {
    return { to: '/inventory/products', label: 'Back to products' };
  }
  if (['/inventory/categories', '/inventory/stock', '/inventory/lots'].includes(pathname)) {
    return { to: '/inventory/products', label: 'Back to inventory' };
  }

  if (pathname === '/sales/history' || pathname === '/sales/checkout') {
    return { to: '/sales', label: 'Back to sales' };
  }
  if (/^\/sales\/[^/]+$/.test(pathname)) {
    return { to: '/sales/history', label: 'Back to sales history' };
  }

  if (pathname === '/customers/new') return { to: '/customers', label: 'Back to customers' };
  const customerEdit = pathname.match(/^\/customers\/([^/]+)\/edit$/);
  if (customerEdit) return { to: `/customers/${customerEdit[1]}`, label: 'Back to customer' };
  if (/^\/customers\/[^/]+$/.test(pathname)) return { to: '/customers', label: 'Back to customers' };
  if (/^\/devices\/[^/]+$/.test(pathname)) return { to: '/devices', label: 'Back to devices' };

  const moreRoutes = new Set([
    '/billing', '/devices', '/expenses', '/jobs', '/payments', '/pharmacy/expiry',
    '/reports', '/settings', '/staff', '/support', '/kitchen',
  ]);
  if (moreRoutes.has(pathname)) return { to: '/more', label: 'Back to more' };

  return null;
}

/** A deterministic parent link for secondary merchant screens. */
export function RouteBackBar() {
  const { pathname } = useLocation();
  const back = destination(pathname);
  if (!back) return null;
  const wide = pathname === '/sales/checkout';

  return (
    <nav className={`route-back-bar${wide ? ' is-wide' : ''}`} aria-label="Back navigation">
      <Link className="route-back-link" to={back.to}>
        <ArrowLeftIcon width={16} height={16} />
        <span>{back.label}</span>
      </Link>
    </nav>
  );
}
