import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		globals: true,
		environment: 'node',
		include: ['**/*.test.ts', '**/*.test.tsx'],
		exclude: [
			'node_modules',
			'build',
			'.cache',
			'extensions/**/node_modules/**',
			'extensions/**/*.test.ts',
			'extensions/**/*.test.tsx',
		],
		environmentMatchGlobs: [
			// jsdom required for React component tests
			// Install jsdom if running component tests: bun add -d jsdom
			['**/components/**/*.test.tsx', 'jsdom'],
		],
		setupFiles: ['./vitest.setup.ts'],
	},
});
