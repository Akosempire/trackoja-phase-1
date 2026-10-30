import { formatMoney } from '../../utils/format';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { usePermissions } from '../../hooks/usePermissions';
import { useBusinessContext } from '../../contexts/BusinessContext';
import { getBusinessExperience } from '../../config/businessExperience';
import { CustomerService } from '../../services/customer.service';
import { PageLoader } from '../../components/ui/PageLoader';
import { SectionState } from '../../components/ui/StateBlock';
import { Avatar, Card, Page, PageHeader, Stat, btn, cn, inputClass } from '../../components/kit';
import { SearchIcon } from '../../components/icons';
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

  const title = `${customersLabel[0].toUpperCase()}${customersLabel.slice(1)}`;
  const owing = customers.filter((customer) => customer.balance > 0);
  const totalOwed = owing.reduce((sum, customer) => sum + customer.balance, 0);
  const totalPoints = customers.reduce((sum, customer) => sum + (customer.loyaltyPoints ?? 0), 0);

  return (
    <Page>
      <PageHeader
        title={title}
        subtitle={loading ? `Loading ${customersLabel}…` : error ? `${title} unavailable` : `${customers.length} ${customerLabel}${customers.length === 1 ? '' : 's'}`}
        actions={<>
          <Link className={btn('outline')} to="/customers/owing">Who owes you</Link>
          {canCreate && <Link className={btn('primary')} to="/customers/new">Add {customerLabel}</Link>}
        </>}
      />

      {!loading && !error && customers.length > 0 && !search && (
        <section className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-3 lg:gap-4" aria-label={`${title} summary`}>
          <Stat label="Owed to you" value={formatMoney(totalOwed)} tone={totalOwed > 0 ? 'warn' : undefined}
            hint={owing.length ? `${owing.length} with a balance` : 'Nobody owes you'} />
          <Stat label={title} value={customers.length.toLocaleString('en-NG')} />
          <div className="hidden lg:block">
            <Stat label="Loyalty points held" value={totalPoints.toLocaleString('en-NG')} />
          </div>
        </section>
      )}

      <div className="relative mb-4">
        <SearchIcon width={17} height={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
        <input type="search" className={cn(inputClass, 'pl-9')} aria-label={`Search ${customersLabel}`}
          placeholder="Search by name, phone, or email" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <SectionState
        loading={loading}
        error={error}
        onRetry={() => setLoadAttempt((attempt) => attempt + 1)}
        empty={customers.length === 0}
        emptyTitle={search ? `No matching ${customersLabel}` : `No ${customersLabel} yet`}
        emptyBody={search ? 'Try a different name, phone number, or email.' : `Add a ${customerLabel} to track purchases, balances, and loyalty.`}
      >
        <Card padded={false} className="overflow-hidden">
          <div className="hidden grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)] gap-4 border-b border-line bg-subtle px-5 py-2.5 text-xs font-semibold uppercase tracking-[.06em] text-ink-3 md:grid" aria-hidden="true">
            <span>{customerLabel}</span><span>Contact</span><span className="text-right">Loyalty</span><span className="text-right">Owes you</span>
          </div>
          <ul className="m-0 list-none divide-y divide-line p-0">
            {customers.map((customer) => {
              const contact = customer.phone || customer.email || 'No contact info';
              const owes = customer.balance > 0;
              return (
                <li key={customer.id}>
                  <Link to={`/customers/${customer.id}`}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 px-4 py-3 text-inherit no-underline transition-colors hover:bg-subtle sm:px-5 md:grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)]">
                    <span className="flex min-w-0 items-center gap-3">
                      <Avatar name={customer.name} />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-ink">{customer.name}</span>
                        <span className="block truncate text-xs text-ink-3 md:hidden">{contact}</span>
                      </span>
                    </span>
                    <span className="hidden min-w-0 md:block">
                      <span className={cn('block truncate text-sm', customer.phone || customer.email ? 'text-ink-2' : 'text-ink-3')}>{contact}</span>
                      {customer.phone && customer.email && <span className="block truncate text-xs text-ink-3">{customer.email}</span>}
                    </span>
                    <span className="hidden text-right text-sm tabular-nums text-ink-2 md:block">
                      {customer.loyaltyPoints > 0 ? `${customer.loyaltyPoints.toLocaleString('en-NG')} pts` : '—'}
                    </span>
                    <span className="flex flex-col items-end gap-0.5 text-right">
                      {owes ? (
                        <span className="inline-flex h-7 items-center rounded-full bg-warn-soft px-2.5 text-[13px] font-semibold tabular-nums text-warn-ink">
                          {formatMoney(customer.balance)}<span className="sr-only"> owed</span>
                        </span>
                      ) : (
                        <span className="text-[13px] tabular-nums text-ink-3">{formatMoney(customer.balance)}<span className="sr-only"> owed</span></span>
                      )}
                      {customer.loyaltyPoints > 0 && <span className="text-xs tabular-nums text-ink-3 md:hidden">{customer.loyaltyPoints.toLocaleString('en-NG')} pts</span>}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      </SectionState>
    </Page>
  );
}
