// Sizes and colours, labels and credit reminders (Stream C screens).
type Mock = (svc: string, key: string, value: unknown) => void;
type F = typeof import('../app-fixtures');
export default function (mock: Mock, f: F) {
  const base = f.products[0];
  const shirt = { ...base, id: 'p-shirt', categoryId: undefined, name: 'Ankara shirt', sku: 'ANK-01', barcode: undefined, unit: 'pcs', costPrice: 6000, sellingPrice: 10000, trackInventory: true, stockQty: 11, reorderLevel: 2,
    variantOptions: [{ name: 'Size', values: ['M', 'L', 'XL'] }, { name: 'Colour', values: ['Red', 'Blue'] }] };
  if (!f.products.some((p) => p.id === 'p-shirt')) (f.products as unknown as typeof shirt[]).push(shirt);
  const v = (id: string, size: string, colour: string, stock: number, price: number | null = null, barcode: string | null = null) =>
    ({ id, productId: 'p-shirt', size, colour, sku: `ANK-01-${size}-${colour.toUpperCase().slice(0, 3)}`, barcode, sellingPrice: price, stockQty: stock });
  const variants = [v('v1', 'M', 'Red', 3, null, '8000001'), v('v2', 'M', 'Blue', 2), v('v3', 'L', 'Red', 4), v('v4', 'L', 'Blue', 0), v('v5', 'XL', 'Red', 1, 12000), v('v6', 'XL', 'Blue', 1, 12000)];
  mock('VariantService', 'forStore', variants);
  mock('VariantService', 'forProduct', async (id: string) => (id === 'p-shirt' ? variants : []));
  mock('VariantService', 'ensureBarcodes', async (ids: string[]) => Object.fromEntries(ids.map((id) => [id, f.products.find((p) => p.id === id)?.barcode ?? f.products.find((p) => p.id === id)?.sku ?? id])));
  mock('VariantService', 'logReminder', undefined);
  const owing = [{ id: 'cu3', storeId: 'fixture-store', name: 'Mama Nkechi', phone: '08035550000', email: '', totalSpent: 90000, visitCount: 14, balance: 15500, creditLimit: 50000, loyaltyPoints: 0, createdAt: new Date().toISOString() }];
  if (!f.customers.some((c) => c.id === 'cu3')) (f.customers as unknown as typeof owing).push(...owing);
}
