-- Verification for migration 091 (platform admin management).
--
-- Re-runnable and self-cleaning: the fixture changes are undone inside the same
-- transaction and the script ends by asserting that nothing was left behind.
-- Run it through the Management API or psql and read the final result set.
--
-- Every mutation authorises on auth.uid(), which is NULL for SQL run without a
-- JWT, so the block impersonates a signed-in platform owner - and checks first
-- that the gate refuses when nobody is signed in.

CREATE TEMP TABLE IF NOT EXISTS zz_results (
  step INTEGER,
  check_name TEXT,
  passed BOOLEAN,
  detail TEXT
) ON COMMIT DROP;

TRUNCATE zz_results;

DO $do$
DECLARE
  v_owner   UUID := 'aac84346-9e10-493f-865c-7f3bef18909e';  -- the platform owner
  v_target  UUID := 'ef12d63c-ef77-4b77-8961-47bc44e7019e';  -- a real user, no platform identity
  v_msg     TEXT;
  v_keys    INTEGER;
  v_level   TEXT;
  v_admin   BOOLEAN;
  v_super   BOOLEAN;
  v_audit   INTEGER;
  v_claims  TEXT := json_build_object('sub', 'aac84346-9e10-493f-865c-7f3bef18909e', 'role', 'authenticated')::TEXT;
