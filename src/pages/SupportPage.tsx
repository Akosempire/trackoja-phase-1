import { Card, Page, PageHeader, btn } from '../components/kit';
import { SupportIcon } from '../components/icons';

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
      <PageHeader title="Support" subtitle="Help and frequently asked questions" />

      <Card className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-center lg:mb-6">
        <span aria-hidden="true" className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand-ink">
          <SupportIcon width={22} height={22} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="m-0 text-[15px] font-semibold text-ink">Need help?</h2>
          <p className="m-0 mt-0.5 text-sm text-ink-2">Reach our support team and we'll get back to you as soon as possible.</p>
        </div>
        <a className={btn('primary')} href="mailto:mercuriusmerchandise@gmail.com">Email support</a>
      </Card>

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
