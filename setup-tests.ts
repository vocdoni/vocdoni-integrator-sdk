import '@testing-library/jest-dom/vitest'
import { TextDecoder, TextEncoder } from 'node:util'
import { mockBatchJobs } from './mocks/handlers'
import { server } from './mocks/server'

Object.defineProperties(globalThis, {
  TextDecoder: { value: TextDecoder },
  TextEncoder: { value: TextEncoder },
})

beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }))
afterEach(() => {
  server.resetHandlers()
  mockBatchJobs.clear()
})
afterAll(() => server.close())

let consoleErrorSpy: ReturnType<typeof vi.spyOn> | undefined
let consoleWarnSpy: ReturnType<typeof vi.spyOn> | undefined

beforeEach(() => {
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  consoleErrorSpy?.mockRestore()
  consoleWarnSpy?.mockRestore()
})
