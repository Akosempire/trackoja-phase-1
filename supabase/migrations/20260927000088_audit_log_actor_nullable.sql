-- Migration: 088_audit_log_actor_nullable.sql
-- Description: Let the auditing actor be cleared when a user is deleted.
--   public.audit_logs.actor_id is declared NOT NULL while its foreign key to
--   public.users is ON DELETE SET NULL. Those two contradict each other, so
--   deleting any user who has audit history fails outright with a not-null
--   violation - which makes deleting a customer account impossible.
--
--   Audit history is append-only and must outlive the account it describes, so
--   the column becomes nullable and the foreign key behaves as it was written
--   to: the row survives, with a null actor meaning "account since deleted".
-- Author: TrackOja Team
-- Date: 2026-09-27

-- ============================================================
-- AUDIT ACTOR MAY BE UNKNOWN
-- ============================================================
-- Idempotent: DROP NOT NULL is a no-op when the column is already nullable.

ALTER TABLE public.audit_logs
  ALTER COLUMN actor_id DROP NOT NULL;

COMMENT ON COLUMN public.audit_logs.actor_id IS
  'The user who performed the action. NULL when that account has since been deleted; the audit row is retained.';
