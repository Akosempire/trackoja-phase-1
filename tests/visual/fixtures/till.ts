// Till: an open till with sales and money out, a closed day's report, history,
// a PIN cashier and two held sales. ?till=none shows the "Open the till" form.
type Mock = (svc: string, key: string, value: unknown) => void;
export default function (mock: Mock) {
  const params = new URLSearchParams(location.search);
  const ago = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
  const open = {
    sessionId: 'till-1', storeId: 'fixture-store', status: 'open', openedAt: ago(5), closedAt: null, openedBy: 'Bayo Adewale', closedBy: null,
    openingFloat: 5000, salesCount: 23, salesTotal: 148600, discounts: 1200, tax: 0, byMethod: { cash: 61400, transfer: 52200, card: 35000 },
    cashTaken: 61400, changeGiven: 8650, voidsCount: 1, voidsTotal: 3200, refundsCount: 1, refundsTotal: 2500, refundsCash: 2500,
    cashIn: 2000, cashOut: 4500,
    movements: [{ kind: 'out', amount: 4500, reason: 'Paid the delivery man', at: ago(3), by: 'Bayo Adewale' }, { kind: 'in', amount: 2000, reason: 'Change from the bank', at: ago(2), by: 'Ada Obi' }],
    cashiers: [{ name: 'Bayo Adewale', sales: 15, total: 98000 }, { name: 'Chioma Eze', sales: 8, total: 50600 }],
    expectedCash: 52750, countedCash: null, difference: null, notes: null,
  };
  mock('TillService', 'current', params.get('till') === 'none' ? null : open);
  mock('TillService', 'isRequired', true);
  mock('TillService', 'report', { ...open, status: 'closed', closedAt: ago(0.1), closedBy: 'Bayo Adewale', countedCash: 52250, difference: -500, notes: 'Short 500. Change given wrong at noon.' });
  mock('TillService', 'history', [
    { id: 'till-1', status: 'open', openedAt: ago(5), closedAt: null, openedBy: 'Bayo Adewale', openingFloat: 5000, expectedCash: null, countedCash: null, difference: null, salesTotal: 148600 },
    { id: 'till-0', status: 'closed', openedAt: ago(29), closedAt: ago(19), openedBy: 'Chioma Eze', openingFloat: 5000, expectedCash: 71200, countedCash: 71200, difference: 0, salesTotal: 182300 },
    { id: 'till-a', status: 'closed', openedAt: ago(53), closedAt: ago(43), openedBy: 'Bayo Adewale', openingFloat: 5000, expectedCash: 64000, countedCash: 63500, difference: -500, salesTotal: 160050 },
    { id: 'till-b', status: 'closed', openedAt: ago(77), closedAt: ago(67), openedBy: 'Chioma Eze', openingFloat: 5000, expectedCash: 58000, countedCash: 58200, difference: 200, salesTotal: 141900 },
  ]);
  mock('CashierService', 'current', { userId: 'u-bayo', name: 'Bayo Adewale' });
  mock('CashierService', 'pinStatus', new Set(['u2']));
  try {
    const line = { productId: 'p6', name: 'Peak Milk Tin 400g', sku: 'FD-012', unit: 'pcs', unitPrice: 3200, taxRate: 0, quantity: 2, trackInventory: true, stockQty: 40 };
    localStorage.setItem('trackoja.held.fixture-store', JSON.stringify([
      { id: 'h1', label: 'Mrs Bisi', heldAt: ago(0.2), lines: [line], customerId: null, customerName: 'Mrs Bisi', discount: '0', total: 6400 },
      { id: 'h2', label: 'Sale 2', heldAt: ago(0.5), lines: [{ ...line, quantity: 5 }], customerId: null, customerName: null, discount: '0', total: 16000 },
    ]));
  } catch { /* preview only */ }
}
