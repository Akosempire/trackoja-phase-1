import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const source = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('shared application layout', () => {
  it('uses separate form, page, and wide content widths', () => {
    const tokens = source('src/styles/tokens.css');
    const surfaces = source('src/styles/waya.css');

    expect(tokens).toContain('--content-form: 760px');
    expect(tokens).toContain('--content-page: 1120px');
    expect(tokens).toContain('--content-readable: 1440px');
    expect(surfaces).toContain('.page { max-width: calc(var(--content-page) + var(--space-24) + var(--space-24))');
    expect(surfaces).toContain('.page-wide, .checkout-page { max-width: calc(var(--content-readable) + var(--space-24) + var(--space-24)); }');
  });

  it('keeps ordinary buttons content-sized and grouped actions aligned', () => {
    const surfaces = source('src/styles/waya.css');
    const components = source('src/styles/waya-components.css');

    expect(surfaces).toMatch(/\.btn \{[^}]*width: auto;/s);
    expect(surfaces).toMatch(/\.btn-label \{[^}]*white-space: nowrap;/s);
    expect(components).toMatch(/\.form-actions,[\s\S]*?align-items: center;/);
    expect(components).toContain('.plat-form-row > :is(.btn, a.btn)');
  });

  it('uses a labelled stacked billing-contact form', () => {
    const billing = source('src/pages/billing/BillingPage.tsx');

    // Usetally rebuild: a labelled form inside a kit Card, one field, a submit row.
    expect(billing).toContain('<form aria-labelledby="billing-contact-title"');
    expect(billing).toContain('id="billing-contact-title">Billing contact');
    expect(billing).toContain('<FormField id="billing-email" label="Invoice and receipt email"');
    expect(billing).toContain('<Button type="submit"');
    expect(billing).not.toContain('<div className="plat-form-row">\n          <FormField id="billing-email"');
  });

  it('provides deterministic back navigation for secondary screens and the mobile menu', () => {
    const layout = source('src/components/AppLayout.tsx');
    const backBar = source('src/components/RouteBackBar.tsx');
    const sideNav = source('src/components/SideNav.tsx');

    expect(layout).toContain('<RouteBackBar />');
    expect(backBar).toContain("pathname === '/more'");
    expect(backBar).toContain("pathname === '/sales/history'");
    expect(backBar).toContain("pathname === '/inventory/products/new'");
    expect(sideNav).toContain('aria-label="Close navigation"');
    expect(sideNav).toContain('<ArrowLeftIcon');
  });

  it('keeps dashboard cards visibly bordered in both themes', () => {
    const kit = source('src/components/kit.tsx');
    // Cards and stat tiles carry a hairline border token that both themes redefine.
    expect(kit).toMatch(/function Card[\s\S]*?border border-line/);
    expect(kit).toMatch(/function Stat[\s\S]*?border border-line/);
  });
});
