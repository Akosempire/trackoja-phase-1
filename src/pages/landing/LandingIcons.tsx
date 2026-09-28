import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import {
  ArrowRight01Icon, Cancel01Icon, ChartHistogramIcon, Menu01Icon,
  PackageIcon, ShoppingBag01Icon, Tick02Icon, UserMultipleIcon,
} from '@hugeicons/core-free-icons';

interface IconProps { width?: number; height?: number; className?: string; }

function icon(source: IconSvgElement) {
  return function LandingIcon({ width = 22, height = width, className }: IconProps) {
    return <HugeiconsIcon icon={source} width={width} height={height} className={className} strokeWidth={1.6} aria-hidden />;
  };
}

export const IconSales = icon(ShoppingBag01Icon);
export const IconStock = icon(PackageIcon);
export const IconCustomers = icon(UserMultipleIcon);
export const IconReports = icon(ChartHistogramIcon);
export const IconArrowRight = icon(ArrowRight01Icon);
export const IconCheck = icon(Tick02Icon);
export const IconMenu = icon(Menu01Icon);
export const IconClose = icon(Cancel01Icon);

/** TrackOja wordmark used by the nav and footer. */
export function TrackOjaLogo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="lp-logo">
      <span className="lp-logo-mark" aria-hidden="true">T</span>
      {!compact && <span className="lp-logo-word">TrackOja</span>}
    </span>
  );
}
