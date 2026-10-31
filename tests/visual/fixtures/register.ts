// Register (POS) preview: create_sale builds a real-looking sale from the request.
// ?settings=autoprint turns auto-print on; ?role=cashier is handled by app-hooks.
type Mock = (svc: string, key: string, value: unknown) => void;
interface Req { items: { productId: string; quantity: number }[]; payments: { method: string; amount: number; reference?: string; pending?: boolean }[]; discountTotal?: number; customerId?: string }
export default function register(mock: Mock, F: typeof import('../app-fixtures')) {
  let n = 129;
  mock('SaleService', 'createSale', async (storeId: string, req: Req) => {
    const id = `s-new-${n}`;
    const items = req.items.map((i, k) => {
      const p = F.products.find((x) => x.id === i.productId)!;
      return { id: `${id}-${k}`, saleId: id, productId: p.id, productName: p.name, sku: p.sku, quantity: i.quantity, unitPrice: p.sellingPrice, taxRate: 0, taxAmount: 0, discountAmount: 0, lineTotal: p.sellingPrice * i.quantity };
    });
    const total = items.reduce((s, i) => s + i.lineTotal, 0) - (req.discountTotal ?? 0);
    const paid = req.payments.reduce((s, p) => s + p.amount, 0);
    const sale = {
      ...F.sales[0], id, storeId, saleNumber: String(n++).padStart(6, '0'), receiptNumber: `#${n}`, status: 'completed', createdAt: new Date().toISOString(),
      subtotal: total + (req.discountTotal ?? 0), discountTotal: req.discountTotal ?? 0, taxTotal: 0, total, amountPaid: paid, changeDue: Math.max(paid - total, 0),
      customerId: req.customerId ?? null, customerName: null, customerPhone: null, items,
      payments: req.payments.map((p, k) => ({ id: `${id}-p${k}`, saleId: id, method: p.method, amount: p.amount, reference: p.reference ?? null, status: p.pending ? 'pending' : 'confirmed' })),
    };
    (window as unknown as { __sales: unknown[] }).__sales = [...((window as unknown as { __sales?: unknown[] }).__sales ?? []), { req, sale }];
    await new Promise((r) => setTimeout(r, 120));
    return sale;
  });
  const params = new URLSearchParams(location.search);
  if (params.get('path')?.startsWith('/sales/checkout')) {
    mock('StoreService', 'getStoreSettings', { currency: 'NGN', taxRate: 0, receiptFooter: 'Thank you!', autoPrintReceipt: params.get('settings') === 'autoprint', discountLimitPercent: 10, requireCustomerForSale: false, allowNegativeStock: false });
    mock('MerchantPaymentService', 'activeAttempts', []);
    if (params.get('pos') !== '1') mock('MerchantPaymentService', 'connection', null);
  }
}
