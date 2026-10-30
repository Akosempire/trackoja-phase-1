import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { CustomerService } from '../../services/customer.service';
import { PageLoader } from '../../components/ui/PageLoader';
import { RemindButton, useStoreName } from '../../components/RemindButton';
import { Avatar, Card, Empty, Page, PageHeader, Stat, btn } from '../../components/kit';
import { formatMoney } from '../../utils/format';
import type { Customer } from '../../types';

/** /customers/owing: everyone with an unpaid credit balance, biggest first. */
export default function WhoOwesPage() {
  const { profile } = useAuth();
  const storeId = profile?.currentStoreId;
  const storeName = useStoreName();
  const [list, setList] = useState<Customer[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!storeId) return;
    CustomerService.getCustomers(storeId)
      .then((all) => setList(all.filter((c) => c.balance > 0).sort((a, b) => b.balance - a.balance)))
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load customers'));
  }, [storeId]);

  if (error) return <Page><Card><p className="m-0 text-sm text-danger" role="alert">{error}</p></Card></Page>;
  if (!list) return <PageLoader />;
  const total = list.reduce((s, c) => s + c.balance, 0);

  return (
    <Page>
      <PageHeader title="Who owes you" subtitle="Customers with unpaid credit sales" actions={<Link className={btn('outline')} to="/customers">All customers</Link>} />
      <section className="mb-6 grid grid-cols-2 gap-3 lg:max-w-xl" aria-label="Summary">
        <Stat label="Total owed" value={formatMoney(total)} tone={total > 0 ? 'warn' : undefined} />
        <Stat label="Customers" value={list.length} />
      </section>
      {list.length === 0 ? (
        <Empty title="Nobody owes you" body="Credit sales that aren't paid yet will show here." />
      ) : (
        <Card padded={false} className="overflow-hidden">
          <ul className="m-0 list-none divide-y divide-line p-0">
            {list.map((c) => (
              <li key={c.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4 sm:px-5">
                <Link to={`/customers/${c.id}`} className="flex min-w-0 flex-1 items-center gap-3 text-inherit no-underline">
                  <Avatar name={c.name} className="rounded-full" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-ink">{c.name}</span>
                    <span className="block truncate text-xs text-ink-3">{c.phone || 'No phone number'}</span>
                  </span>
                  <span className="ml-auto text-right text-sm font-semibold tabular-nums text-warn-ink">{formatMoney(c.balance)}</span>
                </Link>
                {c.phone ? <RemindButton customer={c} storeName={storeName} size="sm" className="self-end sm:self-auto" /> : <span className="self-end text-xs text-ink-3 sm:self-auto">Add a phone number to remind</span>}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </Page>
  );
}
