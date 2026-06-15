const FAQS = [
  {
    question: 'How do I record a sale?',
    answer: 'Tap the Scan button on the bottom bar, or go to Sales → New sale, add items to the cart, choose a payment method and complete checkout.',
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
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Support</h1>
          <p className="page-subtitle">Help and frequently asked questions</p>
        </div>
      </div>

      <div className="card">
        <p className="list-item-title" style={{ marginBottom: 8 }}>
          Need help?
        </p>
        <p className="page-subtitle" style={{ marginBottom: 12 }}>
          Reach our support team and we'll get back to you as soon as possible.
        </p>
        <div className="btn-row" style={{ flexWrap: 'wrap' }}>
          <a className="btn btn-primary btn-sm" href="mailto:ibroakoss@gmail.com">
            Email support
          </a>
        </div>
      </div>

      <div className="card">
        <p className="list-item-title" style={{ marginBottom: 8 }}>
          Frequently asked questions
        </p>
        <div className="list">
          {FAQS.map((faq) => (
            <div key={faq.question} className="list-item" style={{ cursor: 'default', flexDirection: 'column', alignItems: 'flex-start' }}>
              <p className="list-item-title">{faq.question}</p>
              <p className="list-item-subtitle">{faq.answer}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
