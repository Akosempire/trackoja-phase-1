// Sample data for categories, stock movements, batches, bulk import, expenses,
// tailoring jobs, the kitchen display and pharmacy expiry alerts in the preview
// harness (tests/visual/app.html). Not used by the app.
type Mock = (svc: string, key: string, value: unknown) => void;
type Fixtures = typeof import('../app-fixtures');

const now = Date.now();
const iso = (minsAgo: number) => new Date(now - minsAgo * 60000).toISOString();
const day = (offset: number) => new Date(now + offset * 86400000).toISOString().slice(0, 10);
const DAY = 24 * 60;

export default (mock: Mock, F: Fixtures) => {
  const businessType = new URLSearchParams(location.search).get('category') ?? 'supermarket';

  // Categories: add a description and a sub-category.
  mock('CategoryService', 'getCategories', [
    { ...F.categories[0], description: 'Soft drinks, water and juice', status: 'active' },
    { ...F.categories[1], description: 'Noodles, pasta, tins and grains', status: 'active' },
    { ...F.categories[2], description: '', status: 'active' },
    { id: 'c-dairy', storeId: 'fixture-store', name: 'Dairy', description: 'Milk and yoghurt', parentCategoryId: 'c-drinks', status: 'active' },
  ]);

  // Stock movements for the adjust stock screen.
  mock('InventoryService', 'getMovements', [
    { id: 'm1', storeId: 'fixture-store', productId: 'p1', movementType: 'replenishment', quantity: 24, quantityBefore: 22, quantityAfter: 46, reason: 'Delivery from Nigerian Bottling Co.', createdBy: 'u', createdAt: iso(90) },
    { id: 'm2', storeId: 'fixture-store', productId: 'p1', movementType: 'sale', quantity: -3, quantityBefore: 25, quantityAfter: 22, createdBy: 'u', createdAt: iso(DAY) },
    { id: 'm3', storeId: 'fixture-store', productId: 'p1', movementType: 'adjustment', quantity: -2, quantityBefore: 27, quantityAfter: 25, reason: 'Two bottles broken on the shelf', createdBy: 'u', createdAt: iso(2 * DAY) },
    { id: 'm4', storeId: 'fixture-store', productId: 'p1', movementType: 'transfer_out', quantity: -12, quantityBefore: 39, quantityAfter: 27, reason: 'Sent to Yaba branch', createdBy: 'u', createdAt: iso(4 * DAY) },
  ]);

  // Batches / rolls / units.
  const lot = (id: string, productId: string, productName: string, identifier: string | null, received: number, available: number, expiryOffset: number | null, status: string, unit = 'pack') => ({
    id, storeId: 'fixture-store', productId, productName, productUnit: unit, variantId: null, lotType: 'batch', identifier, unitOfMeasure: unit,
    qtyReceived: received, qtyAvailable: available, costPerUnit: 1900, expiryDate: expiryOffset === null ? null : day(expiryOffset), status, receivedAt: iso(10 * DAY),
  });
  mock('StockLotService', 'sweepExpired', 0);
  mock('StockLotService', 'listLots', [
    lot('l1', 'p3', 'Hollandia Yoghurt 1L', 'B-2241', 24, 14, 12, 'available'),
    lot('l2', 'p6', 'Peak Milk Tin 400g', 'PK-0937', 48, 31, 160, 'available', 'tin'),
    lot('l3', 'p3', 'Hollandia Yoghurt 1L', 'B-2198', 24, 6, -3, 'expired'),
    lot('l4', 'p5', 'Indomie Chicken (carton)', 'IND-551', 10, 4, 90, 'quarantined', 'carton'),
    lot('l5', 'p1', 'Coca-Cola 50cl', null, 24, 0, null, 'depleted', 'bottle'),
  ]);

  // Bulk import: the file input is driven by Playwright; parsing is mocked.
  const importRows = [
    { rowNumber: 2, name: 'Milo Refill 500g', sku: 'BV-101', categoryName: 'Drinks', unit: 'pack', costPrice: 2600, sellingPrice: 3100, taxRate: 0, trackInventory: true, stockQty: 20, reorderLevel: 5, errors: [] },
    { rowNumber: 3, name: 'Dangote Sugar 1kg', sku: 'FD-220', categoryName: 'Baking', unit: 'pack', costPrice: 1500, sellingPrice: 1800, taxRate: 0, trackInventory: true, stockQty: 35, reorderLevel: 10, errors: [] },
    { rowNumber: 4, name: '', sku: 'FD-221', categoryName: 'Food items', unit: 'pack', costPrice: 900, sellingPrice: 1200, taxRate: 0, trackInventory: true, stockQty: 12, reorderLevel: 4, errors: ['Name is required'] },
    { rowNumber: 5, name: 'Coca-Cola 50cl', sku: 'DRK-001', categoryName: 'Drinks', unit: 'bottle', costPrice: 280, sellingPrice: 400, taxRate: 0, trackInventory: true, stockQty: 10, reorderLevel: 12, errors: ['SKU DRK-001 already exists'] },
    { rowNumber: 6, name: 'Gift wrap', sku: 'MS-001', unit: 'piece', costPrice: 0, sellingPrice: 500, taxRate: 0, trackInventory: false, stockQty: 0, reorderLevel: 0, errors: [] },
  ];
  mock('BulkImportService', 'parseFile', importRows);
  mock('BulkImportService', 'validateRows', (rows: unknown) => rows);

  // Expenses.
  const expense = (id: string, description: string, category: string, amount: number, daysAgo: number, paymentMethod: string, supplierName: string | null = null) => ({
    id, description, category, amount, currency: 'NGN', spentOn: day(-daysAgo), paymentMethod, supplierId: supplierName ? 'sup1' : null, supplierName,
    reference: null, recordedByEmail: 'ada@example.com', createdAt: iso(daysAgo * DAY),
  });
  const expenses = [
    expense('e1', 'Restock drinks from depot', 'stock', 84000, 0, 'transfer', 'NBC Depot Ikeja'),
    expense('e2', 'Diesel for generator', 'utilities', 18500, 1, 'cash'),
    expense('e3', 'Delivery bike fuel', 'transport', 6000, 2, 'cash'),
    expense('e4', 'Shop rent (October)', 'rent', 150000, 6, 'transfer'),
    expense('e5', 'Salary advance — Tunde', 'salaries', 25000, 9, 'transfer'),
    expense('e6', 'Fix freezer compressor', 'maintenance', 32000, 12, 'cash'),
  ];
  const total = expenses.reduce((sum, e) => sum + e.amount, 0);
  const byCategory = new Map<string, { total: number; entryCount: number }>();
  for (const e of expenses) {
    const row = byCategory.get(e.category) ?? { total: 0, entryCount: 0 };
    row.total += e.amount; row.entryCount += 1; byCategory.set(e.category, row);
  }
  mock('ExpenseService', 'list', expenses);
  mock('ExpenseService', 'summary', [...byCategory.entries()]
    .map(([category, row]) => ({ category, ...row, share: Math.round((row.total / total) * 100) }))
    .sort((a, b) => b.total - a.total));
  mock('ExpenseService', 'listSuppliers', [{ id: 'sup1', name: 'NBC Depot Ikeja', contactName: null, phone: null, email: null, paymentTerms: null, status: 'active', expenseTotal: 84000 }]);

  // Tailoring jobs.
  const job = (id: string, jobNumber: number, garmentType: string, customerName: string | null, status: string, price: number, paid: number, daysUntilDue: number | null, extra: Record<string, unknown> = {}) => ({
    id, jobNumber, garmentType, quantity: 1, customerId: null, customerName, status, price, paid, balance: price - paid,
    dueDate: daysUntilDue === null ? null : day(daysUntilDue), daysUntilDue, assignedEmail: null, nextFittingAt: null, createdAt: iso(5 * DAY), ...extra,
  });
  mock('JobService', 'list', [
    job('j1', 41, 'Agbada (3-piece)', 'Mr Femi Balogun', 'in_progress', 85000, 40000, 3, { nextFittingAt: iso(-DAY) }),
    job('j2', 40, 'Aso-ebi gown', 'Mrs Ngozi Eze', 'ready_for_fitting', 60000, 30000, 1),
    job('j3', 39, 'Senator kaftan', 'Ibrahim Musa', 'ready_for_pickup', 35000, 35000, 0),
    job('j4', 38, 'School uniforms', 'Grace Academy', 'received', 120000, 50000, 9, { quantity: 12 }),
    job('j5', 37, 'Trouser alteration', 'Tunde Ade', 'alterations', 5000, 0, -2),
  ]);
  mock('JobService', 'summary', { jobsDueSoon: 3, jobsOverdue: 1, upcomingFittings: 1, awaitingPickup: 1, outstandingBalances: 150000, openJobs: 5 });

  // Kitchen display.
  const kitchenItem = (saleId: string, n: number, productName: string, quantity: number) => ({
    id: `${saleId}-${n}`, saleId, productId: `k${n}`, productName, sku: `K-${n}`, quantity, unitPrice: 2500, taxRate: 0, taxAmount: 0, discountAmount: 0, lineTotal: quantity * 2500, refundedQuantity: 0, createdAt: iso(5),
  });
  const order = (id: string, saleNumber: string, mins: number, orderStatus: string, orderType: string, tableNumber: string | undefined, items: Array<[string, number]>) => ({
    id, storeId: 'fixture-store', saleNumber, status: 'completed', subtotal: 0, discountTotal: 0, taxTotal: 0, total: 0, amountPaid: 0, changeDue: 0, refundedAmount: 0,
    loyaltyPointsEarned: 0, createdBy: 'u', createdAt: iso(mins), orderStatus, orderType, tableNumber, items: items.map(([name, qty], i) => kitchenItem(id, i, name, qty)),
  });
  mock('SaleService', 'getKitchenOrders', [
    order('k1', '000214', 2, 'new', 'dine_in', '4', [['Jollof rice and chicken', 2], ['Pepper soup (goat)', 1], ['Chapman', 2]]),
    order('k2', '000213', 6, 'new', 'takeaway', undefined, [['Fried rice and turkey', 1], ['Moi moi', 2]]),
    order('k3', '000212', 14, 'preparing', 'dine_in', '7', [['Pounded yam and egusi', 3], ['Assorted meat', 3]]),
    order('k4', '000211', 26, 'preparing', 'delivery', undefined, [['Ofada rice and ayamase', 1], ['Dodo', 1], ['Zobo (50cl)', 2]]),
    order('k5', '000210', 31, 'ready', 'dine_in', '2', [['Suya platter', 1], ['Small chops', 1]]),
    order('k6', '000208', 55, 'served', 'dine_in', '5', [['Amala and ewedu', 2]]),
    order('k7', '000207', 72, 'served', 'takeaway', undefined, [['Shawarma (chicken)', 3]]),
  ]);

  // Pharmacy products carry expiry dates in their attributes.
  if (businessType === 'pharmacy') {
    const drug = (id: string, name: string, sku: string, expiryOffset: number, stockQty: number) => ({
      ...F.products[0], id, name, sku, categoryId: undefined, unit: 'pack', stockQty, attributes: { expiryDate: day(expiryOffset) },
    });
    mock('ProductService', 'getProducts', [
      drug('d1', 'Amoxicillin 500mg (21 caps)', 'RX-1001', -6, 12),
      drug('d2', 'Paracetamol 500mg (Emzor)', 'OTC-2001', 9, 80),
      drug('d3', 'Coartem 80/480', 'RX-1002', 24, 18),
      drug('d4', 'Vitamin C 1000mg', 'OTC-2002', 61, 40),
      drug('d5', 'ORS sachets', 'OTC-2003', 210, 120),
      drug('d6', 'Ciprofloxacin 500mg', 'RX-1003', 400, 22),
    ]);
  }
};
