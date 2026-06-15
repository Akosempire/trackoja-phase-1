import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { usePermissions } from '../../hooks/usePermissions';
import { SaleService } from '../../services/sale.service';
import { StoreService } from '../../services/store.service';
import { CustomerService } from '../../services/customer.service';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { PageLoader } from '../../components/ui/PageLoader';
import type { Customer, PaymentMethod, Sale, Store } from '../../types';

const REFUND_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' },
  { value: 'transfer', label: 'Transfer' },
  { value: 'other', label: 'Other' },
  { value: 'credit', label: 'Credit (customer account)' },
];

const VERIFICATION_BADGE: Record<string, string> = {
  verified: 'badge-success',
  pending: 'badge-warning',
  rejected: 'badge-danger',
};

export default function ReceiptPage() {
  const { saleId } = useParams<{ saleId: string }>();
  const navigate = useNavigate();
  const { hasPermission } = usePermissions();

  const [sale, setSale] = useState<Sale | null>(null);
  const [store, setStore] = useState<Store | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [verifyingId, setVerifyingId] = useState<string | null>(null);

  const [showRefund, setShowRefund] = useState(false);
  const [refundItems, setRefundItems] = useState<Record<string, number>>({});
  const [refundAmount, setRefundAmount] = useState('');
  const [refundMethod, setRefundMethod] = useState<PaymentMethod>('cash');
  const [refundReason, setRefundReason] = useState('');
  const [refunding, setRefunding] = useState(false);

  const canRefund = hasPermission('sales:refund');

  const load = () => {
    if (!saleId) return;
    setLoading(true);
    SaleService.getSale(saleId)
      .then(async (s) => {
        setSale(s);
        const storeData = await StoreService.getStore(s.storeId);
        setStore(storeData);
        if (s.customerId) {
          const customerData = await CustomerService.getCustomer(s.customerId);
          setCustomer(customerData);
        } else {
          setCustomer(null);
        }
      })
      .catch((err) => setError(err.message ?? 'Failed to load receipt'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, [saleId]);

  const handleVerifyPayment = async (paymentId: string, status: 'verified' | 'rejected') => {
    setVerifyingId(paymentId);
    setError(null);
    try {
      await SaleService.verifySalePayment(paymentId, status);
      load();
    } catch (err: any) {
      setError(err.message ?? 'Failed to update payment verification');
    } finally {
      setVerifyingId(null);
    }
  };

  const setRefundItemQuantity = (itemId: string, quantity: number, max: number) => {
    setRefundItems((prev) => {
      const next = { ...prev };
      if (quantity <= 0) {
        delete next[itemId];
      } else {
        next[itemId] = Math.min(quantity, max);
      }
      return next;
    });
  };

  const handleRefund = async () => {
    if (!sale) return;
    const amount = Number(refundAmount);
    if (!amount || amount <= 0) {
      setError('Enter a refund amount greater than zero');
      return;
    }
    if (!refundReason.trim()) {
      setError('A reason is required to process a refund');
      return;
    }

    const items = Object.entries(refundItems)
      .filter(([, qty]) => qty > 0)
      .map(([saleItemId, quantity]) => ({ saleItemId, quantity }));

    setRefunding(true);
    setError(null);
    try {
      await SaleService.processRefund(sale.id, {
        amount,
        reason: refundReason.trim(),
        method: refundMethod,
        items: items.length > 0 ? items : undefined,
      });
      setRefundItems({});
      setRefundAmount('');
      setRefundReason('');
      setShowRefund(false);
      load();
    } catch (err: any) {
      setError(err.message ?? 'Failed to process refund');
    } finally {
      setRefunding(false);
    }
  };

  if (loading) return <PageLoader />;
  if (!sale) return <div className="page">{error && <div className="alert alert-error">{error}</div>}</div>;

  const remainingBalance = Math.max(sale.total - sale.refundedAmount, 0);
  const refundableItems = (sale.items ?? []).filter((item) => item.quantity - item.refundedQuantity > 0);
  const refundMethodOptions = REFUND_METHODS.filter((m) => m.value !== 'credit' || !!sale.customerId);

  return (
    <div className="page">
      <div className="page-header no-print">
        <div>
          <h1 className="page-title">Receipt #{sale.saleNumber}</h1>
          <p className="page-subtitle">{new Date(sale.createdAt).toLocaleString()}</p>
        </div>
        <span className={`badge ${sale.status === 'voided' ? 'badge-danger' : 'badge-success'}`}>{sale.status}</span>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="card receipt">
        <div className="receipt-header">
          <p className="list-item-title">{store?.name ?? 'Store'}</p>
          {store?.address && <p className="page-subtitle">{store.address}</p>}
          {store?.phone && <p className="page-subtitle">{store.phone}</p>}
        </div>

        <hr className="receipt-divider" />

        <p className="page-subtitle">Receipt #{sale.saleNumber}</p>
        <p className="page-subtitle">{new Date(sale.createdAt).toLocaleString()}</p>
        {(customer?.name ?? sale.customerName) && (
          <p className="page-subtitle">Customer: {customer?.name ?? sale.customerName}</p>
        )}

        <hr className="receipt-divider" />

        {(sale.items ?? []).map((item) => (
          <div key={item.id} className="receipt-line">
            <span>
              {item.productName} x {item.quantity}
              {item.refundedQuantity > 0 && ` (${item.refundedQuantity} refunded)`}
            </span>
            <span>₦{item.lineTotal.toLocaleString()}</span>
          </div>
        ))}

        <hr className="receipt-divider" />

        <div className="totals">
          <div className="total-row">
            <span>Subtotal</span>
            <span>₦{sale.subtotal.toLocaleString()}</span>
          </div>
          {sale.discountTotal > 0 && (
            <div className="total-row">
              <span>Discount</span>
              <span>−₦{sale.discountTotal.toLocaleString()}</span>
            </div>
          )}
          <div className="total-row">
            <span>Tax</span>
            <span>₦{sale.taxTotal.toLocaleString()}</span>
          </div>
          <div className="total-row grand">
            <span>Total</span>
            <span>₦{sale.total.toLocaleString()}</span>
          </div>
          {sale.refundedAmount > 0 && (
            <div className="total-row">
              <span>Refunded</span>
              <span>−₦{sale.refundedAmount.toLocaleString()}</span>
            </div>
          )}
        </div>

        <hr className="receipt-divider" />

        {(sale.payments ?? []).map((payment) => (
          <div key={payment.id} className="receipt-line">
            <span style={{ textTransform: 'capitalize' }}>
              {payment.method}{' '}
              <span className={`badge ${VERIFICATION_BADGE[payment.verificationStatus] ?? 'badge-default'}`}>
                {payment.verificationStatus}
              </span>
            </span>
            <span>₦{payment.amount.toLocaleString()}</span>
          </div>
        ))}
        {sale.changeDue > 0 && (
          <div className="receipt-line">
            <span>Change</span>
            <span>₦{sale.changeDue.toLocaleString()}</span>
          </div>
        )}

        {sale.loyaltyPointsEarned > 0 && (
          <div className="receipt-line">
            <span>Loyalty points earned</span>
            <span>{sale.loyaltyPointsEarned}</span>
          </div>
        )}

        {(sale.refunds ?? []).length > 0 && (
          <>
            <hr className="receipt-divider" />
            <p className="list-item-title" style={{ marginTop: 8 }}>
              Refunds
            </p>
            {(sale.refunds ?? []).map((refund) => (
              <div key={refund.id} className="receipt-line">
                <span style={{ textTransform: 'capitalize' }}>
                  {refund.method} · {refund.reason} · {new Date(refund.createdAt).toLocaleDateString()}
                </span>
                <span>₦{refund.amount.toLocaleString()}</span>
              </div>
            ))}
          </>
        )}

        {sale.status === 'voided' && (
          <>
            <hr className="receipt-divider" />
            <p className="page-subtitle">Voided: {sale.voidReason}</p>
          </>
        )}
      </div>

      <div className="btn-row no-print" style={{ marginTop: 12 }}>
        <Button variant="ghost" className="btn-sm btn-outline" onClick={() => window.print()}>
          Print
        </Button>
        {canRefund && sale.status === 'completed' && remainingBalance > 0 && (
          <Button variant="ghost" className="btn-sm btn-outline" onClick={() => setShowRefund((v) => !v)}>
            Refund
          </Button>
        )}
        <Button variant="ghost" className="btn-sm" onClick={() => navigate('/sales')}>
          Back to sales
        </Button>
      </div>

      {canRefund && (sale.payments ?? []).some((p) => p.verificationStatus === 'pending') && (
        <div className="card no-print">
          <p className="list-item-title" style={{ marginBottom: 8 }}>
            Verify payments
          </p>
          {(sale.payments ?? [])
            .filter((p) => p.verificationStatus === 'pending')
            .map((payment) => (
              <div key={payment.id} className="list-item" style={{ padding: '8px 0' }}>
                <div>
                  <p className="list-item-title" style={{ textTransform: 'capitalize' }}>
                    {payment.method} · ₦{payment.amount.toLocaleString()}
                  </p>
                  {payment.reference && <p className="list-item-subtitle">Ref: {payment.reference}</p>}
                </div>
                <div className="btn-row">
                  <Button
                    variant="ghost"
                    className="btn-sm"
                    loading={verifyingId === payment.id}
                    onClick={() => handleVerifyPayment(payment.id, 'verified')}
                  >
                    Verify
                  </Button>
                  <Button
                    variant="ghost"
                    className="btn-sm"
                    loading={verifyingId === payment.id}
                    onClick={() => handleVerifyPayment(payment.id, 'rejected')}
                  >
                    Reject
                  </Button>
                </div>
              </div>
            ))}
        </div>
      )}

      {showRefund && canRefund && sale.status === 'completed' && remainingBalance > 0 && (
        <div className="card no-print">
          <p className="list-item-title" style={{ marginBottom: 8 }}>
            Process refund
          </p>
          <p className="page-subtitle" style={{ marginBottom: 8 }}>
            ₦{remainingBalance.toLocaleString()} available to refund
          </p>

          {refundableItems.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <p className="form-label">Items to return (optional)</p>
              {refundableItems.map((item) => {
                const max = item.quantity - item.refundedQuantity;
                return (
                  <div key={item.id} className="receipt-line">
                    <span>
                      {item.productName} (max {max})
                    </span>
                    <input
                      className="form-input"
                      style={{ width: 80 }}
                      type="number"
                      min={0}
                      max={max}
                      value={refundItems[item.id] ?? ''}
                      onChange={(e) => setRefundItemQuantity(item.id, Number(e.target.value) || 0, max)}
                    />
                  </div>
                );
              })}
            </div>
          )}

          <FormField
            id="refund-amount"
            label="Amount (₦)"
            type="number"
            value={refundAmount}
            onChange={setRefundAmount}
            placeholder={String(remainingBalance)}
          />

          <div className="form-group">
            <label className="form-label" htmlFor="refund-method">
              Method
            </label>
            <select
              id="refund-method"
              className="select-input"
              value={refundMethod}
              onChange={(e) => setRefundMethod(e.target.value as PaymentMethod)}
            >
              {refundMethodOptions.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>

          <FormField
            id="refund-reason"
            label="Reason"
            value={refundReason}
            onChange={setRefundReason}
            placeholder="Why is this refund being issued?"
          />

          <div className="btn-row">
            <Button variant="ghost" className="btn-sm" loading={refunding} onClick={handleRefund}>
              Process refund
            </Button>
            <Button variant="ghost" className="btn-sm" onClick={() => setShowRefund(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
