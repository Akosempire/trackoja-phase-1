-- Migration: 063_platform_products_schema.sql
-- Description: Multi-product platform catalogue. TrackOja and TrackOja Works are
--   modelled as separate products, each owning its own plans, pricing, user
--   limits, features, and access settings. A business gains access to a product
--   through organization_products - one row per (organization, product) - so a
--   subscription to one product never unlocks another.
--   Prices live on product_plans and every edit is journalled to
--   product_plan_revisions; agreed prices are snapshotted onto
--   organization_products so later price changes never alter an existing deal.
-- Author: TrackOja Team
-- Date: 2026-09-26

-- ============================================================
-- PLATFORM PRODUCTS
-- ============================================================

CREATE TABLE IF NOT EXISTS public.platform_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  tagline TEXT,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive', 'internal')),
  visibility TEXT NOT NULL DEFAULT 'public'
    CHECK (visibility IN ('public', 'private', 'hidden')),
  features JSONB NOT NULL DEFAULT '[]'::jsonb,
  onboarding_note TEXT,
  access_settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_products_status ON public.platform_products(status);
CREATE INDEX IF NOT EXISTS idx_platform_products_sort ON public.platform_products(sort_order);

COMMENT ON COLUMN public.platform_products.key IS
  'Stable machine key (trackoja, trackoja_works). Never reused once assigned.';
COMMENT ON COLUMN public.platform_products.visibility IS
  'public = advertised publicly, private = sold by sales only, hidden = not offered.';
COMMENT ON COLUMN public.platform_products.features IS
  'Product feature catalogue: jsonb array of {key, label, upcoming}. Plans select from these keys.';
COMMENT ON COLUMN public.platform_products.access_settings IS
  'Access policy: {requires_verified_payment, requires_activation_key, self_serve, trial_days}.';

-- ============================================================
-- PRODUCT PLANS
-- ============================================================

CREATE TABLE IF NOT EXISTS public.product_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.platform_products(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  monthly_price NUMERIC(14,2) CHECK (monthly_price IS NULL OR monthly_price >= 0),
  annual_price NUMERIC(14,2) CHECK (annual_price IS NULL OR annual_price >= 0),
  currency TEXT NOT NULL DEFAULT 'NGN',
  user_limit INTEGER,
  features JSONB NOT NULL DEFAULT '[]'::jsonb,
  onboarding_note TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive', 'draft', 'retired')),
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  is_public BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES public.users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE (product_id, key)
);

