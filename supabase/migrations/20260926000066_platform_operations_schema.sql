-- Migration: 066_platform_operations_schema.sql
-- Description: Platform operations surface: support notes and admin actions,
--   authorised subscription adjustments (renewals, upgrades, downgrades, expiry
--   changes, manual activations), non-secret platform settings, and notification
--   templates. Credentials and secret keys are never stored here - settings hold
--   references to server-side secrets only.
-- Author: TrackOja Team
-- Date: 2026-09-26

-- ============================================================
-- SUPPORT NOTES AND ADMIN ACTIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS public.platform_support_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  product_id UUID REFERENCES public.platform_products(id) ON DELETE SET NULL,
  admin_user_id UUID NOT NULL REFERENCES public.users(id),
  note_type TEXT NOT NULL DEFAULT 'note'
    CHECK (note_type IN ('note', 'support_action', 'suspension', 'reinstatement',
                         'manual_activation', 'pricing_change', 'contact', 'developer_test')),
  body TEXT NOT NULL,
  is_sandbox BOOLEAN NOT NULL DEFAULT FALSE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_support_notes_org ON public.platform_support_notes(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_notes_admin ON public.platform_support_notes(admin_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_notes_type ON public.platform_support_notes(note_type);

COMMENT ON TABLE public.platform_support_notes IS
  'Append-only record of support contact, suspensions, manual activations, and pricing changes, with the acting admin.';

-- ============================================================
-- SUBSCRIPTION ADJUSTMENTS
-- ============================================================

CREATE TABLE IF NOT EXISTS public.subscription_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  organization_product_id UUID REFERENCES public.organization_products(id) ON DELETE CASCADE,
  product_id UUID REFERENCES public.platform_products(id) ON DELETE SET NULL,
  adjustment_type TEXT NOT NULL
    CHECK (adjustment_type IN ('extend_expiry', 'shorten_expiry', 'change_plan', 'upgrade',
                               'downgrade', 'suspend', 'reinstate', 'cancel', 'reactivate',
                               'manual_activation', 'manual_price', 'seat_change')),
  previous_values JSONB,
  new_values JSONB,
  reason TEXT NOT NULL,
  performed_by UUID NOT NULL REFERENCES public.users(id),
  is_sandbox BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subscription_adjustments_org
  ON public.subscription_adjustments(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_subscription_adjustments_op
  ON public.subscription_adjustments(adjustment_type, created_at DESC);

COMMENT ON TABLE public.subscription_adjustments IS
  'Every authorised manual change to a subscription, with previous and new values and a mandatory reason.';

-- ============================================================
-- PLATFORM SETTINGS
-- ============================================================

CREATE TABLE IF NOT EXISTS public.platform_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  description TEXT,
  category TEXT NOT NULL DEFAULT 'general'
    CHECK (category IN ('general', 'payments', 'products', 'activation', 'notifications', 'developer')),
  updated_by UUID REFERENCES public.users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

COMMENT ON TABLE public.platform_settings IS
  'Non-secret platform configuration. Payment credentials and secret keys stay in server-side '
  'environment/secrets storage; rows here reference them by name only.';

-- ============================================================
-- NOTIFICATION TEMPLATES
-- ============================================================

CREATE TABLE IF NOT EXISTS public.notification_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'email'
    CHECK (channel IN ('email', 'sms', 'in_app')),
  subject TEXT,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive')),
  updated_by UUID REFERENCES public.users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notification_templates_channel ON public.notification_templates(channel, status);

-- ============================================================
-- UPDATED_AT TRIGGERS
-- ============================================================

DROP TRIGGER IF EXISTS handle_updated_at_platform_settings ON public.platform_settings;
CREATE TRIGGER handle_updated_at_platform_settings BEFORE UPDATE ON public.platform_settings
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS handle_updated_at_notification_templates ON public.notification_templates;
CREATE TRIGGER handle_updated_at_notification_templates BEFORE UPDATE ON public.notification_templates
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE public.platform_support_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY platform_support_notes_select ON public.platform_support_notes
  FOR SELECT TO authenticated
  USING (public.is_platform_admin(auth.uid()));

-- A business may see the adjustments made to its own subscription.
CREATE POLICY subscription_adjustments_select ON public.subscription_adjustments
  FOR SELECT TO authenticated
  USING (
    org_id IN (SELECT public.get_user_org_ids(auth.uid()))
    OR public.is_platform_admin(auth.uid())
  );

CREATE POLICY platform_settings_select ON public.platform_settings
  FOR SELECT TO authenticated
  USING (public.is_platform_admin(auth.uid()));

CREATE POLICY notification_templates_select ON public.notification_templates
  FOR SELECT TO authenticated
  USING (public.is_platform_admin(auth.uid()));
