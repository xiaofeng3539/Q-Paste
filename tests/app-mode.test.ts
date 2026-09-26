import { describe, expect, it } from 'vitest'
import { resolveAppMode } from '../src/lib/app-mode'

describe('resolveAppMode', () => {
  it('defaults to clipboard mode', () => {
    expect(resolveAppMode(undefined)).toBe('clipboard')
  })

  it('accepts only supported modes', () => {
    expect(resolveAppMode('floral')).toBe('floral')
    expect(resolveAppMode('clipboard')).toBe('clipboard')
    expect(resolveAppMode('other')).toBe('clipboard')
  })
})
