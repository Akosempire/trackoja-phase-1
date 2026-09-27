-- Migration: 084_tailoring_jobs.sql
-- Description: Tailoring jobs for tailors and fashion designers. Nothing exists for
--   this today, so a tailor is forced through "product -> checkout -> sale", which
--   is not what they do: a job has a client, measurements, a fitting, a deposit, a
--   balance, a due date, and a production status.
--
--   Three decisions matter here:
--     - Measurements are SNAPSHOT per job. Editing a client's measurements later
--       must not silently change what an old job was cut to.
--     - Status transitions are data, not code: tailoring_job_transitions holds what
--       is permitted, including the permitted backward moves that require a reason
--       (a garment really does go back for alterations).
--     - Price, deposit and payments are separate, so "balance outstanding" is
--       computed rather than stored and cannot drift.
-- Author: TrackOja Team
-- Date: 2026-09-26

-- ============================================================
-- TRANSITION RULES
-- ============================================================

CREATE TABLE IF NOT EXISTS public.tailoring_job_transitions (
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  requires_reason BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (from_status, to_status)
);

COMMENT ON TABLE public.tailoring_job_transitions IS
  'Permitted job status moves. Data rather than code so the rule is inspectable and testable, '
  'and so a permitted backward move can require a reason.';

INSERT INTO public.tailoring_job_transitions (from_status, to_status, requires_reason) VALUES
  ('received',         'in_progress',       FALSE),
  ('received',         'cancelled',         TRUE),
  ('in_progress',      'ready_for_fitting', FALSE),
  ('in_progress',      'received',          TRUE),   -- work restarted from scratch
  ('in_progress',      'cancelled',         TRUE),
  ('ready_for_fitting','alterations',       FALSE),
  ('ready_for_fitting','ready_for_pickup',  FALSE),
  ('ready_for_fitting','in_progress',       TRUE),   -- sent back to production
  ('ready_for_fitting','cancelled',         TRUE),
  ('alterations',      'ready_for_fitting', TRUE),   -- re-fit after alterations
  ('alterations',      'ready_for_pickup',  FALSE),
  ('alterations',      'cancelled',         TRUE),
  ('ready_for_pickup', 'delivered',         FALSE),
  ('ready_for_pickup', 'alterations',       TRUE)    -- client wants a change at collection
ON CONFLICT (from_status, to_status) DO NOTHING;

-- ============================================================
-- JOBS
-- ============================================================

CREATE TABLE IF NOT EXISTS public.tailoring_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  job_number INTEGER NOT NULL,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  -- Snapshotted so the job still names its client if the customer record is removed.
  customer_name TEXT,
  customer_phone TEXT,
  garment_type TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  design_notes TEXT,
  reference_images JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- A client may supply their own fabric, in which case business stock is untouched.
  fabric_supplied_by TEXT NOT NULL DEFAULT 'business'
    CHECK (fabric_supplied_by IN ('business', 'client')),
  materials_notes TEXT,
  price NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (price >= 0),
  deposit NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (deposit >= 0),
  due_date DATE,
  assigned_to UUID REFERENCES public.users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'received'
    CHECK (status IN ('received', 'in_progress', 'ready_for_fitting', 'alterations',
                      'ready_for_pickup', 'delivered', 'cancelled')),
  delivered_at TIMESTAMP WITH TIME ZONE,
  created_by UUID NOT NULL REFERENCES public.users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE (store_id, job_number),
  CONSTRAINT tailoring_jobs_deposit_within_price CHECK (deposit <= price)
);

CREATE INDEX IF NOT EXISTS idx_tailoring_jobs_store_status ON public.tailoring_jobs(store_id, status);
CREATE INDEX IF NOT EXISTS idx_tailoring_jobs_due ON public.tailoring_jobs(store_id, due_date)
  WHERE status NOT IN ('delivered', 'cancelled');
CREATE INDEX IF NOT EXISTS idx_tailoring_jobs_customer ON public.tailoring_jobs(customer_id)
  WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tailoring_jobs_assigned ON public.tailoring_jobs(assigned_to)
  WHERE assigned_to IS NOT NULL;

COMMENT ON COLUMN public.tailoring_jobs.deposit IS
  'Deposit taken at booking. Balance is computed from price minus deposit minus recorded payments, never stored.';

CREATE TABLE IF NOT EXISTS public.tailoring_job_measurements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES public.tailoring_jobs(id) ON DELETE CASCADE,
  measured_on DATE NOT NULL DEFAULT current_date,
  taken_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  values JSONB NOT NULL DEFAULT '{}'::jsonb,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tailoring_measurements_job ON public.tailoring_job_measurements(job_id);

COMMENT ON TABLE public.tailoring_job_measurements IS
  'Measurements as taken for THIS job (values: {"chest": 40, "waist": 34}). A snapshot, not a '
  'reference to the client, so editing a client later cannot change what a job was cut to.';

