-- ============================================================
-- 20261001000003: A CUSTOMER CAN OBTAIN THE DOCUMENT THEY ARE SHOWN
-- ============================================================
-- The customer Billing page has always been able to LIST a business's invoices
-- and receipts, through `list_my_billing_documents`, and that list was all there
-- was: the page could state that INV-... exists but offered no way to open,
-- print or save it. The brief for this work asks for a downloadable invoice or
-- receipt when one is generated. This project ships no PDF library and must not
-- gain one, so the document is rendered from its stored rows and printed from
-- the browser - which means the customer needs to read rows the list RPC does
-- not return: the invoice's line items, its stored subtotal beside its total,
-- and the receipt with the mode it was settled in.
--
-- ============================================================
-- WHY SECURITY INVOKER, AND NOT DEFINER WITH AN OWNERSHIP CHECK
-- ============================================================
-- The three tables the document is built from are already restricted to the
-- caller's own businesses by the policies created in
-- 20260928000096_commercial_lifecycle.sql:
--
--   billing_invoices       billing_invoices_org_read       TO authenticated
--     USING (org_id IN (SELECT public.get_user_org_ids(auth.uid()))
--            OR public.is_platform_admin(auth.uid()))
--
--   billing_receipts       billing_receipts_org_read       TO authenticated
--     USING (org_id IN (SELECT public.get_user_org_ids(auth.uid()))
--            OR public.is_platform_admin(auth.uid()))
--
--   billing_invoice_lines  billing_invoice_lines_org_read  TO authenticated
--     USING (invoice_id IN (SELECT id FROM public.billing_invoices))
--
-- The line policy inherits the invoice restriction rather than restating it:
-- its subquery on billing_invoices is itself executed as the caller, so the
-- invoice policy applies inside it and a line is visible only when its invoice
-- is. That is the same rule the two org_id policies state, one join deeper.
--
-- So the invoker form reads exactly the rows `list_my_billing_documents` already
-- shows, through the same helper and the same membership rule. A SECURITY
-- DEFINER function would have to re-state that ownership check in its own WHERE,
-- and then the only remaining way to leak another business's document would be a
-- mistake in that restatement - a rule written twice is a rule that can disagree
-- with itself. Every other billing RPC here is definer because it writes, or
-- because it reads tables with no customer policy at all; this one is a read the
-- policies already cover.
--
-- ============================================================
-- A NUMBER THAT IS NOT YOURS IS ANSWERED LIKE A NUMBER THAT DOES NOT EXIST
-- ============================================================
-- NULL, not an error, for both. Raising for "exists but belongs to another
-- business" would make this function an oracle for other businesses' document
-- numbers, which is exactly the probing the policies exist to prevent.
--
-- ============================================================
-- WHAT IT RETURNS
-- ============================================================
-- One JSON object per document. `lines` is the invoice's own line items in the
-- order they were written (subscription, then setup fee, then adjustments) and
-- is an empty array when the invoice has no lines - never a synthesised row.
-- `receipt` is null when no receipt was issued for the invoice, so the caller
-- states that absence instead of drawing an empty receipt block. Nothing is
-- invented: every value below is read from a row.

