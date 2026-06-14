import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { usePermissions } from '../../hooks/usePermissions';
import { CustomerService } from '../../services/customer.service';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { PageLoader } from '../../components/ui/PageLoader';
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
  if (!customer) return <div className="page">{error && <div className="alert alert-error">{error}</div>}</div>;

  const remainingCredit = Math.max(customer.creditLimit - customer.balance, 0);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">{customer.name}</h1>
          <p className="page-subtitle">{customer.phone || customer.email || 'No contact info'}</p>
        </div>
        {canUpdate && (
          <Link to={`/customers/${customer.id}/edit`}>
            <Button variant="ghost" className="btn-sm">
              Edit
            </Button>
          </Link>
        )}
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="card">
        <div className="total-row">
          <span>Balance owed</span>
          <span>₦{customer.balance.toLocaleString()}</span>
        </div>
        <div className="total-row">
          <span>Credit limit</span>
          <span>₦{customer.creditLimit.toLocaleString()}</span>
        </div>
        <div className="total-row grand">
          <span>Remaining credit</span>
          <span>₦{remainingCredit.toLocaleString()}</span>
        </div>
        <div className="total-row">
          <span>Loyalty points</span>
          <span>{customer.loyaltyPoints.toLocaleString()}</span>
        </div>
      </div>

      {canManageCredit && (
        <div className="card">
          <p className="list-item-title" style={{ marginBottom: 8 }}>
            Record payment
          </p>
          <FormField id="payment-amount" label="Amount (₦)" type="number" value={paymentAmount} onChange={setPaymentAmount} />
          <FormField id="payment-notes" label="Notes" value={paymentNotes} onChange={setPaymentNotes} placeholder="Optional" />
          <Button className="btn-sm" loading={recordingPayment} onClick={handleRecordPayment}>
            Record payment
          </Button>
        </div>
      )}

      {canManageCredit && (
        <div className="card">
          <p className="list-item-title" style={{ marginBottom: 8 }}>
            Adjust loyalty points
          </p>
          <div className="form-group">
            <label className="form-label" htmlFor="loyalty-type">
              Type
            </label>
            <select
              id="loyalty-type"
              className="select-input"
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
          <Button className="btn-sm" loading={adjustingLoyalty} onClick={handleAdjustLoyalty}>
            Apply
          </Button>
        </div>
      )}

      <div className="card">
        <p className="list-item-title" style={{ marginBottom: 8 }}>
          Credit history
        </p>
        {creditTxns.length === 0 ? (
          <p className="page-subtitle">No credit transactions yet.</p>
        ) : (
          creditTxns.map((t) => (
            <div key={t.id} className="movement-row">
              <div>
                <div>{CREDIT_LABELS[t.type] ?? t.type}</div>
                {t.notes && <div className="page-subtitle">{t.notes}</div>}
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ color: t.amount >= 0 ? 'var(--red)' : 'var(--green)' }}>
                  {t.amount >= 0 ? '+' : ''}₦{t.amount.toLocaleString()}
                </div>
                <div className="page-subtitle">{new Date(t.createdAt).toLocaleString()}</div>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="card">
        <p className="list-item-title" style={{ marginBottom: 8 }}>
          Loyalty history
        </p>
        {loyaltyTxns.length === 0 ? (
          <p className="page-subtitle">No loyalty transactions yet.</p>
        ) : (
          loyaltyTxns.map((t) => (
            <div key={t.id} className="movement-row">
              <div>
                <div>{LOYALTY_LABELS[t.type] ?? t.type}</div>
                {t.notes && <div className="page-subtitle">{t.notes}</div>}
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ color: t.points >= 0 ? 'var(--green)' : 'var(--red)' }}>
                  {t.points >= 0 ? '+' : ''}
                  {t.points} pts
                </div>
                <div className="page-subtitle">{new Date(t.createdAt).toLocaleString()}</div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
