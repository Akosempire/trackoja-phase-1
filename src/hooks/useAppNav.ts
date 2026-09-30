import { mobileDestinations } from '../utils/navigation-layout';
import { useNavigate } from 'react-router-dom';
import { usePermissions } from './usePermissions';
import { useBusinessContext } from '../contexts/BusinessContext';
import {
  HomeIcon, SalesIcon, ScanIcon, ReportsIcon,
  MoreIcon, ProductsIcon, CustomersIcon, StaffIcon,
  PaymentsIcon, SettingsIcon, KitchenIcon, ExpiryIcon, DevicesIcon,
} from '../components/icons';
import { getBusinessExperience, visibleNav, type NavIconName } from '../config/businessExperience';

export interface NavItem {
  to: string;
  label: string;
  icon: (props: { width?: number; height?: number }) => JSX.Element;
  end?: boolean;
}

const ICONS: Record<NavIconName, (props: { width?: number; height?: number }) => JSX.Element> = {
  home: HomeIcon,
  sales: SalesIcon,
  products: ProductsIcon,
  customers: CustomersIcon,
  staff: StaffIcon,
  reports: ReportsIcon,
  payments: PaymentsIcon,
  settings: SettingsIcon,
  kitchen: KitchenIcon,
  expiry: ExpiryIcon,
  devices: DevicesIcon,
};

/**
 * Navigation is derived from the business experience, not hard-coded per role.
 *
 * Consequences worth knowing:
 *  - A tailor sees "Clients" and "Materials"; a fabric seller sees "Fabrics" and
 *    "Rolls"; a restaurant sees "Orders", "Menu" and "Preparation". Same routes,
 *    different words, because the terminology lives in the experience.
 *  - Items the server would refuse are hidden using each item's declared
 *    permission (a cashier has no reports:view, so Reports is not shown). Hiding
 *    is convenience only - every route and RPC re-checks permission server-side.
 *  - Only implemented items are rendered, so navigation never points at a
 *    workflow that does not exist (see missingCapabilities() for the work list).
 */
export function useAppNav() {
  const navigate = useNavigate();
  const { hasPermission, loading: permsLoading } = usePermissions();
  const { category } = useBusinessContext();

  const experience = getBusinessExperience(category);

  // Keep public workspace navigation visible while permissions resolve. Do not
  // briefly expose restricted links during a store or role change.
  const permitted = visibleNav(experience).filter(
    (item) => !item.permission || (!permsLoading && hasPermission(item.permission))
  );
  const canScan = !permsLoading && (hasPermission('sales:create') || hasPermission('inventory:view'));

  const navByKey = new Map<string, NavItem>();

  const allItems: NavItem[] = permitted.map((item) => {
    const navItem: NavItem = {
      to: item.route,
      label: item.label,
      icon: ICONS[item.icon],
      end: item.route === '/dashboard' || item.route === '/sales',
    };
    navByKey.set(item.key, navItem);
    return navItem;
  });

  // Payment records are readable with sales:view; approval and refund controls
  // remain separately gated by sales:refund on the page and in the database.
  if (!navByKey.has('payments') && !permsLoading && hasPermission('sales:view')) {
    const payments = { to: '/payments', label: 'Payments', icon: PaymentsIcon };
    navByKey.set('payments', payments);
    allItems.push(payments);
  }
  allItems.push({ to: '/more', label: 'More', icon: MoreIcon });

  // The mobile bottom bar is deliberately small and chosen per business type:
  // a restaurant gets Orders and Preparation, a fabric seller gets Sales and Rolls.
  // A key whose item was filtered out by permission is simply skipped.
  const bottomItems = experience.bottomNav
    .map((key) => navByKey.get(key))
    .filter((item): item is NavItem => Boolean(item));

  // Selection only uses permitted items, with Payments in the four available slots.
  const mobileItems = mobileDestinations(bottomItems, allItems);
  const leftItems = mobileItems.slice(0, 2);
  const rightItems = mobileItems.slice(2, 4);

  const handleScan = () => {
    if (!canScan) return;
    if (hasPermission('sales:create')) {
      navigate('/sales/checkout?scan=1');
    } else {
      navigate('/inventory/products?scan=1');
    }
  };

  return { leftItems, rightItems, allItems, handleScan, canScan, ScanIcon, experience };
}
