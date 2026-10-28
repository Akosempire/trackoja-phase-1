import type { ReactNode } from 'react';

interface SectionHeadProps {
  title: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
  id?: string;
}

export function SectionHead({ title, sub, actions, id }: SectionHeadProps) {
  return (
    <div className="section-head mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="section-head-text min-w-0">
        <h2 className="section-title m-0 text-[15px] font-semibold leading-[22px] text-ink" id={id}>{title}</h2>
        {sub && <p className="section-sub m-0 mt-0.5 text-[13px] text-ink-3">{sub}</p>}
      </div>
      {actions && <div className="section-actions flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