CREATE OR REPLACE FUNCTION public.get_my_billing_document(p_document_number TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_invoice public.billing_invoices%ROWTYPE;
  v_receipt public.billing_receipts%ROWTYPE;
  v_lines JSONB := '[]'::JSONB;
  v_business TEXT;
  v_plan TEXT;
  v_cycle TEXT;
  v_reference TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- An empty parameter is not a document number; answering NULL keeps this path
  -- on the same footing as an unknown one.
  IF p_document_number IS NULL OR btrim(p_document_number) = '' THEN
    RETURN NULL;
  END IF;

  -- The customer reaches a document by whichever number they were shown: the
  -- invoice on the list, or the receipt beside it.
  SELECT * INTO v_invoice
  FROM public.billing_invoices i
  WHERE i.invoice_number = p_document_number;

  IF v_invoice.id IS NULL THEN
    SELECT i.* INTO v_invoice
    FROM public.billing_receipts r
    JOIN public.billing_invoices i ON i.id = r.invoice_id
    WHERE r.receipt_number = p_document_number;
  END IF;

  -- Unknown, or another business's: the policies above removed it before this
  -- line, and the caller cannot tell the two apart from the answer.
  IF v_invoice.id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_receipt
  FROM public.billing_receipts r
  WHERE r.invoice_id = v_invoice.id;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'line_type', l.line_type,
        'description', l.description,
        'quantity', l.quantity,
        'unit_amount_minor', l.unit_amount_minor,
        'total_amount_minor', l.total_amount_minor
      )
      -- Reading order, not insertion order: the trigger writes both rows with the
      -- same now(), so created_at alone cannot separate the subscription line
      -- from the setup fee.
      ORDER BY CASE l.line_type
                 WHEN 'subscription' THEN 1
                 WHEN 'setup_fee' THEN 2
                 ELSE 3
               END,
               l.created_at,
               l.description
    ),
    '[]'::JSONB
  )
  INTO v_lines
  FROM public.billing_invoice_lines l
  WHERE l.invoice_id = v_invoice.id;

  SELECT o.name INTO v_business
  FROM public.organizations o
  WHERE o.id = v_invoice.org_id;

  -- `product_plan_versions` is readable by every authenticated caller for
  -- versions in ('active', 'retired'), which is the whole status vocabulary of
  -- the table, so the plan the invoice was issued against is always nameable.
  SELECT v.display_name, v.billing_cycle INTO v_plan, v_cycle
  FROM public.product_plan_versions v
  WHERE v.id = v_invoice.plan_version_id;

  -- The invoice carries the payment reference the trigger wrote into its
  -- metadata. `subscription_transactions` is owner-only, so a member who is not
  -- the owner falls back to nothing rather than to a wrong value; the document
  -- then simply omits the reference.
  v_reference := COALESCE(
    v_invoice.metadata->>'reference',
    (SELECT t.reference FROM public.subscription_transactions t WHERE t.id = v_invoice.transaction_id)
  );

  RETURN jsonb_build_object(
    'invoice_number', v_invoice.invoice_number,
    'status', v_invoice.status,
    'is_test_data', v_invoice.is_test_data OR COALESCE(v_receipt.is_test_data, FALSE),
    'issued_at', v_invoice.issued_at,
    'paid_at', COALESCE(v_invoice.paid_at, v_receipt.paid_at),
    'currency', v_invoice.currency,
    'subtotal_minor', v_invoice.subtotal_minor,
    'total_minor', v_invoice.total_minor,
    'billing_email', v_invoice.billing_email,
    'business_name', v_business,
    'plan_name', v_plan,
    'billing_cycle', v_cycle,
    'reference', v_reference,
    'lines', v_lines,
    'receipt', CASE WHEN v_receipt.id IS NULL THEN NULL ELSE jsonb_build_object(
      'receipt_number', v_receipt.receipt_number,
      'amount_minor', v_receipt.amount_minor,
      'currency', v_receipt.currency,
      'payment_mode', v_receipt.payment_mode,
      'provider_reference', v_receipt.provider_reference,
      'is_test_data', v_receipt.is_test_data,
      'paid_at', v_receipt.paid_at
    ) END
  );
END;
$$;

COMMENT ON FUNCTION public.get_my_billing_document(TEXT) IS
  'One billing document - invoice or receipt, whichever number the caller supplies - with everything the printable '
  'page renders: the invoice number and status, its issued and paid timestamps, its stored subtotal and total in minor '
  'units, its billing email, the business it belongs to, the plan version it was issued against, the payment '
  'reference, the invoice''s own line items in reading order, and the receipt or an explicit null when none was '
  'issued. SECURITY INVOKER on purpose: billing_invoices, billing_invoice_lines and billing_receipts already restrict '
  'a customer to their own businesses through billing_invoices_org_read, billing_receipts_org_read and '
  'billing_invoice_lines_org_read, so the function reads through those policies instead of around them and cannot '
  'reach a row the customer''s own document list does not show. It returns NULL, never an error, when the number is '
  'unknown OR belongs to another business, so it cannot be used to probe whether another business''s document number '
  'exists.';

