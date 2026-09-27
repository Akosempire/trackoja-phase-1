import type { ReactNode } from 'react';

interface SectionHeadProps {
  title: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
  id?: string;
}

export function SectionHead({ title, sub, actions, id }: SectionHeadProps) {
  return (
    <div className="section-head">
      <div className="section-head-text">
        <h2 className="section-title" id={id}>{title}</h2>
        {sub && <p className="section-sub">{sub}</p>}
      </div>
      {actions && <div className="section-actions">{actions}</div>}
    </div>
  );
}
