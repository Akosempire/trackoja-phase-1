-- Redacted platform diagnostics for merchant POS. Platform subscription
-- payments remain in their own tables and do not include these amounts.
CREATE OR REPLACE FUNCTION public.platform_moniepoint_health()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result JSONB;
BEGIN
  IF auth.uid() IS NULL OR NOT public.platform_user_has_permission(auth.uid(), 'platform:manage_integrations') THEN
    RAISE EXCEPTION 'Platform integrations permission required';
  END IF;
  SELECT jsonb_build_object(
    'liveConnections', COUNT(*) FILTER (WHERE environment = 'live' AND status <> 'disconnected'),
    'sandboxConnections', COUNT(*) FILTER (WHERE environment = 'sandbox' AND status <> 'disconnected'),
    'verifiedConnections', COUNT(*) FILTER (WHERE status = 'connected'),
    'lastVerifiedAt', MAX(last_verified_at)
  ) INTO v_result FROM public.merchant_provider_connections WHERE provider = 'moniepoint';
  v_result := v_result || (
    SELECT jsonb_build_object(
      'livePending', COUNT(*) FILTER (WHERE environment = 'live' AND status IN ('sending', 'pending', 'unresolved')),
      'liveNeedsReconciliation', COUNT(*) FILTER (WHERE environment = 'live' AND status = 'reconciliation_required'),
      'sandboxPending', COUNT(*) FILTER (WHERE environment = 'sandbox' AND status IN ('sending', 'pending', 'unresolved')),
      'sandboxNeedsReconciliation', COUNT(*) FILTER (WHERE environment = 'sandbox' AND status = 'reconciliation_required'),
      'liveTransactionsToday', COUNT(*) FILTER (WHERE environment = 'live' AND initiated_at >=
        (timezone('Africa/Lagos', now())::date::timestamp AT TIME ZONE 'Africa/Lagos')),
      'liveSuccessfulToday', COUNT(*) FILTER (WHERE environment = 'live' AND status = 'successful' AND initiated_at >=
        (timezone('Africa/Lagos', now())::date::timestamp AT TIME ZONE 'Africa/Lagos')),
      'liveFailedToday', COUNT(*) FILTER (WHERE environment = 'live' AND status = 'failed' AND initiated_at >=
        (timezone('Africa/Lagos', now())::date::timestamp AT TIME ZONE 'Africa/Lagos'))
    ) FROM public.merchant_payment_attempts WHERE provider = 'moniepoint'
  );
  v_result := v_result || (
    SELECT jsonb_build_object('activeTerminals', COUNT(*))
    FROM public.devices WHERE type = 'payment_terminal' AND provider = 'moniepoint' AND status = 'active'
  );
  RETURN v_result || (
    SELECT jsonb_build_object(
      'providerUnavailable24h', COUNT(*) FILTER (WHERE outcome = 'unavailable'),
      'providerRejected24h', COUNT(*) FILTER (WHERE outcome = 'failed'),
      'averageLatencyMs24h', ROUND(AVG(latency_ms))
    ) FROM public.merchant_provider_events
    WHERE provider = 'moniepoint' AND created_at >= now() - INTERVAL '24 hours'
  );
END;
$$;
REVOKE ALL ON FUNCTION public.platform_moniepoint_health() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.platform_moniepoint_health() TO authenticated;
