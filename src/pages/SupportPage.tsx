import { startTour } from '../components/Tour';
import { Card, Page, PageHeader, btn } from '../components/kit';
import { SupportMessages } from '../components/SupportMessages';

const FAQS = [
  {
    question: 'How do I record a sale?',
    answer: 'Tap the Scan button on the bottom bar, or go to Sales → Record sale, add items to the cart, choose a payment method and complete checkout.',
  },
  {
    question: 'How do I add or update stock?',
    answer: 'Go to More → Products, open a product, and use Adjust stock, or update Stock Qty directly when editing the product.',
  },
  {
    question: 'How do I invite a staff member?',
    answer: 'Go to More → Staff and use Invite staff. They will receive access once they sign in with the invited email.',
  },
  {
    question: 'How do I verify a pending payment?',
    answer: 'Go to More → Payments and use Verify or Reject next to the pending transaction.',
  },
  {
    question: 'How do I change my store details or subscription?',
    answer: 'Go to More → Settings to edit store details, or More → Subscription to manage your plan and billing.',
  },
];

export default function SupportPage() {
  return (
    <Page width="form">
      <PageHeader title="Support" subtitle="Message the team, or find a quick answer below" actions={<button type="button" className={btn('outline')} onClick={startTour}>Take the tour</button>} />

      <SupportMessages fallbackEmail="mercuriusmerchandise@gmail.com" />

      <Card padded={false} className="overflow-hidden">
        <h2 className="m-0 px-4 pb-3 pt-4 text-[15px] font-semibold text-ink sm:px-5">Frequently asked questions</h2>
        <ul className="m-0 list-none divide-y divide-line border-t border-line p-0">
          {FAQS.map((faq) => (
            <li key={faq.question} className="px-4 py-3.5 sm:px-5">
              <p className="m-0 text-sm font-semibold text-ink">{faq.question}</p>
              <p className="m-0 mt-1 text-[13px] leading-5 text-ink-2">{faq.answer}</p>
            </li>
          ))}
        </ul>
      </Card>
    </Page>
  );
}
