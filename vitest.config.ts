import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

const rootDir = path.dirname(fileURLToPath(import.meta.url))

const pkg = (name: string) => path.resolve(rootDir, `packages/${name}/src/index.ts`)

export default defineConfig({
  plugins: [tsconfigPaths()],
  // Resolve workspace packages to their TypeScript source so unit tests run
  // against current source (no build step, always fresh). Integration tests
  // intentionally test the built dist instead — see integration/vitest.config.ts.
  resolve: {
    alias: {
      '@vocdoni/api-types': pkg('api-types'),
      '@vocdoni/ballot': pkg('ballot'),
      '@vocdoni/metadata-verify': pkg('metadata-verify'),
      '@vocdoni/api-client': pkg('api-client'),
      '@vocdoni/api-voting': pkg('api-voting'),
      '@vocdoni/react-providers': pkg('react-providers'),
      '@vocdoni/react-components': pkg('react-components'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: [path.resolve(rootDir, 'setup-tests.ts')],
    include: ['packages/*/src/**/*.test.ts', 'packages/*/src/**/*.test.tsx'],
    exclude: ['**/dist/**', '**/node_modules/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'json'],
      reportOnFailure: true,
      include: ['packages/*/src/**/*.{ts,tsx}'],
      exclude: ['**/*.test.{ts,tsx}', '**/dist/**'],
    },
  },
})
