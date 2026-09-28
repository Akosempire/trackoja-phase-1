import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const source = (path: string) =>
  readFileSync(join(process.cwd(), path), 'utf8');

describe('ZIP design-system component adoption', () => {
  it('uses one shared drawer in both application shells', () => {
    const merchantLayout = source('src/components/AppLayout.tsx');
    const platformLayout = source('src/components/platform/PlatformLayout.tsx');

    expect(merchantLayout).toContain("import { Drawer } from './ui/Drawer'");
    expect(platformLayout).toContain("import { Drawer } from '../ui/Drawer'");
    expect(merchantLayout).toContain('<Drawer');
    expect(platformLayout).toContain('<Drawer');
    expect(merchantLayout).not.toContain('mobile-nav-dialog');
    expect(platformLayout).not.toContain('mobile-nav-dialog');
  });

  it('keeps drawer behavior accessible and modal', () => {
    const drawer = source('src/components/ui/Drawer.tsx');

    expect(drawer).toContain('<dialog');
    expect(drawer).toContain('showModal()');
    expect(drawer).toContain('containDialogFocus');
    expect(drawer).toContain('onCancel=');
    expect(drawer).toContain('event.target === event.currentTarget');
    expect(drawer).toContain("document.body.style.overflow = 'hidden'");
  });

  it('uses the shared metric component on merchant summary screens', () => {
    for (const path of [
      'src/pages/DashboardPage.tsx',
      'src/pages/jobs/JobsPage.tsx',
      'src/pages/reports/ReportsPage.tsx',
    ]) {
      const page = source(path);
      expect(page).toMatch(/<(KpiGrid|MetricStrip)[ >]/);
      expect(page).toMatch(/<(KpiCard|MetricStrip)[ >]/);
      expect(page).not.toContain('className="stat-card"');
    }
  });

  it('uses the extracted typography and semantic tokens for metrics and drawers', () => {
    const components = source('src/styles/waya-components.css');
    const surfaces = source('src/styles/waya.css');

    expect(components).toContain('font-family: var(--font-display)');
    expect(components).toContain('background: var(--color-panel)');
    expect(surfaces).toContain('.drawer::backdrop');
    expect(surfaces).toContain('@media (prefers-reduced-motion: reduce)');
  });
});
