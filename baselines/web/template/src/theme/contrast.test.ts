import { ColorSpace, contrastAPCA, OKLCH, parse, sRGB } from 'colorjs.io/fn'
import { describe, expect, it } from 'vitest'

import { palette, type Role, type Scheme } from './palette.ts'

ColorSpace.register(sRGB)
ColorSpace.register(OKLCH)

/** APCA minimums (|Lc|) by use, from the APCA readability criterion. */
const Lc = {
  bodyText: 75,
  uiText: 60,
  nonText: 45,
} as const

/** Every foreground/background combination the app draws. Add one with each new pairing. */
const pairs: ReadonlyArray<readonly [fg: Role, bg: Role, min: number]> = [
  ['fg', 'bg', Lc.bodyText],
  ['fgMuted', 'bg', Lc.uiText],
  ['accent', 'bg', Lc.uiText],
  ['onAccent', 'accent', Lc.uiText],
  ['onAccent', 'accentHover', Lc.uiText],
  ['onAccent', 'accentPressed', Lc.uiText],
  ['focus', 'bg', Lc.nonText],
]

describe.each<Scheme>(['light', 'dark'])('APCA contrast, %s', (scheme) => {
  it.each(pairs)('%s on %s reaches Lc %i', (fg, bg, min) => {
    const colors = palette[scheme]
    const lc = Math.abs(contrastAPCA(parse(colors[bg]), parse(colors[fg])))
    expect(lc, `${fg} on ${bg} is Lc ${lc.toFixed(1)}; adjust lightness in palette.ts`).toBeGreaterThanOrEqual(min)
  })
})
