import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../../config/supabase';
import { AuthService } from '../../services/auth.service';
import { AuthLayout } from '../../components/AuthLayout';
import { PageLoader } from '../../components/ui/PageLoader';
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
        navigate('/dashboard', { replace: true });
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
          <div className="alert alert-success">
            New verification email sent to {resendEmail}. Check your inbox.
          </div>
        ) : (
          <>
            {resendEmail ? (
              <>
                <p style={{ fontSize: 14, color: 'var(--t2)', marginBottom: 16, textAlign: 'center' }}>
                  We'll send a fresh link to <strong>{resendEmail}</strong>
                </p>
                <Button onClick={handleResend} loading={resending}>
                  Resend verification email
                </Button>
              </>
            ) : (
              <>
                <p style={{ fontSize: 14, color: 'var(--t2)', marginBottom: 16, textAlign: 'center' }}>
                  Enter your email to get a new verification link.
                </p>
                <input
                  type="email"
                  className="input"
                  placeholder="you@example.com"
                  value={resendEmail}
                  onChange={(e) => setResendEmail(e.target.value)}
                  style={{ marginBottom: 12 }}
                />
                <Button onClick={handleResend} loading={resending} disabled={!resendEmail}>
                  Resend verification email
                </Button>
              </>
            )}
            <div style={{ textAlign: 'center', marginTop: 12 }}>
              <Link
                to={`/verify-email${resendEmail ? `?email=${encodeURIComponent(resendEmail)}` : ''}`}
                style={{ fontSize: 13, color: 'var(--t2)' }}
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
      <PageLoader />
    </AuthLayout>
  );
}
