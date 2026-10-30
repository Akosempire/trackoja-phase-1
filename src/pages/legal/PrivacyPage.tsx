import { Link } from 'react-router-dom';
import { COMPANY_NAME, CONTACT_EMAIL } from '../landing/landingContent';
import { Bullets, LegalLayout, Section } from './LegalLayout';

const Mail = () => <a className="font-medium text-brand" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>;

const PROCESSORS: [string, string, string][] = [
  ['Supabase', 'Database, sign-in and file storage', 'EU / US'],
  ['Cloudflare (R2)', 'Product photos', 'Global'],
  ['Our hosting provider', 'Serving the TrackOja app', 'Global'],
  ['Paystack', 'Paying for your TrackOja plan', 'Nigeria'],
  ['OPay', 'Paying for your TrackOja plan', 'Nigeria'],
  ['Moniepoint', 'Card payments on your POS terminals, when you connect them', 'Nigeria'],
  ['Usetally', 'Sending our emails, our support inbox, and the Usetally connection when you turn it on', 'Nigeria / EU'],
];

export default function PrivacyPage() {
  return (
    <LegalLayout title="Privacy policy" summary="What TrackOja collects, why, who helps us run it, and the choices you have.">
      <Section title="1. Who we are">
        <p className="m-0">TrackOja is a point-of-sale and stock app for shops, run by {COMPANY_NAME} (“we”). For anything about your data, email <Mail />.</p>
        {/* TODO(founder): add the company's registered address and RC number here once confirmed. */}
      </Section>

      <Section title="2. Two kinds of data">
        <Bullets items={[
          <><strong className="text-ink">Your account and business:</strong> we decide how this is used, so we are the controller.</>,
          <><strong className="text-ink">Your shop's records</strong> (products, sales, customers, staff): you decide what goes in. We store and process it for you, on your instructions.</>,
        ]} />
      </Section>

      <Section title="3. What we collect">
        <Bullets items={[
          'Account details: name, email, phone, and your password (kept by our sign-in provider; we never see it).',
          'Business and store details: names, address, currency, time zone, logo.',
          'What you record: products and photos, stock movements, sales, payments, refunds, customers and their credit, suppliers, expenses.',
          'Staff: who is on your team, their role, and which sales they rang up.',
          'Devices and POS terminals you register, and card payment results from Moniepoint (never full card numbers).',
          'How the app is used: which screens are open and for how long, counted only while you are active. We don’t record what you type or what is on screen.',
          'Messages you send us from Support.',
          'Technical data: IP address, browser and device type, error logs, used for security and fixing problems.',
        ]} />
      </Section>

      <Section title="4. Why we use it">
        <Bullets items={[
          'To run TrackOja for you: checkout, receipts, stock, reports (our contract with you).',
          'To bill you for your plan (contract).',
          'To send service emails, such as the daily summary you can turn off in Settings (contract and legitimate interest).',
          'To answer support messages and feature requests (legitimate interest).',
          'To see which parts of TrackOja are used, so we know what to improve (legitimate interest).',
          'To keep TrackOja secure and meet legal duties (legitimate interest and legal obligation).',
        ]} />
        <p className="m-0">We don’t sell your data, and we don’t use your shop’s records for advertising.</p>
      </Section>

      <Section title="5. Who helps us run TrackOja">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13.5px]">
            <thead><tr className="border-b border-line text-ink-3"><th className="py-2 pr-3 font-medium">Provider</th><th className="py-2 pr-3 font-medium">What for</th><th className="py-2 font-medium">Where</th></tr></thead>
            <tbody className="divide-y divide-line">
              {PROCESSORS.map(([n, w, l]) => <tr key={n}><td className="py-2 pr-3 font-medium text-ink">{n}</td><td className="py-2 pr-3">{w}</td><td className="py-2">{l}</td></tr>)}
            </tbody>
          </table>
        </div>
        <p className="m-0">When data leaves Nigeria we rely on the safeguards the Nigeria Data Protection Act 2023 allows, such as contracts and providers with recognised security standards.</p>
      </Section>

      <Section title="6. How long we keep it">
        <p className="m-0">While your business is open, we keep its records so your history and receipts stay available. When the owner deletes a business, it is removed for good 30 days later (you can cancel until then); backups expire shortly after. When you delete your own account, your name, email and phone are removed straight away; sales you rang up stay in the business’s records without your name. Records of payments to us are kept for 6 years, as tax law requires.</p>
      </Section>

      <Section title="7. Your rights">
        <p className="m-0">You can ask to see, correct, download or delete your data, object to how we use it, or withdraw consent. Most of it you can do yourself in <strong className="text-ink">Settings → Privacy &amp; data</strong>: download your store’s data, delete your business, or delete your account. For anything else, email <Mail /> and we will reply within 30 days. You can also complain to the Nigeria Data Protection Commission, or in the UK to the Information Commissioner’s Office.</p>
        <p className="m-0">If you are a customer of a shop that uses TrackOja, ask that shop first; we will help them answer.</p>
      </Section>

      <Section title="8. Cookies and your device">
        <p className="m-0">TrackOja doesn’t use advertising cookies. It stores what it needs on your device to keep you signed in, remember your store and theme, and save sales made offline until they can be sent.</p>
      </Section>

      <Section title="9. Security">
        <Bullets items={[
          'Each business’s data is kept apart at the database level.',
          'Staff only see what their role allows.',
          'Payment provider keys are stored as server secrets, and all traffic uses HTTPS.',
        ]} />
      </Section>

      <Section title="10. Children">
        <p className="m-0">TrackOja is for businesses and isn’t meant for anyone under 18.</p>
      </Section>

      <Section title="11. Changes">
        <p className="m-0">We may update this policy. If a change matters, we’ll tell you in the app or by email. See also our <Link className="font-medium text-brand" to="/terms">terms of service</Link>.</p>
      </Section>
    </LegalLayout>
  );
}
