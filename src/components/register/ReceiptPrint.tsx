import { formatMoney } from '../../utils/format';
import { APP_NAME } from '../../config/brand';
import type { Sale } from '../../types';

const LABEL: Record<string, string> = { cash: 'Cash', card: 'POS / card', transfer: 'Transfer', credit: 'Credit', other: 'Other' };

/**
 * The receipt the register prints in place (only visible when printing). The
 * receipt page has the full version with refunds.
 */
export function ReceiptPrint({ sale, storeName, storeAddress, storePhone, cashier }: { sale: Sale; storeName: string; storeAddress?: string; storePhone?: string; cashier?: string }) {
  const when = new Date(sale.createdAt).toLocaleString('en-NG', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const row = 'flex justify-between gap-3';
  return (
    <article className="print-sheet register-print hidden font-mono text-[13px] leading-5 text-ink print:block" aria-hidden="true">
      <header className="text-center font-sans">
        <h2 className="m-0 text-lg font-semibold">{storeName}</h2>
        {storeAddress && <p className="m-0 text-xs">{storeAddress}</p>}
        {storePhone && <p className="m-0 text-xs">{storePhone}</p>}
      </header>
      <div className="my-3 border-t border-dashed border-line-strong" />
      <div className={row}><span>Receipt</span><span>#{sale.saleNumber}</span></div>
      <div className={row}><span>Date</span><span>{when}</span></div>
      {cashier && <div className={row}><span>Cashier</span><span>{cashier}</span></div>}
      {sale.customerName && <div className={row}><span>Customer</span><span>{sale.customerName}</span></div>}
      <div className="my-3 border-t border-dashed border-line-strong" />
      {(sale.items ?? []).map((i) => (
        <div key={i.id}>
          <div className={row}><span>{i.productName}</span><span>{formatMoney(i.lineTotal)}</span></div>
          <div className="text-xs">{i.quantity} × {formatMoney(i.unitPrice)}</div>
        </div>
      ))}
      <div className="my-3 border-t border-dashed border-line-strong" />
      <div className={row}><span>Subtotal</span><span>{formatMoney(sale.subtotal)}</span></div>
      {sale.discountTotal > 0 && <div className={row}><span>Discount</span><span>−{formatMoney(sale.discountTotal)}</span></div>}
      {sale.taxTotal > 0 && <div className={row}><span>Tax</span><span>{formatMoney(sale.taxTotal)}</span></div>}
      <div className={`${row} text-base font-bold`}><span>Total</span><span>{formatMoney(sale.total)}</span></div>
      <div className="my-3 border-t border-dashed border-line-strong" />
      {(sale.payments ?? []).map((p) => (
        <div key={p.id} className={row}><span>Paid by {LABEL[p.method] ?? p.method}{p.verificationStatus === 'pending' ? ' (to confirm)' : ''}</span><span>{formatMoney(p.amount)}</span></div>
      ))}
      {sale.changeDue > 0 && <div className={row}><span>Change given</span><span>{formatMoney(sale.changeDue)}</span></div>}
      <footer className="mt-4 text-center font-sans text-xs">
        <p className="m-0">Thank you for your business</p>
        <p className="m-0">Powered by {APP_NAME}</p>
      </footer>
    </article>
  );
}

/** Print with the paper size the receipt page last used. */
export function printReceipt(): void {
  let paper = '80mm';
  try { const saved = localStorage.getItem('trackoja-paper'); if (saved === '58mm' || saved === 'a4') paper = saved; } catch { /* default */ }
  document.documentElement.dataset.paper = paper;
  window.print();
}
