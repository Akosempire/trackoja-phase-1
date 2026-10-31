-- ============================================================
-- 20261031001001: REGISTER MODE (POS UX upgrade, stream A)
-- ============================================================
-- Favourites: owners and managers pin quick-sell products; the register shows
-- them in a "Favourites" tab. Everything else the register needs already
-- exists (store_settings.auto_print_receipt, split payments in create_sale,
-- pending verification for "Confirm later").
-- ============================================================

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS is_favourite BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS products_store_favourite ON public.products(store_id) WHERE is_favourite;

-- Pin or unpin a product. Needs product:update in its store.
CREATE OR REPLACE FUNCTION public.set_product_favourite(p_product_id UUID, p_favourite BOOLEAN)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_store UUID;
BEGIN
  SELECT store_id INTO v_store FROM public.products WHERE id = p_product_id;
  IF v_store IS NULL OR NOT public.user_has_permission(auth.uid(), v_store, 'product:update') THEN
    RAISE EXCEPTION 'Only an owner or manager can pin products';
  END IF;
  UPDATE public.products SET is_favourite = COALESCE(p_favourite, FALSE) WHERE id = p_product_id;
  RETURN COALESCE(p_favourite, FALSE);
END;
$$;
REVOKE ALL ON FUNCTION public.set_product_favourite(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_product_favourite(UUID, BOOLEAN) TO authenticated;

-- Auto-print receipts after each sale (the column already exists). Needs store:update.
CREATE OR REPLACE FUNCTION public.set_auto_print_receipt(p_store_id UUID, p_on BOOLEAN)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.user_has_permission(auth.uid(), p_store_id, 'store:update') THEN
    RAISE EXCEPTION 'Only an owner or manager can change this';
  END IF;
  INSERT INTO public.store_settings(store_id, auto_print_receipt) VALUES (p_store_id, COALESCE(p_on, FALSE))
  ON CONFLICT (store_id) DO UPDATE SET auto_print_receipt = COALESCE(p_on, FALSE);
  RETURN COALESCE(p_on, FALSE);
END;
$$;
REVOKE ALL ON FUNCTION public.set_auto_print_receipt(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_auto_print_receipt(UUID, BOOLEAN) TO authenticated;
