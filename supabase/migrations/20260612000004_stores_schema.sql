-- Migration: 003_stores_schema.sql
-- Description: Stores and store management tables
-- Author: TrackOja Team
-- Date: 2026-06-11

-- Create stores table
CREATE TABLE IF NOT EXISTS public.stores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  address TEXT,
  city TEXT,
  state TEXT,
  postal_code TEXT,
  country TEXT DEFAULT 'NG',
  phone TEXT,
  email TEXT,
  logo_url TEXT,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'maintenance', 'closed')),
  timezone TEXT DEFAULT 'UTC',
  currency TEXT DEFAULT 'NGN',
  created_by UUID NOT NULL REFERENCES public.users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(org_id, slug)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_stores_org ON public.stores(org_id);
CREATE INDEX IF NOT EXISTS idx_stores_status ON public.stores(status);
CREATE INDEX IF NOT EXISTS idx_stores_created_by ON public.stores(created_by);

-- Enable RLS
ALTER TABLE public.stores ENABLE ROW LEVEL SECURITY;

-- Create store members table for RBAC
CREATE TABLE IF NOT EXISTS public.store_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES public.roles(id) ON DELETE RESTRICT,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'invited', 'suspended')),
  invited_by UUID REFERENCES public.users(id),
  invited_at TIMESTAMP WITH TIME ZONE,
  accepted_at TIMESTAMP WITH TIME ZONE,
  invited_email TEXT,
  joined_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(store_id, user_id)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_store_members_store ON public.store_members(store_id);
CREATE INDEX IF NOT EXISTS idx_store_members_user ON public.store_members(user_id);
CREATE INDEX IF NOT EXISTS idx_store_members_role ON public.store_members(role_id);
CREATE INDEX IF NOT EXISTS idx_store_members_status ON public.store_members(status);

-- Enable RLS
ALTER TABLE public.store_members ENABLE ROW LEVEL SECURITY;

-- Create store settings table for future use
CREATE TABLE IF NOT EXISTS public.store_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL UNIQUE REFERENCES public.stores(id) ON DELETE CASCADE,
  allow_negative_stock BOOLEAN DEFAULT FALSE,
  require_customer_for_sale BOOLEAN DEFAULT FALSE,
  auto_print_receipt BOOLEAN DEFAULT TRUE,
  receipt_format TEXT DEFAULT 'thermal',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Triggers for updated_at
DROP TRIGGER IF EXISTS handle_updated_at_stores ON public.stores;
CREATE TRIGGER handle_updated_at_stores BEFORE UPDATE ON public.stores
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS handle_updated_at_store_members ON public.store_members;
CREATE TRIGGER handle_updated_at_store_members BEFORE UPDATE ON public.store_members
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
