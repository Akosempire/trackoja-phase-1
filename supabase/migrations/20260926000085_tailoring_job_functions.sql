-- Migration: 085_tailoring_job_functions.sql
-- Description: Tailoring job operations. Sequential job numbers per store, snapshot
--   measurements at creation, status changes validated against
--   tailoring_job_transitions with a reason where the rule requires one, fittings,
--   payments, and the queries the tailoring dashboard needs.
-- Author: TrackOja Team
-- Date: 2026-09-26

-- Per-store counter, the same approach used for sequential sale numbers.
CREATE TABLE IF NOT EXISTS public.tailoring_job_counters (
  store_id UUID PRIMARY KEY REFERENCES public.stores(id) ON DELETE CASCADE,
  next_number INTEGER NOT NULL DEFAULT 1
);

ALTER TABLE public.tailoring_job_counters ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- CREATE A JOB
-- ============================================================
-- p_measurements: jsonb object of measurement values, snapshotted onto the job.

CREATE OR REPLACE FUNCTION public.create_tailoring_job(
  p_store_id UUID,
  p_garment_type TEXT,
  p_customer_id UUID DEFAULT NULL,
  p_customer_name TEXT DEFAULT NULL,
  p_customer_phone TEXT DEFAULT NULL,
  p_quantity INTEGER DEFAULT 1,
  p_price NUMERIC DEFAULT 0,
  p_deposit NUMERIC DEFAULT 0,
  p_due_date DATE DEFAULT NULL,
  p_fabric_supplied_by TEXT DEFAULT 'business',
  p_design_notes TEXT DEFAULT NULL,
  p_materials_notes TEXT DEFAULT NULL,
  p_assigned_to UUID DEFAULT NULL,
  p_measurements JSONB DEFAULT NULL,
  p_measurement_notes TEXT DEFAULT NULL
)
RETURNS public.tailoring_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_number INTEGER;
  v_job public.tailoring_jobs;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF NOT public.user_has_permission(v_actor, p_store_id, 'job:create') THEN
    RAISE EXCEPTION 'Permission denied: job:create required';
  END IF;
  IF p_garment_type IS NULL OR length(trim(p_garment_type)) = 0 THEN
    RAISE EXCEPTION 'Say what is being made';
  END IF;
  IF p_price < 0 OR p_deposit < 0 THEN
    RAISE EXCEPTION 'Price and deposit cannot be negative';
  END IF;
  IF p_deposit > p_price THEN
    RAISE EXCEPTION 'A deposit cannot be more than the agreed price';
  END IF;
  IF p_fabric_supplied_by NOT IN ('business', 'client') THEN
    RAISE EXCEPTION 'Fabric is either supplied by the business or the client';
  END IF;

  -- A client must belong to this store, otherwise a job could name someone else's.
  IF p_customer_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.customers c WHERE c.id = p_customer_id AND c.store_id = p_store_id
  ) THEN
    RAISE EXCEPTION 'That client belongs to a different store';
  END IF;

  INSERT INTO public.tailoring_job_counters (store_id, next_number)
  VALUES (p_store_id, 2)
  ON CONFLICT (store_id) DO UPDATE SET next_number = public.tailoring_job_counters.next_number + 1
  RETURNING next_number - 1 INTO v_number;

  INSERT INTO public.tailoring_jobs (
    store_id, job_number, customer_id, customer_name, customer_phone, garment_type,
    quantity, design_notes, fabric_supplied_by, materials_notes, price, deposit,
    due_date, assigned_to, created_by
  ) VALUES (
    p_store_id, v_number, p_customer_id, p_customer_name, p_customer_phone, trim(p_garment_type),
    COALESCE(p_quantity, 1), p_design_notes, p_fabric_supplied_by, p_materials_notes,
    round(COALESCE(p_price, 0), 2), round(COALESCE(p_deposit, 0), 2),
    p_due_date, p_assigned_to, v_actor
  )
  RETURNING * INTO v_job;

  -- The measurements are copied onto the job, not referenced, so later edits to the
  -- client's measurements cannot change what this job was cut to.
  IF p_measurements IS NOT NULL AND jsonb_typeof(p_measurements) = 'object' THEN
    INSERT INTO public.tailoring_job_measurements (job_id, taken_by, values, notes)
    VALUES (v_job.id, v_actor, p_measurements, p_measurement_notes);
  END IF;

  INSERT INTO public.tailoring_job_status_history (job_id, from_status, to_status, reason, changed_by)
  VALUES (v_job.id, NULL, 'received', 'Job created', v_actor);

  -- The deposit is a real payment, recorded so the balance is computed, not stored.
  IF COALESCE(p_deposit, 0) > 0 THEN
    INSERT INTO public.tailoring_job_payments (job_id, amount, method, reference, received_by)
    VALUES (v_job.id, round(p_deposit, 2), 'cash', 'Deposit at booking', v_actor);
  END IF;

  INSERT INTO public.audit_logs (actor_id, store_id, action, resource_type, resource_id, status, details)
  VALUES (v_actor, p_store_id, 'TAILORING_JOB_CREATED', 'tailoring_job', v_job.id, 'success',
          jsonb_build_object('job_number', v_number, 'garment', v_job.garment_type,
                             'price', v_job.price, 'deposit', v_job.deposit));

  RETURN v_job;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_tailoring_job(UUID, TEXT, UUID, TEXT, TEXT, INTEGER, NUMERIC, NUMERIC, DATE, TEXT, TEXT, TEXT, UUID, JSONB, TEXT) TO authenticated;

