// Headings drawn as SVG text, the one way a plugin sets a type size on the
// desktop: its Text and Markdown take the app's body size and its small
// heading styles. The SVG is drawn as an image, so it carries its own colours
// for light and dark and wraps its own lines.

// Four hues, none shared: one per list, whose colour means the same everywhere,
// and the lens's own for its frames. `mid` reads on either theme and colours
// borders and text; `light` and `dark` are the headings' shades.
export const PALETTE = {
  text: { mid: '#8a8780', light: '#1f1e1d', dark: '#f0eee6' },
  // the lists
  blue: { mid: '#3b82f6', light: '#1d4ed8', dark: '#93b4fd' },
  amber: { mid: '#f59e0b', light: '#b45309', dark: '#fcd34d' },
  green: { mid: '#22c55e', light: '#15803d', dark: '#86efac' },
  // the lens
  violet: { mid: '#a855f7', light: '#7e22ce', dark: '#d8b4fe' },
} as const

export type Hue = keyof typeof PALETTE

export const LENS: Hue = 'violet'

export const mid = (hue: Hue) => PALETTE[hue].mid

const escape = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// Greedy word wrap on an estimate of the glyph width: system-ui runs about
// 0.55em per character at these weights.
function wrap(text: string, perLine: number) {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line !== '' && line.length + 1 + word.length > perLine) {
      lines.push(line)
      line = word
    } else {
      line = line === '' ? word : `${line} ${word}`
    }
  }
  if (line !== '') lines.push(line)

  return lines.length ? lines : ['']
}

export function headingSvg(text: string, size: number, hue: Hue, maxWidth: number) {
  const perLine = Math.max(8, Math.floor(maxWidth / (size * 0.55)))
  const lines = wrap(text, perLine)
  const lineHeight = Math.round(size * 1.3)
  const width = Math.min(maxWidth, Math.ceil(Math.max(...lines.map(l => l.length)) * size * 0.58) + 4)
  const height = lines.length * lineHeight + Math.round(size * 0.35)
  const { light, dark } = PALETTE[hue]
  const spans = lines.map((l, i) => `<tspan x="0" y="${Math.round(size + i * lineHeight)}">${escape(l)}</tspan>`).join('')

  return {
    width,
    height,
    source:
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
      `<style>text{fill:${light};font:600 ${size}px system-ui,-apple-system,"Segoe UI",sans-serif}` +
      `@media (prefers-color-scheme:dark){text{fill:${dark}}}</style>` +
      `<text>${spans}</text></svg>`,
  }
}
