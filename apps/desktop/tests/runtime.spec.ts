import { describe, expect, it } from 'vitest'
import { parseRuntimeReadyUrl } from '../src/runtime.ts'

describe('parseRuntimeReadyUrl', () => {
  it('extracts the loopback URL from the DSH readiness line', () => {
    expect(parseRuntimeReadyUrl('booting...\ndsh web: http://127.0.0.1:49321\n'))
      .toBe('http://127.0.0.1:49321')
  })

  it('works when stdout arrives in accumulated chunks', () => {
    expect(parseRuntimeReadyUrl('dsh web: http://127.0.0.1:'))
      .toBeUndefined()
    expect(parseRuntimeReadyUrl('dsh web: http://127.0.0.1:60214'))
      .toBe('http://127.0.0.1:60214')
  })

  it('does not accept a non-loopback readiness URL', () => {
    expect(parseRuntimeReadyUrl('dsh web: http://192.168.1.10:3080'))
      .toBeUndefined()
  })
})
