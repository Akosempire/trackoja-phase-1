import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AuthLayout } from '../../components/AuthLayout';
import { FormField } from '../../components/ui/FormField';
import { Button } from '../../components/ui/Button';
import { AuthService } from '../../services/auth.service';

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // The recovery link establishes a session via the URL hash
    // (detectSessionInUrl: true). Confirm a session exists before
    // allowing the user to set a new password.
    AuthService.getSession().then((session) => {
      setReady(Boolean(session));
    });
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }

    setLoading(true);
    try {
      await AuthService.resetPassword(password);
      setSuccess(true);
      setTimeout(() => navigate('/login', { replace: true }), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to reset password. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      title="Set a new password"
      subtitle="Choose a new password for your account"
      footer={
        <span>
          Back to <Link to="/login">sign in</Link>
        </span>
      }
    >
      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">Password updated. Redirecting to sign in&hellip;</div>}
      {!ready && !success && (
        <div className="alert alert-error">
          This page must be opened from the password reset link in your email.
        </div>
      )}
      {ready && !success && (
        <form onSubmit={handleSubmit}>
          <FormField
            id="password"
            label="New password"
            type="password"
            value={password}
            onChange={setPassword}
            placeholder="At least 8 characters"
            autoComplete="new-password"
            required
          />
          <FormField
            id="confirmPassword"
            label="Confirm new password"
            type="password"
            value={confirmPassword}
            onChange={setConfirmPassword}
            autoComplete="new-password"
            required
          />
          <Button type="submit" loading={loading}>
            Update password
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
