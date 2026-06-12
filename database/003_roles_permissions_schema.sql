-- Migration: 003_roles_permissions_schema.sql
-- Description: RBAC tables - roles, permissions, and assignments
-- Author: TrackOja Team
-- Date: 2026-06-11

-- Create roles table
CREATE TABLE IF NOT EXISTS public.roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  is_system BOOLEAN DEFAULT FALSE,
  level INTEGER,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  -- System roles are org-level; custom roles may be store-specific later
  UNIQUE(org_id, name)
);

CREATE INDEX IF NOT EXISTS idx_roles_org ON public.roles(org_id);
CREATE INDEX IF NOT EXISTS idx_roles_is_system ON public.roles(is_system);

ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;

-- Create permissions table
CREATE TABLE IF NOT EXISTS public.permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  resource TEXT NOT NULL,
  action TEXT NOT NULL,
  description TEXT,
  category TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(resource, action)
);

CREATE INDEX IF NOT EXISTS idx_permissions_resource ON public.permissions(resource);
CREATE INDEX IF NOT EXISTS idx_permissions_action ON public.permissions(action);

ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;

-- Create role_permissions junction table
CREATE TABLE IF NOT EXISTS public.role_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id UUID NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES public.permissions(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(role_id, permission_id)
);

CREATE INDEX IF NOT EXISTS idx_role_permissions_role ON public.role_permissions(role_id);
CREATE INDEX IF NOT EXISTS idx_role_permissions_permission ON public.role_permissions(permission_id);

ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;

-- Triggers for updated_at
DROP TRIGGER IF EXISTS handle_updated_at_roles ON public.roles;
CREATE TRIGGER handle_updated_at_roles BEFORE UPDATE ON public.roles
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Insert system roles for Phase 1
-- These will be created per organization in seed data

-- Insert core permissions for Phase 1
INSERT INTO public.permissions (name, resource, action, description, category) VALUES
  ('store:create', 'stores', 'create', 'Create a new store', 'store_management'),
  ('store:read', 'stores', 'read', 'View store details', 'store_management'),
  ('store:update', 'stores', 'update', 'Update store information', 'store_management'),
  ('store:delete', 'stores', 'delete', 'Delete a store', 'store_management'),
  ('member:invite', 'store_members', 'invite', 'Invite staff to store', 'staff_management'),
  ('member:manage', 'store_members', 'manage', 'Manage store staff', 'staff_management'),
  ('member:remove', 'store_members', 'remove', 'Remove staff from store', 'staff_management'),
  ('inventory:view', 'inventory', 'read', 'View inventory', 'inventory'),
  ('sales:create', 'sales', 'create', 'Create sales transactions', 'sales'),
  ('reports:view', 'reports', 'read', 'View reports', 'reports'),
  ('settings:update', 'settings', 'update', 'Update store settings', 'settings')
ON CONFLICT (name) DO NOTHING;