-- ============================================================
-- PRIVILEGES
-- ============================================================
-- This project's ALTER DEFAULT PRIVILEGES hands EXECUTE on every new public
-- function to anon and authenticated, so REVOKE ... FROM PUBLIC removes nothing
-- on its own - the roles have to be named. Only a signed-in customer has a
-- document to read, so anon holds no EXECUTE at all.

REVOKE ALL ON FUNCTION public.get_my_billing_document(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_billing_document(TEXT) TO authenticated, service_role;

-- SECURITY INVOKER means the caller's own table privileges decide whether the
-- read can run at all, so the SELECT grant is stated rather than assumed. It
-- grants no rows: the policies above still admit only the caller's businesses.
GRANT SELECT ON TABLE
  public.billing_invoices,
  public.billing_invoice_lines,
  public.billing_receipts
TO authenticated;

-- anon has no policy on any of the three, so it can already read no row. Removing
-- the table privilege - from PUBLIC as well, since a grant to PUBLIC would be
-- inherited by anon whatever is revoked from the role itself - removes the only
-- way a future policy mistake in this area could become an anonymous leak.
REVOKE ALL ON TABLE
  public.billing_invoices,
  public.billing_invoice_lines,
  public.billing_receipts
FROM PUBLIC, anon;

-- ============================================================
-- ASSERTED
-- ============================================================

DO $$
DECLARE
  v_table TEXT;
BEGIN
  IF to_regprocedure('public.get_my_billing_document(text)') IS NULL THEN
    RAISE EXCEPTION '20261001000003: the customer billing document function does not exist';
  END IF;

  -- The whole ownership argument rests on this function reading through the
  -- caller's RLS. A definer form would silently read around it.
  IF (SELECT prosecdef FROM pg_proc WHERE oid = 'public.get_my_billing_document(text)'::regprocedure) THEN
    RAISE EXCEPTION '20261001000003: get_my_billing_document is SECURITY DEFINER; it must read through the caller''s RLS';
  END IF;

  FOREACH v_table IN ARRAY ARRAY['billing_invoices', 'billing_invoice_lines', 'billing_receipts'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = v_table AND c.relrowsecurity
    ) THEN
      RAISE EXCEPTION '20261001000003: RLS is not enabled on public.%, so the invoker read is not scoped', v_table;
    END IF;

    IF NOT has_table_privilege('authenticated', 'public.' || v_table, 'SELECT') THEN
      RAISE EXCEPTION '20261001000003: authenticated cannot SELECT public.%, so the invoker read would fail', v_table;
    END IF;

    IF has_table_privilege('anon', 'public.' || v_table, 'SELECT') THEN
      RAISE EXCEPTION '20261001000003: anon can SELECT public.%, which the customer document read must not allow', v_table;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'billing_invoices'
      AND policyname = 'billing_invoices_org_read'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'billing_receipts'
      AND policyname = 'billing_receipts_org_read'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'billing_invoice_lines'
      AND policyname = 'billing_invoice_lines_org_read'
  ) THEN
    RAISE EXCEPTION '20261001000003: the billing read policies are missing, so an invoker document read is not scoped to one business';
  END IF;

  IF has_function_privilege('anon', 'public.get_my_billing_document(text)', 'EXECUTE') THEN
    RAISE EXCEPTION '20261001000003: anon still holds EXECUTE on get_my_billing_document; the default-privileges grant has to be named, not left to REVOKE ... FROM PUBLIC';
  END IF;

  IF NOT has_function_privilege('authenticated', 'public.get_my_billing_document(text)', 'EXECUTE') THEN
    RAISE EXCEPTION '20261001000003: a signed-in customer cannot read their own billing document';
  END IF;

  RAISE NOTICE '20261001000003: the customer billing document read is installed, invoker-scoped, and closed to anon';
END $$;
