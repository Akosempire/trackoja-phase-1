// Small, self-contained icon set for the public landing page.
//
// Kept local on purpose: src/components/icons.tsx belongs to the signed-in app
// shell and is untouched by this page, so the marketing page cannot be broken by
// navigation icon changes.

interface IconProps {
  width?: number;
  height?: number;
  className?: string;
}

const BASE = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  viewBox: '0 0 24 24',
  'aria-hidden': true,
};

export function IconSales({ width = 22, height = 22, className }: IconProps) {
  return (
    <svg {...BASE} width={width} height={height} className={className}>
      <path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" />
      <path d="M9.5 8h5M9.5 12h5" />
    </svg>
  );
}

export function IconStock({ width = 22, height = 22, className }: IconProps) {
  return (
    <svg {...BASE} width={width} height={height} className={className}>
      <path d="M3 7.5 12 3l9 4.5v9L12 21 3 16.5z" />
      <path d="M3 7.5 12 12l9-4.5M12 12v9" />
    </svg>
  );
}

export function IconCustomers({ width = 22, height = 22, className }: IconProps) {
  return (
    <svg {...BASE} width={width} height={height} className={className}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 20c0-3.1 2.5-5.2 5.5-5.2s5.5 2.1 5.5 5.2" />
      <path d="M16 5.2A3 3 0 0 1 16 11M17.5 14.9c2 .6 3.5 2.4 3.5 5.1" />
    </svg>
  );
}

export function IconReports({ width = 22, height = 22, className }: IconProps) {
  return (
    <svg {...BASE} width={width} height={height} className={className}>
      <path d="M4 20h16" />
      <path d="M7 20V11M12 20V5M17 20v-6" />
    </svg>
  );
}

export function IconArrowRight({ width = 16, height = 16, className }: IconProps) {
  return (
    <svg {...BASE} width={width} height={height} className={className}>
      <path d="M5 12h13M13 6l6 6-6 6" />
    </svg>
  );
}

export function IconCheck({ width = 15, height = 15, className }: IconProps) {
  return (
    <svg {...BASE} width={width} height={height} className={className}>
      <path d="M4.5 12.5 9 17l10.5-10.5" />
    </svg>
  );
}

export function IconMenu({ width = 22, height = 22, className }: IconProps) {
  return (
    <svg {...BASE} width={width} height={height} className={className}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

export function IconClose({ width = 22, height = 22, className }: IconProps) {
  return (
    <svg {...BASE} width={width} height={height} className={className}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

/** TrackOja wordmark used by the nav and footer. */
export function TrackOjaLogo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="lp-logo">
      <span className="lp-logo-mark" aria-hidden="true">
        T
      </span>
      {!compact && <span className="lp-logo-word">TrackOja</span>}
    </span>
  );
}
