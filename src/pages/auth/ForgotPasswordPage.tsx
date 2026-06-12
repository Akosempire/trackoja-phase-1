import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { AuthLayout } from '../../components/AuthLayout';
import { FormField } from '../../components/ui/FormField';
import { Button } from '../../components/ui/Button';
import { AuthService } from '../../services/auth.service';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      await AuthService.forgotPassword(email);
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to send reset email. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      title="Reset your password"
      subtitle="We'll email you a link to reset your password"
      footer={
        <span>
          Remembered your password? <Link to="/login">Sign in</Link>
        </span>
      }
    >
      {error && <div className="alert alert-error">{error}</div>}
      {sent ? (
        <div className="alert alert-success">
          If an account exists for {email}, a password reset link has been sent. Check your inbox.
        </div>
      ) : (
        <form onSubmit={handleSubmit}>
          <FormField
            id="email"
            label="Email address"
            type="email"
            value={email}
            onChange={setEmail}
            placeholder="you@example.com"
            autoComplete="email"
            required
          />
          <Button type="submit" loading={loading}>
            Send reset link
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
