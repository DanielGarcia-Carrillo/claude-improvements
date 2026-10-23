/**
 * Chrome and Firefox ship Temporal; Safari stable does not yet. Load the
 * polyfill only where it is missing, so most visitors never download it.
 * Remove this module once every browser in the `browserslist` range has it.
 */
export async function ensureTemporal(): Promise<void> {
  if (!('Temporal' in globalThis)) await import('temporal-polyfill/global')
}
