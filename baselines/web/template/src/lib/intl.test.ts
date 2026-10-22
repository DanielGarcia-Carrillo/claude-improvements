import { describe, expect, it } from 'vitest'

import { formatDay, type Viewer } from './intl.ts'

// 07:30 UTC is still the previous evening on the US west coast, and US
// daylight saving starts later that day: a zone bug shows up as the wrong day.
const instant = Temporal.Instant.from('2026-03-08T07:30:00Z')

describe('formatDay', () => {
  it.each<[Viewer, string]>([
    [{ locale: 'en-US', timeZone: 'America/Los_Angeles' }, 'Saturday, March 7, 2026'],
    [{ locale: 'en-GB', timeZone: 'Europe/London' }, 'Sunday, 8 March 2026'],
    [{ locale: 'fr-CA', timeZone: 'America/Toronto' }, 'dimanche 8 mars 2026'],
  ])('formats for %o', (viewer, expected) => {
    expect(formatDay(instant, viewer)).toBe(expected)
  })
})
