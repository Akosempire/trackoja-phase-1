import { formatMoney } from '../../utils/format';
import { useBusinessContext } from '../../contexts/BusinessContext';
import { recordSaleAction } from '../../utils/business-language';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { usePermissions } from '../../hooks/usePermissions';
import { SaleService } from '../../services/sale.service';
import { StoreService } from '../../services/store.service';
import { receiptMessage, whatsappLink } from '../../utils/whatsapp';
import { CustomerService } from '../../services/customer.service';
import { MerchantPaymentService } from '../../services/merchantPayment.service';
import { Button } from '../../components/ui/Button';
import { Card, CardHead, Page, btn, cn, inputClass } from '../../components/kit';
import { APP_NAME } from '../../config/brand';
import { PageLoader } from '../../components/ui/PageLoader';
import type { Customer, PaymentMethod, Sale, Store } from '../../types';
import { CashierService } from '../../services/cashier.service';
import { VoidSaleAction } from '../../components/till/VoidSaleAction';

type Paper = '80mm' | '58mm' | 'a4';

const PAYMENT_LABEL: Record<string, string> = { cash: 'cash', card: 'POS / card', transfer: 'transfer', credit: 'credit', other: 'other' };

const REFUND_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'POS / card' },
  { value: 'transfer', label: 'Transfer' },
  { value: 'other', label: 'Other' },
  { value: 'credit', label: 'Credit (customer account)' },
];


