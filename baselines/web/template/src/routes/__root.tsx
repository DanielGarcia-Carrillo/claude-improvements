import * as stylex from '@stylexjs/stylex'
import { createRootRoute, Link, Outlet } from '@tanstack/react-router'

import { UpdatePrompt } from '../components/UpdatePrompt.tsx'
import { paths } from '../constants.ts'
import { color, font, line, space } from '../theme/tokens.stylex.ts'

export const Route = createRootRoute({ component: Root })

function Root() {
  return (
    <div {...stylex.props(styles.app)}>
      <header {...stylex.props(styles.header)}>
        <nav aria-label="Main">
          <ul {...stylex.props(styles.navList)}>
            <li>
              <Link to={paths.home} {...stylex.props(styles.navLink)}>
                Home
              </Link>
            </li>
            <li>
              <Link to={paths.about} {...stylex.props(styles.navLink)}>
                About
              </Link>
            </li>
          </ul>
        </nav>
      </header>
      <main {...stylex.props(styles.main)}>
        <Outlet />
      </main>
      <UpdatePrompt />
    </div>
  )
}

const styles = stylex.create({
  app: {
    minHeight: '100dvh',
    fontFamily: font.body,
    lineHeight: 1.5,
    color: color.fg,
    backgroundColor: color.bg,
  },
  header: {
    paddingBlock: space.s3,
    paddingInline: space.s4,
    borderBlockEndWidth: 1,
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: line.subtle,
  },
  navList: {
    display: 'flex',
    gap: space.s4,
    margin: 0,
    padding: 0,
    listStyle: 'none',
  },
  navLink: {
    color: color.accent,
    // TanStack Router marks the current route's link with data-status="active".
    fontWeight: { default: 400, '[data-status="active"]': 700 },
    textDecorationLine: { default: 'none', ':hover': 'underline' },
  },
  main: {
    paddingInline: space.s4,
    paddingBlock: space.s6,
  },
})
