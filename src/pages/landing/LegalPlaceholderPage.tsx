import { Link } from 'react-router-dom';
import { COMPANY_NAME, CONTACT_EMAIL } from './landingContent';
import { BrandLogo } from './LandingIcons';
import { btn } from '../../components/kit';
import { APP_NAME } from '../../config/brand';

/**
 * Honest placeholder for the legal documents the footer links to.
 *
 * The landing page must not carry a broken link, and it must not invent legal
 * wording either, so these routes state plainly that the document is being
 * finalised and give a real way to ask questions.
 */
export default function LegalPlaceholderPage({
  title,
  summary,
}: {
  title: string;
  summary: string;
}) {
  return (
    <div className="min-h-dvh bg-canvas text-ink">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex h-16 w-full max-w-[1160px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <Link className="rounded-md no-underline" to="/" aria-label={`${APP_NAME} home`}>
            <BrandLogo />
          </Link>
          <Link className={btn('outline')} to="/">
            Back to home
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[720px] px-4 pb-16 pt-10 sm:px-6 sm:pt-16">
        <h1 className="m-0 text-[28px] font-semibold leading-9 tracking-tight text-ink sm:text-[32px] sm:leading-10">{title}</h1>
        <p className="m-0 mt-2 text-[15px] leading-6 text-ink-2">{summary}</p>

        <div className="mt-8 flex flex-col gap-4 rounded-xl border border-line bg-surface p-5 text-sm leading-6 text-ink-2 shadow-card sm:p-6">
          <p className="m-0">
            This document is still being finalised and will be published here before {APP_NAME} takes
            on paying customers at scale. It is not yet a complete statement of our practices.
          </p>
          <p className="m-0">
            In the meantime, send any question about your data or your agreement to{' '}
            <a className="font-medium text-brand" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> and we will answer directly.
          </p>
          <p className="m-0 border-t border-line pt-4 text-[13px] text-ink-3">{APP_NAME} is operated by {COMPANY_NAME}.</p>
        </div>
      </main>
    </div>
  );
}
