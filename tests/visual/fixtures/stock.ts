// Restock screens: suppliers, deliveries, a stock count in progress, transfers and low stock.
// ?count=none shows "Start a count".
type Mock = (svc: string, key: string, value: unknown) => void;
export default function (mock: Mock, F: { products: Array<{ id: string; name: string; sku: string; barcode?: string; unit: string; stockQty: number; costPrice: number }> }) {
  const days = (n: number) => new Date(Date.now() - n * 86400_000).toISOString();
  const day = (n: number) => days(n).slice(0, 10);
  const params = new URLSearchParams(location.search);
  mock('RestockService', 'suppliers', [
    { id: 's1', name: 'Dangote Foods', contactName: 'Musa Bello', phone: '0803 555 1200', email: 'sales@dangotefoods.ng', address: 'Apapa, Lagos', paymentTerms: '30 days', notes: null, status: 'active', purchaseCount: 6, purchasedTotal: 1840000, paidTotal: 1520000, owed: 320000, lastPurchaseOn: day(2) },
    { id: 's2', name: 'Nestlé Distributor Ikeja', contactName: 'Chika', phone: '0812 000 4411', email: null, address: null, paymentTerms: 'Cash on delivery', notes: null, status: 'active', purchaseCount: 3, purchasedTotal: 410500, paidTotal: 410500, owed: 0, lastPurchaseOn: day(9) },
    { id: 's3', name: 'Mama Tunde Wholesale', contactName: null, phone: '0705 111 2233', email: null, address: 'Mile 12 market', paymentTerms: null, notes: null, status: 'active', purchaseCount: 1, purchasedTotal: 96000, paidTotal: 40000, owed: 56000, lastPurchaseOn: day(15) },
  ]);
  const purchases = [
    { id: 'p1', reference: 'INV-0781', purchasedOn: day(2), total: 420000, amountPaid: 100000, owed: 320000, supplierId: 's1', supplierName: 'Dangote Foods', lineCount: 4, recordedBy: 'Ada Obi' },
    { id: 'p2', reference: null, purchasedOn: day(9), total: 186500, amountPaid: 186500, owed: 0, supplierId: 's2', supplierName: 'Nestlé Distributor Ikeja', lineCount: 3, recordedBy: 'Ada Obi' },
    { id: 'p3', reference: 'MT-22', purchasedOn: day(15), total: 96000, amountPaid: 40000, owed: 56000, supplierId: 's3', supplierName: 'Mama Tunde Wholesale', lineCount: 2, recordedBy: 'Kemi' },
  ];
  mock('RestockService', 'purchases', purchases);
  mock('RestockService', 'purchase', { purchase: { id: 'p1', reference: 'INV-0781', purchased_on: day(2), total: 420000, amount_paid: 100000, owed: 320000, supplier_id: 's1', supplier_name: 'Dangote Foods', payment_method: 'transfer', notes: 'Two cartons dented, accepted.' },
    items: [
      { id: 'i1', product_id: 'p1', name: 'Golden Penny Rice 5kg', sku: 'RICE5', quantity: 20, unit_cost: 9500, line_total: 190000, lot_identifier: null, unit: 'bag' },
      { id: 'i2', product_id: 'p2', name: 'Dangote Sugar 1kg', sku: 'SUG1', quantity: 40, unit_cost: 1500, line_total: 60000, lot_identifier: null, unit: 'pack' },
      { id: 'i3', product_id: 'p3', name: 'Semovita 2kg', sku: 'SEMO2', quantity: 50, unit_cost: 2600, line_total: 130000, lot_identifier: null, unit: 'pack' },
      { id: 'i4', product_id: 'p4', name: 'Dangote Salt 500g', sku: 'SALT', quantity: 100, unit_cost: 400, line_total: 40000, lot_identifier: null, unit: 'pack' },
    ],
    payments: [{ id: 'y1', amount: 100000, paid_on: day(2), method: 'transfer', reference: 'GTB 99812', notes: 'Paid on delivery' }] });
  mock('RestockService', 'lowStock', [
    { productId: F.products[0]?.id ?? 'p1', name: 'Peak Milk Tin 400g', sku: 'MILK', unit: 'tin', stockQty: 0, reorderLevel: 12, suggestedQty: 24, lastUnitCost: 320, supplierId: 's2', supplierName: 'Nestlé Distributor Ikeja', lastPurchasedOn: day(9) },
    { productId: F.products[1]?.id ?? 'p2', name: 'Golden Penny Rice 5kg', sku: 'RICE5', unit: 'bag', stockQty: 2, reorderLevel: 8, suggestedQty: 14, lastUnitCost: 9500, supplierId: 's1', supplierName: 'Dangote Foods', lastPurchasedOn: day(2) },
    { productId: F.products[2]?.id ?? 'p3', name: 'Indomie Chicken (carton)', sku: 'INDO', unit: 'carton', stockQty: 3, reorderLevel: 5, suggestedQty: 7, lastUnitCost: 9800, supplierId: null, supplierName: null, lastPurchasedOn: null },
  ]);
  mock('RestockService', 'transfers', [
    { id: 't1', direction: 'in', status: 'in_transit', otherBranch: 'Yaba branch', lineCount: 3, unitsSent: 34, unitsReceived: null, value: 128000, notes: 'Weekend stock', sentAt: days(0.2), receivedAt: null },
    { id: 't2', direction: 'out', status: 'received', otherBranch: 'Lekki branch', lineCount: 2, unitsSent: 20, unitsReceived: 19, value: 64000, notes: null, sentAt: days(4), receivedAt: days(3.8) },
  ]);
  mock('RestockService', 'transfer', { transfer: { id: 't1', from_store_id: 'store-2', to_store_id: 'fixture-store', from_name: 'Yaba branch', to_name: 'Ikeja branch', status: 'in_transit', notes: 'Weekend stock', sent_at: days(0.2), received_at: null },
    lines: [
      { id: 'l1', product_name: 'Coca-Cola 50cl', sku: 'COKE', unit: 'bottle', unit_cost: 250, quantity_sent: 24, quantity_received: null },
      { id: 'l2', product_name: 'Hollandia Yoghurt 1L', sku: 'HOLL', unit: 'pack', unit_cost: 2100, quantity_sent: 6, quantity_received: null },
      { id: 'l3', product_name: 'Peak Milk Tin 400g', sku: 'MILK', unit: 'tin', unit_cost: 320, quantity_sent: 4, quantity_received: null },
    ] });
  mock('RestockService', 'branches', [{ id: 'store-2', name: 'Yaba branch' }, { id: 'store-3', name: 'Lekki branch' }]);
  const counting = params.get('count') !== 'none';
  mock('RestockService', 'openCount', counting ? { id: 'c1', storeId: 'fixture-store', scopeLabel: 'All products', status: 'open', startedAt: days(0.1), finishedAt: null } : null);
  mock('RestockService', 'pastCounts', [{ id: 'c0', storeId: 'fixture-store', scopeLabel: 'Drinks', status: 'applied', startedAt: days(31), finishedAt: days(31) }]);
  mock('RestockService', 'countLines', F.products.slice(0, 7).map((p, i) => ({
    productId: p.id, name: p.name, sku: p.sku, barcode: p.barcode ?? null, unit: p.unit, expected: p.stockQty,
    counted: i < 4 ? Math.max(p.stockQty + [0, -2, 1, -1][i], 0) : null, unitCost: p.costPrice,
  })));
}
