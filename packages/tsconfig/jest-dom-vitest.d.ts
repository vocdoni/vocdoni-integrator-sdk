// jest-dom's own `@testing-library/jest-dom/vitest` types still augment
// `Assertion<T>` (a single type parameter). Vitest 5 changed the public
// extension point to `Matchers<R, T>`, so that augmentation no longer merges
// and every jest-dom matcher disappears from the type checker (silently —
// `skipLibCheck` hides the arity error). Augment the v5 interface ourselves.
//
// Remove this once @testing-library/jest-dom ships vitest 5 support.
import type { TestingLibraryMatchers } from '@testing-library/jest-dom/matchers'

declare module 'vitest' {
  interface Matchers<R extends void | Promise<void> = void | Promise<void>, T = unknown>
    extends TestingLibraryMatchers<any, R> {}
}
