import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/about')({ component: About })

function About() {
  return (
    <>
      <h1>About</h1>
      <p>What this app is for, in a sentence or two.</p>
    </>
  )
}
