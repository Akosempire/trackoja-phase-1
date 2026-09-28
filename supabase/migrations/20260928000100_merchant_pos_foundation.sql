-- Merchant customer payments. Platform subscription_transactions and Paystack
-- billing remain separate. A pending POS sale has no stock movement, payment,
-- loyalty award, revenue, or printable receipt until provider verification.

ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS checkout_key UUID;
ALTER TABLE public.sales DROP CONSTRAINT IF EXISTS sales_status_check;
ALTER TABLE public.sales ADD CONSTRAINT sales_status_check
  CHECK (status IN ('pending_payment', 'completed', 'voided'));
CREATE UNIQUE INDEX IF NOT EXISTS sales_store_checkout_key_unique
  ON public.sales(store_id, checkout_key) WHERE checkout_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS sales_id_store_unique ON public.sales(id, store_id);
CREATE UNIQUE INDEX IF NOT EXISTS stores_id_org_unique ON public.stores(id, org_id);

-- Store is the existing TrackOja branch boundary. Registers are optional
-- logical checkouts within a store; payment terminals stay in the devices table.
CREATE TABLE IF NOT EXISTS public.merchant_registers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 2 AND 80),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_by UUID NOT NULL REFERENCES public.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(store_id, name),
  UNIQUE(store_id, id)
);
CREATE INDEX IF NOT EXISTS merchant_registers_store_idx ON public.merchant_registers(store_id, status);
ALTER TABLE public.merchant_registers ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.merchant_registers TO authenticated;
CREATE POLICY merchant_registers_read ON public.merchant_registers FOR SELECT
  USING (public.user_has_permission(auth.uid(), store_id, 'devices:view'));
CREATE POLICY merchant_registers_insert ON public.merchant_registers FOR INSERT
  WITH CHECK (created_by = auth.uid() AND public.user_has_permission(auth.uid(), store_id, 'devices:manage'));
CREATE POLICY merchant_registers_update ON public.merchant_registers FOR UPDATE
  USING (public.user_has_permission(auth.uid(), store_id, 'devices:manage'))
  WITH CHECK (public.user_has_permission(auth.uid(), store_id, 'devices:manage'));

ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS register_id UUID;
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS is_default_payment_terminal BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS provider_verified_at TIMESTAMPTZ;
ALTER TABLE public.devices ADD CONSTRAINT devices_register_same_store_fk
  FOREIGN KEY (store_id, register_id) REFERENCES public.merchant_registers(store_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS devices_default_moniepoint_per_store
  ON public.devices(store_id)
  WHERE type = 'payment_terminal' AND provider = 'moniepoint'
    AND is_default_payment_terminal AND status = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS devices_moniepoint_serial_global
  ON public.devices(serial_number)
  WHERE type = 'payment_terminal' AND provider = 'moniepoint'
    AND serial_number IS NOT NULL AND status <> 'decommissioned';
CREATE UNIQUE INDEX IF NOT EXISTS devices_id_store_unique ON public.devices(id, store_id);

-- External merchant providers are registered separately from platform billing.
-- Capabilities are explicit, so the UI never offers unsupported provider calls.
CREATE TABLE IF NOT EXISTS public.merchant_payment_providers (
  key TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  supports_push BOOLEAN NOT NULL DEFAULT FALSE,
  supports_status BOOLEAN NOT NULL DEFAULT FALSE,
  supports_cancel BOOLEAN NOT NULL DEFAULT FALSE,
  supports_refund BOOLEAN NOT NULL DEFAULT FALSE,
  active BOOLEAN NOT NULL DEFAULT FALSE
);
INSERT INTO public.merchant_payment_providers
  (key, display_name, supports_push, supports_status, supports_cancel, supports_refund, active)
VALUES ('moniepoint', 'Moniepoint POS', TRUE, TRUE, FALSE, FALSE, TRUE)
ON CONFLICT (key) DO NOTHING;
ALTER TABLE public.merchant_payment_providers ENABLE ROW LEVEL SECURITY;
CREATE POLICY merchant_payment_providers_read ON public.merchant_payment_providers FOR SELECT USING (TRUE);
GRANT SELECT ON public.merchant_payment_providers TO authenticated;
GRANT ALL ON public.merchant_payment_providers TO service_role;

-- The Edge Function encrypts credentials with AES-GCM using a key from server
-- secrets before writing either field. RLS exposes NO rows to browser roles.
CREATE TABLE IF NOT EXISTS public.merchant_provider_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  provider TEXT NOT NULL REFERENCES public.merchant_payment_providers(key),
  environment TEXT NOT NULL CHECK (environment IN ('sandbox', 'live')),
  auth_mode TEXT NOT NULL,
  credential_ciphertext TEXT NOT NULL,
  credential_iv TEXT NOT NULL,
  credential_key_version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'configured'
    CHECK (status IN ('configured', 'connected', 'error', 'disconnected')),
  erp_enabled_confirmed_at TIMESTAMPTZ,
  last_verified_at TIMESTAMPTZ,
  last_error_code TEXT,
  created_by UUID NOT NULL REFERENCES public.users(id),
  updated_by UUID NOT NULL REFERENCES public.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(org_id, provider, environment)
);
ALTER TABLE public.merchant_provider_connections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.merchant_provider_connections FROM anon, authenticated;
GRANT ALL ON public.merchant_provider_connections TO service_role;
COMMENT ON TABLE public.merchant_provider_connections IS
  'Service-role only. Secrets are AES-GCM encrypted with an Edge Function key; never expose this table through merchant RPCs.';

