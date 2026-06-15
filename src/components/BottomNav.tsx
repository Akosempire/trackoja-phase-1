import { NavLink, useNavigate } from 'react-router-dom';
import { usePermissions } from '../hooks/usePermissions';
import { HomeIcon, SalesIcon, ScanIcon, ReportsIcon, MoreIcon, ProductsIcon } from './icons';

interface NavItem {
  to: string;
  label: string;
  icon: (props: { width?: number; height?: number }) => JSX.Element;
  end?: boolean;
}

// Bottom tab bar for the mobile-first app shell. Item set adapts to the
// member's role so each role's most common actions are one tap away, with
// the barcode Scan action always anchored in the center.
export function BottomNav() {
  const navigate = useNavigate();
  const { roleName, hasPermission } = usePermissions();

  const isInventoryOfficer = roleName === 'inventory_officer';
  const isCashier = roleName === 'cashier';

  const leftItems: NavItem[] = [{ to: '/dashboard', label: 'Home', icon: HomeIcon, end: true }];
  const rightItems: NavItem[] = [];

  if (!isInventoryOfficer) {
    leftItems.push({ to: '/sales', label: 'Sales', icon: SalesIcon, end: true });
  }

  if (isInventoryOfficer) {
    rightItems.push({ to: '/inventory/products', label: 'Products', icon: ProductsIcon });
  } else if (!isCashier) {
    rightItems.push({ to: '/reports', label: 'Reports', icon: ReportsIcon });
  }

  rightItems.push({ to: '/more', label: 'More', icon: MoreIcon });

  const handleScan = () => {
    if (hasPermission('sales:create')) {
      navigate('/sales/checkout?scan=1');
    } else {
      navigate('/inventory/products?scan=1');
    }
  };

  const renderLink = (item: NavItem) => (
    <NavLink
      key={item.to}
      to={item.to}
      end={item.end}
      className={({ isActive }) => `bottom-nav-link${isActive ? ' active' : ''}`}
    >
      <item.icon />
      <span>{item.label}</span>
    </NavLink>
  );

  return (
    <nav className="bottom-nav">
      {leftItems.map(renderLink)}
      <button type="button" className="bottom-nav-scan" onClick={handleScan} aria-label="Scan barcode">
        <ScanIcon width={26} height={26} />
        <span>Scan</span>
      </button>
      {rightItems.map(renderLink)}
    </nav>
  );
}
