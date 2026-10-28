import { Link, useLocation } from 'react-router-dom';
import { ArrowLeftIcon } from './icons';

interface BackDestination { to: string; label: string }

function destination(pathname: string): BackDestination | null {
  if (pathname === '/more') return { to: '/dashboard', label: 'Back to dashboard' };
  if (['/inventory/products', '/sales', '/customers'].includes(pathname)) {
    return { to: '/dashboard', label: 'Back to dashboard' };
  }

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
  // Form-width screens (receipt, product and customer forms) align the link to their narrower column.
  const productForm = /^\/inventory\/products\/[^/]+$/.test(pathname) && pathname !== '/inventory/products/bulk-import';
  const narrow = /^\/sales\/(?!history$|checkout$)[^/]+$/.test(pathname)
    || pathname === '/customers/new' || /^\/customers\/[^/]+\/edit$/.test(pathname);

  return (
    <nav className={`tl-back mx-auto w-full px-4 pt-4 sm:px-6 lg:px-8 lg:pt-6 ${wide ? 'max-w-[1440px]' : productForm ? 'max-w-[1040px]' : narrow ? 'max-w-[760px]' : 'max-w-[1120px]'}`} aria-label="Back navigation">
      <Link className="tl-back-link inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-2 no-underline hover:text-ink" to={back.to}>
        <ArrowLeftIcon width={16} height={16} />
        <span>{back.label}</span>
      </Link>
    </nav>
  );
}
