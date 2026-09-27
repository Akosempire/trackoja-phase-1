-- Migration: 076_stock_identity_schema.sql
-- Description: Stock identity. TrackOja stores one integer stock_qty per product,
--   which cannot express the four ways real businesses hold stock:
--     - variants   (fashion sizes/colours, cosmetics shades)
--     - batches    (pharmacy, cosmetics: expiry per batch)
--     - rolls      (fabric: measured length per roll, fractional quantities)
--     - serials    (electronics: one indivisible unit with an IMEI/serial)
--   This adds product_variants and a single stock_lots table covering batches,
--   rolls, serials and plain bulk stock, so validation, the movement ledger and
--   reporting are shared rather than reimplemented per business type.
--
--   Also records the unit of measure on sale lines. Today a quantity of 3 cannot
--   be told apart as 3 metres, 3 yards, 3 cartons or 3 pieces in history,
--   receipts or reports.
--
--   Additive only: no existing column is altered or dropped, and
--   products.stock_qty keeps working for simple products.
-- Author: TrackOja Team
-- Date: 2026-09-26

-- ============================================================
-- PRODUCT VARIANTS
-- ============================================================
-- A style sold in several sizes/colours holds its own stock per combination.
-- selling_price NULL inherits the parent product's price.

CREATE TABLE IF NOT EXISTS public.product_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  sku TEXT,
  size TEXT,
  colour TEXT,
  attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
  cost_price NUMERIC(14,2),
  selling_price NUMERIC(14,2),
  stock_qty NUMERIC(14,3) NOT NULL DEFAULT 0,
  reorder_level NUMERIC(14,3) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive', 'archived')),
  created_by UUID NOT NULL REFERENCES public.users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_product_variants_product ON public.product_variants(product_id, status);
CREATE INDEX IF NOT EXISTS idx_product_variants_store ON public.product_variants(store_id);
CREATE INDEX IF NOT EXISTS idx_product_variants_low_stock ON public.product_variants(store_id, product_id)
  WHERE status = 'active';

-- One row per size/colour combination per product. COALESCE keeps a missing size
-- or colour from defeating uniqueness (NULLs are distinct in a plain UNIQUE).
CREATE UNIQUE INDEX IF NOT EXISTS idx_product_variants_unique_combo
  ON public.product_variants(product_id, COALESCE(size, ''), COALESCE(colour, ''));

CREATE UNIQUE INDEX IF NOT EXISTS idx_product_variants_unique_sku
  ON public.product_variants(store_id, sku) WHERE sku IS NOT NULL;

COMMENT ON COLUMN public.product_variants.selling_price IS
  'NULL inherits the parent product price, so a price change on the style flows through unless overridden.';
COMMENT ON COLUMN public.product_variants.stock_qty IS
  'Variant-level stock. Kept alongside stock_lots: variants answer "how many mediums are left", lots answer "which batch or roll".';

-- ============================================================
-- STOCK LOTS
-- ============================================================
-- One table for every form of identified stock. `lot_type` drives validation:
--   batch  - needs a batch number, may carry an expiry date
--   roll   - needs a roll identifier, measured length, fractional quantities
--   serial - exactly one indivisible unit with a serial/IMEI, sellable once
--   bulk   - un-identified quantity, the default for simple retail