export default function ReceiptPage() {
  const { saleId } = useParams<{ saleId: string }>();
  const navigate = useNavigate();
  const { category } = useBusinessContext();
  const { hasPermission } = usePermissions();

  const [sale, setSale] = useState<Sale | null>(null);
  const [store, setStore] = useState<Store | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [cashierName, setCashierName] = useState<string | null>(null);
  const [posTerminalLastFour, setPosTerminalLastFour] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [verifyingId, setVerifyingId] = useState<string | null>(null);

  const [showRefund, setShowRefund] = useState(false);
  const [refundItems, setRefundItems] = useState<Record<string, number>>({});
  const [refundAmount, setRefundAmount] = useState('');
  const [refundMethod, setRefundMethod] = useState<PaymentMethod>('cash');
  const [refundReason, setRefundReason] = useState('');
  const [refunding, setRefunding] = useState(false);
  const [copied, setCopied] = useState(false);
  const [paper, setPaper] = useState<Paper>(() => {
    try { const saved = localStorage.getItem('trackoja-paper'); if (saved === '58mm' || saved === 'a4') return saved; } catch { /* default */ }
    return '80mm';
  });
  useEffect(() => { try { localStorage.setItem('trackoja-paper', paper); } catch { /* session only */ } }, [paper]);

  const isMoniepointSale = sale?.payments?.some((payment) => payment.provider === 'moniepoint') ?? false;
  const canRefund = hasPermission('sales:refund') && !isMoniepointSale;
  // Someone who sells but can't refund can still refund with a manager's PIN
  const refundWithPin = !canRefund && !isMoniepointSale && hasPermission('sales:create');
  const [managerPin, setManagerPin] = useState('');

  const load = () => {
    if (!saleId) return;
    setLoading(true);
    setCashierName(null);
    setPosTerminalLastFour(null);
    SaleService.getSale(saleId)
      .then(async (s) => {
        setSale(s);
        const storeData = await StoreService.getStore(s.storeId);
        setStore(storeData);
        SaleService.getCashierName(s.id).then(setCashierName).catch(() => setCashierName(null));
        const posPayment = s.payments?.find((payment) => payment.provider === 'moniepoint' && payment.merchantAttemptId);
        if (posPayment?.merchantAttemptId) {
          MerchantPaymentService.getAttempt(posPayment.merchantAttemptId)
            .then((attempt) => setPosTerminalLastFour(attempt.terminalLastFour))
            .catch(() => setPosTerminalLastFour(null));
        }
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
      if (refundWithPin) {
        const r = await CashierService.refundWithPin(sale.id, { amount, reason: refundReason.trim(), method: refundMethod, items }, managerPin);
        setManagerPin('');
        if (!r.ok) throw new Error(r.error);
      } else {
        await SaleService.processRefund(sale.id, { amount, reason: refundReason.trim(), method: refundMethod, items: items.length > 0 ? items : undefined });
      }
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
  if (!sale) return <Page width="form">{error && <div className="rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger" role="alert">{error}</div>}</Page>;

  const isVoided = sale.status === 'voided';
  const isPending = sale.status === 'pending_payment';
  const remainingBalance = Math.max(sale.total - sale.refundedAmount, 0);
  const refundableItems = (sale.items ?? []).filter((item) => item.quantity - item.refundedQuantity > 0);
  const refundMethodOptions = REFUND_METHODS.filter((m) => m.value !== 'credit' || !!sale.customerId);
  const pendingPayments = (sale.payments ?? []).filter((p) => p.verificationStatus === 'pending');
  const when = new Date(sale.createdAt).toLocaleString('en-NG', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const row = 'flex justify-between gap-3';

  const print = () => {
    document.documentElement.dataset.paper = paper;
    window.print();
  };
  const share = async () => {
    const lines = [
      `${store?.name ?? 'Receipt'} · #${sale.saleNumber}`,
      when,
      ...(sale.items ?? []).map((item) => `${item.quantity} × ${item.productName}  ${formatMoney(item.lineTotal)}`),
      `Total: ${formatMoney(sale.total)}`,
      'Thank you for your business',
    ].join('\n');
    try {
      if (navigator.share) await navigator.share({ title: `Receipt #${sale.saleNumber}`, text: lines });
      else { await navigator.clipboard.writeText(lines); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    } catch { /* The person closed the share sheet. */ }
  };

  // Send on WhatsApp: to the customer's number when there is one; credit stays as balance to pay
  const onCredit = (sale.payments ?? []).filter((p) => p.method === 'credit').reduce((t, p) => t + p.amount, 0);
  const paidNow = Math.min(sale.total, Math.max(0, sale.amountPaid - onCredit));
  const whatsappHref = whatsappLink(customer?.phone ?? sale.customerPhone ?? null, receiptMessage({
    storeName: store?.name ?? 'Receipt', receiptNumber: `#${sale.saleNumber}`, date: when,
    items: (sale.items ?? []).map((i) => ({ name: i.productName, quantity: i.quantity, lineTotal: i.lineTotal })),
    total: sale.total, paid: paidNow, balance: Math.max(0, sale.total - paidNow),
  }));

  return (
    <Page width="form" className="rp-page">
      {error && <div className="no-print mb-4 rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger" role="alert">{error}</div>}

      {/* Status */}
      <div className={cn('no-print mb-4 flex items-center gap-3 rounded-xl p-4', isVoided || isPending ? 'bg-warn-soft' : 'bg-success-soft')}>
        <span className={cn('inline-flex size-10 shrink-0 items-center justify-center rounded-full text-lg font-bold text-white', isVoided ? 'bg-danger' : isPending ? 'bg-warn' : 'bg-success')} aria-hidden="true">
          {isPending ? '…' : isVoided ? '✕' : '✓'}
        </span>
        <div className="min-w-0 flex-1">
          <p className="m-0 text-[15px] font-semibold text-ink">{isPending ? 'Awaiting verified payment' : isVoided ? 'Sale voided' : 'Sale complete'}</p>
          <p className="m-0 text-[13px] text-ink-2">Receipt #{sale.saleNumber} · {when}</p>
        </div>
        <p className="m-0 text-xl font-semibold tabular-nums text-ink">{formatMoney(sale.total)}</p>
      </div>

      {/* Actions */}
      <div className="no-print mb-6 flex flex-wrap items-center gap-2">
        {hasPermission('sales:create') && <Button onClick={() => navigate('/sales/checkout')}>{recordSaleAction(category)}</Button>}
        <Button variant="outline" disabled={isPending} onClick={print}>Print</Button>
        <select aria-label="Paper size" className="h-10 rounded-md border border-line-strong bg-surface px-2 text-sm text-ink" value={paper} onChange={(e) => setPaper(e.target.value as Paper)} disabled={isPending}>
          <option value="80mm">80 mm roll</option>
          <option value="58mm">58 mm roll</option>
          <option value="a4">A4</option>
        </select>
        {!isPending && !isVoided && <a className={btn('outline')} href={whatsappHref} target="_blank" rel="noopener noreferrer">Send on WhatsApp</a>}
        <Button variant="outline" disabled={isPending} onClick={share}>{copied ? 'Copied' : 'Share'}</Button>
        {(canRefund || refundWithPin) && !isVoided && !isPending && remainingBalance > 0 && (
          <Button variant="outline" onClick={() => setShowRefund((v) => !v)}>{showRefund ? 'Cancel refund' : 'Refund'}</Button>
        )}
        {!isVoided && !isPending && !isMoniepointSale && sale.refundedAmount === 0 && hasPermission('sales:create') && (
          <VoidSaleAction saleId={sale.id} saleNumber={sale.saleNumber} canVoid={hasPermission('sales:void')} onVoided={load} />
        )}
      </div>
      {isPending && <div className="no-print mb-4 rounded-lg bg-warn-soft px-4 py-3 text-[13px] text-warn-ink" role="status">
        This sale has no verified payment. Do not issue a receipt or collect another payment until its POS status is checked.
      </div>}
      {isMoniepointSale && <div className="no-print mb-4 rounded-lg bg-warn-soft px-4 py-3 text-[13px] text-warn-ink" role="status">
        Moniepoint refunds are not available here. Confirm any return with Moniepoint and contact support for reconciliation.
      </div>}

      {/* Receipt */}
      {!isPending && <article className="print-sheet mx-auto w-full max-w-[400px] rounded-xl border border-line bg-surface px-6 py-7 font-mono text-[13px] leading-5 text-ink shadow-card" aria-label={`Receipt ${sale.saleNumber}`}>
        <header className="text-center font-sans">
          <h2 className="m-0 text-lg font-semibold">{store?.name ?? 'Store'}</h2>
          {store?.address && <p className="m-0 text-xs text-ink-2">{store.address}</p>}
          {store?.phone && <p className="m-0 text-xs text-ink-2">{store.phone}</p>}
        </header>

        <div className="my-4 border-t border-dashed border-line-strong" />
        <dl className="m-0 space-y-0.5 text-xs">
          <div className={row}><dt>Receipt</dt><dd className="m-0">#{sale.saleNumber}</dd></div>
          <div className={row}><dt>Date</dt><dd className="m-0">{when}</dd></div>
          {cashierName && <div className={row}><dt>Cashier</dt><dd className="m-0">{cashierName}</dd></div>}
          {posTerminalLastFour && <div className={row}><dt>POS terminal</dt><dd className="m-0">••••{posTerminalLastFour}</dd></div>}
          {(customer?.name ?? sale.customerName) && <div className={row}><dt>Customer</dt><dd className="m-0 truncate">{customer?.name ?? sale.customerName}</dd></div>}
        </dl>

        <div className="my-4 border-t border-dashed border-line-strong" />
        <ul className="m-0 list-none space-y-2 p-0">
          {(sale.items ?? []).map((item) => (
            <li key={item.id}>
              <div className={row}><span className="min-w-0">{item.productName}</span><span className="shrink-0 tabular-nums">{formatMoney(item.lineTotal)}</span></div>
              <div className="text-xs text-ink-3">{item.quantity} × {formatMoney(item.unitPrice)}{item.refundedQuantity > 0 ? ` · ${item.refundedQuantity} refunded` : ''}</div>
            </li>
          ))}
        </ul>

        <div className="my-4 border-t border-dashed border-line-strong" />
        <dl className="m-0 space-y-0.5">
          <div className={row}><dt>Subtotal</dt><dd className="m-0 tabular-nums">{formatMoney(sale.subtotal)}</dd></div>
          {sale.discountTotal > 0 && <div className={row}><dt>Discount</dt><dd className="m-0 tabular-nums">−{formatMoney(sale.discountTotal)}</dd></div>}
          {sale.taxTotal > 0 && <div className={row}><dt>Tax</dt><dd className="m-0 tabular-nums">{formatMoney(sale.taxTotal)}</dd></div>}
          {sale.refundedAmount > 0 && <div className={cn(row, 'text-danger')}><dt>Refunded</dt><dd className="m-0 tabular-nums">−{formatMoney(sale.refundedAmount)}</dd></div>}
          <div className={cn(row, 'pt-1 text-base font-bold')}><dt>Total</dt><dd className="m-0 tabular-nums">{formatMoney(sale.total)}</dd></div>
        </dl>

        <div className="my-4 border-t border-dashed border-line-strong" />
        <ul className="m-0 list-none space-y-1 p-0 text-xs">
          {(sale.payments ?? []).map((payment) => (
            <li key={payment.id}>
              <div className={row}>
                <span>Paid by {PAYMENT_LABEL[payment.method] ?? payment.method}{payment.provider ? ` (${payment.provider})` : ''}{payment.verificationStatus !== 'verified' ? ` · ${payment.verificationStatus}` : ''}</span>
                <span className="tabular-nums">{formatMoney(payment.amount)}</span>
              </div>
              {payment.reference && <div className="text-ink-3">Ref: {payment.reference}</div>}
            </li>
          ))}
          {sale.changeDue > 0 && <li className={row}><span>Change given</span><span className="tabular-nums">{formatMoney(sale.changeDue)}</span></li>}
          {sale.loyaltyPointsEarned > 0 && <li className={row}><span>Loyalty points earned</span><span>+{sale.loyaltyPointsEarned}</span></li>}
        </ul>

        {(sale.refunds ?? []).length > 0 && <>
          <div className="my-4 border-t border-dashed border-line-strong" />
          <p className="m-0 mb-1 text-xs font-semibold">Refunds</p>
          <ul className="m-0 list-none space-y-1 p-0 text-xs">
            {(sale.refunds ?? []).map((refund) => (
              <li key={refund.id} className={row}>
                <span className="min-w-0">{refund.method} · {refund.reason} · {new Date(refund.createdAt).toLocaleDateString('en-NG')}</span>
                <span className="shrink-0 tabular-nums text-danger">−{formatMoney(refund.amount)}</span>
              </li>
            ))}
          </ul>
        </>}

        {isVoided && <p className="m-0 mt-4 rounded-md bg-danger-soft px-3 py-2 text-xs text-danger">Voided: {sale.voidReason}</p>}

        <footer className="mt-6 text-center font-sans text-xs text-ink-3">
          <p className="m-0">Thank you for your business</p>
          <p className="m-0 mt-1">Powered by {APP_NAME}</p>
        </footer>
      </article>}

      {/* Verify pending payments */}
      {canRefund && pendingPayments.length > 0 && (
        <Card className="no-print mt-6">
          <CardHead title="Confirm payments" hint="Check your bank or POS alert, then confirm or reject." />
          <ul className="m-0 list-none divide-y divide-line p-0">
            {pendingPayments.map((payment) => (
              <li key={payment.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <p className="m-0 text-sm font-medium text-ink">{PAYMENT_LABEL[payment.method] ?? payment.method} · {formatMoney(payment.amount)}</p>
                  {payment.reference && <p className="m-0 text-xs text-ink-3">Ref: {payment.reference}</p>}
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" className="btn-sm" loading={verifyingId === payment.id} onClick={() => handleVerifyPayment(payment.id, 'verified')}>Confirm</Button>
                  <Button variant="ghost" className="btn-sm" loading={verifyingId === payment.id} onClick={() => handleVerifyPayment(payment.id, 'rejected')}>Reject</Button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Refund */}
      {showRefund && (canRefund || refundWithPin) && !isVoided && !isPending && remainingBalance > 0 && (
        <Card className="no-print mt-6">
          <CardHead title="Refund" hint={`${formatMoney(remainingBalance)} can still be refunded`} />
          {refundableItems.length > 0 && (
            <div className="mb-4">
              <p className="m-0 mb-2 text-[13px] font-medium text-ink-2">Items coming back (optional)</p>
              <ul className="m-0 list-none space-y-2 p-0">
                {refundableItems.map((item) => {
                  const max = item.quantity - item.refundedQuantity;
                  return (
                    <li key={item.id} className="flex items-center justify-between gap-3">
                      <span className="min-w-0 text-sm text-ink">{item.productName} <span className="text-ink-3">(up to {max})</span></span>
                      <input className={cn(inputClass, 'w-20')} aria-label={`Return quantity for ${item.productName}`} type="number" min={0} max={max}
                        value={refundItems[item.id] ?? ''} onChange={(e) => setRefundItemQty(item.id, Number(e.target.value) || 0, max)} />
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block"><span className="mb-1 block text-[13px] font-medium text-ink-2">Amount (₦)</span>
              <input id="refund-amount" type="number" inputMode="decimal" className={inputClass} value={refundAmount} onChange={(e) => setRefundAmount(e.target.value)} placeholder={String(remainingBalance)} /></label>
            <label className="block"><span className="mb-1 block text-[13px] font-medium text-ink-2">Method</span>
              <select id="refund-method" className={inputClass} value={refundMethod} onChange={(e) => setRefundMethod(e.target.value as PaymentMethod)}>
                {refundMethodOptions.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select></label>
          </div>
          <label className="mt-3 block"><span className="mb-1 block text-[13px] font-medium text-ink-2">Reason</span>
            <input id="refund-reason" className={inputClass} value={refundReason} onChange={(e) => setRefundReason(e.target.value)} placeholder="Why is this refund being issued?" /></label>
          {refundWithPin && (
            <label className="mt-3 block"><span className="mb-1 block text-[13px] font-medium text-ink-2">Manager's PIN</span>
              <input className={cn(inputClass, 'tracking-[.4em]')} type="password" inputMode="numeric" autoComplete="off" maxLength={6}
                value={managerPin} onChange={(e) => setManagerPin(e.target.value.replace(/\D/g, ''))} placeholder="Ask a manager to enter it" /></label>
          )}
          <div className="mt-4 flex gap-2">
            <Button variant="danger" loading={refunding} disabled={refundWithPin && managerPin.length < 4} onClick={handleRefund}>Process refund</Button>
            <Button variant="ghost" onClick={() => setShowRefund(false)}>Cancel</Button>
          </div>
        </Card>
      )}
    </Page>
  );
}
