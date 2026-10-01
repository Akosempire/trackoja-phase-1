// @vitest-environment jsdom
//
// The printable billing document is the one screen where a test invoice could be
// mistaken for a real one, and where a page could quietly draw something the
// database never stored. These assertions are about what it refuses to draw: a
// line that does not exist, a receipt that was never issued, and a real-looking
// document that is not real.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BillingDocumentPage from '../src/pages/billing/BillingDocumentPage';
import type { BillingDocumentDetail } from '../src/services/subscription.service';

const mock = vi.hoisted(() => ({ getBillingDocument: vi.fn() }));

vi.mock('../src/services/subscription.service', () => ({
  SubscriptionService: { getBillingDocument: mock.getBillingDocument },
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const INVOICE_NUMBER = 'INV-202610-ABC1234567';

const fixture = (overrides: Partial<BillingDocumentDetail> = {}): BillingDocumentDetail => ({
  invoiceNumber: INVOICE_NUMBER,
  status: 'paid',
  isTestData: false,
  issuedAt: '2026-10-01T09:00:00.000Z',
  paidAt: '2026-10-01T09:00:00.000Z',
  currency: 'NGN',
  subtotalMinor: 2_250_000,
  totalMinor: 2_250_000,
  billingEmail: 'owner@example.test',
  businessName: 'Ada Stores',
  planName: 'Standard',
  billingCycle: 'annual',
  reference: 'TKO-ABCDEF',
  lines: [
    { lineType: 'subscription', description: 'Standard - annual', quantity: 1, unitAmountMinor: 2_250_000, totalAmountMinor: 2_250_000 },
  ],
  receipt: null,
  ...overrides,
});

let host: HTMLDivElement;
let root: Root;

async function mount(number = INVOICE_NUMBER): Promise<string> {
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[`/billing/documents/${number}`]}>
        <Routes>
          <Route path="/billing/documents/:number" element={<BillingDocumentPage />} />
        </Routes>
      </MemoryRouter>,
    );
  });
  return host.textContent ?? '';
}

function printedText(): string {
  return host.textContent ?? '';
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  mock.getBillingDocument.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('the printable billing document', () => {
  it('reads its amounts as the minor units they are stored in', async () => {
    mock.getBillingDocument.mockResolvedValue(fixture());
    await mount();
    expect(printedText()).toContain('₦22,500');
    // 2,250,000 is ₦22,500, not ₦2,250,000: a missing division is the whole
    // class of money defect this page could ship.
    expect(printedText()).not.toContain('₦2,250,000');
  });

  it('draws the lines the invoice has and no others', async () => {
    mock.getBillingDocument.mockResolvedValue(fixture());
    await mount();
    expect(printedText()).toContain('Standard - annual');
    expect(printedText()).not.toContain('Setup fee');
  });

  it('draws a setup fee when the invoice carries one', async () => {
    mock.getBillingDocument.mockResolvedValue(fixture({
      subtotalMinor: 2_350_000,
      totalMinor: 2_350_000,
      lines: [
        { lineType: 'subscription', description: 'Standard - annual', quantity: 1, unitAmountMinor: 2_250_000, totalAmountMinor: 2_250_000 },
        { lineType: 'setup_fee', description: 'Setup fee', quantity: 1, unitAmountMinor: 100_000, totalAmountMinor: 100_000 },
      ],
    }));
    await mount();
    expect(printedText()).toContain('Setup fee');
    expect(printedText()).toContain('₦1,000');
  });

  it('states the absence of a receipt instead of drawing an empty block', async () => {
    mock.getBillingDocument.mockResolvedValue(fixture());
    await mount();
    expect(printedText()).toContain('No receipt has been issued for this invoice.');
  });

  it('shows the receipt, its mode and its provider reference when one was issued', async () => {
    mock.getBillingDocument.mockResolvedValue(fixture({
      receipt: {
        receiptNumber: 'RCT-202610-DEF9876543',
        amountMinor: 2_250_000,
        currency: 'NGN',
        paymentMode: 'live',
        providerReference: 'ps_ref_1',
        isTestData: false,
        paidAt: '2026-10-01T09:05:00.000Z',
      },
    }));
    await mount();
    expect(printedText()).toContain('RCT-202610-DEF9876543');
    expect(printedText()).toContain('Live');
    expect(printedText()).toContain('ps_ref_1');
    expect(printedText()).not.toContain('No receipt has been issued');
  });

  it('opens the same document when the customer was shown the receipt number', async () => {
    mock.getBillingDocument.mockResolvedValue(fixture({
      receipt: {
        receiptNumber: 'RCT-202610-DEF9876543',
        amountMinor: 2_250_000,
        currency: 'NGN',
        paymentMode: 'live',
        providerReference: null,
        isTestData: false,
        paidAt: '2026-10-01T09:05:00.000Z',
      },
    }));
    await mount('RCT-202610-DEF9876543');
    expect(printedText()).toContain('Receipt RCT-202610-DEF9876543');
    expect(printedText()).toContain('Payment receipt');
  });

  it('marks a test document as a test document, on the paper as well as the screen', async () => {
    mock.getBillingDocument.mockResolvedValue(fixture({ isTestData: true, status: 'paid' }));
    await mount();
    expect(printedText()).toContain('Test document.');
  });

  it('shows the document status it was given, and never claims a void invoice was paid', async () => {
    mock.getBillingDocument.mockResolvedValue(fixture({ status: 'void' }));
    await mount();
    expect(printedText()).toContain('Void');
    expect(printedText()).not.toContain('Paid');
  });

  it('reports a number this business does not have as absent rather than as a failure', async () => {
    // The server answers an unknown number and another business's number the same
    // way, so the page must not turn the absence into an error state that could be
    // read as "this document exists but you may not see it".
    mock.getBillingDocument.mockResolvedValue(null);
    await mount('INV-202610-NOTMINE000');
    expect(printedText()).toContain('No document with that number');
  });

  it('offers the browser print action that produces the PDF', async () => {
    mock.getBillingDocument.mockResolvedValue(fixture());
    await mount();
    const print = [...host.querySelectorAll('button')].find((button) => button.textContent?.includes('Print or save as PDF'));
    expect(print).toBeTruthy();
  });
});
