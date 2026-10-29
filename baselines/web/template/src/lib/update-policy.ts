/**
 * public/update-policy.json, served uncached, lets whoever deploys force
 * every open copy of an older build onto the newest one, instead of waiting
 * for each user to accept the update prompt:
 *
 *   { "forceUpdateBefore": "2026-10-28T18:00:00Z" }
 *
 * A build made before that instant reloads into the newest worker as soon as
 * it is installed. `null`, the default, forces nothing. The web README's
 * "Recover from a broken service worker" says when to use it.
 */
export const UPDATE_POLICY_URL = '/update-policy.json'

// An instant, not a local time: a date without a zone parses in the
// viewer's own, and would force different builds in different places.
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/

/** Whether `policy` forces a build made at `builtAt` (an ISO instant) to update. Anything malformed forces nothing. */
export function mustUpdate(policy: unknown, builtAt: string): boolean {
  if (typeof policy !== 'object' || policy === null || !('forceUpdateBefore' in policy)) return false
  const before = policy.forceUpdateBefore
  if (typeof before !== 'string' || !INSTANT.test(before)) return false
  const cutoff = Date.parse(before)
  const built = Date.parse(builtAt)
  return Number.isFinite(cutoff) && Number.isFinite(built) && built < cutoff
}

/** Reads the policy past every cache. Offline, or any failure, forces nothing. */
export async function fetchMustUpdate(builtAt: string): Promise<boolean> {
  try {
    const response = await fetch(UPDATE_POLICY_URL, { cache: 'no-store' })
    return response.ok && mustUpdate(await response.json(), builtAt)
  } catch {
    return false
  }
}