CREATE INDEX IF NOT EXISTS idx_product_plans_product ON public.product_plans(product_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_product_plans_status ON public.product_plans(status);

COMMENT ON COLUMN public.product_plans.monthly_price IS
  'NULL means custom/negotiated pricing (Enterprise).';
COMMENT ON COLUMN public.product_plans.user_limit IS
  'Billable seats. -1 = unlimited, NULL = custom, positive = hard cap enforced per subscription.';
COMMENT ON COLUMN public.product_plans.features IS
  'Plan feature list: jsonb array of {key, label, upcoming}.';
COMMENT ON COLUMN public.product_plans.status IS
  'retired keeps the row for existing subscribers but blocks new signups.';

-- ============================================================
-- PLAN REVISION HISTORY
-- ============================================================

CREATE TABLE IF NOT EXISTS public.product_plan_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES public.product_plans(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.platform_products(id) ON DELETE CASCADE,
  changed_by UUID NOT NULL REFERENCES public.users(id),
  change_type TEXT NOT NULL
    CHECK (change_type IN ('created', 'updated', 'published', 'retired')),
  previous_values JSONB,
  new_values JSONB,
  note TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_plan_revisions_plan ON public.product_plan_revisions(plan_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_plan_revisions_product ON public.product_plan_revisions(product_id, created_at DESC);

COMMENT ON TABLE public.product_plan_revisions IS
  'Append-only journal of every plan change so pricing history is auditable.';

-- ============================================================
-- BUSINESS PRODUCT ENTITLEMENTS
-- ============================================================

CREATE TABLE IF NOT EXISTS public.organization_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.platform_products(id) ON DELETE RESTRICT,
  plan_id UUID REFERENCES public.product_plans(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'past_due', 'suspended', 'expired', 'cancelled')),
  source TEXT NOT NULL DEFAULT 'payment'
    CHECK (source IN ('payment', 'activation_key', 'manual', 'trial')),
  agreed_monthly_price NUMERIC(14,2),
  agreed_annual_price NUMERIC(14,2),
  agreed_user_limit INTEGER,
  currency TEXT NOT NULL DEFAULT 'NGN',
  trial_ends_at TIMESTAMP WITH TIME ZONE,
  activated_at TIMESTAMP WITH TIME ZONE,
  expires_at TIMESTAMP WITH TIME ZONE,
  cancelled_at TIMESTAMP WITH TIME ZONE,
  is_sandbox BOOLEAN NOT NULL DEFAULT FALSE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE (org_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_org_products_org ON public.organization_products(org_id);
CREATE INDEX IF NOT EXISTS idx_org_products_product ON public.organization_products(product_id, status);
CREATE INDEX IF NOT EXISTS idx_org_products_status ON public.organization_products(status);
CREATE INDEX IF NOT EXISTS idx_org_products_expiry ON public.organization_products(expires_at)
  WHERE status IN ('active', 'pending');
CREATE INDEX IF NOT EXISTS idx_org_products_sandbox ON public.organization_products(is_sandbox);

COMMENT ON TABLE public.organization_products IS
  'One row per business per product. This is the entitlement boundary: a TrackOja '
  'subscription creates only the trackoja row and cannot unlock TrackOja Works.';
COMMENT ON COLUMN public.organization_products.agreed_monthly_price IS
  'Price agreed at activation. Snapshotted so later plan price edits do not change an existing deal.';
COMMENT ON COLUMN public.organization_products.agreed_user_limit IS
  'Seat limit agreed at activation, enforced when inviting staff.';
COMMENT ON COLUMN public.organization_products.is_sandbox IS
  'Test record. Excluded from production revenue reporting and from real customer counts.';

-- ============================================================
-- UPDATED_AT TRIGGERS
-- ============================================================

DROP TRIGGER IF EXISTS handle_updated_at_platform_products ON public.platform_products;
CREATE TRIGGER handle_updated_at_platform_products BEFORE UPDATE ON public.platform_products
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS handle_updated_at_product_plans ON public.product_plans;
CREATE TRIGGER handle_updated_at_product_plans BEFORE UPDATE ON public.product_plans
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS handle_updated_at_organization_products ON public.organization_products;
CREATE TRIGGER handle_updated_at_organization_products BEFORE UPDATE ON public.organization_products
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE public.platform_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_plan_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_products ENABLE ROW LEVEL SECURITY;

-- The catalogue is readable by any signed-in user so the billing screen can list
-- plans; writes are function-only (no INSERT/UPDATE/DELETE policies anywhere).
CREATE POLICY platform_products_select ON public.platform_products
  FOR SELECT TO authenticated
  USING (status <> 'internal' OR public.is_platform_admin(auth.uid()));

CREATE POLICY product_plans_select ON public.product_plans
  FOR SELECT TO authenticated
  USING (status IN ('active', 'retired') OR public.is_platform_admin(auth.uid()));

-- A business only ever sees its own entitlements.
CREATE POLICY organization_products_select ON public.organization_products
  FOR SELECT TO authenticated
  USING (
    org_id IN (SELECT public.get_user_org_ids(auth.uid()))
    OR public.is_platform_admin(auth.uid())
  );

-- Pricing history is platform-admin only.
CREATE POLICY product_plan_revisions_select ON public.product_plan_revisions
  FOR SELECT TO authenticated
  USING (public.is_platform_admin(auth.uid()));
