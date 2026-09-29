import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { usePermissions } from '../../hooks/usePermissions';
import { useBusinessContext } from '../../contexts/BusinessContext';
import { getBusinessExperience } from '../../config/businessExperience';
import { CustomerService } from '../../services/customer.service';
import { SearchInput } from '../../components/ui/SearchInput';
import { PageLoader } from '../../components/ui/PageLoader';
import { SectionState } from '../../components/ui/StateBlock';
import type { Customer } from '../../types';

export default function CustomersListPage() {
  const { profile } = useAuth();
  const { hasPermission, loading: permsLoading } = usePermissions();
  const { category } = useBusinessContext();
  const customerLabel = getBusinessExperience(category).terminology.customer.toLowerCase();
  const customersLabel = `${customerLabel}s`;
  const storeId = profile?.currentStoreId;

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [loadAttempt, setLoadAttempt] = useState(0);

  const canCreate = hasPermission('customer:create');

  useEffect(() => {
    if (!storeId) {
      setCustomers([]);
      setLoading(false);
      setError(`Choose a business workspace to view ${customersLabel}.`);
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    setCustomers([]);
    CustomerService.getCustomers(storeId, { search: search || undefined, isActive: true })
      .then((data) => { if (active) setCustomers(data); })
      .catch((err) => { if (active) setError(err instanceof Error ? err.message : 'Failed to load customers'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [storeId, search, loadAttempt, customersLabel]);

  if (permsLoading) return <PageLoader />;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">{customersLabel[0].toUpperCase()}{customersLabel.slice(1)}</h1>
          <p className="page-subtitle">{loading ? `Loading ${customersLabel}…` : error ? `${customersLabel[0].toUpperCase()}${customersLabel.slice(1)} unavailable` : `${customers.length} ${customerLabel}${customers.length === 1 ? '' : 's'}`}</p>
        </div>
        {canCreate && (
          <Link className="btn btn-primary btn-sm" to="/customers/new">Add {customerLabel}</Link>
        )}
      </div>

      <SearchInput
        aria-label={`Search ${customersLabel}`}
        placeholder="Search by name, phone, or email"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      <SectionState
        loading={loading}
        error={error}
        onRetry={() => setLoadAttempt((attempt) => attempt + 1)}
        empty={customers.length === 0}
        emptyTitle={search ? `No matching ${customersLabel}` : `No ${customersLabel} yet`}
        emptyBody={search ? 'Try a different name, phone number, or email.' : `Add a ${customerLabel} to track purchases, balances, and loyalty.`}
        emptyActions={canCreate && !search ? <Link className="btn btn-primary btn-sm" to="/customers/new">Add {customerLabel}</Link> : undefined}
      >
        <div className="list">
          {customers.map((customer) => (
            <Link key={customer.id} to={`/customers/${customer.id}`} className="list-item">
              <div>
                <p className="list-item-title">{customer.name}</p>
                <p className="list-item-subtitle">{customer.phone || customer.email || 'No contact info'}</p>
              </div>
              <div className="list-item-meta">
                <span className={`badge ${customer.balance > 0 ? 'badge-warning' : 'badge-default'}`}>
                  ₦{customer.balance.toLocaleString()} owed
                </span>
                {customer.loyaltyPoints > 0 && (
                  <span className="list-item-subtitle">{customer.loyaltyPoints} pts</span>
                )}
              </div>
            </Link>
          ))}
        </div>
      </SectionState>
    </div>
  );
}
