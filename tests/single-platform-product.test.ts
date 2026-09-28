import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260928000097_merge_trackoja_works.sql'),
  'utf8',
);

describe('single TrackOja product consolidation', () => {
  it('moves historical records before removing the placeholder', () => {
    expect(migration).toMatch(/UPDATE public\.product_plans SET product_id = v_trackoja/);
    expect(migration).toMatch(/UPDATE public\.organization_products SET product_id = v_trackoja/);
    expect(migration).toMatch(/UPDATE public\.subscription_transactions SET product_id = v_trackoja/);
    expect(migration.indexOf('UPDATE public.product_plans SET product_id')).toBeLessThan(
      migration.indexOf('DELETE FROM public.platform_products'),
    );
  });

  it('removes obsolete settings and the TrackOja Works catalogue row', () => {
    expect(migration).toMatch(/DELETE FROM public\.platform_settings WHERE key = 'products\.trackoja_works\.visible'/);
    expect(migration).toMatch(/DELETE FROM public\.platform_products WHERE id = v_works/);
  });

  it('keeps the schema ready for an intentionally approved future product', () => {
    expect(migration).toMatch(/add another row only for a separately approved and priced product/);
  });
});
