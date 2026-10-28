import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../../config/supabase';
import { AuthService } from '../../services/auth.service';
import { AuthLayout, AuthNotice, authSubmitClass } from '../../components/AuthLayout';
import { FormField } from '../../components/ui/FormField';
import { Button } from '../../components/ui/Button';

function parseHashError(): { code: string; description: string } | null {
  const hash = window.location.hash.slice(1);
  if (!hash.includes('error=')) return null;
  const params = new URLSearchParams(hash);
  return {
    code: params.get('error_code') ?? '',
    description: params.get('error_description') ?? 'Verification failed.',
  };
}

export default function AuthCallbackPage() {
  const navigate = useNavigate();
  const navigated = useRef(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [resendEmail, setResendEmail] = useState('');
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);

  useEffect(() => {
    const err = parseHashError();
    if (err) {
      const saved = sessionStorage.getItem('tk_verify_email') ?? '';
      setResendEmail(saved);
      if (err.code === 'otp_expired') {
        setErrorMsg('Your verification link has expired.');
      } else {
        setErrorMsg(err.description.replace(/\+/g, ' '));
      }
      return;
    }

    const go = () => {
      if (!navigated.current) {
        navigated.current = true;
        navigate('/auth/continue', { replace: true });
      }
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) go();
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) go();
    });

    return () => subscription.unsubscribe();
  }, [navigate]);

  const handleResend = async () => {
    if (!resendEmail) return;
    setResending(true);
    try {
      await AuthService.resendVerification(resendEmail);
      setResent(true);
    } catch {
      // show generic message
      setResent(true);
    } finally {
      setResending(false);
    }
  };

  if (errorMsg) {
    return (
      <AuthLayout
        title="Link expired"
        subtitle={errorMsg}
        footer={<Link to="/login">Back to sign in</Link>}
      >
        {resent ? (
          <AuthNotice tone="success">
            New verification email sent to {resendEmail}. Check your inbox.
          </AuthNotice>
        ) : (
          <>
            {resendEmail ? (
              <>
                <p className="m-0 mb-4 text-sm text-ink-2">
                  We&apos;ll send a fresh link to <strong className="font-semibold text-ink">{resendEmail}</strong>
                </p>
                <Button onClick={handleResend} loading={resending} className={authSubmitClass}>
                  Resend verification email
                </Button>
              </>
            ) : (
              <>
                <p className="m-0 mb-4 text-sm text-ink-2">
                  Enter your email to get a new verification link.
                </p>
                <FormField
                  id="resendEmail"
                  label="Email address"
                  type="email"
                  value={resendEmail}
                  onChange={setResendEmail}
                  placeholder="you@example.com"
                  autoComplete="email"
                />
                <Button onClick={handleResend} loading={resending} disabled={!resendEmail} className={authSubmitClass}>
                  Resend verification email
                </Button>
              </>
            )}
            <div className="mt-4 text-center">
              <Link
                to={`/verify-email${resendEmail ? `?email=${encodeURIComponent(resendEmail)}` : ''}`}
                className="text-[13px] font-medium text-ink-2 no-underline hover:text-ink hover:underline"
              >
                Enter code manually instead
              </Link>
            </div>
          </>
        )}
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Verifying your email…" subtitle="Please wait while we confirm your account.">
      <div role="status" aria-label="Verifying" className="flex items-center gap-3 rounded-md bg-subtle px-4 py-3 text-sm text-ink-2">
        <span aria-hidden="true" className="size-4 shrink-0 animate-spin rounded-full border-2 border-line-strong border-t-brand" />
        This usually takes a few seconds.
      </div>
    </AuthLayout>
  );
}
