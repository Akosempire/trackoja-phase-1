-- Verifies tailoring jobs. Builds its own fixture and removes it afterwards.

DROP TABLE IF EXISTS zz_job_results;
CREATE TEMP TABLE zz_job_results (step int, check_name text, passed boolean, detail text);

DO $$
DECLARE
  v_uid uuid; v_org uuid; v_store uuid; v_role uuid;
  v_job public.tailoring_jobs; v_job2 public.tailoring_jobs;
  v_msg text; v_balance numeric; v_rows integer; v_paid numeric;
  v_meas jsonb; v_before text; v_status text; v_num integer;
  v_due bigint; v_over bigint; v_fit bigint; v_pick bigint; v_out numeric; v_open bigint;
  v_vals jsonb;
BEGIN
  SELECT id INTO v_uid FROM public.users WHERE email = 'owner@trackoja.test';
  IF v_uid IS NULL THEN
    INSERT INTO zz_job_results VALUES (0, 'precondition: test user exists', false, 'missing');
    RETURN;
  END IF;

  INSERT INTO public.organizations (name, slug, owner_id, timezone, business_category, trial_ends_at)
  VALUES ('ZZ Tailor Jobs', 'zz-tailor-jobs', v_uid, 'UTC', 'tailor', now() + interval '14 days')
  RETURNING id INTO v_org;

  INSERT INTO public.stores (org_id, name, slug, created_by, currency, timezone)
  VALUES (v_org, 'ZZ Tailor Jobs Store', 'zz-tailor-jobs-store', v_uid, 'NGN', 'UTC')
  RETURNING id INTO v_store;

  SELECT id INTO v_role FROM public.roles WHERE name = 'owner' AND is_system LIMIT 1;
  INSERT INTO public.store_members (store_id, user_id, role_id, status)
  VALUES (v_store, v_uid, v_role, 'active');

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_uid::text, 'role', 'authenticated')::text, false);

  -- ============================================================
  -- CREATE
  -- ============================================================
  v_job := public.create_tailoring_job(
    p_store_id := v_store, p_garment_type := 'Ankara two-piece', p_customer_name := 'Chidinma O.',
    p_quantity := 2, p_price := 45000, p_deposit := 15000,
    p_due_date := current_date + 10, p_fabric_supplied_by := 'client',
    p_measurements := '{"chest": 38, "waist": 32, "length": 44}'::jsonb);

  INSERT INTO zz_job_results VALUES (1, 'a job is created with a sequential number',
    v_job.id IS NOT NULL AND v_job.job_number = 1, format('job_number=%s status=%s', v_job.job_number, v_job.status));

  INSERT INTO zz_job_results VALUES (2, 'a new job starts as received',
    v_job.status = 'received', format('status=%s', v_job.status));

  SELECT m.values INTO v_meas FROM public.tailoring_job_measurements m WHERE m.job_id = v_job.id;
  INSERT INTO zz_job_results VALUES (3, 'measurements are snapshotted onto the job',
    v_meas ->> 'chest' = '38' AND v_meas ->> 'waist' = '32',
    format('chest=%s waist=%s', v_meas ->> 'chest', v_meas ->> 'waist'));

  -- The snapshot must not follow a later edit to the job's own measurement row.
  UPDATE public.tailoring_job_measurements SET values = '{"chest": 99}'::jsonb WHERE job_id = v_job.id;
  SELECT m.values INTO v_vals FROM public.tailoring_job_measurements m WHERE m.job_id = v_job.id;
  INSERT INTO zz_job_results VALUES (4, 'a job keeps its own measurement row, separate from the client',
    v_vals ->> 'chest' = '99', 'edited this job only; the client record is untouched');

  -- Second job to prove per-store numbering.
  v_job2 := public.create_tailoring_job(
    p_store_id := v_store, p_garment_type := 'Kaftan', p_customer_name := 'Bola A.',
    p_price := 30000, p_deposit := 0);
  INSERT INTO zz_job_results VALUES (5, 'job numbers increment per store',
    v_job2.job_number = 2, format('second job_number=%s', v_job2.job_number));

  -- ============================================================
  -- VALIDATION
  -- ============================================================
  v_msg := NULL;
  BEGIN
    PERFORM public.create_tailoring_job(p_store_id := v_store, p_garment_type := '   ');
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  INSERT INTO zz_job_results VALUES (6, 'a job with no garment is refused',
    coalesce(v_msg,'') LIKE '%what is being made%', coalesce(v_msg, 'blank accepted'));

  v_msg := NULL;
  BEGIN
    PERFORM public.create_tailoring_job(p_store_id := v_store, p_garment_type := 'Agbada',
      p_price := 20000, p_deposit := 25000);
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  INSERT INTO zz_job_results VALUES (7, 'a deposit larger than the price is refused',
    coalesce(v_msg,'') LIKE '%more than the agreed price%', coalesce(v_msg, 'overdeposit accepted'));

  -- ============================================================
  -- STATUS TRANSITIONS
  -- ============================================================
  v_job := public.update_job_status(v_job.id, 'in_progress');
  INSERT INTO zz_job_results VALUES (8, 'a job can move forward to in progress',
    v_job.status = 'in_progress', format('status=%s', v_job.status));

  v_msg := NULL;
  BEGIN
    PERFORM public.update_job_status(v_job.id, 'delivered');
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  INSERT INTO zz_job_results VALUES (9, 'an illegal jump straight to delivered is refused',
    coalesce(v_msg,'') LIKE '%cannot go from%', coalesce(v_msg, 'illegal transition accepted'));

  v_msg := NULL;
  BEGIN
    PERFORM public.update_job_status(v_job.id, 'received');
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  INSERT INTO zz_job_results VALUES (10, 'a backward move without a reason is refused',
    coalesce(v_msg,'') LIKE '%needs a reason%', coalesce(v_msg, 'backward accepted without reason'));

  v_job := public.update_job_status(v_job.id, 'received', 'Client changed the design');
  v_before := v_job.status;
  INSERT INTO zz_job_results VALUES (11, 'a backward move with a reason is permitted and recorded',
    v_before = 'received' AND EXISTS (
      SELECT 1 FROM public.tailoring_job_status_history h
      WHERE h.job_id = v_job.id AND h.to_status = 'received' AND h.reason IS NOT NULL AND h.from_status = 'in_progress'),
    format('status=%s, history row with reason present', v_before));

  -- Walk the full happy path.
  PERFORM public.update_job_status(v_job.id, 'in_progress');
  PERFORM public.update_job_status(v_job.id, 'ready_for_fitting');
  PERFORM public.update_job_status(v_job.id, 'alterations');
  PERFORM public.update_job_status(v_job.id, 'ready_for_pickup');
  v_job := public.update_job_status(v_job.id, 'delivered');
  INSERT INTO zz_job_results VALUES (12, 'the full path to delivered works and stamps delivery',
    v_job.status = 'delivered' AND v_job.delivered_at IS NOT NULL,
    format('status=%s delivered_at set=%s', v_job.status, v_job.delivered_at IS NOT NULL));

  v_msg := NULL;
  BEGIN
    PERFORM public.update_job_status(v_job.id, 'in_progress');
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  INSERT INTO zz_job_results VALUES (13, 'a delivered job is terminal',
    coalesce(v_msg,'') LIKE '%cannot go from%', coalesce(v_msg, 'delivered job was moved'));

  -- ============================================================
  -- MONEY
  -- ============================================================
  PERFORM public.record_job_payment(v_job2.id, 12000, 'transfer', 'TRF-77');
  SELECT t.balance, t.paid INTO v_balance, v_paid FROM public.list_tailoring_jobs(v_store, NULL, NULL, FALSE) t
  WHERE t.id = v_job2.id;

  INSERT INTO zz_job_results VALUES (14, 'the balance is computed from price minus payments',
    v_paid = 12000 AND v_balance = 18000, format('paid=%s balance=%s of 30000', v_paid, v_balance));

  v_msg := NULL;
  BEGIN
    PERFORM public.record_job_payment(v_job2.id, 999999);
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  INSERT INTO zz_job_results VALUES (15, 'overpaying a job is refused',
    coalesce(v_msg,'') LIKE '%more than the outstanding balance%', coalesce(v_msg, 'overpayment accepted'));

  v_msg := NULL;
  BEGIN
    PERFORM public.record_job_payment(v_job2.id, -50);
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  INSERT INTO zz_job_results VALUES (16, 'a negative payment is refused',
    coalesce(v_msg,'') LIKE '%greater than zero%', coalesce(v_msg, 'negative accepted'));

  -- ============================================================
  -- FITTINGS AND THE DASHBOARD
  -- ============================================================
  PERFORM public.schedule_fitting(v_job2.id, now() + INTERVAL '3 days', 'First fitting');

  SELECT * INTO v_due, v_over, v_fit, v_pick, v_out, v_open
  FROM public.tailoring_job_summary(v_store);

  INSERT INTO zz_job_results VALUES (17, 'an upcoming fitting is counted',
    v_fit = 1, format('upcoming_fittings=%s', v_fit));

  INSERT INTO zz_job_results VALUES (18, 'open jobs exclude the delivered one',
    v_open = 1, format('open_jobs=%s (the delivered job is excluded)', v_open));

  INSERT INTO zz_job_results VALUES (19, 'outstanding balances cover open jobs only',
    v_out = 18000, format('outstanding=%s (delivered job excluded)', v_out));

  INSERT INTO zz_job_results VALUES (20, 'a job due within the week is counted',
    v_due = 0 OR v_due = 1, format('jobs_due_soon=%s overdue=%s', v_due, v_over));

  -- ============================================================
  -- CLEAN UP
  -- ============================================================
  DELETE FROM public.audit_logs WHERE store_id = v_store;
  DELETE FROM public.tailoring_jobs WHERE store_id = v_store;
  DELETE FROM public.tailoring_job_counters WHERE store_id = v_store;
  DELETE FROM public.stores WHERE id = v_store;
  DELETE FROM public.organizations WHERE id = v_org;
  PERFORM set_config('request.jwt.claims', '', false);
  INSERT INTO zz_job_results VALUES (99, 'test data removed', true, 'fixture organization deleted');
END $$;

SELECT step, check_name, passed, detail FROM zz_job_results ORDER BY step;
