-- Migration: 053_store_members_nullable_user.sql
-- Description: The Staff Management invite flow (MemberService.inviteStaff)
--   inserts a store_members row with status='invited', invited_email=<email>,
--   and user_id left unset (filled in later by accept_pending_invitations()
--   when the invitee signs up/logs in). But store_members.user_id was
--   defined NOT NULL (004_stores_schema.sql), so every invite insert fails
--   with "null value in column user_id violates not-null constraint".
--   Drop the NOT NULL constraint - the UNIQUE(store_id, user_id) constraint
--   and FK still apply, and Postgres treats multiple NULLs as distinct for
--   uniqueness purposes so multiple pending invites per store are fine.
-- Author: TrackOja Team
-- Date: 2026-06-15

ALTER TABLE public.store_members ALTER COLUMN user_id DROP NOT NULL;