BEGIN
  INSERT INTO zz_results VALUES (0, 'precondition: the target holds no platform identity',
    NOT EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = v_target)
    AND NOT (SELECT is_platform_admin FROM public.users WHERE id = v_target), 'target=' || v_target);

  -- ---- the gate refuses without a session ---------------------------------
  PERFORM set_config('request.jwt.claims', '{}', TRUE);
  BEGIN
    PERFORM public.grant_platform_admin(v_target, 'admin', 'zz');
    v_msg := 'NOT REFUSED';
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  INSERT INTO zz_results VALUES (1, 'the gate refuses a caller with no session',
    v_msg = 'Permission denied: platform super admin required', v_msg);

  PERFORM set_config('request.jwt.claims', v_claims, TRUE);

  -- ---- appointment seeds each level's baseline ----------------------------
  PERFORM public.grant_platform_admin(v_target, 'admin', 'zz grant');
  SELECT pa.level, (SELECT count(*) FROM public.platform_admin_permissions WHERE user_id = v_target),
         u.is_platform_admin
    INTO v_level, v_keys, v_admin
    FROM public.platform_admins pa JOIN public.users u ON u.id = pa.user_id
   WHERE pa.user_id = v_target;
  INSERT INTO zz_results VALUES (2, 'appointing as admin seeds 3 keys and sets the legacy flag',
    v_level = 'admin' AND v_keys = 3 AND v_admin, format('level=%s keys=%s legacy=%s', v_level, v_keys, v_admin));

  PERFORM public.set_platform_admin_level(v_target, 'support', 'zz');
  SELECT (SELECT count(*) FROM public.platform_admin_permissions WHERE user_id = v_target) INTO v_keys;
  INSERT INTO zz_results VALUES (3, 'moving to support reseeds its 2-key baseline', v_keys = 2, 'keys=' || v_keys);

  PERFORM public.set_platform_admin_level(v_target, 'finance_operator', 'zz');
  SELECT (SELECT count(*) FROM public.platform_admin_permissions WHERE user_id = v_target) INTO v_keys;
  INSERT INTO zz_results VALUES (4, 'moving to finance_operator reseeds its 3-key baseline', v_keys = 3, 'keys=' || v_keys);

  PERFORM public.set_platform_admin_level(v_target, 'developer', 'zz');
  SELECT (SELECT count(*) FROM public.platform_admin_permissions WHERE user_id = v_target) INTO v_keys;
  INSERT INTO zz_results VALUES (5, 'moving to developer reseeds its 2-key baseline', v_keys = 2, 'keys=' || v_keys);

  PERFORM public.set_platform_admin_level(v_target, 'super_admin', 'zz');
  SELECT (SELECT count(*) FROM public.platform_admin_permissions WHERE user_id = v_target),
         (SELECT is_platform_super_admin FROM public.users WHERE id = v_target)
    INTO v_keys, v_super;
  INSERT INTO zz_results VALUES (6, 'promotion to owner clears explicit keys and sets the super flag',
    v_keys = 0 AND v_super, format('keys=%s super_flag=%s', v_keys, v_super));

  PERFORM public.set_platform_admin_level(v_target, 'support', 'zz');
  SELECT (SELECT count(*) FROM public.platform_admin_permissions WHERE user_id = v_target),
         (SELECT is_platform_super_admin FROM public.users WHERE id = v_target)
    INTO v_keys, v_super;
  INSERT INTO zz_results VALUES (7, 'demotion from owner reseeds the new baseline and clears the super flag',
    v_keys = 2 AND NOT v_super, format('keys=%s super_flag=%s', v_keys, v_super));

  -- ---- the guards ---------------------------------------------------------
  BEGIN
    PERFORM public.set_platform_admin_level(v_owner, 'admin', 'zz');
    v_msg := 'NOT REFUSED';
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  INSERT INTO zz_results VALUES (8, 'the last platform owner cannot be demoted',
    v_msg LIKE 'This is the only platform owner%', v_msg);

  BEGIN
    PERFORM public.revoke_platform_admin(v_owner, 'zz self revoke');
    v_msg := 'NOT REFUSED';
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  INSERT INTO zz_results VALUES (9, 'self-revocation is refused',
    v_msg = 'You cannot revoke your own platform access', v_msg);

  BEGIN
    PERFORM public.revoke_platform_admin(v_target, 'no');
    v_msg := 'NOT REFUSED';
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  INSERT INTO zz_results VALUES (10, 'a short reason is refused',
    v_msg = 'A reason is required to revoke platform access', v_msg);

  BEGIN
    PERFORM public.grant_platform_admin(v_target, 'admin', 'zz duplicate');
    v_msg := 'NOT REFUSED';
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  INSERT INTO zz_results VALUES (11, 'appointing an existing admin is refused',
    v_msg LIKE 'That user is already an active platform admin%', v_msg);

  BEGIN
    PERFORM public.grant_platform_admin(v_target, 'emperor', 'zz');
    v_msg := 'NOT REFUSED';
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  INSERT INTO zz_results VALUES (12, 'an unknown level is refused',
    v_msg = 'Invalid platform level: emperor', v_msg);

  BEGIN
    PERFORM public.grant_platform_admin('00000000-0000-0000-0000-000000000000', 'admin', 'zz');
    v_msg := 'NOT REFUSED';
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; END;
  INSERT INTO zz_results VALUES (13, 'an unknown user is refused',
    v_msg LIKE 'Unknown user:%', v_msg);

  -- ---- revocation clears everything ---------------------------------------
  PERFORM public.revoke_platform_admin(v_target, 'zz end of verification');
  SELECT pa.status,
         (SELECT count(*) FROM public.platform_admin_permissions WHERE user_id = v_target),
         u.is_platform_admin, u.is_platform_super_admin
    INTO v_msg, v_keys, v_admin, v_super
    FROM public.platform_admins pa JOIN public.users u ON u.id = pa.user_id
   WHERE pa.user_id = v_target;
  INSERT INTO zz_results VALUES (14, 'revocation clears keys and both legacy flags',
    v_msg = 'revoked' AND v_keys = 0 AND NOT v_admin AND NOT v_super,
    format('status=%s keys=%s legacy=%s/%s', v_msg, v_keys, v_admin, v_super));

  SELECT count(*) INTO v_audit FROM public.audit_logs
   WHERE resource_id = v_target AND action LIKE 'PLATFORM_ADMIN%';
  INSERT INTO zz_results VALUES (15, 'every mutation wrote an audit row', v_audit >= 6, 'rows=' || v_audit);

  -- ---- privilege surface --------------------------------------------------
  INSERT INTO zz_results VALUES (16, 'anon cannot execute the new mutations',
    NOT has_function_privilege('anon', 'public.grant_platform_admin(uuid,text,text)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.set_platform_admin_level(uuid,text,text)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.revoke_platform_admin(uuid,text)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.platform_level_baseline(text)', 'EXECUTE'),
    'checked all four');

  INSERT INTO zz_results VALUES (17, 'authenticated can execute the three mutations and the roster read',
    has_function_privilege('authenticated', 'public.grant_platform_admin(uuid,text,text)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.set_platform_admin_level(uuid,text,text)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.revoke_platform_admin(uuid,text)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.list_platform_admin_accounts_v2()', 'EXECUTE'),
    'checked all four');

  -- ---- put the fixture back ----------------------------------------------
  DELETE FROM public.audit_logs WHERE resource_id = v_target AND action LIKE 'PLATFORM_ADMIN%';
  DELETE FROM public.platform_admin_permissions WHERE user_id = v_target;
  DELETE FROM public.platform_admins WHERE user_id = v_target;
  UPDATE public.users
     SET is_platform_admin = FALSE, is_platform_super_admin = FALSE
   WHERE id = v_target;

  INSERT INTO zz_results VALUES (18, 'the target was restored exactly as found',
    NOT EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = v_target)
    AND NOT EXISTS (SELECT 1 FROM public.platform_admin_permissions WHERE user_id = v_target)
    AND NOT (SELECT is_platform_admin FROM public.users WHERE id = v_target)
    AND NOT (SELECT is_platform_super_admin FROM public.users WHERE id = v_target)
    AND NOT EXISTS (SELECT 1 FROM public.audit_logs WHERE resource_id = v_target AND action LIKE 'PLATFORM_ADMIN%'),
    'all five checks passed');

  INSERT INTO zz_results VALUES (19, 'the roster still contains exactly one platform owner',
    (SELECT count(*) FROM public.platform_admins) = 1
    AND EXISTS (SELECT 1 FROM public.platform_admins WHERE level = 'super_admin' AND status = 'active'),
    (SELECT count(*)::TEXT FROM public.platform_admins) || ' platform admin row(s)');
END
$do$;

SELECT step, check_name, passed, detail FROM zz_results ORDER BY step;
