// Sample data for sales history, customers, payments and activity screens in the
// preview harness (tests/visual/app.html). Not used by the app.
type Mock = (svc: string, key: string, value: unknown) => void;
type Fixtures = typeof import('../app-fixtures');

const now = Date.now();
const iso = (minsAgo: number) => new Date(now - minsAgo * 60000).toISOString();
const DAY = 24 * 60;

export default (mock: Mock, F: Fixtures) => {
  const p = F.products;
  const line = (saleId: string, product: typeof p[number], qty: number) => ({
    id: `${saleId}-${product.id}`, saleId, productId: product.id, productName: product.name, sku: product.sku, quantity: qty,
    unitPrice: product.sellingPrice, taxRate: 0, taxAmount: 0, discountAmount: 0, lineTotal: qty * product.sellingPrice, refundedQuantity: 0, createdAt: iso(10),
  });
  const sale = (id: string, num: string, mins: number, status: string, method: string, items: ReturnType<typeof line>[], extra: Record<string, unknown> = {}) => {
    const total = items.reduce((sum, l) => sum + l.lineTotal, 0);
    return {
      id, storeId: 'fixture-store', saleNumber: num, status, subtotal: total, discountTotal: 0, taxTotal: 0, total, amountPaid: total, changeDue: 0,
      refundedAmount: 0, loyaltyPointsEarned: 0, createdBy: 'fixture-user', createdAt: iso(mins), items,
      payments: [{ id: `${id}-pay`, saleId: id, method, amount: total, verificationStatus: 'verified', createdAt: iso(mins) }], refunds: [], ...extra,
    };
  };
  const older = [
    sale('s5', '000124', DAY + 90, 'pending_payment', 'transfer', [line('s5', p[5], 2), line('s5', p[2], 1)], { customerId: 'cu2', customerName: 'Chidi Okafor' }),
    sale('s6', '000123', DAY + 200, 'completed', 'cash', [line('s6', p[0], 6)]),
    sale('s7', '000122', DAY + 330, 'completed', 'credit', [line('s7', p[4], 1)], { customerId: 'cu3', customerName: 'Mama Nkechi Stores' }),
    sale('s8', '000121', 3 * DAY + 60, 'completed', 'card', [line('s8', p[7], 2), line('s8', p[6], 3), line('s8', p[1], 4)]),
  ];
  const sales = [...F.sales, ...older];
  mock('SaleService', 'getSales', async (_store: string, filters?: { status?: string }) =>
    filters?.status ? sales.filter((s) => s.status === filters.status) : sales);
  mock('SaleService', 'getSale', async (id: string) => sales.find((s) => s.id === id) ?? sales[0]);
  mock('SaleService', 'getPendingPayments', [
    { id: 'pp1', saleId: 's5', saleNumber: '000124', method: 'transfer', amount: 11300, reference: 'GTB-2210-88431', createdAt: iso(DAY + 88) },
  ]);
  mock('SaleService', 'getRecentRefunds', [
    { id: 'rf1', saleId: 's3', saleNumber: '000126', amount: 2500, reason: 'Yoghurt past best-before', method: 'cash', createdByEmail: 'ada@example.com', createdAt: iso(120) },
  ]);

  const customers = [
    { id: 'cu1', storeId: 'fixture-store', name: 'Mrs Bisi Adeyemi', phone: '0803 123 4567', email: 'bisi@example.com', address: '14 Allen Avenue, Ikeja', notes: 'Prefers Peak Milk in tins', creditLimit: 20000, balance: 0, loyaltyPoints: 485, isActive: true, createdBy: 'fixture-user', createdAt: iso(40000), updatedAt: iso(100) },
    { id: 'cu2', storeId: 'fixture-store', name: 'Chidi Okafor', phone: '0812 987 6543', email: '', creditLimit: 15000, balance: 4000, loyaltyPoints: 126, isActive: true, createdBy: 'fixture-user', createdAt: iso(20000), updatedAt: iso(100) },
    { id: 'cu3', storeId: 'fixture-store', name: 'Mama Nkechi Stores', phone: '0705 555 0192', email: 'nkechi.stores@example.com', address: 'Shop 22, Computer Village, Ikeja', creditLimit: 50000, balance: 18500, loyaltyPoints: 0, isActive: true, createdBy: 'fixture-user', createdAt: iso(60000), updatedAt: iso(100) },
    { id: 'cu4', storeId: 'fixture-store', name: 'Tunde Bakare', email: 'tunde.b@example.com', creditLimit: 0, balance: 0, loyaltyPoints: 32, isActive: true, createdBy: 'fixture-user', createdAt: iso(9000), updatedAt: iso(100) },
    { id: 'cu5', storeId: 'fixture-store', name: 'Hauwa', creditLimit: 0, balance: 0, loyaltyPoints: 0, isActive: true, createdBy: 'fixture-user', createdAt: iso(3000), updatedAt: iso(100) },
  ];
  mock('CustomerService', 'getCustomers', async (_store: string, filters?: { search?: string }) => {
    const q = filters?.search?.toLowerCase();
    return q ? customers.filter((c) => [c.name, c.phone, c.email].some((v) => v?.toLowerCase().includes(q))) : customers;
  });
  mock('CustomerService', 'getCustomer', async (id: string) => customers.find((c) => c.id === id) ?? customers[0]);
  const credit = (id: string, type: string, amount: number, before: number, mins: number, notes?: string) =>
    ({ id, storeId: 'fixture-store', customerId: 'cu3', type, amount, balanceBefore: before, balanceAfter: before + amount, notes, createdBy: 'fixture-user', createdAt: iso(mins) });
  mock('CustomerService', 'getCreditTransactions', [
    credit('ct3', 'sale_credit', 11500, 7000, DAY + 330, 'Sale #000122'),
    credit('ct2', 'payment', -5000, 12000, 2 * DAY, 'Transfer from Nkechi'),
    credit('ct1', 'sale_credit', 12000, 0, 6 * DAY),
  ]);
  const loyalty = (id: string, type: string, points: number, mins: number, notes?: string) =>
    ({ id, storeId: 'fixture-store', customerId: 'cu1', type, points, pointsBefore: 0, pointsAfter: points, notes, createdBy: 'fixture-user', createdAt: iso(mins) });
  mock('CustomerService', 'getLoyaltyTransactions', [
    loyalty('lt3', 'earn', 147, 25, 'Sale #000128'),
    loyalty('lt2', 'redeem', -100, 3 * DAY, 'Redeemed at checkout'),
    loyalty('lt1', 'earn', 438, 9 * DAY),
  ]);

  const attempt = (id: string, mins: number, status: string, extra: Record<string, unknown> = {}) => ({
    id, saleId: 's1', storeId: 'fixture-store', terminalId: 'term-1', terminalLastFour: '4821', expectedAmount: 14700, actualAmount: status === 'successful' ? 14700 : null,
    merchantReference: `TOJ-${id.toUpperCase()}-7F3K92`, providerReference: status === 'successful' ? `MPT${id.slice(-1)}2026102810451198` : null,
    status, providerStatus: status === 'successful' ? 'APPROVED' : null, failureCode: null, initiatedAt: iso(mins), completedAt: status === 'successful' ? iso(mins - 1) : null,
    environment: 'live', paymentMethod: 'any', actualPaymentMethod: status === 'successful' ? 'card' : null, initiatedBy: 'fixture-user',
    saleNumber: '000128', customerName: 'Mrs Bisi Adeyemi', initiatorName: 'Ada Obi', ...extra,
  });
  const attempts = [
    attempt('pa1', 24, 'successful'),
    attempt('pa2', 65, 'reconciliation_required', { saleNumber: '000127', customerName: null, expectedAmount: 4000, failureCode: 'STATUS_UNAVAILABLE' }),
    attempt('pa3', 140, 'failed', { saleNumber: '000126', customerName: null, expectedAmount: 5000, failureCode: 'PROVIDER_DECLINED', terminalId: 'term-2', terminalLastFour: '1093', initiatorName: 'Emeka' }),
    attempt('pa4', DAY + 30, 'pending', { saleNumber: '000124', customerName: 'Chidi Okafor', expectedAmount: 11300, environment: 'sandbox' }),
  ];
  mock('MerchantPaymentService', 'attempts', attempts);
  mock('MerchantPaymentService', 'getAttempt', async (id: string) => attempts.find((a) => a.id === id) ?? attempts[0]);
  mock('MerchantPaymentService', 'reconciliationAttempts', attempts.filter((a) => ['reconciliation_required', 'unresolved'].includes(a.status)));
  mock('MerchantPaymentService', 'connection', { status: 'connected', environment: 'live', authMode: 'api_key', erpEnabled: true, lastVerifiedAt: iso(300), amountUnitConfirmed: true, approvalCodesConfirmed: true });
  mock('MerchantPaymentService', 'terminals', [
    { id: 'term-1', name: 'Front counter', storeId: 'fixture-store', serialLastFour: '4821', status: 'active', isDefault: true, registerId: 'reg-1', verifiedAt: iso(300) },
    { id: 'term-2', name: 'Back till', storeId: 'fixture-store', serialLastFour: '1093', status: 'active', isDefault: false, registerId: null, verifiedAt: null },
  ]);
  mock('MerchantPaymentService', 'registers', [{ id: 'reg-1', name: 'Counter 1', status: 'active' }, { id: 'reg-2', name: 'Counter 2', status: 'active' }]);
};
