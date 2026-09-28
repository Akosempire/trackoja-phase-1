import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AuthLayout } from '../../components/AuthLayout';
import { FormField } from '../../components/ui/FormField';
import { Button } from '../../components/ui/Button';
import { AuthService } from '../../services/auth.service';

export default function SignUpPage() {
  const navigate = useNavigate();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (password !== confirmPassword) { setError('Passwords do not match.'); return; }
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    setLoading(true);
    try {
      const { session } = await AuthService.signup({ email, password, firstName, lastName });
      if (session) navigate('/onboarding', { replace: true });
      else {
        sessionStorage.setItem('tk_verify_email', email);
        navigate(`/verify-email?email=${encodeURIComponent(email)}`, { replace: true });
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Something went wrong. Please try again.');
    } finally { setLoading(false); }
  }

  return <AuthLayout title="Create your account" subtitle="Start managing your business with TrackOja"
    footer={<span>Already have an account? <Link to="/login">Sign in</Link></span>}>
    {error && <div className="alert alert-error" role="alert">{error}</div>}
    <form onSubmit={handleSubmit}>
      <div className="auth-form-row">
        <FormField id="firstName" label="First name" value={firstName} onChange={setFirstName} autoComplete="given-name" required />
        <FormField id="lastName" label="Last name" value={lastName} onChange={setLastName} autoComplete="family-name" required />
      </div>
      <FormField id="email" label="Email address" type="email" value={email} onChange={setEmail} autoComplete="email" required />
      <FormField id="password" label="Password" type="password" value={password} onChange={setPassword} autoComplete="new-password" required hint="At least 8 characters." />
      <FormField id="confirmPassword" label="Confirm password" type="password" value={confirmPassword} onChange={setConfirmPassword} autoComplete="new-password" required />
      <Button type="submit" loading={loading}>Create account</Button>
    </form>
  </AuthLayout>;
}