-- ============================================================
-- CHANGE STATUS
-- ============================================================
-- Validated against tailoring_job_transitions. A move flagged requires_reason is
-- refused without one, which is how a permitted backward move stays auditable.

CREATE OR REPLACE FUNCTION public.update_job_status(
  p_job_id UUID,
  p_new_status TEXT,
  p_reason TEXT DEFAULT NULL
)
RETURNS public.tailoring_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_job public.tailoring_jobs;
  v_rule public.tailoring_job_transitions;
BEGIN
  SELECT * INTO v_job FROM public.tailoring_jobs WHERE id = p_job_id FOR UPDATE;
  IF v_job.id IS NULL THEN
    RAISE EXCEPTION 'Job not found';
  END IF;
  IF NOT public.user_has_permission(v_actor, v_job.store_id, 'job:update') THEN
    RAISE EXCEPTION 'Permission denied: job:update required';
  END IF;
  IF v_job.status = p_new_status THEN
    RAISE EXCEPTION 'This job is already %', replace(p_new_status, '_', ' ');
  END IF;

  SELECT * INTO v_rule FROM public.tailoring_job_transitions
  WHERE from_status = v_job.status AND to_status = p_new_status;

  IF v_rule.from_status IS NULL THEN
    RAISE EXCEPTION 'A job cannot go from % to %',
      replace(v_job.status, '_', ' '), replace(p_new_status, '_', ' ');
  END IF;
  IF v_rule.requires_reason AND (p_reason IS NULL OR length(trim(p_reason)) < 3) THEN
    RAISE EXCEPTION 'Moving a job back to % needs a reason', replace(p_new_status, '_', ' ');
  END IF;

  UPDATE public.tailoring_jobs
  SET status = p_new_status,
      delivered_at = CASE WHEN p_new_status = 'delivered' THEN now() ELSE delivered_at END,
      updated_at = now()
  WHERE id = p_job_id
  RETURNING * INTO v_job;

  INSERT INTO public.tailoring_job_status_history (job_id, from_status, to_status, reason, changed_by)
  VALUES (p_job_id, v_rule.from_status, p_new_status, p_reason, v_actor);

  INSERT INTO public.audit_logs (actor_id, store_id, action, resource_type, resource_id, status, details)
  VALUES (v_actor, v_job.store_id, 'TAILORING_JOB_STATUS_CHANGED', 'tailoring_job', p_job_id, 'success',
          jsonb_build_object('from', v_rule.from_status, 'to', p_new_status, 'reason', p_reason));

  RETURN v_job;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_job_status(UUID, TEXT, TEXT) TO authenticated;

