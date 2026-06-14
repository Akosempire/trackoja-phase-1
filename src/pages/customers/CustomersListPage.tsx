import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { usePermissions } from '../../hooks/usePermissions';
import { CustomerService } from '../../services/customer.service';
import { Button } from '../../components/ui/Button';
import { PageLoader } from '../../components/ui/PageLoader';
import type { Customer } from '../../types';

export default function CustomersListPage() {
  const { profile } = useAuth();
  const { hasPermission, loading: permsLoading } = usePermissions();
  const storeId = profile?.currentStoreId;

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const canCreate = hasPermission('customer:create');

  useEffect(() => {
    if (!storeId) return;
    setLoading(true);
    CustomerService.getCustomers(storeId, { search: search || undefined, isActive: true })
      .then(setCustomers)
      .catch((err) => setError(err.message ?? 'Failed to load customers'))
      .finally(() => setLoading(false));
  }, [storeId, search]);

  if (permsLoading) return <PageLoader />;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Customers</h1>
          <p className="page-subtitle">{customers.length} customer{customers.length === 1 ? '' : 's'}</p>
        </div>
        {canCreate && (
          <Link to="/customers/new">
            <Button className="btn-sm">Add customer</Button>
          </Link>
        )}
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <input
        className="form-input search-input"
        placeholder="Search by name, phone, or email"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {loading ? (
        <PageLoader />
      ) : customers.length === 0 ? (
        <div className="empty-state">No customers found.</div>
      ) : (
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
      )}
    </div>
  );
}
