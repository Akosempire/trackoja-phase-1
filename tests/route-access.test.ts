import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { checkRouteAccess, ROUTE_RULES } from '../src/config/routeAccess';
import { parseDiscountLimit } from '../src/services/storeRules.service';

// Same lists the roles migration seeds (20261031002001), so the screens and the
// database agree on who can open what.
const CASHIER = ['sales:create', 'sales:view', 'customer:view', 'customer:create', 'inventory:view', 'store:read', 'devices:view'];
const INVENTORY = ['inventory:view', 'inventory:adjust', 'product:create', 'product:update', 'category:create', 'category:update',
  'purchase:view', 'purchase:create', 'supplier:view', 'supplier:create', 'supplier:update', 'store:read', 'cost:view'];
const MANAGER = [...new Set([...CASHIER, ...INVENTORY, 'reports:view', 'sales:void', 'sales:refund', 'sales:view_all', 'sales:override',
  'price:edit', 'settings:view', 'settings:update', 'store:update', 'member:invite', 'member:manage', 'expense:view', 'customer:update', 'job:view'])];

const as = (perms: string[], role: string) => (path: string) => checkRouteAccess(path, (p) => perms.includes(p), role);
const cashier = as(CASHIER, 'cashier');
const officer = as(INVENTORY, 'inventory_officer');
const manager = as(MANAGER, 'manager');
const owner = as(MANAGER, 'owner');

describe('route access', () => {
  it('keeps a cashier on the register: no reports, settings, staff, billing, product edits or stock adjustments', () => {
    for (const path of ['/reports', '/settings', '/settings/payments/moniepoint', '/staff', '/billing', '/billing/documents/INV-1',
      '/inventory/products/p1', '/inventory/products/new', '/inventory/stock', '/inventory/count', '/inventory/lots', '/expenses', '/payments', '/activity']) {
      expect(cashier(path), path).toMatchObject({ allowed: false });
    }
    for (const path of ['/sales/checkout', '/till', '/till/history', '/sales/history', '/sales/abc', '/customers', '/customers/new', '/inventory/products']) {
      expect(cashier(path), path).toEqual({ allowed: true });
    }
  });

  it('sends a cashier from the dashboard to the register, and an inventory officer to products', () => {
    expect(cashier('/dashboard')).toMatchObject({ allowed: false, redirect: '/sales/checkout' });
    expect(officer('/dashboard')).toMatchObject({ allowed: false, redirect: '/inventory/products' });
    expect(manager('/dashboard')).toEqual({ allowed: true });
  });

  it('gives an inventory officer stock work but not the till, reports, staff or settings', () => {
    for (const path of ['/inventory/products', '/inventory/products/p1', '/inventory/stock', '/inventory/restock', '/inventory/count',
      '/inventory/transfers', '/inventory/suppliers/s1', '/inventory/lots']) {
      expect(officer(path), path).toEqual({ allowed: true });
    }
    for (const path of ['/sales/checkout', '/till', '/sales/history', '/reports', '/staff', '/settings', '/billing']) {
      expect(officer(path), path).toMatchObject({ allowed: false });
    }
  });

  it('lets a manager do everything except billing and payment-provider settings', () => {
    for (const path of ['/reports', '/settings', '/staff', '/sales/checkout', '/inventory/stock', '/payments', '/expenses']) {
      expect(manager(path), path).toEqual({ allowed: true });
    }
    expect(manager('/billing')).toMatchObject({ allowed: false });
    expect(manager('/settings/payments/moniepoint')).toMatchObject({ allowed: false });
    expect(owner('/billing')).toEqual({ allowed: true });
    expect(owner('/settings/payments/moniepoint')).toEqual({ allowed: true });
  });

  it('says what was blocked in plain words', () => {
    expect(cashier('/settings')).toMatchObject({ label: 'settings' });
    expect(cashier('/reports')).toMatchObject({ label: 'reports' });
  });

  it('leaves unlisted screens (support, more) open, and orders specific rules before their parents', () => {
    expect(cashier('/support')).toEqual({ allowed: true });
    expect(cashier('/more')).toEqual({ allowed: true });
    const idx = (s: string) => ROUTE_RULES.findIndex((r) => r.pattern.source === s);
    expect(idx('^\\/settings\\/payments(\\/|$)')).toBeLessThan(idx('^\\/settings(\\/|$)'));
    expect(idx('^\\/sales\\/checkout\\/?$')).toBeLessThan(idx('^\\/sales(\\/|$)'));
  });

  it('wraps every app screen in the access gate', () => {
    const layout = readFileSync('src/components/AppLayout.tsx', 'utf8');
    expect(layout).toMatch(/<AccessGate><Outlet \/><\/AccessGate>/);
  });

  it('no longer tells people a PIN switch leaves permissions unchanged', () => {
    const sw = readFileSync('src/components/till/CashierSwitch.tsx', 'utf8');
    expect(sw).not.toMatch(/doesn't change/);
    const svc = readFileSync('src/services/cashier.service.ts', 'utf8');
    expect(svc.match(/refreshPermissions\(\)/g)?.length).toBeGreaterThanOrEqual(2);
  });
});

describe('discount limit input', () => {
  it('reads empty as no limit and accepts 0-100 with up to two decimals', () => {
    expect(parseDiscountLimit('')).toBeNull();
    expect(parseDiscountLimit(' 10 ')).toBe(10);
    expect(parseDiscountLimit('12.5%')).toBe(12.5);
    expect(parseDiscountLimit('0')).toBe(0);
    expect(parseDiscountLimit('100')).toBe(100);
  });
  it('rejects anything else', () => {
    for (const bad of ['101', '-5', 'abc', '10.123', '1e2']) expect(parseDiscountLimit(bad), bad).toBeUndefined();
  });
});
