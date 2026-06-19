import { useNavigate } from 'react-router-dom';
import { usePermissions } from './usePermissions';
import { useBusinessContext } from '../contexts/BusinessContext';
import {
  HomeIcon, SalesIcon, ScanIcon, ReportsIcon,
  MoreIcon, ProductsIcon, KitchenIcon, ExpiryIcon,
} from '../components/icons';

export interface NavItem {
  to: string;
  label: string;
  icon: (props: { width?: number; height?: number }) => JSX.Element;
  end?: boolean;
}

export function useAppNav() {
  const navigate = useNavigate();
  const { roleName, hasPermission } = usePermissions();
  const { config, category } = useBusinessContext();

  const isInventoryOfficer = roleName === 'inventory_officer';
  const isCashier = roleName === 'cashier';

  const leftItems: NavItem[] = [{ to: '/dashboard', label: 'Home', icon: HomeIcon, end: true }];
  const rightItems: NavItem[] = [];

  if (!isInventoryOfficer) {
    leftItems.push({ to: '/sales', label: config.saleLabel, icon: SalesIcon, end: true });
  }

  if (isInventoryOfficer) {
    rightItems.push({ to: '/inventory/products', label: 'Products', icon: ProductsIcon });
  } else if (!isCashier) {
    if (category === 'restaurant') {
      rightItems.push({ to: '/kitchen', label: 'Kitchen', icon: KitchenIcon });
    } else if (category === 'pharmacy') {
      rightItems.push({ to: '/pharmacy/expiry', label: 'Alerts', icon: ExpiryIcon });
    } else {
      rightItems.push({ to: '/reports', label: 'Reports', icon: ReportsIcon });
    }
  }

  rightItems.push({ to: '/more', label: 'More', icon: MoreIcon });

  const allItems = [...leftItems, ...rightItems];

  const handleScan = () => {
    if (hasPermission('sales:create')) {
      navigate('/sales/checkout?scan=1');
    } else {
      navigate('/inventory/products?scan=1');
    }
  };

  return { leftItems, rightItems, allItems, handleScan, ScanIcon };
}
