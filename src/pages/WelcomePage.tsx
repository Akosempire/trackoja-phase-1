import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { SellIllustration } from '../components/illustrations/SellIllustration';
import { StockIllustration } from '../components/illustrations/StockIllustration';
import { TeamIllustration } from '../components/illustrations/TeamIllustration';

const SLIDES = [
  {
    illustration: <SellIllustration />,
    title: 'Sell in seconds',
    description:
      'Ring up sales from your phone. Search products or scan barcodes with your camera, then accept cash, card, transfer, or customer credit.',
  },
  {
    illustration: <StockIllustration />,
    title: 'Stay on top of stock',
    description:
      'Organize products into categories, track stock levels in real time, and get alerted automatically when items are running low.',
  },
  {
    illustration: <TeamIllustration />,
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

          <div className="welcome-illustration">{slide.illustration}</div>
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
