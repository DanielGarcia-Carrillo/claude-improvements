import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { mustUpdate } from './update-policy.ts'

const builtAt = '2026-10-28T12:00:00.000Z'

describe('mustUpdate', () => {
  it.each<[string, unknown, boolean]>([
    ['a cutoff after the build', { forceUpdateBefore: '2026-10-28T18:00:00Z' }, true],
    ['a cutoff with an offset, after the build', { forceUpdateBefore: '2026-10-28T09:00:00-04:00' }, true],
    ['a cutoff before the build', { forceUpdateBefore: '2026-10-28T11:59:59Z' }, false],
    ['a cutoff at the build itself', { forceUpdateBefore: builtAt }, false],
    ['the default', { forceUpdateBefore: null }, false],
    ['a cutoff without a zone', { forceUpdateBefore: '2026-10-28T18:00:00' }, false],
    ['a date alone', { forceUpdateBefore: '2026-10-29' }, false],
    ['a cutoff that is not a date', { forceUpdateBefore: 'tomorrow' }, false],
    ['an empty policy', {}, false],
    ['a policy that is not an object', 'force', false],
    ['no policy', null, false],
  ])('%s', (_case, policy, expected) => {
    expect(mustUpdate(policy, builtAt)).toBe(expected)
  })

  it('forces nothing when the build time is unreadable', () => {
    expect(mustUpdate({ forceUpdateBefore: '2026-10-28T18:00:00Z' }, 'unknown')).toBe(false)
  })
})

describe('public/update-policy.json', () => {
  // A cutoff without a zone, or a typo, forces nothing without a word, so
  // the committed file must be the default or a well-formed instant.
  it('forces nothing, or names an instant mustUpdate reads', () => {
    const policy: unknown = JSON.parse(
      readFileSync(new URL('../../public/update-policy.json', import.meta.url), 'utf8'),
    )
    const isDefault =
      typeof policy === 'object' &&
      policy !== null &&
      'forceUpdateBefore' in policy &&
      policy.forceUpdateBefore === null
    expect(isDefault || mustUpdate(policy, '1970-01-01T00:00:00Z')).toBe(true)
  })
})
