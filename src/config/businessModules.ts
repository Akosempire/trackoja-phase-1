export type BusinessCategory =
  | 'restaurant'
  | 'tailor'
  | 'fashion_store'
  | 'fabric_textile'
  | 'supermarket'
  | 'pharmacy'
  | 'electronics_gadget'
  | 'beauty_cosmetics'
  | 'building_materials'
  | 'stationery'
  | 'general_retail'
  | 'other';

export interface AttributeFieldConfig {
  key: string;
  label: string;
  type: 'text' | 'date' | 'select' | 'textarea';
  options?: string[];
  placeholder?: string;
}

export interface CategoryConfig {
  label: string;
  emoji: string;
  description: string;
  modules: string[];
  productLabel: string;
  saleLabel: string;
  unitOptions: string[];
  attributeFields: AttributeFieldConfig[];
}

export const CATEGORY_CONFIGS: Record<BusinessCategory, CategoryConfig> = {
  restaurant: {
    label: 'Restaurant / Food Vendor',
    emoji: '🍽️',
    description: 'Manage meals, drinks, tables & kitchen orders',
    modules: ['inventory', 'sales', 'customers', 'restaurant', 'kitchen'],
    productLabel: 'Menu Items',
    saleLabel: 'Orders',
    unitOptions: ['Portion', 'Plate', 'Glass', 'Cup', 'Bowl', 'Bottle', 'Pack', 'Piece'],
    attributeFields: [
      { key: 'mealType', label: 'Type', type: 'select', options: ['Meal', 'Drink', 'Snack', 'Combo', 'Dessert', 'Other'] },
      { key: 'availableFor', label: 'Available for', type: 'select', options: ['Dine-in & Takeaway', 'Dine-in only', 'Takeaway only', 'Delivery'] },
    ],
  },

  tailor: {
    label: 'Tailor / Fashion Designer',
    emoji: '🧵',
    description: 'Track orders, measurements, delivery dates & styles',
    modules: ['inventory', 'sales', 'customers', 'tailoring'],
    productLabel: 'Services & Materials',
    saleLabel: 'Orders',
    unitOptions: ['Yard', 'Meter', 'Piece', 'Set', 'Outfit'],
    attributeFields: [
      { key: 'fabricType', label: 'Fabric type', type: 'text', placeholder: 'e.g. Cotton, Chiffon, Ankara' },
      { key: 'styleReference', label: 'Style / design', type: 'text', placeholder: 'Optional reference' },
    ],
  },

  fashion_store: {
    label: 'Fashion Store',
    emoji: '👗',
    description: 'Sell clothing with sizes, colours & variants',
    modules: ['inventory', 'sales', 'customers', 'variants'],
    productLabel: 'Products',
    saleLabel: 'Sales',
    unitOptions: ['Piece', 'Pair', 'Set', 'Pack'],
    attributeFields: [
      { key: 'sizes', label: 'Available sizes', type: 'text', placeholder: 'e.g. S, M, L, XL, XXL' },
      { key: 'colors', label: 'Available colours', type: 'text', placeholder: 'e.g. Red, Blue, Black' },
      { key: 'collection', label: 'Collection / Season', type: 'text', placeholder: 'e.g. Summer 2026' },
    ],
  },

  fabric_textile: {
    label: 'Fabric & Textile Seller',
    emoji: '🧶',
    description: 'Sell fabric by yard, meter or roll with fractional quantities',
    modules: ['inventory', 'sales', 'customers', 'fabric'],
    productLabel: 'Fabrics',
    saleLabel: 'Sales',
    unitOptions: ['Yard', 'Meter', 'Roll', 'Bundle', 'Piece'],
    attributeFields: [
      { key: 'fabricType', label: 'Fabric type', type: 'text', placeholder: 'e.g. Cotton, Lace, Velvet' },
      { key: 'width', label: 'Width', type: 'text', placeholder: 'e.g. 45 inches, 60 inches' },
      { key: 'rollLength', label: 'Roll length (yards)', type: 'text', placeholder: 'e.g. 50' },
    ],
  },

  supermarket: {
    label: 'Supermarket',
    emoji: '🛒',
    description: 'Full-range retail store with bulk stock management',
    modules: ['inventory', 'sales', 'customers'],
    productLabel: 'Products',
    saleLabel: 'Sales',
    unitOptions: ['Piece', 'Pack', 'Box', 'Carton', 'kg', 'litre', 'Dozen'],
    attributeFields: [],
  },

  pharmacy: {
    label: 'Pharmacy',
    emoji: '💊',
    description: 'Track medicines with batch numbers, expiry dates & dosages',
    modules: ['inventory', 'sales', 'customers', 'pharmacy'],
    productLabel: 'Medicines',
    saleLabel: 'Sales',
    unitOptions: ['Tablet', 'Pack', 'Bottle', 'Sachet', 'Vial', 'Strip', 'Capsule', 'Piece'],
    attributeFields: [
      { key: 'batchNumber', label: 'Batch number', type: 'text', placeholder: 'e.g. BN2026-001' },
      { key: 'expiryDate', label: 'Expiry date', type: 'date' },
      { key: 'manufacturer', label: 'Manufacturer', type: 'text', placeholder: 'e.g. Emzor, May & Baker' },
      { key: 'dosage', label: 'Dosage / Strength', type: 'text', placeholder: 'e.g. 500mg, 10mg/5ml' },
    ],
  },

  electronics_gadget: {
    label: 'Electronics & Gadgets',
    emoji: '📱',
    description: 'Track devices with IMEI, serial numbers & warranties',
    modules: ['inventory', 'sales', 'customers', 'gadgets'],
    productLabel: 'Gadgets',
    saleLabel: 'Sales',
    unitOptions: ['Piece', 'Unit', 'Set', 'Box'],
    attributeFields: [
      { key: 'condition', label: 'Condition', type: 'select', options: ['New', 'Used', 'Refurbished'] },
      { key: 'imei', label: 'IMEI / Serial number', type: 'text', placeholder: 'e.g. 356938035643809' },
      { key: 'warrantyExpiry', label: 'Warranty expires', type: 'date' },
      { key: 'specifications', label: 'Specs / Model', type: 'text', placeholder: 'e.g. 128GB, Space Grey' },
    ],
  },

  beauty_cosmetics: {
    label: 'Beauty & Cosmetics',
    emoji: '💄',
    description: 'Manage beauty products, skincare & accessories',
    modules: ['inventory', 'sales', 'customers'],
    productLabel: 'Products',
    saleLabel: 'Sales',
    unitOptions: ['Piece', 'Pack', 'Set', 'Bottle', 'Tube', 'Jar'],
    attributeFields: [
      { key: 'shade', label: 'Shade / Variant', type: 'text', placeholder: 'e.g. Nude Pink, #24' },
      { key: 'skinType', label: 'Suitable for', type: 'text', placeholder: 'e.g. Oily, Dry, All skin types' },
    ],
  },

  building_materials: {
    label: 'Building Materials',
    emoji: '🏗️',
    description: 'Sell construction materials in bulk units',
    modules: ['inventory', 'sales', 'customers'],
    productLabel: 'Materials',
    saleLabel: 'Sales',
    unitOptions: ['Bag', 'Piece', 'Bundle', 'Carton', 'Ton', 'Metre', 'Sheet', 'Roll'],
    attributeFields: [
      { key: 'grade', label: 'Grade / Specification', type: 'text', placeholder: 'e.g. Grade 60, 3/4 inch' },
      { key: 'brand', label: 'Brand', type: 'text', placeholder: 'e.g. Dangote, BUA' },
    ],
  },

  stationery: {
    label: 'Stationery Store',
    emoji: '📚',
    description: 'Books, office supplies and school materials',
    modules: ['inventory', 'sales', 'customers'],
    productLabel: 'Items',
    saleLabel: 'Sales',
    unitOptions: ['Piece', 'Pack', 'Box', 'Ream', 'Dozen', 'Set'],
    attributeFields: [],
  },

  general_retail: {
    label: 'General Retail Store',
    emoji: '🏪',
    description: 'Standard retail POS and inventory management',
    modules: ['inventory', 'sales', 'customers'],
    productLabel: 'Products',
    saleLabel: 'Sales',
    unitOptions: ['pcs', 'box', 'kg', 'litre', 'dozen', 'pack'],
    attributeFields: [],
  },

  other: {
    label: 'Other Business',
    emoji: '💼',
    description: 'Custom setup — all core modules enabled',
    modules: ['inventory', 'sales', 'customers'],
    productLabel: 'Products',
    saleLabel: 'Sales',
    unitOptions: ['pcs', 'box', 'kg', 'litre', 'unit', 'piece'],
    attributeFields: [],
  },
};

export const DEFAULT_CATEGORY: BusinessCategory = 'general_retail';

export function getCategoryConfig(category: BusinessCategory | string): CategoryConfig {
  return CATEGORY_CONFIGS[category as BusinessCategory] ?? CATEGORY_CONFIGS.general_retail;
}

export const BUSINESS_CATEGORIES = Object.entries(CATEGORY_CONFIGS).map(([value, config]) => ({
  value: value as BusinessCategory,
  ...config,
}));
