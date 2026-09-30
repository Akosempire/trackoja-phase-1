import { mobileDestinations } from '../utils/navigation-layout';
import { merchantPrimaryAction, navigationGroup, routeModule } from '../utils/merchant-experience';
import { useLocation, useNavigate } from 'react-router-dom';
import { usePermissions } from './usePermissions';
import { useBusinessContext } from '../contexts/BusinessContext';
import {
  HomeIcon, SalesIcon, ScanIcon, ReportsIcon,
  MoreIcon, ProductsIcon, CustomersIcon, StaffIcon,
  PaymentsIcon, SettingsIcon, KitchenIcon, ExpiryIcon, DevicesIcon, SubscriptionIcon, SupportIcon,
} from '../components/icons';
import { getBusinessExperience, visibleNav, type NavIconName } from '../config/businessExperience';

export interface NavItem {
  to: string;
  label: string;
  icon: (props: { width?: number; height?: number }) => JSX.Element;
  end?: boolean;
  group?: string;
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
  const { category, modules, loading: businessLoading } = useBusinessContext();
  const { pathname } = useLocation();

  const experience = getBusinessExperience(category, modules);

  const enabled = modules ?? experience.defaultModules;
  const allowed = (permission: string) => !permsLoading && !businessLoading && hasPermission(permission);
  const primaryAction = merchantPrimaryAction(category, enabled, allowed, pathname);

  // Keep public workspace navigation visible while permissions resolve. Do not
  // briefly expose restricted links during a store or role change.
  const permitted = visibleNav(experience).filter(
    (item) => (!item.permission || allowed(item.permission)) && (!routeModule(item.route) || enabled.includes(routeModule(item.route)!))
  );
  const canScan = Boolean(primaryAction.route);

  const navByKey = new Map<string, NavItem>();

  const allItems: NavItem[] = permitted.map((item) => {
    const navItem: NavItem = {
      to: item.route,
      label: item.key === 'checkout' ? 'POS' : item.key === 'sales' && item.label === 'Sales' ? 'Sales history' : item.label,
      group: navigationGroup(item.route),
      icon: item.key === 'sales' ? ReportsIcon : ICONS[item.icon],
      end: item.route === '/dashboard' || item.route === '/sales',
    };
    navByKey.set(item.key, navItem);
    return navItem;
  });

  // Payment records are readable with sales:view; approval and refund controls
  // remain separately gated by sales:refund on the page and in the database.
  if (!navByKey.has('payments') && allowed('sales:view') && enabled.includes('sales')) {
    const payments = { to: '/payments', label: 'Customer payments', icon: PaymentsIcon, group: 'Payments and connections' };
    navByKey.set('payments', payments);
    allItems.push(payments);
  }
  const extras = [
    { to: '/staff', label: 'Staff', icon: StaffIcon, permission: 'member:manage' },
    { to: '/devices', label: 'Devices', icon: DevicesIcon, permission: 'devices:view' },
    { to: '/settings', label: 'Settings', icon: SettingsIcon, permission: 'store:update' },
    { to: '/billing', label: 'Subscription', icon: SubscriptionIcon, permission: 'store:update' },
    { to: '/support', label: 'Support', icon: SupportIcon },
  ];
  extras.filter(item => !item.permission || allowed(item.permission)).forEach(item => {
    if (!allItems.some(existing => existing.to === item.to)) allItems.push({ ...item, group: navigationGroup(item.to) });
  });
  allItems.push({ to: '/more', label: 'More', icon: MoreIcon });

  // The mobile bottom bar is deliberately small and chosen per business type:
  // a restaurant gets Orders and Preparation, a fabric seller gets Sales and Rolls.
  // A key whose item was filtered out by permission is simply skipped.
  const bottomItems = experience.bottomNav
    .map((key) => navByKey.get(key))
    .filter((item): item is NavItem => Boolean(item));

  // Overview and More anchor the bar; the two middle destinations follow the category.
  const mobileItems = mobileDestinations(bottomItems, allItems);
  const leftItems = mobileItems.slice(0, 2);
  const rightItems = mobileItems.slice(2, 4);

  const handleScan = () => { if (primaryAction.route) navigate(primaryAction.route); };

  return { leftItems, rightItems, allItems, handleScan, canScan, ScanIcon, experience, primaryAction };
}
