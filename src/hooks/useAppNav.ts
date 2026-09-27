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

  // While permissions are still loading, do not filter - otherwise every item
  // disappears for a frame and the sidebar visibly empties on each store switch.
  const permitted = visibleNav(experience).filter(
    (item) => permsLoading || !item.permission || hasPermission(item.permission)
  );

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

  allItems.push({ to: '/more', label: 'More', icon: MoreIcon });

  // The mobile bottom bar is deliberately small and chosen per business type:
  // a restaurant gets Orders and Preparation, a fabric seller gets Sales and Rolls.
  // A key whose item was filtered out by permission is simply skipped.
  const bottomItems = experience.bottomNav
    .map((key) => navByKey.get(key))
    .filter((item): item is NavItem => Boolean(item));

  const leftItems: NavItem[] = bottomItems.slice(0, 1);
  const rightItems: NavItem[] = [
    ...bottomItems.slice(1),
    { to: '/more', label: 'More', icon: MoreIcon },
  ];

  const handleScan = () => {
    if (hasPermission('sales:create')) {
      navigate('/sales/checkout?scan=1');
    } else {
      navigate('/inventory/products?scan=1');
    }
  };

  return { leftItems, rightItems, allItems, handleScan, ScanIcon, experience };
}
