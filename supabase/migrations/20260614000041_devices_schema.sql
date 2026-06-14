-- Migration: 041_devices_schema.sql
-- Description: Phase 9 device registry, sessions, and transactions tables
--   per PHASE_9_DEVICES.md / ARCHITECTURE_DEVICES.md. devices is the device
--   registry; device_sessions records staff use of a registered device;
--   device_transactions is a ledger of device-initiated payment actions,
--   optionally linked to sales/sale_payments/refunds from Phases 3/8.
-- Author: TrackOja Team
-- Date: 2026-06-14

-- ============================================================
-- DEVICES
-- ============================================================
CREATE TABLE IF NOT EXISTS public.devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('payment_terminal', 'scanner', 'printer', 'tablet', 'mobile')),
  provider TEXT,
  serial_number TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'offline', 'maintenance', 'decommissioned')),
  model TEXT,
  firmware_version TEXT,
  connectivity TEXT CHECK (connectivity IN ('online', 'offline', 'bluetooth', 'wifi', 'cellular')),
  battery_level INTEGER CHECK (battery_level BETWEEN 0 AND 100),
  last_seen_at TIMESTAMP WITH TIME ZONE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID NOT NULL REFERENCES public.users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_devices_store ON public.devices(store_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_devices_store_serial ON public.devices(store_id, serial_number) WHERE serial_number IS NOT NULL;

ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS handle_updated_at_devices ON public.devices;
CREATE TRIGGER handle_updated_at_devices BEFORE UPDATE ON public.devices
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ============================================================
-- DEVICE_SESSIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.device_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id UUID NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id),
  session_token UUID NOT NULL DEFAULT gen_random_uuid(),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended', 'expired', 'failed')),
  started_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  ended_at TIMESTAMP WITH TIME ZONE,
  last_heartbeat_at TIMESTAMP WITH TIME ZONE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_device_sessions_device ON public.device_sessions(device_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_device_sessions_store ON public.device_sessions(store_id, started_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_device_sessions_token ON public.device_sessions(session_token);

ALTER TABLE public.device_sessions ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- DEVICE_TRANSACTIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.device_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id UUID NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  session_id UUID REFERENCES public.device_sessions(id) ON DELETE SET NULL,
  sale_id UUID REFERENCES public.sales(id) ON DELETE SET NULL,
  sale_payment_id UUID REFERENCES public.sale_payments(id) ON DELETE SET NULL,
  refund_id UUID REFERENCES public.refunds(id) ON DELETE SET NULL,
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('payment_request', 'payment_confirmation', 'refund', 'reconciliation', 'status_check')),
  amount NUMERIC(14,2),
  currency TEXT NOT NULL DEFAULT 'NGN',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'success', 'failed', 'cancelled')),
  external_ref TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID NOT NULL REFERENCES public.users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  completed_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_device_transactions_device ON public.device_transactions(device_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_device_transactions_store ON public.device_transactions(store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_device_transactions_sale ON public.device_transactions(sale_id);

ALTER TABLE public.device_transactions ENABLE ROW LEVEL SECURITY;
