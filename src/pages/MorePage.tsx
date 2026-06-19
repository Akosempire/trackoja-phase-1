import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../hooks/usePermissions';
import { useBusinessContext } from '../contexts/BusinessContext';
import { AuthService } from '../services/auth.service';
import {
  ProductsIcon,
  CustomersIcon,
  StaffIcon,
  DevicesIcon,
  PaymentsIcon,
  SettingsIcon,
  SubscriptionIcon,
  SupportIcon,
  ChevronRightIcon,
  ExpiryIcon,
} from '../components/icons';

interface MoreLink {
  to: string;
  label: string;
  icon: (props: { width?: number; height?: number }) => JSX.Element;
}

export default function MorePage() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { hasPermission, loading } = usePermissions();
  const { category } = useBusinessContext();

  const handleLogout = async () => {
    await AuthService.logout();
    navigate('/login', { replace: true });
  };

  if (loading) return null;

  const links: MoreLink[] = [{ to: '/inventory/products', label: 'Products', icon: ProductsIcon }];

  if (category === 'pharmacy') {
    links.push({ to: '/pharmacy/expiry', label: 'Expiry Alerts', icon: ExpiryIcon });
  }

  if (hasPermission('customer:view')) {
    links.push({ to: '/customers', label: 'Customers', icon: CustomersIcon });
  }
  if (hasPermission('member:manage')) {
    links.push({ to: '/staff', label: 'Staff', icon: StaffIcon });
  }
  if (hasPermission('devices:view')) {
    links.push({ to: '/devices', label: 'Devices', icon: DevicesIcon });
  }
  if (hasPermission('sales:refund')) {
    links.push({ to: '/payments', label: 'Payments', icon: PaymentsIcon });
  }
  if (hasPermission('store:update')) {
    links.push({ to: '/settings', label: 'Settings', icon: SettingsIcon });
    links.push({ to: '/billing', label: 'Subscription', icon: SubscriptionIcon });
  }
  links.push({ to: '/support', label: 'Support', icon: SupportIcon });

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">More</h1>
          <p className="page-subtitle">{profile?.firstName ? `Signed in as ${profile.firstName}` : 'More options'}</p>
        </div>
      </div>

      <div className="list">
        {links.map((link) => (
          <Link key={link.to} to={link.to} className="list-item">
            <div className="list-item-leading">
              <link.icon width={20} height={20} />
              <p className="list-item-title">{link.label}</p>
            </div>
            <ChevronRightIcon width={18} height={18} style={{ color: 'var(--t2)' }} />
          </Link>
        ))}
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <button type="button" className="btn btn-ghost btn-sm" onClick={handleLogout}>
          Log out
        </button>
      </div>
    </div>
  );
}
