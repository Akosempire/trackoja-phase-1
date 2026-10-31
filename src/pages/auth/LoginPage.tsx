import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AuthLayout, AuthNotice, authSubmitClass } from '../../components/AuthLayout';
import { APP_NAME } from '../../config/brand';
import { FormField } from '../../components/ui/FormField';
import { Button } from '../../components/ui/Button';
import { AuthService } from '../../services/auth.service';

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
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
      navigate('/auth/continue' + location.search, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to sign in. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      title="Welcome back"
      subtitle={`Sign in to your ${APP_NAME} account`}
      footer={
        <span>
          Don&apos;t have an account? <Link to="/signup">Create one</Link>
        </span>
      }
    >
      {error && <AuthNotice>{error}</AuthNotice>}
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
        <div className="-mt-1 mb-5 flex justify-end">
          <Link to="/forgot-password" className="text-[13px] font-medium text-brand-ink no-underline hover:underline">
            Forgot password?
          </Link>
        </div>
        <Button type="submit" loading={loading} className={authSubmitClass}>
          Sign in
        </Button>
      </form>
    </AuthLayout>
  );
}
