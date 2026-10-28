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
const line = (p: typeof products[number], qty: number) => ({ id: `${p.id}-l`, productId: p.id, productName: p.name, sku: p.sku, quantity: qty, unitPrice: p.sellingPrice, discount: 0, taxAmount: 0, lineTotal: qty * p.sellingPrice });
export const sales = [
  { id: 's1', storeId: 'fixture-store', receiptNumber: 'RCP-000128', status: 'completed', paymentMethod: 'transfer', subtotal: 14700, discount: 0, taxTotal: 0, total: 14700, amountPaid: 14700, changeDue: 0, cashierId: 'fixture-user', cashierName: 'Ada', customerId: 'cu1', customerName: 'Mrs Bisi Adeyemi', createdAt: iso(25), items: [line(products[4], 1), line(products[5], 1)] },
  { id: 's2', storeId: 'fixture-store', receiptNumber: 'RCP-000127', status: 'completed', paymentMethod: 'cash', subtotal: 2200, discount: 0, taxTotal: 0, total: 2200, amountPaid: 3000, changeDue: 800, cashierId: 'fixture-user', cashierName: 'Ada', createdAt: iso(70), items: [line(products[0], 2), line(products[1], 2), line(products[0], 1)] },
  { id: 's3', storeId: 'fixture-store', receiptNumber: 'RCP-000126', status: 'completed', paymentMethod: 'pos', subtotal: 5000, discount: 0, taxTotal: 0, total: 5000, amountPaid: 5000, changeDue: 0, cashierId: 'fixture-user', cashierName: 'Tunde', createdAt: iso(140), items: [line(products[2], 2)] },
  { id: 's4', storeId: 'fixture-store', receiptNumber: 'RCP-000125', status: 'voided', paymentMethod: 'cash', subtotal: 900, discount: 0, taxTotal: 0, total: 900, amountPaid: 900, changeDue: 0, cashierId: 'fixture-user', cashierName: 'Tunde', createdAt: iso(300), items: [line(products[6], 1)] },
];
