import { createFileRoute } from '@tanstack/react-router'

import { testIds } from '../constants.ts'
import { currentViewer, formatDay } from '../lib/intl.ts'

export const Route = createFileRoute('/')({
  // Loaders are the edge where the clock and the viewer's locale are read;
  // components below receive values and stay pure.
  loader: () => ({ today: formatDay(Temporal.Now.instant(), currentViewer()) }),
  component: Home,
})

function Home() {
  const { today } = Route.useLoaderData()
  return (
    <>
      <h1>Replace Me</h1>
      <p data-testid={testIds.today}>{today}</p>
    </>
  )
}
