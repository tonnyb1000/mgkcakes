import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';

// jsdom does not implement window.print
Object.defineProperty(window, 'print', {
  writable: true,
  configurable: true,
  value: vi.fn(),
});

afterEach(() => {
  window.sessionStorage.clear();
});
