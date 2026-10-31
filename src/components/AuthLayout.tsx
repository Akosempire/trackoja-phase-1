import type { ReactNode } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { Tick02Icon } from '@hugeicons/core-free-icons';
import { ThemeSelect } from './ThemeSelect';
import { InstallAppAction } from './InstallAppAction';
import { APP_MARK, APP_NAME } from '../config/brand';
import { btn, cn } from './kit';

/** Square brand mark plus product name. Shared by the auth, welcome, onboarding and landing screens. */
export function BrandLockup({ size = 'md', className }: { size?: 'sm' | 'md'; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <span aria-hidden="true" className={cn('inline-flex shrink-0 items-center justify-center rounded-lg bg-brand font-bold text-white',
        size === 'md' ? 'size-9 text-[17px]' : 'size-8 text-[15px]')}>{APP_MARK}</span>
      <span className={cn('font-semibold tracking-tight text-ink', size === 'md' ? 'text-[18px]' : 'text-[16px]')}>{APP_NAME}</span>
    </span>
  );
}

/** Inline status message inside an auth card. */
export function AuthNotice({ tone = 'error', children }: { tone?: 'error' | 'success'; children: ReactNode }) {
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={cn('mb-5 rounded-md px-3.5 py-2.5 text-[13px] leading-5',
      tone === 'error' ? 'bg-danger-soft text-danger' : 'bg-success-soft text-success-ink')}>
      {children}
    </div>
  );
}

/** Class for the full-width primary action in an auth card. */
export const authSubmitClass = 'btn-lg w-full';

const PROMISES = [
  { title: 'Sell faster', body: 'Search or scan products and take cash, card or transfer in a few taps.' },
  { title: 'Track stock', body: 'Stock moves with every sale, and low items are flagged before you run out.' },
  { title: 'Know your profit', body: 'See daily sales, payments and estimated profit for every branch.' },
];

/**
 * Page frame for signed-out screens: grey canvas, centred content and, on wide
 * screens, a calm brand panel on the left.
 */
export function AuthFrame({ children, panel = true }: { children: ReactNode; panel?: boolean }) {
  return (
    <div className={cn('min-h-dvh bg-canvas text-ink', panel && 'lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]')}>
      {panel && (
        <aside className="sticky top-0 hidden h-dvh flex-col justify-between border-r border-line bg-surface px-12 py-10 lg:flex xl:px-16">
          <BrandLockup />
          <div className="max-w-[460px]">
            <h2 className="m-0 text-[32px] font-semibold leading-10 tracking-tight text-ink">The simple way to run your shop.</h2>
            <p className="m-0 mt-3 text-[15px] leading-6 text-ink-2">Sales, stock and staff in one place, on the phone you already use.</p>
            <ul className="m-0 mt-8 list-none space-y-5 p-0">
              {PROMISES.map(item => (
                <li key={item.title} className="flex gap-3">
                  <span aria-hidden="true" className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand-ink">
                    <HugeiconsIcon icon={Tick02Icon} size={16} strokeWidth={2} />
                  </span>
                  <span>
                    <span className="block text-[15px] font-semibold text-ink">{item.title}</span>
                    <span className="mt-0.5 block text-sm leading-5 text-ink-2">{item.body}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <p className="m-0 text-[13px] text-ink-3">Built for small shops and growing businesses.</p>
        </aside>
      )}
      <div className="flex min-h-dvh min-w-0 flex-col items-center px-4 py-8 sm:px-6 sm:py-12">
        <div className={cn('mb-8 flex w-full justify-center', panel && 'lg:hidden')}><BrandLockup /></div>
        <div className="flex w-full flex-1 flex-col items-center sm:justify-center">{children}</div>
        <div className="mt-8 flex w-full max-w-[420px] flex-wrap items-center justify-between gap-3">
          <InstallAppAction className={btn('ghost', 'sm')} label={`Install ${APP_NAME}`} />
          <ThemeSelect />
        </div>
      </div>
    </div>
  );
}

interface AuthLayoutProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}

export function AuthLayout({ title, subtitle, children, footer }: AuthLayoutProps) {
  return (
    <AuthFrame>
      <main className="w-full max-w-[420px]">
        <div className="rounded-2xl border border-line bg-surface p-6 shadow-card sm:p-8">
          <h1 className="m-0 text-2xl font-semibold leading-8 tracking-tight text-ink">{title}</h1>
          {subtitle && <p className="m-0 mt-1.5 text-sm leading-5 text-ink-2">{subtitle}</p>}
          <div className="mt-6 [&_input.form-input]:h-11 [&_input.form-input]:text-[15px] [&_.form-input-reveal]:size-10">{children}</div>
        </div>
        {footer && (
          <div className="mt-5 text-center text-sm text-ink-2 [&_a]:font-semibold [&_a]:text-brand-ink [&_a]:no-underline [&_a:hover]:underline">
            {footer}
          </div>
        )}
      </main>
    </AuthFrame>
  );
}
