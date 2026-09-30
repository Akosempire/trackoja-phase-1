import type { AuditLog, Product } from '../types';
export function activityTypes(can: (permission: string) => boolean): string[] {
  return [...(can('sales:view') ? ['sale', 'payment'] : []), ...(can('inventory:view') ? ['product', 'inventory_movement'] : []), ...(can('customer:view') ? ['customer', 'customer_payment'] : []), ...(can('job:view') ? ['tailoring_job'] : [])];
}
export function businessActivity(logs: AuditLog[], types: string[]): AuditLog[] {
  const seen = new Set<string>();
  return logs.filter(log => {
    if (!types.includes(log.resourceType) || seen.has(log.id)) return false;
    seen.add(log.id); return true;
  });
}
export function activityTitle(log: AuditLog): string {
  if (log.action === 'TAILORING_JOB_STATUS_CHANGED' && log.details && typeof log.details === 'object' && !Array.isArray(log.details) && log.details.to === 'ready_for_pickup') return 'Job ready for collection';
  const titles: Record<string, string> = { SALE_CREATED: 'Sale recorded', SALE_VOIDED: 'Sale voided', PRODUCT_CREATED: 'Product added', PRODUCT_UPDATED: 'Product updated', PRODUCT_DELETED: 'Product removed', STOCK_ADJUSTED: 'Stock updated', CUSTOMER_CREATED: 'Customer added', CUSTOMER_UPDATED: 'Customer updated', CUSTOMER_PAYMENT: 'Customer payment received', TAILORING_JOB_CREATED: 'Job created', TAILORING_JOB_STATUS_CHANGED: 'Job status updated' };
  return titles[log.action.toUpperCase()] ?? log.action.toLowerCase().replace(/_/g, ' ').replace(/^./, letter => letter.toUpperCase());
}
export function activityRoute(log: AuditLog): string | undefined {
  if (!log.resourceId || /deleted/i.test(log.action)) return;
  const roots: Record<string, string> = { sale: '/sales/', product: '/inventory/products/', customer: '/customers/' };
  return roots[log.resourceType] ? roots[log.resourceType] + encodeURIComponent(log.resourceId) : log.resourceType === 'tailoring_job' ? '/jobs' : undefined;
}
export function stockState(product: Pick<Product, 'stockQty' | 'reorderLevel'>): string | null {
  if (product.stockQty < 0) return 'Stock discrepancy';
  if (product.stockQty === 0) return 'Out of stock';
  if (product.stockQty <= product.reorderLevel) return 'Low stock';
  return null;
}
export function stockQuantity(quantity: number, unit: string): string {
  const plurals: Record<string, string> = { pack: 'packs', piece: 'pieces', bag: 'bags', roll: 'rolls', yard: 'yards', metre: 'metres', meter: 'meters', carton: 'cartons', bottle: 'bottles', tablet: 'tablets', unit: 'units', length: 'lengths', tonne: 'tonnes' };
  const normalized = unit.toLowerCase();
  return `${quantity.toLocaleString('en-NG', { maximumFractionDigits: 6 })} ${Math.abs(quantity) === 1 ? normalized : plurals[normalized] ?? unit}`;
}
