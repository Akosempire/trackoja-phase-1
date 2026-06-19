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

const VERIFY_CLASS: Record<string, string> = {
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

  useEffect(() => { load(); }, [saleId]);

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

  const setRefundItemQty = (itemId: string, quantity: number, max: number) => {
    setRefundItems((prev) => {
      const next = { ...prev };
      if (quantity <= 0) delete next[itemId];
      else next[itemId] = Math.min(quantity, max);
      return next;
    });
  };

  const handleRefund = async () => {
    if (!sale) return;
    const amount = Number(refundAmount);
    if (!amount || amount <= 0) { setError('Enter a refund amount greater than zero'); return; }
    if (!refundReason.trim()) { setError('A reason is required to process a refund'); return; }
    const items = Object.entries(refundItems).filter(([, qty]) => qty > 0).map(([saleItemId, quantity]) => ({ saleItemId, quantity }));
    setRefunding(true);
    setError(null);
    try {
      await SaleService.processRefund(sale.id, { amount, reason: refundReason.trim(), method: refundMethod, items: items.length > 0 ? items : undefined });
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

  const isVoided = sale.status === 'voided';
  const remainingBalance = Math.max(sale.total - sale.refundedAmount, 0);
  const refundableItems = (sale.items ?? []).filter((item) => item.quantity - item.refundedQuantity > 0);
  const refundMethodOptions = REFUND_METHODS.filter((m) => m.value !== 'credit' || !!sale.customerId);
  const pendingPayments = (sale.payments ?? []).filter((p) => p.verificationStatus === 'pending');

  return (
    <div className="page rp-page">
      {error && <div className="alert alert-error no-print">{error}</div>}

      {/* Status banner */}
      <div className={`rp-status-bar no-print ${isVoided ? 'rp-status-voided' : 'rp-status-done'}`}>
        <div className={`rp-status-icon ${isVoided ? 'rp-icon-voided' : 'rp-icon-done'}`}>
          {isVoided ? '✕' : '✓'}
        </div>
        <div className="rp-status-text">
          <p className="rp-status-title">
            {isVoided ? 'Sale Voided' : 'Sale Complete'}
          </p>
          <p className="rp-status-sub">Receipt #{sale.saleNumber} · {new Date(sale.createdAt).toLocaleString()}</p>
        </div>
        <div className="rp-status-amount">
          ₦{sale.total.toLocaleString()}
        </div>
      </div>

      {/* Action bar */}
      <div className="rp-actions no-print">
        <Button variant="primary" style={{ flex: 1 }} onClick={() => navigate('/sales/checkout')}>
          + New sale
        </Button>
        <Button variant="ghost" className="btn-outline" onClick={() => window.print()}>
          Print
        </Button>
        {canRefund && !isVoided && remainingBalance > 0 && (
          <Button variant="ghost" className="btn-outline" onClick={() => setShowRefund((v) => !v)}>
            {showRefund ? 'Cancel' : 'Refund'}
          </Button>
        )}
        <Button variant="ghost" onClick={() => navigate('/sales')}>
          Sales
        </Button>
      </div>

      {/* ── Receipt card ── */}
      <div className="rp-card">
        {/* Store header */}
        <div className="rp-store-header">
          <div className="rp-store-avatar">
            {(store?.name ?? 'S')[0].toUpperCase()}
          </div>
          <h2 className="rp-store-name">{store?.name ?? 'Store'}</h2>
          {store?.address && <p className="rp-store-meta">{store.address}</p>}
          {store?.phone && <p className="rp-store-meta">{store.phone}</p>}
        </div>

        <hr className="receipt-divider" />

        {/* Meta row */}
        <div className="rp-meta">
          <div className="rp-meta-row">
            <span>Receipt</span>
            <span>#{sale.saleNumber}</span>
          </div>
          <div className="rp-meta-row">
            <span>Date</span>
            <span>{new Date(sale.createdAt).toLocaleString()}</span>
          </div>
          {(customer?.name ?? sale.customerName) && (
            <div className="rp-meta-row">
              <span>Customer</span>
              <span>{customer?.name ?? sale.customerName}</span>
            </div>
          )}
        </div>

        <hr className="receipt-divider" />

        {/* Line items */}
        <div className="rp-items">
          {(sale.items ?? []).map((item) => (
            <div key={item.id} className="rp-item">
              <div className="rp-item-info">
                <span className="rp-item-name">{item.productName}</span>
                {item.refundedQuantity > 0 && (
                  <span className="rp-item-refunded">{item.refundedQuantity} refunded</span>
                )}
              </div>
              <div className="rp-item-right">
                <span className="rp-item-qty">×{item.quantity}</span>
                <span className="rp-item-total">₦{item.lineTotal.toLocaleString()}</span>
              </div>
            </div>
          ))}
        </div>

        <hr className="receipt-divider" />

        {/* Totals */}
        <div className="rp-totals">
          <div className="rp-total-row">
            <span>Subtotal</span>
            <span>₦{sale.subtotal.toLocaleString()}</span>
          </div>
          {sale.discountTotal > 0 && (
            <div className="rp-total-row">
              <span>Discount</span>
              <span>−₦{sale.discountTotal.toLocaleString()}</span>
            </div>
          )}
          {sale.taxTotal > 0 && (
            <div className="rp-total-row">
              <span>Tax</span>
              <span>₦{sale.taxTotal.toLocaleString()}</span>
            </div>
          )}
          {sale.refundedAmount > 0 && (
            <div className="rp-total-row rp-row-refunded">
              <span>Refunded</span>
              <span>−₦{sale.refundedAmount.toLocaleString()}</span>
            </div>
          )}
          <div className="rp-grand-total">
            <span>Total</span>
            <span>₦{sale.total.toLocaleString()}</span>
          </div>
        </div>

        <hr className="receipt-divider" />

        {/* Payments */}
        <div className="rp-payments">
          {(sale.payments ?? []).map((payment) => (
            <div key={payment.id} className="rp-payment-row">
              <div className="rp-payment-left">
                <span className="rp-payment-method">{payment.method}</span>
                <span className={`badge ${VERIFY_CLASS[payment.verificationStatus] ?? 'badge-default'}`}>
                  {payment.verificationStatus}
                </span>
              </div>
              <span className="rp-payment-amount">₦{payment.amount.toLocaleString()}</span>
            </div>
          ))}
          {sale.changeDue > 0 && (
            <div className="rp-payment-row">
              <span className="rp-payment-method rp-change">Change given</span>
              <span className="rp-payment-amount">₦{sale.changeDue.toLocaleString()}</span>
            </div>
          )}
          {sale.loyaltyPointsEarned > 0 && (
            <div className="rp-payment-row">
              <span className="rp-payment-method">Loyalty pts earned</span>
              <span className="rp-payment-amount" style={{ color: 'var(--brand-l)' }}>
                +{sale.loyaltyPointsEarned}
              </span>
            </div>
          )}
        </div>

        {/* Refunds history */}
        {(sale.refunds ?? []).length > 0 && (
          <>
            <hr className="receipt-divider" />
            <div className="rp-payments">
              <p className="rp-section-label">Refund history</p>
              {(sale.refunds ?? []).map((refund) => (
                <div key={refund.id} className="rp-payment-row">
                  <div>
                    <span className="rp-payment-method" style={{ textTransform: 'capitalize' }}>{refund.method}</span>
                    <span className="rp-payment-note"> · {refund.reason} · {new Date(refund.createdAt).toLocaleDateString()}</span>
                  </div>
                  <span className="rp-payment-amount" style={{ color: 'var(--danger)' }}>−₦{refund.amount.toLocaleString()}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Void reason */}
        {isVoided && (
          <>
            <hr className="receipt-divider" />
            <p className="rp-void-note">Voided: {sale.voidReason}</p>
          </>
        )}

        {/* Footer */}
        <div className="rp-footer">
          <p>Thank you for your business</p>
          <p className="rp-footer-brand">Powered by TrackOja</p>
        </div>
      </div>

      {/* Verify pending payments */}
      {canRefund && pendingPayments.length > 0 && (
        <div className="card no-print" style={{ marginTop: 16 }}>
          <p className="list-item-title" style={{ marginBottom: 8 }}>Verify payments</p>
          {pendingPayments.map((payment) => (
            <div key={payment.id} className="list-item" style={{ padding: '8px 0' }}>
              <div>
                <p className="list-item-title" style={{ textTransform: 'capitalize' }}>
                  {payment.method} · ₦{payment.amount.toLocaleString()}
                </p>
                {payment.reference && <p className="list-item-subtitle">Ref: {payment.reference}</p>}
              </div>
              <div className="btn-row">
                <Button variant="ghost" className="btn-sm" loading={verifyingId === payment.id} onClick={() => handleVerifyPayment(payment.id, 'verified')}>Verify</Button>
                <Button variant="ghost" className="btn-sm" loading={verifyingId === payment.id} onClick={() => handleVerifyPayment(payment.id, 'rejected')}>Reject</Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Refund form */}
      {showRefund && canRefund && !isVoided && remainingBalance > 0 && (
        <div className="card no-print" style={{ marginTop: 16 }}>
          <p className="list-item-title" style={{ marginBottom: 4 }}>Process refund</p>
          <p className="page-subtitle" style={{ marginBottom: 12 }}>₦{remainingBalance.toLocaleString()} available</p>

          {refundableItems.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <p className="form-label">Items to return (optional)</p>
              {refundableItems.map((item) => {
                const max = item.quantity - item.refundedQuantity;
                return (
                  <div key={item.id} className="rp-payment-row" style={{ padding: '6px 0' }}>
                    <span>{item.productName} (max {max})</span>
                    <input className="form-input" style={{ width: 80 }} type="number" min={0} max={max}
                      value={refundItems[item.id] ?? ''} onChange={(e) => setRefundItemQty(item.id, Number(e.target.value) || 0, max)} />
                  </div>
                );
              })}
            </div>
          )}

          <FormField id="refund-amount" label="Amount (₦)" type="number" value={refundAmount} onChange={setRefundAmount} placeholder={String(remainingBalance)} />

          <div className="form-group">
            <label className="form-label" htmlFor="refund-method">Method</label>
            <select id="refund-method" className="select-input" value={refundMethod} onChange={(e) => setRefundMethod(e.target.value as PaymentMethod)}>
              {refundMethodOptions.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>

          <FormField id="refund-reason" label="Reason" value={refundReason} onChange={setRefundReason} placeholder="Why is this refund being issued?" />

          <div className="btn-row">
            <Button variant="ghost" className="btn-sm" loading={refunding} onClick={handleRefund}>Process refund</Button>
            <Button variant="ghost" className="btn-sm" onClick={() => setShowRefund(false)}>Cancel</Button>
          </div>
        </div>
      )}
    </div>
  );
}