CREATE TABLE IF NOT EXISTS public.stock_lots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  variant_id UUID REFERENCES public.product_variants(id) ON DELETE CASCADE,
  lot_type TEXT NOT NULL DEFAULT 'bulk'
    CHECK (lot_type IN ('batch', 'roll', 'serial', 'bulk')),
  identifier TEXT,
  unit_of_measure TEXT NOT NULL DEFAULT 'piece',
  qty_received NUMERIC(14,3) NOT NULL DEFAULT 0,
  qty_available NUMERIC(14,3) NOT NULL DEFAULT 0,
  qty_reserved NUMERIC(14,3) NOT NULL DEFAULT 0,
  cost_per_unit NUMERIC(14,2),
  selling_price_per_unit NUMERIC(14,2),
  expiry_date DATE,
  received_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  supplier_id UUID,
  status TEXT NOT NULL DEFAULT 'available'
    CHECK (status IN ('available', 'quarantined', 'expired', 'depleted', 'written_off')),
  attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID NOT NULL REFERENCES public.users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  CONSTRAINT stock_lots_qty_non_negative CHECK (qty_available >= 0 AND qty_reserved >= 0),
  CONSTRAINT stock_lots_qty_within_received CHECK (qty_available <= qty_received),
  -- A serialized unit is exactly one thing and must be identifiable.
  CONSTRAINT stock_lots_serial_is_single CHECK (
    lot_type <> 'serial' OR (qty_received = 1 AND identifier IS NOT NULL)
  ),
  -- Batches and rolls must be identifiable, otherwise they cannot be selected or audited.
  CONSTRAINT stock_lots_identified CHECK (
    lot_type IN ('bulk', 'serial') OR identifier IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_stock_lots_product ON public.stock_lots(product_id, status);
CREATE INDEX IF NOT EXISTS idx_stock_lots_variant ON public.stock_lots(variant_id) WHERE variant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_stock_lots_store_status ON public.stock_lots(store_id, status);
CREATE INDEX IF NOT EXISTS idx_stock_lots_expiry ON public.stock_lots(store_id, expiry_date)
  WHERE expiry_date IS NOT NULL;
-- Selection order for expiring stock is earliest-expiry-first.
CREATE INDEX IF NOT EXISTS idx_stock_lots_available_expiry
  ON public.stock_lots(product_id, expiry_date) WHERE status = 'available' AND qty_available > 0;

-- A serial/IMEI may exist only once per store. This is what makes double-selling a
-- serialized unit impossible even under concurrent requests.
CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_lots_serial_unique
  ON public.stock_lots(store_id, identifier)
  WHERE lot_type = 'serial' AND identifier IS NOT NULL;

-- Batch/roll identifiers are unique per product within a store.
CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_lots_identified_unique
  ON public.stock_lots(store_id, product_id, identifier)
  WHERE identifier IS NOT NULL AND lot_type IN ('batch', 'roll');

COMMENT ON TABLE public.stock_lots IS
  'Identified stock: pharmacy batches, fabric rolls, electronics serials, and plain bulk quantities. '
  'One table so expiry, fractional quantities, and serial uniqueness are validated in one place.';
COMMENT ON COLUMN public.stock_lots.qty_available IS
  'Remaining quantity. For a roll this is the remaining length in unit_of_measure; for a serial it is 1 or 0.';
COMMENT ON COLUMN public.stock_lots.unit_of_measure IS
  'Unit this lot is measured in (metre, yard, piece, carton...). Never converted implicitly - the unit travels with the quantity.';

-- ============================================================
-- SALE LINE IDENTITY AND UNITS
-- ============================================================
-- Historical sale lines gain the unit sold and which variant/lot it came from,
-- snapshotted so later lot edits cannot rewrite history.

ALTER TABLE public.sale_items
  ADD COLUMN IF NOT EXISTS unit_of_measure TEXT,
  ADD COLUMN IF NOT EXISTS variant_id UUID REFERENCES public.product_variants(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS lot_id UUID REFERENCES public.stock_lots(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS lot_identifier TEXT;

CREATE INDEX IF NOT EXISTS idx_sale_items_lot ON public.sale_items(lot_id) WHERE lot_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sale_items_variant ON public.sale_items(variant_id) WHERE variant_id IS NOT NULL;

COMMENT ON COLUMN public.sale_items.unit_of_measure IS
  'Unit as sold (metre, yard, piece...). Snapshotted at sale time.';
COMMENT ON COLUMN public.sale_items.lot_identifier IS
  'Batch number, roll number or serial as sold, snapshotted so a later lot edit cannot rewrite history.';

-- ============================================================
-- UPDATED_AT TRIGGERS
-- ============================================================

DROP TRIGGER IF EXISTS handle_updated_at_product_variants ON public.product_variants;
CREATE TRIGGER handle_updated_at_product_variants BEFORE UPDATE ON public.product_variants
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS handle_updated_at_stock_lots ON public.stock_lots;
CREATE TRIGGER handle_updated_at_stock_lots BEFORE UPDATE ON public.stock_lots
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
-- Same shape as every other store-scoped table: membership of the store plus the
-- matching inventory permission. Writes are function-only.

ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_lots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS product_variants_select ON public.product_variants;
CREATE POLICY product_variants_select ON public.product_variants
  FOR SELECT TO authenticated
  USING (
    store_id IN (SELECT public.get_user_active_store_ids(auth.uid()))
    AND public.user_has_permission(auth.uid(), store_id, 'inventory:view')
  );

DROP POLICY IF EXISTS stock_lots_select ON public.stock_lots;
CREATE POLICY stock_lots_select ON public.stock_lots
  FOR SELECT TO authenticated
  USING (
    store_id IN (SELECT public.get_user_active_store_ids(auth.uid()))
    AND public.user_has_permission(auth.uid(), store_id, 'inventory:view')
  );
