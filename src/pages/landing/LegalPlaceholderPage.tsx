import { Link } from 'react-router-dom';
import { COMPANY_NAME, CONTACT_EMAIL } from './landingContent';
import { TrackOjaLogo } from './LandingIcons';
import '../../styles/landing.css';

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
    <div className="lp lp-legal">
      <header className="lp-nav">
        <div className="lp-container lp-nav-inner">
          <Link className="lp-nav-brand" to="/" aria-label="TrackOja home">
            <TrackOjaLogo />
          </Link>
          <div className="lp-nav-actions">
            <Link className="lp-btn lp-btn-primary" to="/">
              Back to home
            </Link>
          </div>
        </div>
      </header>

      <main className="lp-legal-main lp-container">
        <h1 className="lp-h2">{title}</h1>
        <p className="lp-lede">{summary}</p>

        <div className="lp-card lp-legal-card">
          <p className="lp-card-copy">
            This document is still being finalised and will be published here before TrackOja takes
            on paying customers at scale. It is not yet a complete statement of our practices.
          </p>
          <p className="lp-card-copy">
            In the meantime, send any question about your data or your agreement to{' '}
            <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> and we will answer directly.
          </p>
          <p className="lp-card-note">TrackOja is operated by {COMPANY_NAME}.</p>
        </div>
      </main>
    </div>
  );
}
