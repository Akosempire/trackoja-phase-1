import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/Button';

function CartIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="21" r="1" />
      <circle cx="20" cy="21" r="1" />
      <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
    </svg>
  );
}

function BoxIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
    </svg>
  );
}

function TeamIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

const SLIDES = [
  {
    icon: <CartIcon />,
    title: 'Sell in seconds',
    description:
      'Ring up sales from your phone. Search products or scan barcodes with your camera, then accept cash, card, transfer, or customer credit.',
  },
  {
    icon: <BoxIcon />,
    title: 'Stay on top of stock',
    description:
      'Organize products into categories, track stock levels in real time, and get alerted automatically when items are running low.',
  },
  {
    icon: <TeamIcon />,
    title: 'Run your whole team',
    description:
      'Invite staff with the right roles and permissions, and watch revenue, transactions, and stock on one live dashboard.',
  },
];

const WELCOME_SEEN_KEY = 'tk_welcome_seen';

export default function WelcomePage() {
  const navigate = useNavigate();
  const [index, setIndex] = useState(0);
  const isLast = index === SLIDES.length - 1;
  const slide = SLIDES[index];

  const finish = (path: string) => {
    localStorage.setItem(WELCOME_SEEN_KEY, '1');
    navigate(path, { replace: true });
  };

  const handleNext = () => {
    if (isLast) {
      finish('/signup');
    } else {
      setIndex((i) => i + 1);
    }
  };

  return (
    <div className="auth-shell">
      <div className="auth-bg-glow" />
      <div className="auth-bg-grid" />
      <div className="auth-content">
        <div className="auth-logo">
          <div className="auth-logo-row">
            <div className="auth-logo-mark">T</div>
            <span className="auth-logo-name">TrackOja</span>
          </div>
          <span className="auth-logo-tagline">Retail Management Platform</span>
        </div>

        <div className="auth-card welcome-card">
          <button type="button" className="btn-ghost welcome-skip" onClick={() => finish('/login')}>
            Skip
          </button>

          <div className="welcome-icon">{slide.icon}</div>
          <h1 className="auth-title" style={{ textAlign: 'center' }}>
            {slide.title}
          </h1>
          <p className="auth-subtitle" style={{ textAlign: 'center' }}>
            {slide.description}
          </p>

          <div className="welcome-dots">
            {SLIDES.map((_, i) => (
              <button
                key={i}
                type="button"
                className={`welcome-dot${i === index ? ' active' : ''}`}
                aria-label={`Go to slide ${i + 1}`}
                onClick={() => setIndex(i)}
              />
            ))}
          </div>

          <Button onClick={handleNext}>{isLast ? 'Get started' : 'Next'}</Button>
        </div>

        <div className="auth-footer">
          <span>
            Already have an account?{' '}
            <Link to="/login" onClick={() => localStorage.setItem(WELCOME_SEEN_KEY, '1')}>
              Sign in
            </Link>
          </span>
        </div>
      </div>
    </div>
  );
}
