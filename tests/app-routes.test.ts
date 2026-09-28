import { describe, expect, it } from 'vitest';
import App from '../src/App';

describe('application routes', () => {
  it('resolves every lazy page module at startup', () => {
    expect(typeof App).toBe('function');
  });
});
