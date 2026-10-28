import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { SubscriptionService, type BillingDocumentDetail } from '../../services/subscription.service';
import { Button } from '../../components/ui/Button';
import { PageLoader } from '../../components/ui/PageLoader';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { DefList, type DefRow } from '../../components/ui/DefList';
import { StateBlock } from '../../components/ui/StateBlock';
import { Card, Page, btn, cn } from '../../components/kit';
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
      <Page width="form">
        <Card>
          <StateBlock
            variant="error"
            title="This document could not be loaded"
            body={error}
            actions={
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" className="btn-sm" onClick={() => void load()}>Try again</Button>
                <Link className={btn('ghost', 'sm')} to="/billing">Back to billing</Link>
              </div>
            }
          />
        </Card>
      </Page>
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
      <Page width="form">
        <Card>
          <StateBlock
            variant="empty"
            title="No document with that number"
            body="This number is not one of this business's invoices or receipts. Open Billing to see the documents that have been issued."
            actions={<Link className={btn('outline', 'sm')} to="/billing">Back to billing</Link>}
          />
        </Card>
      </Page>
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
    { term: 'Invoice number', value: <span className="font-mono text-[13px]">{billingDocument.invoiceNumber}</span> },
  ];
  if (receipt) rows.push({ term: 'Receipt number', value: <span className="break-all font-mono text-[13px]">{receipt.receiptNumber}</span> });
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
    rows.push({ term: 'Payment reference', value: <span className="break-all font-mono text-[13px]">{billingDocument.reference}</span> });
  }

  const receiptRows: DefRow[] = receipt ? [
    { term: 'Receipt number', value: <span className="break-all font-mono text-[13px]">{receipt.receiptNumber}</span> },
    { term: 'Amount received', value: amount(receipt.amountMinor, receipt.currency) },
    { term: 'Payment mode', value: humaniseToken(receipt.paymentMode) },
    { term: 'Payment date', value: formatDate(receipt.paidAt) },
    ...(receipt.providerReference
      ? [{ term: 'Provider reference', value: <span className="break-all font-mono text-[13px]">{receipt.providerReference}</span> }]
      : []),
    ...(receipt.isTestData
      ? [{ term: 'Test record', value: 'This receipt was created by a test payment and is not a real charge.' }]
      : []),
  ] : [];

  const label = 'm-0 mb-3 text-[11px] font-semibold uppercase tracking-wider text-ink-3';
  const divider = <div className="my-6 border-t border-line" />;

  return (
    <Page width="form" className="bd-page">
      {/* On screen only: the paper version is the document itself. */}
      <div className="no-print mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="m-0 break-words text-2xl font-semibold leading-8 tracking-tight text-ink">{heading}</h1>
          <p className="m-0 mt-1 text-sm text-ink-2">{subtitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => window.print()}>Print or save as PDF</Button>
          <Link className={btn('outline')} to="/billing">Back to billing</Link>
        </div>
      </div>

      <article className="print-sheet bd-sheet rounded-xl border border-line bg-surface px-5 py-7 text-ink shadow-card sm:px-10 sm:py-10" aria-label={heading}>
        {billingDocument.isTestData && (
          <p className="m-0 mb-6 rounded-lg border border-warn bg-warn-soft px-4 py-3 text-[13px] font-medium text-warn-ink" role="note">
            Test document. This was created by a test payment, so it is not a real charge and not evidence that money
            was received.
          </p>
        )}

        <header className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-lg font-semibold text-brand-ink" aria-hidden="true">
              {(billingDocument.businessName ?? 'B')[0].toUpperCase()}
            </span>
            <div className="min-w-0">
              <h2 className="m-0 truncate text-lg font-semibold text-ink">{billingDocument.businessName ?? 'Billing document'}</h2>
              <p className="m-0 text-[13px] text-ink-3">{openedByReceipt ? 'Payment receipt' : 'Invoice'}</p>
            </div>
          </div>
          <p className="m-0 shrink-0 pt-1 text-right text-[13px] font-semibold tracking-wide text-ink-2">TrackOja</p>
        </header>

        {divider}

        <DefList rows={rows} />

        {divider}

        <section aria-label="Charges">
          <p className={label}>Charges</p>
          {billingDocument.lines.length === 0 ? (
            <p className="m-0 text-sm text-ink-3">No line items are recorded for this invoice.</p>
          ) : (
            <ul className="m-0 list-none divide-y divide-line p-0">
              {billingDocument.lines.map((line, index) => (
                <li className="flex items-baseline justify-between gap-4 py-2.5 first:pt-0" key={`${line.lineType}-${index}`}>
                  <div className="min-w-0">
                    <p className="m-0 text-sm font-medium text-ink">{line.description}</p>
                    {/* A unit price is only worth stating when it is not the line total. */}
                    {line.quantity > 1 && (
                      <p className="m-0 mt-0.5 text-xs tabular-nums text-ink-3">{line.quantity} × {amount(line.unitAmountMinor)}</p>
                    )}
                  </div>
                  <span className="shrink-0 text-sm font-medium tabular-nums text-ink">{amount(line.totalAmountMinor)}</span>
                </li>
              ))}
            </ul>
          )}

          <dl className="m-0 mt-4 rounded-lg bg-subtle px-4 py-3">
            <div className="flex items-baseline justify-between gap-4 text-[13px] text-ink-2">
              <dt>Subtotal</dt>
              <dd className="m-0 tabular-nums">{amount(billingDocument.subtotalMinor)}</dd>
            </div>
            <div className="mt-2 flex items-baseline justify-between gap-4 border-t border-line pt-2 text-ink">
              <dt className="text-[15px] font-semibold">Total</dt>
              <dd className="m-0 text-lg font-semibold tabular-nums">{amount(billingDocument.totalMinor)}</dd>
            </div>
          </dl>
        </section>

        {divider}

        <section aria-label="Receipt">
          <p className={label}>Receipt</p>
          {receipt ? (
            <DefList rows={receiptRows} />
          ) : (
            <p className="m-0 text-sm text-ink-3">No receipt has been issued for this invoice.</p>
          )}
        </section>

        <footer className={cn('mt-8 border-t border-dashed border-line-strong pt-4 text-center text-xs text-ink-3')}>
          <p className="m-0 break-all font-mono">
            {billingDocument.invoiceNumber}
            {receipt ? ` · ${receipt.receiptNumber}` : ''}
          </p>
          <p className="m-0 mt-1">Powered by TrackOja</p>
        </footer>
      </article>
    </Page>
  );
}
