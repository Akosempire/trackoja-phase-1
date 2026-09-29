import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PlatformAdminService, type ImpersonationInfo } from '../services/platformAdmin.service';
import { useAuth } from '../contexts/AuthContext';

/**
 * Persistent developer-mode / impersonation indicator.
 *
 * Developer mode must be unmistakable whenever it is active, so this renders a
 * full-width bar that cannot be mistaken for product chrome. When a support
 * impersonation session is running it names the impersonated business and offers
 * an immediate exit control.
 */
export function DeveloperModeBanner() {
  const { profile } = useAuth();
  const [developerMode, setDeveloperMode] = useState(false);
  const [impersonation, setImpersonation] = useState<ImpersonationInfo | null>(null);
  const [exiting, setExiting] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);

  const load = useCallback(() => {
    PlatformAdminService.getDeveloperStatus()
      .then((status) => setDeveloperMode(status.developerMode))
      .catch(() => setDeveloperMode(false));

    PlatformAdminService.getActiveImpersonation()
      .then((info) => {
        setImpersonation(info);
        setSecondsLeft(info?.secondsRemaining ?? 0);
      })
      .catch(() => setImpersonation(null));
  }, []);

  useEffect(() => {
    load();
    // Re-check periodically so an expired or revoked grant stops showing as active.
    const timer = window.setInterval(load, 60000);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    if (!impersonation) return;
    const timer = window.setInterval(() => {
      setSecondsLeft((current) => {
        if (current <= 1) {
          // Session lapsed: re-read from the server rather than assuming.
          load();
          return 0;
        }
        return current - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [impersonation, load]);

  const handleExit = async () => {
    setExiting(true);
    try {
      await PlatformAdminService.endImpersonation(impersonation?.sessionId);
      setImpersonation(null);
    } finally {
      setExiting(false);
    }
  };

  if (!developerMode && !impersonation) return null;

  return (
    <div className="dev-banner-stack">
      {developerMode && (
        <div className="dev-banner dev-banner-developer" role="status" data-developer-indicator>
          <span className="dev-banner-dot" aria-hidden="true" />
          <span className="dev-banner-text">
            <strong>Developer access granted.</strong> Diagnostics and sandbox records only. Customer permissions still apply.
          </span>
          {profile?.isPlatformAdmin && <Link className="btn btn-outline btn-sm" to="/platform/developer">Manage access</Link>}
        </div>
      )}

      {impersonation && (
        <div className="dev-banner dev-banner-impersonation" role="alert" data-impersonation-indicator>
          <span className="dev-banner-dot" aria-hidden="true" />
          <span className="dev-banner-text">
            <strong>Read-only support session:</strong> viewing {impersonation.orgName}. Writes are
            blocked. {secondsLeft > 0 ? `Expires in ${formatSeconds(secondsLeft)}.` : 'Expired.'}
          </span>
          <button type="button" className="btn btn-outline btn-sm" onClick={handleExit} disabled={exiting}>
            {exiting ? 'Exiting…' : 'Exit session'}
          </button>
        </div>
      )}
    </div>
  );
}

function formatSeconds(total: number): string {
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}
