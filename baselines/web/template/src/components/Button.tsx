import * as stylex from '@stylexjs/stylex'
import type { StyleXStyles } from '@stylexjs/stylex'
import type { ComponentProps } from 'react'

import { color, font, motion, radius, space } from '../theme/tokens.stylex.ts'

export interface ButtonProps extends Omit<ComponentProps<'button'>, 'className' | 'style'> {
  /** Placement from the caller. Colour, type and shape stay the button's own. */
  xstyle?: StyleXStyles<{ alignSelf?: string; marginBlockStart?: string; marginInlineStart?: string }>
}

/**
 * A native `<button>`: keyboard activation, focus and disabled behaviour come
 * from the platform, at no bundle cost. `type` defaults to "button" so it
 * never submits a form by accident.
 */
export function Button({ xstyle, type = 'button', ...props }: ButtonProps) {
  return <button type={type} {...props} {...stylex.props(styles.root, xstyle)} />
}

const styles = stylex.create({
  root: {
    appearance: 'none',
    borderWidth: 1,
    borderStyle: 'solid',
    // Transparent, not absent: forced-colours mode paints it, so the button keeps an edge.
    borderColor: 'transparent',
    borderRadius: radius.control,
    paddingBlock: space.s2,
    paddingInline: space.s4,
    fontFamily: font.body,
    fontSize: '1rem',
    fontWeight: 600,
    color: color.onAccent,
    backgroundColor: {
      default: color.accent,
      // Only where a pointer can hover: on touch screens :hover sticks after a tap.
      ':hover': { default: null, '@media (hover: hover)': color.accentHover },
      ':active': color.accentPressed,
    },
    outlineStyle: 'solid',
    outlineWidth: 2,
    outlineOffset: 2,
    outlineColor: { default: 'transparent', ':focus-visible': color.focus },
    transitionProperty: 'background-color',
    transitionDuration: motion.duration,
    cursor: { default: 'pointer', ':disabled': 'not-allowed' },
    opacity: { default: 1, ':disabled': 0.5 },
  },
})
