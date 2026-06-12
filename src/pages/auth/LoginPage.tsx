import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AuthLayout } from '../../components/AuthLayout';
import { FormField } from '../../components/ui/FormField';
import { Button } from '../../components/ui/Button';
import { AuthService } from '../../services/auth.service';

export default function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      await AuthService.login({ email, password });
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to sign in. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Sign in to your TrackOja account"
      footer={
        <span>
          Don&apos;t have an account? <Link to="/signup">Create one</Link>
        </span>
      }
    >
      {error && <div className="alert alert-error">{error}</div>}
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
        <FormField
          id="password"
          label="Password"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          required
        />
        <div className="form-row-end">
          <Link to="/forgot-password" className="btn-ghost">
            Forgot password?
          </Link>
        </div>
        <Button type="submit" loading={loading}>
          Sign in
        </Button>
      </form>
    </AuthLayout>
  );
}
