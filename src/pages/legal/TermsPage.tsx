import { Link } from 'react-router-dom';
import { COMPANY_NAME, CONTACT_EMAIL } from '../landing/landingContent';
import { Bullets, LegalLayout, Section } from './LegalLayout';

const Mail = () => <a className="font-medium text-brand-ink" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>;

export default function TermsPage() {
  return (
    <LegalLayout title="Terms of service" summary="The agreement between your business and us when you use TrackOja.">
      <Section title="1. The agreement">
        <p className="m-0">These terms are between {COMPANY_NAME} (“we”) and the business that signs up (“you”). By creating an account or using TrackOja you agree to them. If you sign up for a business, you confirm you’re allowed to act for it.</p>
        {/* TODO(founder): add the company's registered address and RC number once confirmed. */}
      </Section>

      <Section title="2. What TrackOja does">
        <p className="m-0">TrackOja helps you sell, keep track of stock, and see how your shop is doing. It records what you enter and what happens at your till. It doesn’t hold your money: payments go straight to you or to your payment provider.</p>
      </Section>

      <Section title="3. Your account and team">
        <Bullets items={[
          'Keep your sign-in details safe. You’re responsible for what happens under your account and your staff’s accounts.',
          'Give staff only the access they need. Remove people who leave.',
          'Tell us straight away at the email below if you think someone got into your account.',
        ]} />
      </Section>

      <Section title="4. Plans and payment">
        <Bullets items={[
          'Prices are shown before you pay. Plans renew for the period you chose unless you cancel.',
          'If a payment fails or a plan ends, some features may stop until you pay; your records are not deleted because of that.',
          'Fees already paid are not refunded for part-used periods, except where the law says otherwise.',
        ]} />
      </Section>

      <Section title="5. Your data">
        <p className="m-0">Your shop’s records belong to you. You can download them or delete your business at any time in Settings → Privacy &amp; data. How we handle personal data is set out in our <Link className="font-medium text-brand-ink" to="/privacy">privacy policy</Link>. You’re responsible for having the right to record your customers’ and staff’s details in TrackOja.</p>
      </Section>

      <Section title="6. Fair use">
        <p className="m-0">Don’t use TrackOja for anything illegal, to sell goods you aren’t allowed to sell, or to try to break, overload or get around its security. We may suspend accounts that do.</p>
      </Section>

      <Section title="7. Availability and your records">
        <p className="m-0">We work to keep TrackOja running and your data safe, including offline sales that sync later, but no service is perfect. Check your till, cash and stock counts regularly, and keep your own copy of important records (Settings → Privacy &amp; data → Download).</p>
      </Section>

      <Section title="8. Tax and the law">
        <p className="m-0">TrackOja shows figures to help you, but you remain responsible for your tax, prices and receipts meeting the rules that apply to your business.</p>
      </Section>

      <Section title="9. Liability">
        <p className="m-0">As far as the law allows, we aren’t liable for indirect losses such as lost profit, and our total liability is limited to what you paid us in the 12 months before the claim. Nothing here limits liability that the law doesn’t allow us to limit.</p>
      </Section>

      <Section title="10. Ending">
        <p className="m-0">You can stop using TrackOja and delete your business at any time. We may end or suspend the service for a serious breach of these terms, and will tell you why.</p>
      </Section>

      <Section title="11. Changes and the law">
        <p className="m-0">We may update these terms; if a change matters we’ll tell you in advance in the app or by email. These terms are governed by the laws of the Federal Republic of Nigeria.</p>
      </Section>

      <Section title="12. Contact">
        <p className="m-0">Questions: <Mail />.</p>
      </Section>
    </LegalLayout>
  );
}
