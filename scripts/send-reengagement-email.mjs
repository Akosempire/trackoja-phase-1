/**
 * One-time script: send a re-engagement email to all users who signed up
 * but have not yet confirmed their email address.
 *
 * Prerequisites
 * -------------
 * Set these two environment variables before running:
 *
 *   SUPABASE_SERVICE_ROLE_KEY=<from Supabase Dashboard → Settings → API>
 *   BREVO_API_KEY=<from Brevo Dashboard → SMTP & API → API Keys>
 *
 * Run:
 *   node scripts/send-reengagement-email.mjs
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://xegcukmbinkyffzmfejc.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BREVO_API_KEY = process.env.BREVO_API_KEY;

const FROM_EMAIL = 'hello@trackoja.com';  // must match your verified Brevo sender
const FROM_NAME  = 'TrackOja';

const SUBJECT = 'We noticed you had trouble signing up on TrackOja';

const HTML_BODY = `
<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px;">
  <h2 style="color:#6366f1;">TrackOja</h2>
  <p>Hi there,</p>
  <p>
    We noticed you started signing up on <strong>TrackOja</strong> but may have
    run into a challenge completing the process.
  </p>
  <p>
    We've fixed the issue — you can now sign up smoothly and receive your
    6-digit verification code by email.
  </p>
  <p style="margin:28px 0;">
    <a href="https://trackoja-community.vercel.app/signup"
       style="background:#6366f1;color:#fff;padding:12px 28px;border-radius:8px;
              text-decoration:none;font-weight:700;display:inline-block;">
      Retry Sign Up →
    </a>
  </p>
  <p style="color:#6b7280;font-size:13px;">
    If you weren't trying to sign up, you can safely ignore this email.
  </p>
  <p style="color:#6b7280;font-size:13px;">— The TrackOja Team</p>
</div>
`;

const TEXT_BODY = `Hi,

We noticed you started signing up on TrackOja but may have run into a challenge.

We've fixed the issue — you can now sign up and receive a 6-digit verification code by email.

Retry here: https://trackoja-community.vercel.app/signup

If you weren't trying to sign up, ignore this email.

— The TrackOja Team`;

// ─── helpers ────────────────────────────────────────────────────────────────

async function sendEmail(toEmail, toName) {
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': BREVO_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      sender: { name: FROM_NAME, email: FROM_EMAIL },
      to: [{ email: toEmail, name: toName || toEmail }],
      subject: SUBJECT,
      htmlContent: HTML_BODY,
      textContent: TEXT_BODY,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Brevo error ${res.status}: ${err}`);
  }
  return res.json();
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ─── main ───────────────────────────────────────────────────────────────────

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error('ERROR: SUPABASE_SERVICE_ROLE_KEY env var is not set.');
  process.exit(1);
}
if (!BREVO_API_KEY) {
  console.error('ERROR: BREVO_API_KEY env var is not set.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

console.log('Fetching unconfirmed users from Supabase…');

// Paginate through all users (Supabase returns max 1000 per page)
let page = 1;
const allUnconfirmed = [];

while (true) {
  const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
  if (error) { console.error('Supabase error:', error.message); process.exit(1); }

  const unconfirmed = data.users.filter(u => !u.email_confirmed_at && u.email);
  allUnconfirmed.push(...unconfirmed);

  if (data.users.length < 1000) break;
  page++;
}

console.log(`Found ${allUnconfirmed.length} unconfirmed user(s).`);

if (allUnconfirmed.length === 0) {
  console.log('Nothing to send. Exiting.');
  process.exit(0);
}

let sent = 0;
let failed = 0;

for (const user of allUnconfirmed) {
  const name = [
    user.user_metadata?.first_name,
    user.user_metadata?.last_name,
  ].filter(Boolean).join(' ') || user.email;

  try {
    await sendEmail(user.email, name);
    console.log(`  ✓ Sent to ${user.email}`);
    sent++;
  } catch (err) {
    console.error(`  ✗ Failed for ${user.email}: ${err.message}`);
    failed++;
  }

  // Brevo free tier: ~3 req/s — small delay to be safe
  await sleep(400);
}

console.log(`\nDone. ${sent} sent, ${failed} failed.`);
