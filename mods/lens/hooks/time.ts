// When the original reply was written, in the person's local time, with the
// day once it is not today. Absent for turns kept before times were recorded.
export const timeOf = (at: number | undefined, now: number) => {
  if (at === undefined) return undefined
  const d = new Date(at)
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

  return new Date(now).toDateString() === d.toDateString() ? time : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`
}
