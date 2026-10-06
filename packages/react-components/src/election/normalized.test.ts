import { describe, expect, it } from 'vitest'
import {
  getElectionDate,
  getElectionDescription,
  getElectionField,
  getElectionStatus,
  getElectionTitle,
  isInvalidElectionLike,
  isPublishedElectionLike,
  resolveDescription,
  resolveTitle,
} from './normalized'

describe('normalized election helpers', () => {
  describe('getElectionTitle', () => {
    it('returns a plain string title', () => {
      expect(getElectionTitle({ title: 'Hello' })).toBe('Hello')
    })
    it('resolves an i18n object via default then first value', () => {
      expect(getElectionTitle({ title: { default: 'Def', es: 'Hola' } })).toBe('Def')
      expect(getElectionTitle({ title: { es: 'Hola' } })).toBe('Hola')
    })
    it('falls back to id, then empty string', () => {
      expect(getElectionTitle({ id: 'abc' })).toBe('abc')
      expect(getElectionTitle(null)).toBe('')
    })
  })

  describe('getElectionDescription', () => {
    it('resolves string and i18n descriptions, undefined when absent', () => {
      expect(getElectionDescription({ description: 'D' })).toBe('D')
      expect(getElectionDescription({ description: { default: 'D' } })).toBe('D')
      expect(getElectionDescription({})).toBeUndefined()
    })
  })

  describe('getElectionStatus', () => {
    it('returns the status or undefined', () => {
      expect(getElectionStatus({ status: 'READY' })).toBe('READY')
      expect(getElectionStatus(null)).toBeUndefined()
    })
  })

  describe('getElectionField', () => {
    it('reads nested dot paths safely', () => {
      expect(getElectionField({ a: { b: { c: 1 } } }, 'a.b.c')).toBe(1)
      expect(getElectionField({ a: {} }, 'a.b.c')).toBeUndefined()
      expect(getElectionField(null, 'a')).toBeUndefined()
    })
  })

  describe('getElectionDate', () => {
    it('coerces ISO strings to Date and passes through Date instances', () => {
      const d = getElectionDate({ startDate: '2024-01-01T00:00:00Z' }, 'startDate')
      expect(d).toBeInstanceOf(Date)
      const existing = new Date()
      expect(getElectionDate({ endDate: existing }, 'endDate')).toBe(existing)
      expect(getElectionDate({}, 'startDate')).toBeUndefined()
    })
  })

  describe('resolveTitle / resolveDescription', () => {
    it('resolves strings, i18n objects and empties', () => {
      expect(resolveTitle('x')).toBe('x')
      expect(resolveTitle({ default: 'x', fr: 'y' })).toBe('x')
      expect(resolveTitle(undefined)).toBe('')
      expect(resolveDescription({ fr: 'y' })).toBe('y')
      expect(resolveDescription(undefined)).toBeUndefined()
    })
  })

  describe('isInvalid/isPublishedElectionLike', () => {
    it('flips on presence of an election', () => {
      expect(isInvalidElectionLike(null)).toBe(true)
      expect(isPublishedElectionLike(null)).toBe(false)
      expect(isInvalidElectionLike({ id: 'a' })).toBe(false)
      expect(isPublishedElectionLike({ id: 'a' })).toBe(true)
    })
  })
})
