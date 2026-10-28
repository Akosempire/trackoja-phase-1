// Sample shop data for the screen preview harness. Not used by the app.
const now = Date.now();
const iso = (minsAgo: number) => new Date(now - minsAgo * 60000).toISOString();
const base = { storeId: 'fixture-store', createdBy: 'fixture-user', createdAt: iso(9000), updatedAt: iso(60), status: 'active' as const, taxRate: 0, attributes: {} };
export const categories = [
  { id: 'c-drinks', storeId: 'fixture-store', name: 'Drinks', description: '', productCount: 3 },
  { id: 'c-food', storeId: 'fixture-store', name: 'Food items', description: '', productCount: 3 },
  { id: 'c-care', storeId: 'fixture-store', name: 'Personal care', description: '', productCount: 2 },
];
export const products = [
  { ...base, id: 'p1', categoryId: 'c-drinks', name: 'Coca-Cola 50cl', sku: 'DRK-001', barcode: '5449000000996', unit: 'bottle', costPrice: 280, sellingPrice: 400, trackInventory: true, stockQty: 46, reorderLevel: 12 },
  { ...base, id: 'p2', categoryId: 'c-drinks', name: 'Eva Water 75cl', sku: 'DRK-002', barcode: '6151100030017', unit: 'bottle', costPrice: 180, sellingPrice: 300, trackInventory: true, stockQty: 8, reorderLevel: 12 },
  { ...base, id: 'p3', categoryId: 'c-drinks', name: 'Hollandia Yoghurt 1L', sku: 'DRK-003', barcode: '6151100120015', unit: 'pack', costPrice: 1900, sellingPrice: 2500, trackInventory: true, stockQty: 14, reorderLevel: 5 },
  { ...base, id: 'p4', categoryId: 'c-food', name: 'Golden Penny Spaghetti 500g', sku: 'FD-010', barcode: '6151100500123', unit: 'pack', costPrice: 950, sellingPrice: 1300, trackInventory: true, stockQty: 0, reorderLevel: 10 },
  { ...base, id: 'p5', categoryId: 'c-food', name: 'Indomie Chicken (carton)', sku: 'FD-011', barcode: '6154000000127', unit: 'carton', costPrice: 9800, sellingPrice: 11500, trackInventory: true, stockQty: 22, reorderLevel: 6 },
  { ...base, id: 'p6', categoryId: 'c-food', name: 'Peak Milk Tin 400g', sku: 'FD-012', barcode: '8712100850032', unit: 'tin', costPrice: 2600, sellingPrice: 3200, trackInventory: true, stockQty: 31, reorderLevel: 8 },
  { ...base, id: 'p7', categoryId: 'c-care', name: 'Dettol Soap 110g', sku: 'PC-020', barcode: '6008679000123', unit: 'bar', costPrice: 650, sellingPrice: 900, trackInventory: true, stockQty: 4, reorderLevel: 10 },
  { ...base, id: 'p8', categoryId: 'c-care', name: 'Close-Up Toothpaste 140g', sku: 'PC-021', barcode: '6001087000555', unit: 'tube', costPrice: 1100, sellingPrice: 1500, trackInventory: true, stockQty: 19, reorderLevel: 6 },
];
export const customers = [
  { id: 'cu1', storeId: 'fixture-store', name: 'Mrs Bisi Adeyemi', phone: '08031234567', email: 'bisi@example.com', totalSpent: 48500, visitCount: 9, balance: 0, createdAt: iso(40000) },
  { id: 'cu2', storeId: 'fixture-store', name: 'Chidi Okafor', phone: '08129876543', email: '', totalSpent: 12600, visitCount: 3, balance: 4000, createdAt: iso(20000) },
];
const line = (saleId: string, p: typeof products[number], qty: number) => ({ id: `${saleId}-${p.id}`, saleId, productId: p.id, productName: p.name, sku: p.sku, quantity: qty, unitPrice: p.sellingPrice, taxRate: 0, taxAmount: 0, discountAmount: 0, lineTotal: qty * p.sellingPrice, refundedQuantity: 0, createdAt: iso(10) });
const pay = (saleId: string, method: string, amount: number, extra: Record<string, unknown> = {}) => [{ id: `${saleId}-pay`, saleId, method, amount, verificationStatus: 'verified', createdAt: iso(10), ...extra }];
const sale = (id: string, num: string, mins: number, status: string, method: string, items: ReturnType<typeof line>[], extra: Record<string, unknown> = {}) => {
  const subtotal = items.reduce((a, l) => a + l.lineTotal, 0);
  return { id, storeId: 'fixture-store', saleNumber: num, status, subtotal, discountTotal: 0, taxTotal: 0, total: subtotal, amountPaid: subtotal, changeDue: 0, refundedAmount: 0, loyaltyPointsEarned: 0, createdBy: 'fixture-user', createdAt: iso(mins), items, payments: pay(id, method, subtotal), refunds: [], cashierName: 'Ada', ...extra };
};
export const sales = [
  sale('s1', '000128', 25, 'completed', 'transfer', [line('s1', products[4], 1), line('s1', products[5], 1)], { customerId: 'cu1', customerName: 'Mrs Bisi Adeyemi' }),
  { ...sale('s2', '000127', 70, 'completed', 'cash', [line('s2', products[0], 3), line('s2', products[1], 2), line('s2', products[7], 1)]), amountPaid: 4000, changeDue: 100 },
  sale('s3', '000126', 140, 'completed', 'card', [line('s3', products[2], 2)]),
  { ...sale('s4', '000125', 300, 'voided', 'cash', [line('s4', products[6], 1)]), voidReason: 'Wrong item scanned' },
];
