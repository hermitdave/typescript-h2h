import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 1_800_000,
    hookTimeout: 300_000,
    include: ['tests/**/*.test.ts'],
  },
});
