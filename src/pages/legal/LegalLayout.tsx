import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { BrandLogo } from '../landing/LandingIcons';
import { btn } from '../../components/kit';
import { APP_NAME } from '../../config/brand';

export const LEGAL_UPDATED = '30 October 2026';

export function LegalLayout({ title, summary, children }: { title: string; summary: string; children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-canvas text-ink">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex h-16 w-full max-w-[1160px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <Link className="rounded-md no-underline" to="/" aria-label={`${APP_NAME} home`}><BrandLogo /></Link>
          <Link className={btn('outline', 'sm')} to="/">Back to home</Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[760px] px-4 pb-16 pt-8 sm:px-6 sm:pt-12">
        <h1 className="m-0 text-[28px] font-semibold leading-9 tracking-tight text-ink sm:text-[32px] sm:leading-10">{title}</h1>
        <p className="m-0 mt-2 text-[15px] leading-6 text-ink-2">{summary}</p>
        <p className="m-0 mt-1 text-[13px] text-ink-3">Last updated {LEGAL_UPDATED}</p>
        <div className="mt-8 flex flex-col gap-6 rounded-xl border border-line bg-surface p-5 text-[14.5px] leading-6 text-ink-2 shadow-card sm:p-8">
          {children}
        </div>
      </main>
    </div>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5">
      <h2 className="m-0 text-[17px] font-semibold leading-6 text-ink">{title}</h2>
      {children}
    </section>
  );
}

export function Bullets({ items }: { items: ReactNode[] }) {
  return <ul className="m-0 flex list-disc flex-col gap-1.5 pl-5">{items.map((it, i) => <li key={i}>{it}</li>)}</ul>;
}
