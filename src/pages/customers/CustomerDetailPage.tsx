import { formatMoney } from '../../utils/format';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { usePermissions } from '../../hooks/usePermissions';
import { CustomerService } from '../../services/customer.service';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { PageLoader } from '../../components/ui/PageLoader';
import { StateBlock } from '../../components/ui/StateBlock';
import { Avatar, Card, CardHead, Page, Stat, btn, cn, inputClass } from '../../components/kit';
import type { Customer, CustomerCreditTransaction, CustomerLoyaltyTransaction } from '../../types';

const CREDIT_LABELS: Record<string, string> = {
  sale_credit: 'Sale on credit',
  payment: 'Payment received',
  adjustment: 'Manual adjustment',
  sale_void: 'Sale voided',
};

const LOYALTY_LABELS: Record<string, string> = {
  earn: 'Points earned',
  redeem: 'Points redeemed',
  adjustment: 'Manual adjustment',
  void: 'Sale voided',
};

export default function CustomerDetailPage() {
  const { customerId } = useParams<{ customerId: string }>();
  const { hasPermission } = usePermissions();

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [creditTxns, setCreditTxns] = useState<CustomerCreditTransaction[]>([]);
  const [loyaltyTxns, setLoyaltyTxns] = useState<CustomerLoyaltyTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentNotes, setPaymentNotes] = useState('');
  const [recordingPayment, setRecordingPayment] = useState(false);

  const [loyaltyPoints, setLoyaltyPoints] = useState('');
  const [loyaltyType, setLoyaltyType] = useState<'redeem' | 'adjustment'>('redeem');
  const [loyaltyNotes, setLoyaltyNotes] = useState('');
  const [adjustingLoyalty, setAdjustingLoyalty] = useState(false);

  const canUpdate = hasPermission('customer:update');
  const canManageCredit = hasPermission('customer:manage_credit');

  const load = () => {
    if (!customerId) return;
    setLoading(true);
    Promise.all([
      CustomerService.getCustomer(customerId),
      CustomerService.getCreditTransactions(customerId),
      CustomerService.getLoyaltyTransactions(customerId),
    ])
      .then(([c, credit, loyalty]) => {
        setCustomer(c);
        setCreditTxns(credit);
        setLoyaltyTxns(loyalty);
      })
      .catch((err) => setError(err.message ?? 'Failed to load customer'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, [customerId]);

  const handleRecordPayment = async () => {
    if (!customerId) return;
    const amount = Number(paymentAmount);
    if (!amount || amount <= 0) {
      setError('Enter a payment amount greater than zero');
      return;
    }

    setRecordingPayment(true);
    setError(null);
    try {
      await CustomerService.recordCreditPayment(customerId, amount, paymentNotes || undefined);
      setPaymentAmount('');
      setPaymentNotes('');
      load();
    } catch (err: any) {
      setError(err.message ?? 'Failed to record payment');
    } finally {
      setRecordingPayment(false);
    }
  };

  const handleAdjustLoyalty = async () => {
    if (!customerId) return;
    const points = Number(loyaltyPoints);
    if (!points) {
      setError('Enter a non-zero points value');
      return;
    }
    const signedPoints = loyaltyType === 'redeem' ? -Math.abs(points) : points;

    setAdjustingLoyalty(true);
    setError(null);
    try {
      await CustomerService.adjustCustomerLoyalty(customerId, signedPoints, loyaltyType, loyaltyNotes || undefined);
      setLoyaltyPoints('');
      setLoyaltyNotes('');
      load();
    } catch (err: any) {
      setError(err.message ?? 'Failed to adjust loyalty points');
    } finally {
      setAdjustingLoyalty(false);
    }
  };

  if (loading) return <PageLoader />;
  if (!customer) {
    return (
      <Page>
        <Card>
          <StateBlock variant="error" title="Could not load this customer" body={error ?? 'This customer could not be found.'}
            actions={<Link className={btn('outline', 'sm')} to="/customers">Back to customers</Link>} />
        </Card>
      </Page>
    );
  }

  const remainingCredit = Math.max(customer.creditLimit - customer.balance, 0);
  const label = 'mb-1.5 block text-[13px] font-medium text-ink-2';
  const when = (value: string) => new Date(value).toLocaleString('en-NG', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const contact = [customer.phone, customer.email].filter(Boolean).join(' · ');

  return (
    <Page>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between lg:mb-8">
        <div className="flex min-w-0 items-center gap-4">
          <Avatar name={customer.name} className="size-14 rounded-full text-lg" />
          <div className="min-w-0">
            <h1 className="m-0 truncate text-2xl font-semibold leading-8 tracking-tight text-ink lg:text-[28px] lg:leading-9">{customer.name}</h1>
            <p className="m-0 mt-0.5 truncate text-sm text-ink-2">{contact || 'No contact info'}</p>
            {customer.address && <p className="m-0 mt-0.5 truncate text-[13px] text-ink-3">{customer.address}</p>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {customer.phone && <a className={btn('outline')} href={`tel:${customer.phone.replace(/\s+/g, '')}`}>Call</a>}
          {canUpdate && <Link className={btn('outline')} to={`/customers/${customer.id}/edit`}>Edit</Link>}
        </div>
      </div>

      {error && <div className="mb-4 rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger" role="alert">{error}</div>}

      <section className="mb-4 grid grid-cols-2 gap-3 lg:mb-6 lg:grid-cols-4 lg:gap-4" aria-label="Account summary">
        <Stat label="Balance owed" value={formatMoney(customer.balance)} tone={customer.balance > 0 ? 'warn' : undefined}
          hint={customer.balance > 0 ? 'Unpaid credit sales' : 'All settled'} />
        <Stat label="Credit limit" value={formatMoney(customer.creditLimit)} hint={customer.creditLimit > 0 ? undefined : 'Credit is off'} />
        <Stat label="Remaining credit" value={formatMoney(remainingCredit)} tone={customer.creditLimit > 0 && remainingCredit === 0 ? 'danger' : undefined} />
        <Stat label="Loyalty points" value={customer.loyaltyPoints.toLocaleString()} />
      </section>

      {customer.notes && (
        <p className="m-0 mb-4 rounded-lg bg-tray px-4 py-3 text-[13px] text-ink-2 lg:mb-6"><span className="font-semibold text-ink">Note: </span>{customer.notes}</p>
      )}

      <div className="grid gap-4 lg:grid-cols-3 lg:gap-6">
        {canManageCredit && (
          <div className="contents min-w-0 lg:col-start-3 lg:row-start-1 lg:flex lg:flex-col lg:gap-6">
            <Card className="order-1 lg:order-none" aria-labelledby="record-payment-title">
              <CardHead title={<span id="record-payment-title">Record payment</span>} hint="Money received towards their balance" />
              <div className="mb-4">
                <label className={label} htmlFor="payment-amount">Amount (₦)</label>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink-3" aria-hidden="true">₦</span>
                  <input id="payment-amount" name="payment-amount" className={cn(inputClass, 'pl-7 tabular-nums')} type="number" inputMode="decimal" min={0} step="any"
                    value={paymentAmount} onChange={(e) => setPaymentAmount(e.target.value)} placeholder="0" />
                </div>
              </div>
              <FormField id="payment-notes" label="Notes" value={paymentNotes} onChange={setPaymentNotes} placeholder="Optional" />
              <Button className="w-full" loading={recordingPayment} onClick={handleRecordPayment}>
                Record payment
              </Button>
            </Card>

            <Card className="order-3 lg:order-none" aria-labelledby="adjust-loyalty-title">
              <CardHead title={<span id="adjust-loyalty-title">Adjust loyalty points</span>} />
              <div className="mb-4">
                <label className={label} htmlFor="loyalty-type">
                  Type
                </label>
                <select
                  id="loyalty-type"
                  className={inputClass}
                  value={loyaltyType}
                  onChange={(e) => setLoyaltyType(e.target.value as 'redeem' | 'adjustment')}
                >
                  <option value="redeem">Redeem points</option>
                  <option value="adjustment">Manual adjustment</option>
                </select>
              </div>
              <FormField
                id="loyalty-points"
                label="Points"
                type="number"
                value={loyaltyPoints}
                onChange={setLoyaltyPoints}
                placeholder={loyaltyType === 'redeem' ? 'Points to redeem' : 'Use a negative value to deduct'}
              />
              <FormField id="loyalty-notes" label="Notes" value={loyaltyNotes} onChange={setLoyaltyNotes} placeholder="Optional" />
              <Button variant="outline" className="w-full" loading={adjustingLoyalty} onClick={handleAdjustLoyalty}>
                Apply
              </Button>
            </Card>
          </div>
        )}

        <div className={cn('order-2 flex min-w-0 flex-col gap-4 lg:order-none lg:row-start-1 lg:gap-6', canManageCredit ? 'lg:col-span-2' : 'lg:col-span-3')}>
          <Card padded={false} className="overflow-hidden" aria-labelledby="credit-history-title">
            <div className="px-4 pb-3 pt-4 sm:px-5">
              <h2 id="credit-history-title" className="m-0 text-[15px] font-semibold text-ink">Credit history</h2>
            </div>
            {creditTxns.length === 0 ? (
              <p className="m-0 px-4 pb-5 text-sm text-ink-3 sm:px-5">No credit transactions yet.</p>
            ) : (
              <ul className="m-0 list-none divide-y divide-line border-t border-line p-0">
                {creditTxns.map((t) => (
                  <li key={t.id} className="flex items-start justify-between gap-3 px-4 py-3 sm:px-5">
                    <div className="min-w-0">
                      <p className="m-0 text-sm font-medium text-ink">{CREDIT_LABELS[t.type] ?? t.type}</p>
                      <p className="m-0 mt-0.5 truncate text-xs text-ink-3">{when(t.createdAt)}{t.notes ? ` · ${t.notes}` : ''}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className={cn('m-0 text-sm font-semibold tabular-nums', t.amount >= 0 ? 'text-warn-ink' : 'text-success-ink')}>
                        {t.amount >= 0 ? '+' : '−'}{formatMoney(Math.abs(t.amount))}
                      </p>
                      <p className="m-0 mt-0.5 text-xs tabular-nums text-ink-3">Balance {formatMoney(t.balanceAfter)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card padded={false} className="overflow-hidden" aria-labelledby="loyalty-history-title">
            <div className="px-4 pb-3 pt-4 sm:px-5">
              <h2 id="loyalty-history-title" className="m-0 text-[15px] font-semibold text-ink">Loyalty history</h2>
            </div>
            {loyaltyTxns.length === 0 ? (
              <p className="m-0 px-4 pb-5 text-sm text-ink-3 sm:px-5">No loyalty transactions yet.</p>
            ) : (
              <ul className="m-0 list-none divide-y divide-line border-t border-line p-0">
                {loyaltyTxns.map((t) => (
                  <li key={t.id} className="flex items-start justify-between gap-3 px-4 py-3 sm:px-5">
                    <div className="min-w-0">
                      <p className="m-0 text-sm font-medium text-ink">{LOYALTY_LABELS[t.type] ?? t.type}</p>
                      <p className="m-0 mt-0.5 truncate text-xs text-ink-3">{when(t.createdAt)}{t.notes ? ` · ${t.notes}` : ''}</p>
                    </div>
                    <p className={cn('m-0 shrink-0 text-sm font-semibold tabular-nums', t.points >= 0 ? 'text-success-ink' : 'text-ink-2')}>
                      {t.points >= 0 ? '+' : ''}
                      {t.points} pts
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </Page>
  );
}
