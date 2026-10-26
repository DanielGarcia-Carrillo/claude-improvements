/**
 * Every user-visible date, time and number is formatted here, from an
 * explicit locale and time zone. Components never call `toLocaleString` or
 * read the machine's zone themselves; they receive a `Viewer`, so tests and
 * stories pin both and render the same on every machine.
 */
export interface Viewer {
  readonly locale: string
  readonly timeZone: string
}

/** The viewer's own locale and zone. Read once, at the edge of the app. */
export function currentViewer(): Viewer {
  const { locale, timeZone } = new Intl.DateTimeFormat().resolvedOptions()
  return { locale, timeZone }
}

/** The calendar day `instant` falls on for this viewer, written out in full. */
export function formatDay(instant: Temporal.Instant, viewer: Viewer): string {
  return instant.toZonedDateTimeISO(viewer.timeZone).toLocaleString(viewer.locale, { dateStyle: 'full' })
}
