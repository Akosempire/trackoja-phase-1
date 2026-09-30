import type { BusinessCategory } from '../config/businessModules';

const LINE_ITEM_PLURALS: Record<string, string> = {
  Product: 'products',
  'Menu item': 'menu items',
  Garment: 'garments',
  Variant: 'variants',
  Fabric: 'fabrics',
  Medicine: 'medicines',
  Unit: 'units',
  Shade: 'shades',
  Material: 'materials',
  Item: 'items',
  'Item or service': 'items and services',
};

export function lineItemPlural(lineItem: string): string {
  return LINE_ITEM_PLURALS[lineItem] ?? `${lineItem.toLowerCase()}s`;
}

export function recordSaleAction(category: BusinessCategory): string {
  return category === 'restaurant' ? 'New order' : 'Record sale';
}
