import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../config/supabase';
import { AuthLayout } from '../../components/AuthLayout';
import { PageLoader } from '../../components/ui/PageLoader';

export default function AuthCallbackPage() {
  const navigate = useNavigate();
  const navigated = useRef(false);

  useEffect(() => {
    const go = () => {
      if (!navigated.current) {
        navigated.current = true;
        navigate('/dashboard', { replace: true });
      }
    };

    // detectSessionInUrl:true processes the URL hash automatically.
    // Subscribe first so we don't miss the SIGNED_IN / USER_UPDATED event.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) go();
    });

    // Fallback: session may already be established if Supabase processed the
    // hash before this component mounted.
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) go();
    });

    return () => subscription.unsubscribe();
  }, [navigate]);

  return (
    <AuthLayout title="Verifying your email…" subtitle="Please wait while we confirm your account.">
      <PageLoader />
    </AuthLayout>
  );
}
