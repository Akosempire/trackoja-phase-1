import { useEffect } from 'react';

/**
 * Adds `is-revealed` to every `[data-reveal]` element as it scrolls into view.
 *
 * Deliberately restrained: elements start slightly offset and fade in once, then
 * stop being observed. When the visitor prefers reduced motion, everything is
 * revealed immediately and no observer is created.
 */
export function useRevealOnScroll(): void {
  useEffect(() => {
    const nodes = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]'));

    const prefersReducedMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (prefersReducedMotion || typeof IntersectionObserver === 'undefined') {
      nodes.forEach((node) => node.classList.add('is-revealed'));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('is-revealed');
          observer.unobserve(entry.target);
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -8% 0px' }
    );

    nodes.forEach((node) => observer.observe(node));

    return () => observer.disconnect();
  }, []);
}
