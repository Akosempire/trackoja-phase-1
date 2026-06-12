import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AuthLayout } from '../../components/AuthLayout';
import { FormField } from '../../components/ui/FormField';
import { Button } from '../../components/ui/Button';
import { AuthService } from '../../services/auth.service';

export default function VerifyEmailPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const email = searchParams.get('email') ?? '';

  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);

  const handleVerify = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setVerifying(true);

    try {
      await AuthService.verifyOtp(email, code);
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid or expired code. Please try again.');
    } finally {
      setVerifying(false);
    }
  };

  const handleResend = async () => {
    setError(null);
    setInfo(null);
    setResending(true);

    try {
      await AuthService.resendVerification(email);
      setInfo('Verification email sent. Check your inbox.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to resend email. Please try again.');
    } finally {
      setResending(false);
    }
  };

  return (
    <AuthLayout
      title="Verify your email"
      subtitle={email ? `We sent a verification link and code to ${email}` : 'Check your email for a verification link'}
      footer={
        <span>
          Wrong email? <Link to="/signup">Sign up again</Link>
        </span>
      }
    >
      {error && <div className="alert alert-error">{error}</div>}
      {info && <div className="alert alert-success">{info}</div>}

      <form onSubmit={handleVerify}>
        <FormField
          id="code"
          label="Verification code"
          value={code}
          onChange={setCode}
          placeholder="Enter the 6-digit code"
          autoComplete="one-time-code"
          required
        />
        <Button type="submit" loading={verifying} disabled={!email}>
          Verify email
        </Button>
      </form>

      <div className="form-row-end" style={{ marginTop: 16, justifyContent: 'center' }}>
        <Button type="button" variant="ghost" onClick={handleResend} loading={resending} disabled={!email}>
          Resend verification email
        </Button>
      </div>
    </AuthLayout>
  );
}
