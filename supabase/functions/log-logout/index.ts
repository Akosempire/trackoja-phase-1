// Edge Function: log-logout
// Writes the LOGOUT audit log entry. This event has no corresponding database
// write to hook a trigger into (unlike LOGIN, STORE_CREATED, STORE_SWITCHED,
// STAFF_INVITED/ACCEPTED - see database/011_audit_log_triggers.sql), so the SPA
// calls this function while the user's session is still valid, just before
// supabase.auth.signOut(). The actor's identity is taken from their verified
// JWT, never from the request body.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Missing authorization header' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) {
      return new Response(JSON.stringify({ error: 'Invalid session' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const actorId = userData.user.id;
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: profile } = await adminClient
      .from('users')
      .select('current_org_id, current_store_id')
      .eq('id', actorId)
      .single();

    if (profile?.current_org_id) {
      await adminClient.from('audit_logs').insert({
        actor_id: actorId,
        org_id: profile.current_org_id,
        store_id: profile.current_store_id,
        action: 'LOGOUT',
        resource_type: 'auth_session',
        resource_id: actorId,
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
