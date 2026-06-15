// services/bulk-import.service.ts
// Excel/CSV template generation and parsing for bulk product import

export interface BulkImportRow {
  rowNumber: number;
  name: string;
  sku: string;
  barcode?: string;
  categoryName?: string;
  unit: string;
  costPrice: number;
  sellingPrice: number;
  taxRate: number;
  trackInventory: boolean;
  stockQty: number;
  reorderLevel: number;
  description?: string;
  errors: string[];
}

const TEMPLATE_HEADERS = [
  'Name',
  'SKU',
  'Barcode',
  'Category',
  'Unit',
  'Cost Price',
  'Selling Price',
  'Tax Rate (%)',
  'Track Inventory (TRUE/FALSE)',
  'Stock Quantity',
  'Reorder Level',
  'Description',
];

const TEMPLATE_EXAMPLE_ROWS = [
  ['Coca-Cola 50cl', 'BEV-COKE-50', '5449000000996', 'Beverages', 'pcs', 80, 150, 0, 'TRUE', 100, 10, 'Soft drink, 50cl bottle'],
  ['Rice 5kg', 'GRN-RICE-5KG', '', 'Groceries', 'bag', 4500, 5200, 0, 'TRUE', 30, 5, ''],
];

// Maps normalized (lowercase, alphanumeric-only) header text to our field names
const HEADER_ALIASES: Record<string, string> = {
  name: 'name',
  productname: 'name',
  product: 'name',
  sku: 'sku',
  code: 'sku',
  productcode: 'sku',
  barcode: 'barcode',
  upc: 'barcode',
  category: 'categoryName',
  categoryname: 'categoryName',
  unit: 'unit',
  uom: 'unit',
  costprice: 'costPrice',
  cost: 'costPrice',
  buyingprice: 'costPrice',
  sellingprice: 'sellingPrice',
  price: 'sellingPrice',
  sellprice: 'sellingPrice',
  unitprice: 'sellingPrice',
  taxrate: 'taxRate',
  tax: 'taxRate',
  trackinventory: 'trackInventory',
  trackinventorytruefalse: 'trackInventory',
  stockquantity: 'stockQty',
  stockqty: 'stockQty',
  quantity: 'stockQty',
  stock: 'stockQty',
  initialstock: 'stockQty',
  reorderlevel: 'reorderLevel',
  reorder: 'reorderLevel',
  reorderpoint: 'reorderLevel',
  description: 'description',
  notes: 'description',
};

function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function toNumber(value: unknown, fallback: number): number {
  if (value === undefined || value === null || value === '') return fallback;
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function toBoolean(value: unknown, fallback: boolean): boolean {
  if (value === undefined || value === null || value === '') return fallback;
  const str = String(value).trim().toLowerCase();
  if (['true', 'yes', 'y', '1'].includes(str)) return true;
  if (['false', 'no', 'n', '0'].includes(str)) return false;
  return fallback;
}

function toText(value: unknown): string {
  return value === undefined || value === null ? '' : String(value).trim();
}

export class BulkImportService {
  /**
   * Generates and downloads an .xlsx template with the expected columns and example rows
   */
  static async downloadTemplate(): Promise<void> {
    const XLSX = await import('xlsx');
    const sheet = XLSX.utils.aoa_to_sheet([TEMPLATE_HEADERS, ...TEMPLATE_EXAMPLE_ROWS]);
    sheet['!cols'] = TEMPLATE_HEADERS.map(() => ({ wch: 18 }));

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, 'Products');
    XLSX.writeFile(workbook, 'trackoja-product-import-template.xlsx');
  }

  /**
   * Parses an uploaded .xlsx, .xls, or .csv file into rows ready for validation
   */
  static async parseFile(file: File): Promise<BulkImportRow[]> {
    const XLSX = await import('xlsx');
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const raw: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, { defval: '' });

    return raw.map((record, index) => {
      const mapped: Record<string, unknown> = {};
      for (const [header, value] of Object.entries(record)) {
        const field = HEADER_ALIASES[normalizeHeader(header)];
        if (field) mapped[field] = value;
      }

      const row: BulkImportRow = {
        rowNumber: index + 2, // +1 for header row, +1 for 1-based numbering
        name: toText(mapped.name),
        sku: toText(mapped.sku),
        barcode: toText(mapped.barcode) || undefined,
        categoryName: toText(mapped.categoryName) || undefined,
        unit: toText(mapped.unit) || 'pcs',
        costPrice: toNumber(mapped.costPrice, 0),
        sellingPrice: toNumber(mapped.sellingPrice, 0),
        taxRate: toNumber(mapped.taxRate, 0),
        trackInventory: toBoolean(mapped.trackInventory, true),
        stockQty: toNumber(mapped.stockQty, 0),
        reorderLevel: toNumber(mapped.reorderLevel, 0),
        description: toText(mapped.description) || undefined,
        errors: [],
      };

      return row;
    });
  }

  /**
   * Validates parsed rows: required fields, numeric ranges, and duplicate SKUs
   * (both within the file and against existing products)
   */
  static validateRows(rows: BulkImportRow[], existingSkus: Set<string>): BulkImportRow[] {
    const seenSkus = new Set<string>();

    return rows.map((row) => {
      const errors: string[] = [];

      if (!row.name) errors.push('Name is required');
      if (!row.sku) {
        errors.push('SKU is required');
      } else {
        const skuKey = row.sku.toLowerCase();
        if (existingSkus.has(skuKey)) errors.push('SKU already exists');
        else if (seenSkus.has(skuKey)) errors.push('Duplicate SKU in file');
        seenSkus.add(skuKey);
      }
      if (!row.sellingPrice || row.sellingPrice <= 0) errors.push('Selling price must be greater than 0');
      if (row.costPrice < 0) errors.push('Cost price cannot be negative');
      if (row.stockQty < 0) errors.push('Stock quantity cannot be negative');
      if (row.reorderLevel < 0) errors.push('Reorder level cannot be negative');

      return { ...row, errors };
    });
  }
}
