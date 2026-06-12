import type { ReactNode } from 'react';

interface AuthLayoutProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}

export function AuthLayout({ title, subtitle, children, footer }: AuthLayoutProps) {
  return (
    <div className="auth-shell">
      <div className="auth-bg-glow" />
      <div className="auth-bg-grid" />
      <div className="auth-content">
        <div className="auth-logo">
          <div className="auth-logo-row">
            <div className="auth-logo-mark">T</div>
            <span className="auth-logo-name">TrackOja</span>
          </div>
          <span className="auth-logo-tagline">Retail Management Platform</span>
        </div>
        <div className="auth-card">
          <h1 className="auth-title">{title}</h1>
          {subtitle && <p className="auth-subtitle">{subtitle}</p>}
          {children}
        </div>
        {footer && <div className="auth-footer">{footer}</div>}
      </div>
    </div>
  );
}