-- Several attempts may belong to one sale. A partial unique index prevents a
-- second active request while the first is pending or its outcome is unknown.
CREATE TABLE IF NOT EXISTS public.merchant_payment_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  sale_id UUID NOT NULL REFERENCES public.sales(id) ON DELETE RESTRICT,
  terminal_id UUID NOT NULL REFERENCES public.devices(id) ON DELETE RESTRICT,
  terminal_serial TEXT NOT NULL,
  register_id UUID REFERENCES public.merchant_registers(id) ON DELETE SET NULL,
  provider TEXT NOT NULL REFERENCES public.merchant_payment_providers(key),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('card', 'transfer', 'any')),
  expected_amount NUMERIC(14,2) NOT NULL CHECK (expected_amount > 0),
  provider_amount BIGINT CHECK (provider_amount > 0),
  actual_amount NUMERIC(14,2) CHECK (actual_amount > 0),
  currency TEXT NOT NULL DEFAULT 'NGN' CHECK (currency = 'NGN'),
  merchant_reference TEXT NOT NULL UNIQUE
    CHECK (merchant_reference ~ '^TRKOJA-[A-Fa-f0-9]{32}-[A-Fa-f0-9]{12}$'),
  provider_reference TEXT,
  request_key UUID NOT NULL,
  environment TEXT NOT NULL CHECK (environment IN ('sandbox', 'live')),
  provider_processing_status TEXT,
  provider_response_code TEXT,
  actual_payment_method TEXT CHECK (actual_payment_method IN ('card', 'transfer')),
  status TEXT NOT NULL DEFAULT 'created'
    CHECK (status IN ('created', 'sending', 'pending', 'unresolved',
                     'successful', 'failed', 'cancelled', 'expired', 'reconciliation_required')),
  failure_code TEXT,
  initiated_by UUID NOT NULL REFERENCES public.users(id),
  initiated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ,
  last_checked_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  sale_payment_id UUID UNIQUE REFERENCES public.sale_payments(id) ON DELETE SET NULL,
  UNIQUE(org_id, request_key)
);
ALTER TABLE public.merchant_payment_attempts
  ADD CONSTRAINT merchant_attempt_store_org_fk FOREIGN KEY (store_id, org_id)
    REFERENCES public.stores(id, org_id),
  ADD CONSTRAINT merchant_attempt_sale_store_fk FOREIGN KEY (sale_id, store_id)
    REFERENCES public.sales(id, store_id),
  ADD CONSTRAINT merchant_attempt_terminal_store_fk FOREIGN KEY (terminal_id, store_id)
    REFERENCES public.devices(id, store_id),
  ADD CONSTRAINT merchant_attempt_register_store_fk FOREIGN KEY (store_id, register_id)
    REFERENCES public.merchant_registers(store_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS merchant_attempt_one_active_per_sale
  ON public.merchant_payment_attempts(sale_id)
  WHERE status IN ('created', 'sending', 'pending', 'unresolved', 'reconciliation_required');
CREATE UNIQUE INDEX IF NOT EXISTS merchant_attempt_provider_reference_unique
  ON public.merchant_payment_attempts(provider, environment, provider_reference)
  WHERE provider_reference IS NOT NULL;
CREATE INDEX IF NOT EXISTS merchant_attempts_store_time
  ON public.merchant_payment_attempts(store_id, initiated_at DESC);
CREATE INDEX IF NOT EXISTS merchant_attempts_reconciliation
  ON public.merchant_payment_attempts(status, last_checked_at)
  WHERE status IN ('sending', 'pending', 'unresolved', 'reconciliation_required');
ALTER TABLE public.merchant_payment_attempts ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.merchant_payment_attempts TO authenticated;
GRANT ALL ON public.merchant_payment_attempts TO service_role;
CREATE POLICY merchant_attempts_read ON public.merchant_payment_attempts FOR SELECT
  USING (public.user_has_permission(auth.uid(), store_id, 'sales:view')
         AND (initiated_by = auth.uid()
              OR public.user_has_permission(auth.uid(), store_id, 'sales:refund')));
REVOKE INSERT, UPDATE, DELETE ON public.merchant_payment_attempts FROM anon, authenticated;

ALTER TABLE public.sale_payments ADD COLUMN IF NOT EXISTS provider TEXT;
ALTER TABLE public.sale_payments ADD COLUMN IF NOT EXISTS merchant_attempt_id UUID UNIQUE
  REFERENCES public.merchant_payment_attempts(id) ON DELETE SET NULL;

-- The first merchant accounting journal is provider-neutral and append-only.
-- One entry per verified attempt makes repeated status checks harmless.
CREATE TABLE IF NOT EXISTS public.merchant_journal_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  sale_id UUID NOT NULL REFERENCES public.sales(id) ON DELETE RESTRICT,
  attempt_id UUID NOT NULL REFERENCES public.merchant_payment_attempts(id) ON DELETE RESTRICT,
  debit_account TEXT NOT NULL,
  credit_account TEXT NOT NULL DEFAULT 'sales_revenue',
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL DEFAULT 'NGN' CHECK (currency = 'NGN'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(attempt_id, credit_account)
);
ALTER TABLE public.merchant_journal_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY merchant_journal_read ON public.merchant_journal_entries FOR SELECT
  USING (public.user_has_permission(auth.uid(), store_id, 'sales:view'));
GRANT SELECT ON public.merchant_journal_entries TO authenticated;
GRANT ALL ON public.merchant_journal_entries TO service_role;

CREATE OR REPLACE FUNCTION public.audit_merchant_payment_attempt()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO public.audit_logs
      (actor_id, org_id, store_id, action, resource_type, resource_id, resource_name, details)
    VALUES
      (CASE WHEN TG_OP = 'INSERT' THEN NEW.initiated_by ELSE NULL END,
       NEW.org_id, NEW.store_id,
       CASE NEW.status
         WHEN 'created' THEN 'PAYMENT_INITIATED'
         WHEN 'pending' THEN 'PAYMENT_REQUEST_SENT'
         WHEN 'successful' THEN 'PAYMENT_CONFIRMED'
         WHEN 'failed' THEN 'PAYMENT_FAILED'
         WHEN 'cancelled' THEN 'PAYMENT_CANCELLED'
         ELSE 'PAYMENT_' || upper(NEW.status)
       END,
       'merchant_payment_attempt', NEW.id, NEW.merchant_reference,
       jsonb_build_object('provider', NEW.provider, 'sale_id', NEW.sale_id,
                          'terminal_id', NEW.terminal_id, 'status', NEW.status,
                          'amount', NEW.expected_amount, 'environment', NEW.environment));
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER audit_merchant_payment_attempt
  AFTER INSERT OR UPDATE OF status ON public.merchant_payment_attempts
  FOR EACH ROW EXECUTE FUNCTION public.audit_merchant_payment_attempt();

CREATE OR REPLACE FUNCTION public.audit_merchant_provider_connection()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.audit_logs
    (actor_id, org_id, action, resource_type, resource_id, resource_name, details)
  VALUES
    (NEW.updated_by, NEW.org_id,
     CASE WHEN NEW.status = 'disconnected' THEN 'MONIEPOINT_DISCONNECTED'
          ELSE 'MONIEPOINT_CONFIGURED' END,
     'merchant_provider_connection', NEW.id, NEW.provider,
     jsonb_build_object('environment', NEW.environment, 'status', NEW.status,
                        'auth_mode', NEW.auth_mode));
  RETURN NEW;
END;
$$;
CREATE TRIGGER audit_merchant_provider_connection
  AFTER INSERT OR UPDATE OF status, credential_ciphertext ON public.merchant_provider_connections
  FOR EACH ROW EXECUTE FUNCTION public.audit_merchant_provider_connection();

-- Safe, redacted provider-call diagnostics. No request bodies, credentials or
-- provider payloads are stored here. Only the service role may write/read rows.
CREATE TABLE IF NOT EXISTS public.merchant_provider_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  store_id UUID REFERENCES public.stores(id) ON DELETE SET NULL,
  attempt_id UUID REFERENCES public.merchant_payment_attempts(id) ON DELETE SET NULL,
  provider TEXT NOT NULL REFERENCES public.merchant_payment_providers(key),
  operation TEXT NOT NULL CHECK (operation IN ('authenticate', 'push', 'status')),
  outcome TEXT NOT NULL CHECK (outcome IN ('accepted', 'responded', 'pending', 'failed', 'unavailable')),
  latency_ms INTEGER NOT NULL CHECK (latency_ms BETWEEN 0 AND 120000),
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS merchant_provider_events_recent
  ON public.merchant_provider_events(provider, created_at DESC);
ALTER TABLE public.merchant_provider_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.merchant_provider_events FROM anon, authenticated;
GRANT ALL ON public.merchant_provider_events TO service_role;

-- The Push API has no documented refund endpoint. A TrackOja-only refund or
-- void would otherwise imply that Moniepoint returned money when it did not.
CREATE OR REPLACE FUNCTION public.guard_moniepoint_sale_reversal()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_TABLE_NAME = 'refunds' THEN
    IF EXISTS (SELECT 1 FROM public.sale_payments
               WHERE sale_id = NEW.sale_id AND provider = 'moniepoint') THEN
      RAISE EXCEPTION 'Moniepoint refunds must be confirmed outside TrackOja before they can be recorded';
    END IF;
  ELSIF OLD.status = 'completed' AND NEW.status = 'voided' THEN
    IF EXISTS (SELECT 1 FROM public.sale_payments
               WHERE sale_id = OLD.id AND provider = 'moniepoint') THEN
      RAISE EXCEPTION 'A paid Moniepoint sale cannot be voided without payment reconciliation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER guard_moniepoint_refund BEFORE INSERT ON public.refunds
  FOR EACH ROW EXECUTE FUNCTION public.guard_moniepoint_sale_reversal();
CREATE TRIGGER guard_moniepoint_void BEFORE UPDATE OF status ON public.sales
  FOR EACH ROW EXECUTE FUNCTION public.guard_moniepoint_sale_reversal();
