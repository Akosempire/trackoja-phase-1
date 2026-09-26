-- Migration: 064_platform_activation_keys_schema.sql
-- Description: Activation keys for offline or manually approved purchases. A key
--   is bound to one business, product, plan, payment reference, and validity
--   period, and every issuance, redemption, expiry, and revocation is journalled.
-- Author: TrackOja Team
-- Date: 2026-09-26

-- ============================================================
-- ACTIVATION KEYS
-- ============================================================

CREATE TABLE IF NOT EXISTS public.activation_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key_code TEXT NOT NULL UNIQUE,
  product_id UUID NOT NULL REFERENCES public.platform_products(id) ON DELETE RESTRICT,
  plan_id UUID REFERENCES public.product_plans(id) ON DELETE SET NULL,
  org_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
  bound_email TEXT,
  status TEXT NOT NULL DEFAULT 'issued'
    CHECK (status IN ('issued', 'redeemed', 'expired', 'revoked')),
  valid_from TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  valid_until TIMESTAMP WITH TIME ZONE,
  user_limit INTEGER,
  currency TEXT NOT NULL DEFAULT 'NGN',
  payment_reference TEXT,
  subscription_transaction_id UUID REFERENCES public.subscription_transactions(id) ON DELETE SET NULL,
  issued_by UUID NOT NULL REFERENCES public.users(id),
  issued_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  redeemed_at TIMESTAMP WITH TIME ZONE,
  redeemed_by UUID REFERENCES public.users(id),
  revoked_at TIMESTAMP WITH TIME ZONE,
  revoked_by UUID REFERENCES public.users(id),
  revoke_reason TEXT,
  is_sandbox BOOLEAN NOT NULL DEFAULT FALSE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_activation_keys_product ON public.activation_keys(product_id, status);
CREATE INDEX IF NOT EXISTS idx_activation_keys_org ON public.activation_keys(org_id);
CREATE INDEX IF NOT EXISTS idx_activation_keys_status ON public.activation_keys(status);
CREATE INDEX IF NOT EXISTS idx_activation_keys_sandbox ON public.activation_keys(is_sandbox);

COMMENT ON COLUMN public.activation_keys.key_code IS
  'Opaque redemption code. Generated server-side; never guessable from the product or org.';
COMMENT ON COLUMN public.activation_keys.org_id IS
  'Bound business. NULL means the key is unbound and can be redeemed once by any business.';
COMMENT ON COLUMN public.activation_keys.user_limit IS
  'Seat limit captured when the key was issued, so a later plan edit cannot widen it.';
COMMENT ON COLUMN public.activation_keys.is_sandbox IS
  'Test key. Can only activate sandbox businesses and never counts towards revenue.';

-- ============================================================
-- ACTIVATION KEY EVENTS
-- ============================================================

CREATE TABLE IF NOT EXISTS public.activation_key_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key_id UUID NOT NULL REFERENCES public.activation_keys(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL
    CHECK (event_type IN ('issued', 'redeemed', 'expired', 'revoked', 'validity_extended')),
  actor_id UUID REFERENCES public.users(id),
  note TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_activation_key_events_key
  ON public.activation_key_events(key_id, created_at DESC);

COMMENT ON TABLE public.activation_key_events IS
  'Append-only lifecycle journal for activation keys (issuance, redemption, expiry, revocation).';

-- ============================================================
-- UPDATED_AT TRIGGERS
-- ============================================================

DROP TRIGGER IF EXISTS handle_updated_at_activation_keys ON public.activation_keys;
CREATE TRIGGER handle_updated_at_activation_keys BEFORE UPDATE ON public.activation_keys
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE public.activation_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activation_key_events ENABLE ROW LEVEL SECURITY;

-- Keys are never client-readable, not even by their own business: redemption and
-- inspection both go through SECURITY DEFINER functions that redact the code.
CREATE POLICY activation_keys_select ON public.activation_keys
  FOR SELECT TO authenticated
  USING (public.is_platform_admin(auth.uid()));

CREATE POLICY activation_key_events_select ON public.activation_key_events
  FOR SELECT TO authenticated
  USING (public.is_platform_admin(auth.uid()));
