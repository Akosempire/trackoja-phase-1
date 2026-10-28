import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import {
  ArrowRight01Icon, Cancel01Icon, ChartHistogramIcon, Menu01Icon,
  PackageIcon, ShoppingBag01Icon, Tick02Icon, UserMultipleIcon,
} from '@hugeicons/core-free-icons';
import { BrandLockup } from '../../components/AuthLayout';

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

/** Product wordmark used by the landing nav, footer and legal pages. */
export function BrandLogo({ size = 'md' }: { size?: 'sm' | 'md' }) {
  return <BrandLockup size={size} />;
}
