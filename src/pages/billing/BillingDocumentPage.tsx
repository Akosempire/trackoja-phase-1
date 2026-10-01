import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { SubscriptionService, type BillingDocumentDetail } from '../../services/subscription.service';
import { Button } from '../../components/ui/Button';
import { PageLoader } from '../../components/ui/PageLoader';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { DefList, type DefRow } from '../../components/ui/DefList';
import { StateBlock } from '../../components/ui/StateBlock';
import { formatDate, formatMoneyMinor, humaniseToken } from '../../utils/format';

/**
 * The invoice or receipt the customer was shown, drawn from the rows that were
 * stored for it, so it can be printed or saved from the browser.
 *
 * There is no PDF library in this project and no server-side renderer, so the
 * honest way to hand a customer their document is to render its own data and let
 * the browser produce the file: `window.print()` for "print or save as PDF" and
 * print CSS that removes the application chrome. Nothing here is composed from
 * the page it was opened from — a line that was never stored is not drawn, an
 * invoice with no receipt says so, and a test document is marked as one on the
 * paper as well as on the screen.
 */
export default function BillingDocumentPage() {
  const { number } = useParams<{ number: string }>();
  const [billingDocument, setBillingDocument] = useState<BillingDocumentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!number) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setBillingDocument(await SubscriptionService.getBillingDocument(number));
    } catch (cause) {
      setBillingDocument(null);
      setError(cause instanceof Error ? cause.message : 'This document could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [number]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <PageLoader />;

  if (error) {
    return (
      <div className="page bd-page">
        <StateBlock
          variant="error"
          title="This document could not be loaded"
          body={error}
          actions={
            <div className="btn-row">
              <Button variant="outline" onClick={() => void load()}>Try again</Button>
              <Link className="btn btn-ghost" to="/billing">Back to billing</Link>
            </div>
          }
        />
      </div>
    );
  }

  /*
   * Null means the server found no such document for this business — the same
   * answer it gives for a number that belongs to somebody else, so this page
   * cannot be used to learn whose number exists. The copy says what is true in
   * both cases rather than guessing which one it was.
   */
  if (!billingDocument) {
    return (
      <div className="page bd-page">
        <StateBlock
          variant="empty"
          title="No document with that number"
          body="This number is not one of this business's invoices or receipts. Open Billing to see the documents that have been issued."
          actions={<Link className="btn btn-outline" to="/billing">Back to billing</Link>}
        />
      </div>
    );
  }

  const receipt = billingDocument.receipt;
  const openedByReceipt = receipt !== null && receipt.receiptNumber === number;
  const currency = billingDocument.currency;
  const amount = (minor: number, code: string = currency) => formatMoneyMinor(minor, code);

  const heading = openedByReceipt && receipt
    ? `Receipt ${receipt.receiptNumber}`
    : `Invoice ${billingDocument.invoiceNumber}`;

  const subtitle = [
    billingDocument.planName,
    billingDocument.billingCycle ? `${humaniseToken(billingDocument.billingCycle)} billing` : null,
    billingDocument.isTestData ? 'Test document' : null,
  ].filter(Boolean).join(' · ') || 'Billing document';

  const rows: DefRow[] = [
    { term: 'Status', value: <StatusBadge status={billingDocument.status} /> },
    { term: 'Invoice number', value: <span className="mono">{billingDocument.invoiceNumber}</span> },
  ];
  if (receipt) rows.push({ term: 'Receipt number', value: <span className="mono">{receipt.receiptNumber}</span> });
  rows.push({ term: 'Issued', value: formatDate(billingDocument.issuedAt) });
  /*
   * "Payment recorded", not "Paid": a void invoice keeps the paid_at its payment
   * stamped, and a page that printed "Paid" beside a Void status would state two
   * contradictory things. The timestamp is recorded either way; whether the
   * invoice stands is what the status badge answers.
   */
  if (billingDocument.paidAt) rows.push({ term: 'Payment recorded', value: formatDate(billingDocument.paidAt) });
  if (billingDocument.planName) rows.push({ term: 'Plan', value: billingDocument.planName });
  if (billingDocument.billingCycle) rows.push({ term: 'Billing cycle', value: humaniseToken(billingDocument.billingCycle) });
  rows.push({
    term: 'Billing email',
    value: billingDocument.billingEmail ?? 'No billing email recorded',
    muted: !billingDocument.billingEmail,
  });
  if (billingDocument.reference) {
    rows.push({ term: 'Payment reference', value: <span className="mono">{billingDocument.reference}</span> });
  }

  const receiptRows: DefRow[] = receipt ? [
    { term: 'Receipt number', value: <span className="mono">{receipt.receiptNumber}</span> },
    { term: 'Amount received', value: amount(receipt.amountMinor, receipt.currency) },
    { term: 'Payment mode', value: humaniseToken(receipt.paymentMode) },
    { term: 'Payment date', value: formatDate(receipt.paidAt) },
    ...(receipt.providerReference
      ? [{ term: 'Provider reference', value: <span className="mono">{receipt.providerReference}</span> }]
      : []),
    ...(receipt.isTestData
      ? [{ term: 'Test record', value: 'This receipt was created by a test payment and is not a real charge.' }]
      : []),
  ] : [];

  return (
    <div className="page rp-page bd-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">{heading}</h1>
          <p className="page-subtitle">{subtitle}</p>
        </div>
        {/* On screen only: the paper version is the document itself. */}
        <div className="toolbar-group no-print">
          <Button onClick={() => window.print()}>Print or save as PDF</Button>
          <Link className="btn btn-outline" to="/billing">Back to billing</Link>
        </div>
      </div>

      <div className="rp-card bd-sheet">
        {billingDocument.isTestData && (
          <p className="alert alert-warning bd-notice">
            Test document. This was created by a test payment, so it is not a real charge and not evidence that money
            was received.
          </p>
        )}

        <div className="rp-store-header">
          <div className="rp-store-avatar" aria-hidden="true">
            {(billingDocument.businessName ?? 'B')[0].toUpperCase()}
          </div>
          <h2 className="rp-store-name">{billingDocument.businessName ?? 'Billing document'}</h2>
          <p className="rp-store-meta">{openedByReceipt ? 'Payment receipt' : 'Invoice'}</p>
        </div>

        <hr className="receipt-divider" />

        <div className="bd-block">
          <DefList rows={rows} />
        </div>

        <hr className="receipt-divider" />

        <div className="rp-items">
          <p className="rp-section-label">Charges</p>
          {billingDocument.lines.length === 0 ? (
            <p className="section-sub">No line items are recorded for this invoice.</p>
          ) : (
            billingDocument.lines.map((line, index) => (
              <div className="rp-item" key={`${line.lineType}-${index}`}>
                <div className="rp-item-info">
                  <span className="rp-item-name">{line.description}</span>
                  {/* A unit price is only worth stating when it is not the line total. */}
                  {line.quantity > 1 && (
                    <span className="rp-payment-note">{line.quantity} × {amount(line.unitAmountMinor)}</span>
                  )}
                </div>
                <div className="rp-item-right">
                  <span className="rp-item-total">{amount(line.totalAmountMinor)}</span>
                </div>
              </div>
            ))
          )}
        </div>

        <hr className="receipt-divider" />

        <div className="rp-totals">
          <div className="rp-total-row">
            <span>Subtotal</span>
            <span>{amount(billingDocument.subtotalMinor)}</span>
          </div>
          <div className="rp-grand-total">
            <span>Total</span>
            <span>{amount(billingDocument.totalMinor)}</span>
          </div>
        </div>

        <hr className="receipt-divider" />

        <div className="bd-block">
          <p className="rp-section-label">Receipt</p>
          {receipt ? (
            <DefList rows={receiptRows} />
          ) : (
            <p className="section-sub">No receipt has been issued for this invoice.</p>
          )}
        </div>

        <div className="rp-footer">
          <p>
            {billingDocument.invoiceNumber}
            {receipt ? ` · ${receipt.receiptNumber}` : ''}
          </p>
          <p className="rp-footer-brand">Powered by TrackOja</p>
        </div>
      </div>
    </div>
  );
}
