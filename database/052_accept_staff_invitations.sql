-- Migration: 052_accept_staff_invitations.sql
-- Description: The Staff Management UI lets an Owner/Manager invite a staff
--   member by email (MemberService.inviteStaff inserts a store_members row
--   with status='invited', invited_email=<email>, user_id=NULL). When that
--   person later signs up or logs in with a matching email, their account
--   needs to be linked to that membership - but under RLS:
--     - store_members_update only allows updates where user_id = auth.uid()
--       (not yet true for a pending invite) or the user is already an
--       active member of the store (also not yet true).
--     - organization_members_insert_self (010) only allows a user to insert
--       their own org membership for orgs they OWN, not orgs they're being
--       added to as staff - but stores_user_isolation requires an
--       organization_members row to see the store at all.
--   So accepting an invite needs a SECURITY DEFINER function that performs
--   both the store_members update and the organization_members insert in
--   one step, bypassing those RLS gaps for this one well-scoped operation.
-- Author: TrackOja Team
-- Date: 2026-06-15

CREATE OR REPLACE FUNCTION public.accept_pending_invitations()
RETURNS SETOF public.store_members
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email TEXT;
  v_invite RECORD;
  v_updated public.store_members;
  v_first_store_id UUID;
  v_first_org_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT email INTO v_email FROM public.users WHERE id = auth.uid();
  IF v_email IS NULL THEN
    RETURN;
  END IF;

  FOR v_invite IN
    SELECT sm.id, sm.store_id, s.org_id
    FROM public.store_members sm
    JOIN public.stores s ON s.id = sm.store_id
    WHERE sm.status = 'invited'
      AND lower(sm.invited_email) = lower(v_email)
  LOOP
    UPDATE public.store_members
    SET user_id = auth.uid(), status = 'active', accepted_at = now(), joined_at = now()
    WHERE id = v_invite.id
    RETURNING * INTO v_updated;

    INSERT INTO public.organization_members (org_id, user_id, role, accepted_at)
    VALUES (v_invite.org_id, auth.uid(), 'member', now())
    ON CONFLICT (org_id, user_id) DO NOTHING;

    IF v_first_store_id IS NULL THEN
      v_first_store_id := v_invite.store_id;
      v_first_org_id := v_invite.org_id;
    END IF;

    RETURN NEXT v_updated;
  END LOOP;

  IF v_first_store_id IS NOT NULL THEN
    UPDATE public.users
    SET current_org_id = COALESCE(current_org_id, v_first_org_id),
        current_store_id = COALESCE(current_store_id, v_first_store_id)
    WHERE id = auth.uid();
  END IF;

  RETURN;
END;
$$;

GRANT EXECUTE ON FUNCTION public.accept_pending_invitations() TO authenticated;