-- ============================================================
-- FITTINGS AND PAYMENTS
-- ============================================================

CREATE OR REPLACE FUNCTION public.schedule_fitting(
  p_job_id UUID,
  p_scheduled_at TIMESTAMP WITH TIME ZONE,
  p_notes TEXT DEFAULT NULL
)
RETURNS public.tailoring_fittings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_job public.tailoring_jobs;
  v_row public.tailoring_fittings;
BEGIN
  SELECT * INTO v_job FROM public.tailoring_jobs WHERE id = p_job_id;
  IF v_job.id IS NULL THEN
    RAISE EXCEPTION 'Job not found';
  END IF;
  IF NOT public.user_has_permission(v_actor, v_job.store_id, 'job:update') THEN
    RAISE EXCEPTION 'Permission denied: job:update required';
  END IF;
  IF p_scheduled_at IS NULL THEN
    RAISE EXCEPTION 'A fitting needs a date and time';
  END IF;

  INSERT INTO public.tailoring_fittings (job_id, scheduled_at, notes, created_by)
  VALUES (p_job_id, p_scheduled_at, p_notes, v_actor)
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.schedule_fitting(UUID, TIMESTAMP WITH TIME ZONE, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.record_job_payment(
  p_job_id UUID,
  p_amount NUMERIC,
  p_method TEXT DEFAULT 'cash',
  p_reference TEXT DEFAULT NULL
)
RETURNS public.tailoring_job_payments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_job public.tailoring_jobs;
  v_paid NUMERIC;
  v_row public.tailoring_job_payments;
BEGIN
  SELECT * INTO v_job FROM public.tailoring_jobs WHERE id = p_job_id;
  IF v_job.id IS NULL THEN
    RAISE EXCEPTION 'Job not found';
  END IF;
  IF NOT public.user_has_permission(v_actor, v_job.store_id, 'job:create') THEN
    RAISE EXCEPTION 'Permission denied: job:create required';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'A payment must be greater than zero';
  END IF;
  IF p_method NOT IN ('cash', 'transfer', 'card', 'credit', 'other') THEN
    RAISE EXCEPTION 'Unknown payment method: %', p_method;
  END IF;
  IF v_job.status = 'cancelled' THEN
    RAISE EXCEPTION 'This job was cancelled';
  END IF;

  SELECT COALESCE(SUM(p.amount), 0) INTO v_paid
  FROM public.tailoring_job_payments p WHERE p.job_id = p_job_id;

  -- Overpaying is refused rather than silently creating a credit.
  IF v_paid + p_amount > v_job.price THEN
    RAISE EXCEPTION 'That is more than the outstanding balance of %',
      round(v_job.price - v_paid, 2);
  END IF;

  INSERT INTO public.tailoring_job_payments (job_id, amount, method, reference, received_by)
  VALUES (p_job_id, round(p_amount, 2), p_method, p_reference, v_actor)
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_job_payment(UUID, NUMERIC, TEXT, TEXT) TO authenticated;

-- ============================================================
-- QUERIES
-- ============================================================

CREATE OR REPLACE FUNCTION public.list_tailoring_jobs(
  p_store_id UUID,
  p_status TEXT DEFAULT NULL,
  p_due_within_days INTEGER DEFAULT NULL,
  p_open_only BOOLEAN DEFAULT TRUE,
  p_limit INTEGER DEFAULT 100
)
RETURNS TABLE (
  id UUID,
  job_number INTEGER,
  garment_type TEXT,
  quantity INTEGER,
  customer_id UUID,
  customer_name TEXT,
  status TEXT,
  price NUMERIC,
  paid NUMERIC,
  balance NUMERIC,
  due_date DATE,
  days_until_due INTEGER,
  assigned_to UUID,
  assigned_email TEXT,
  next_fitting_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  IF NOT public.user_has_permission(auth.uid(), p_store_id, 'job:view') THEN
    RAISE EXCEPTION 'Permission denied: job:view required';
  END IF;

  RETURN QUERY
  SELECT j.id, j.job_number, j.garment_type, j.quantity, j.customer_id, j.customer_name,
         j.status, j.price,
         COALESCE((SELECT SUM(p.amount) FROM public.tailoring_job_payments p WHERE p.job_id = j.id), 0)::NUMERIC,
         (j.price - COALESCE((SELECT SUM(p.amount) FROM public.tailoring_job_payments p WHERE p.job_id = j.id), 0))::NUMERIC,
         j.due_date,
         CASE WHEN j.due_date IS NULL THEN NULL ELSE (j.due_date - current_date)::INTEGER END,
         j.assigned_to, u.email,
         (SELECT MIN(f.scheduled_at) FROM public.tailoring_fittings f
           WHERE f.job_id = j.id AND f.completed_at IS NULL),
         j.created_at
  FROM public.tailoring_jobs j
  LEFT JOIN public.users u ON u.id = j.assigned_to
  WHERE j.store_id = p_store_id
    AND (p_status IS NULL OR j.status = p_status)
    AND (NOT p_open_only OR j.status NOT IN ('delivered', 'cancelled'))
    AND (p_due_within_days IS NULL
         OR (j.due_date IS NOT NULL AND j.due_date <= current_date + p_due_within_days))
  ORDER BY j.due_date NULLS LAST, j.created_at
  LIMIT COALESCE(p_limit, 100);
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_tailoring_jobs(UUID, TEXT, INTEGER, BOOLEAN, INTEGER) TO authenticated;

/** Every tailoring dashboard metric in one round trip. */
CREATE OR REPLACE FUNCTION public.tailoring_job_summary(p_store_id UUID)
RETURNS TABLE (
  jobs_due_soon BIGINT,
  jobs_overdue BIGINT,
  upcoming_fittings BIGINT,
  awaiting_pickup BIGINT,
  outstanding_balances NUMERIC,
  open_jobs BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  IF NOT public.user_has_permission(auth.uid(), p_store_id, 'job:view') THEN
    RAISE EXCEPTION 'Permission denied: job:view required';
  END IF;

  RETURN QUERY
  SELECT
    (SELECT COUNT(*) FROM public.tailoring_jobs j
      WHERE j.store_id = p_store_id AND j.status NOT IN ('delivered', 'cancelled')
        AND j.due_date IS NOT NULL
        AND j.due_date BETWEEN current_date AND current_date + 7),
    (SELECT COUNT(*) FROM public.tailoring_jobs j
      WHERE j.store_id = p_store_id AND j.status NOT IN ('delivered', 'cancelled')
        AND j.due_date IS NOT NULL AND j.due_date < current_date),
    (SELECT COUNT(*) FROM public.tailoring_fittings f
      JOIN public.tailoring_jobs j ON j.id = f.job_id
      WHERE j.store_id = p_store_id AND f.completed_at IS NULL
        AND f.scheduled_at BETWEEN now() AND now() + INTERVAL '7 days'),
    (SELECT COUNT(*) FROM public.tailoring_jobs j
      WHERE j.store_id = p_store_id AND j.status = 'ready_for_pickup'),
    (SELECT COALESCE(SUM(j.price -
        COALESCE((SELECT SUM(p.amount) FROM public.tailoring_job_payments p WHERE p.job_id = j.id), 0)), 0)
      FROM public.tailoring_jobs j
      WHERE j.store_id = p_store_id AND j.status NOT IN ('delivered', 'cancelled')),
    (SELECT COUNT(*) FROM public.tailoring_jobs j
      WHERE j.store_id = p_store_id AND j.status NOT IN ('delivered', 'cancelled'));
END;
$$;

GRANT EXECUTE ON FUNCTION public.tailoring_job_summary(UUID) TO authenticated;