CREATE TABLE IF NOT EXISTS public.tailoring_job_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES public.tailoring_jobs(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT NOT NULL,
  reason TEXT,
  changed_by UUID NOT NULL REFERENCES public.users(id),
  changed_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tailoring_status_history_job
  ON public.tailoring_job_status_history(job_id, changed_at DESC);

CREATE TABLE IF NOT EXISTS public.tailoring_fittings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES public.tailoring_jobs(id) ON DELETE CASCADE,
  scheduled_at TIMESTAMP WITH TIME ZONE NOT NULL,
  completed_at TIMESTAMP WITH TIME ZONE,
  outcome TEXT CHECK (outcome IS NULL OR outcome IN ('pending', 'approved', 'altered')),
  notes TEXT,
  created_by UUID NOT NULL REFERENCES public.users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tailoring_fittings_job ON public.tailoring_fittings(job_id);
CREATE INDEX IF NOT EXISTS idx_tailoring_fittings_upcoming ON public.tailoring_fittings(scheduled_at)
  WHERE completed_at IS NULL;

CREATE TABLE IF NOT EXISTS public.tailoring_job_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES public.tailoring_jobs(id) ON DELETE CASCADE,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  method TEXT NOT NULL CHECK (method IN ('cash', 'transfer', 'card', 'credit', 'other')),
  reference TEXT,
  received_by UUID NOT NULL REFERENCES public.users(id),
  received_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tailoring_payments_job ON public.tailoring_job_payments(job_id);

-- ============================================================
-- PERMISSIONS
-- ============================================================

INSERT INTO public.permissions (name, resource, action, description, category) VALUES
  ('job:view',   'tailoring_jobs', 'read',   'View tailoring jobs, clients and fittings', 'tailoring'),
  ('job:create', 'tailoring_jobs', 'create', 'Create a tailoring job and record a deposit', 'tailoring'),
  ('job:update', 'tailoring_jobs', 'update', 'Update job status, fittings and measurements', 'tailoring')
ON CONFLICT (name) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.roles r
JOIN public.permissions p ON TRUE
WHERE r.name IN ('owner', 'manager') AND r.is_system = TRUE
  AND p.name IN ('job:view', 'job:create', 'job:update')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- A cashier books jobs in and takes deposits, but does not run production.
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.roles r
JOIN public.permissions p ON TRUE
WHERE r.name = 'cashier' AND r.is_system = TRUE
  AND p.name IN ('job:view', 'job:create')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ============================================================
-- TRIGGERS AND RLS
-- ============================================================

DROP TRIGGER IF EXISTS handle_updated_at_tailoring_jobs ON public.tailoring_jobs;
CREATE TRIGGER handle_updated_at_tailoring_jobs BEFORE UPDATE ON public.tailoring_jobs
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE public.tailoring_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tailoring_job_measurements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tailoring_job_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tailoring_fittings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tailoring_job_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tailoring_job_transitions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tailoring_jobs_select ON public.tailoring_jobs;
CREATE POLICY tailoring_jobs_select ON public.tailoring_jobs
  FOR SELECT TO authenticated
  USING (
    store_id IN (SELECT public.get_user_active_store_ids(auth.uid()))
    AND public.user_has_permission(auth.uid(), store_id, 'job:view')
  );

DROP POLICY IF EXISTS tailoring_job_transitions_select ON public.tailoring_job_transitions;
CREATE POLICY tailoring_job_transitions_select ON public.tailoring_job_transitions
  FOR SELECT TO authenticated USING (TRUE);

-- Child tables follow the parent job's visibility.
DROP POLICY IF EXISTS tailoring_measurements_select ON public.tailoring_job_measurements;
CREATE POLICY tailoring_measurements_select ON public.tailoring_job_measurements
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.tailoring_jobs j WHERE j.id = job_id
      AND j.store_id IN (SELECT public.get_user_active_store_ids(auth.uid()))
      AND public.user_has_permission(auth.uid(), j.store_id, 'job:view')
  ));

DROP POLICY IF EXISTS tailoring_status_history_select ON public.tailoring_job_status_history;
CREATE POLICY tailoring_status_history_select ON public.tailoring_job_status_history
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.tailoring_jobs j WHERE j.id = job_id
      AND j.store_id IN (SELECT public.get_user_active_store_ids(auth.uid()))
      AND public.user_has_permission(auth.uid(), j.store_id, 'job:view')
  ));

DROP POLICY IF EXISTS tailoring_fittings_select ON public.tailoring_fittings;
CREATE POLICY tailoring_fittings_select ON public.tailoring_fittings
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.tailoring_jobs j WHERE j.id = job_id
      AND j.store_id IN (SELECT public.get_user_active_store_ids(auth.uid()))
      AND public.user_has_permission(auth.uid(), j.store_id, 'job:view')
  ));

DROP POLICY IF EXISTS tailoring_payments_select ON public.tailoring_job_payments;
CREATE POLICY tailoring_payments_select ON public.tailoring_job_payments
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.tailoring_jobs j WHERE j.id = job_id
      AND j.store_id IN (SELECT public.get_user_active_store_ids(auth.uid()))
      AND public.user_has_permission(auth.uid(), j.store_id, 'job:view')
  ));
