-- Migration: 011_audit_log_triggers.sql
-- Description: Database-layer audit logging. Per PHASE_1_FOUNDATION.md, audit logs
--   must be written at the database or edge function layer, not as a frontend stub.
--   These triggers cover the events that have a natural signal on a table write:
--   LOGIN (auth.users.last_sign_in_at changes), STORE_CREATED (stores insert),
--   STORE_SWITCHED (users.current_store_id changes), STAFF_INVITED and
--   STAFF_ACCEPTED (store_members insert/status transition). LOGOUT has no DB
--   write to hook into and is handled by the log-logout Edge Function instead.
-- Author: TrackOja Team
-- Date: 2026-06-12

-- ============================================================
-- LOGIN (auth.users.last_sign_in_at changes)
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_login_audit()
RETURNS TRIGGER AS $$
DECLARE
  v_org_id UUID;
BEGIN
  SELECT current_org_id INTO v_org_id FROM public.users WHERE id = NEW.id;

  IF v_org_id IS NOT NULL THEN
    INSERT INTO public.audit_logs (actor_id, org_id, action, resource_type, resource_id)
    VALUES (NEW.id, v_org_id, 'LOGIN', 'auth_session', NEW.id);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_auth_user_login ON auth.users;
CREATE TRIGGER on_auth_user_login
  AFTER UPDATE OF last_sign_in_at ON auth.users
  FOR EACH ROW
  WHEN (OLD.last_sign_in_at IS DISTINCT FROM NEW.last_sign_in_at)
  EXECUTE FUNCTION public.handle_login_audit();

-- ============================================================
-- STORE_CREATED (stores insert)
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_store_created_audit()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.audit_logs (actor_id, org_id, store_id, action, resource_type, resource_id, resource_name)
  VALUES (NEW.created_by, NEW.org_id, NEW.id, 'STORE_CREATED', 'store', NEW.id, NEW.name);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_store_created ON public.stores;
CREATE TRIGGER on_store_created
  AFTER INSERT ON public.stores
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_store_created_audit();

-- ============================================================
-- STORE_SWITCHED (users.current_store_id changes after first assignment)
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_store_switched_audit()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.audit_logs (actor_id, org_id, store_id, action, resource_type, resource_id, changes)
  VALUES (
    NEW.id,
    NEW.current_org_id,
    NEW.current_store_id,
    'STORE_SWITCHED',
    'store',
    NEW.current_store_id,
    jsonb_build_object('from_store_id', OLD.current_store_id, 'to_store_id', NEW.current_store_id)
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_user_store_switched ON public.users;
CREATE TRIGGER on_user_store_switched
  AFTER UPDATE OF current_store_id ON public.users
  FOR EACH ROW
  WHEN (
    OLD.current_store_id IS DISTINCT FROM NEW.current_store_id
    AND OLD.current_store_id IS NOT NULL
    AND NEW.current_org_id IS NOT NULL
  )
  EXECUTE FUNCTION public.handle_store_switched_audit();

-- ============================================================
-- STAFF_INVITED (store_members insert with status = 'invited')
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_staff_invited_audit()
RETURNS TRIGGER AS $$
DECLARE
  v_org_id UUID;
BEGIN
  SELECT org_id INTO v_org_id FROM public.stores WHERE id = NEW.store_id;

  INSERT INTO public.audit_logs (actor_id, org_id, store_id, action, resource_type, resource_id, resource_name, details)
  VALUES (
    NEW.invited_by,
    v_org_id,
    NEW.store_id,
    'STAFF_INVITED',
    'store_member',
    NEW.id,
    NEW.invited_email,
    jsonb_build_object('role_id', NEW.role_id)
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_staff_invited ON public.store_members;
CREATE TRIGGER on_staff_invited
  AFTER INSERT ON public.store_members
  FOR EACH ROW
  WHEN (NEW.status = 'invited')
  EXECUTE FUNCTION public.handle_staff_invited_audit();

-- ============================================================
-- STAFF_ACCEPTED (store_members status transitions invited -> active)
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_staff_accepted_audit()
RETURNS TRIGGER AS $$
DECLARE
  v_org_id UUID;
  v_store_name TEXT;
BEGIN
  SELECT org_id, name INTO v_org_id, v_store_name FROM public.stores WHERE id = NEW.store_id;

  INSERT INTO public.audit_logs (actor_id, org_id, store_id, action, resource_type, resource_id, resource_name)
  VALUES (NEW.user_id, v_org_id, NEW.store_id, 'STAFF_ACCEPTED', 'store_member', NEW.id, v_store_name);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_staff_accepted ON public.store_members;
CREATE TRIGGER on_staff_accepted
  AFTER UPDATE ON public.store_members
  FOR EACH ROW
  WHEN (OLD.status = 'invited' AND NEW.status = 'active')
  EXECUTE FUNCTION public.handle_staff_accepted_audit();
