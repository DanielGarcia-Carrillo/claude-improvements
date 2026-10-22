# UI primitives (exploration)

Status: **native elements are the default**; no headless component library
is installed. This page is for the day a project needs a widget the platform
doesn't provide. Checked on 2026-10-21.

## What the platform covers

Against the template's browser range (the last three majors of Chrome, Edge,
Firefox, Safari and iOS, so Safari 18 is the floor), per MDN's
browser-compat-data 8.1.6:

| Need | Native feature | In range? |
|---|---|---|
| Buttons, links, inputs, checkboxes | `<button>`, `<a>`, `<input>` | Yes |
| Modal dialog with focus trap and inert background | `<dialog>` + `showModal()` | Yes |
| Non-modal popups, light dismiss, top layer | Popover API (`popover`, `popovertarget`) | Yes (Safari 17) |
| Exclusive accordion | `<details name="…">` | Yes (Safari 17.2) |
| Opening dialogs and popovers without JS | Invoker commands (`commandfor`) | No: Safari 26.2+ |
| Positioning a popup next to its trigger | CSS anchor positioning | No: Safari 27 |
| Fully stylable `<select>` | `appearance: base-select` | No: Safari 27 |

So menus and comboboxes that must sit next to their trigger, and a styled
select, still need JavaScript in this range; dialogs, popovers and
accordions don't.

## When a widget needs a library

Add one per widget, not a whole kit, and record the choice in an ADR. Cost
on top of React 19.3, in gzipped JS from `vite build` (Vite 8.3), measured
on 2026-10-21 with each library's documented imports:

| Library | Version | Popover | Menu | Menu + Select | Strengths | Watch out for |
|---|---|---|---|---|---|---|
| Radix (`radix-ui`) | 1.8.1, maintained again since 2026 | +22 KB | +28 KB | +33 KB | Smallest; plain `data-state` attributes for styling | Thinner i18n; its maintenance lapsed once before |
| Ariakit | 0.4.42 | +28 KB | +41 KB | +44 KB | Composable, good a11y | Still 0.x |
| Base UI | 1.9.0 | +34 KB | +44 KB | +53 KB | Modern API from the Radix and MUI authors | Newer, smaller community |
| React Aria Components | 1.22.1 | +29 KB | +48 KB (+45 KB) | +58 KB (+53 KB) | Strongest a11y and i18n: localised strings, RTL, date and number fields | Heaviest; bracketed figures use its locale optimiser |

All four tree-shake fully. Umbrella packages, root imports, `import * as`
and per-component subpaths land within 1 KB of each other, so use the style
the library's docs show. The widget sets the cost: a Menu costs about twice
a Dialog in every library. A second widget from the same library is cheap
(Select adds 3–10 KB to a Menu) because the core is shared.

All four are unstyled and expose state as attributes, which StyleX can
target (`'[data-state="open"]': …`).

## Suggested pick by widget

- **Menu, popover menu, tooltip, combobox:** Radix, for size, until anchor
  positioning reaches the browser floor.
- **Date picker, number or currency field, anything locale-heavy:** React
  Aria, the one case where its weight buys something the others lack. A
  DatePicker alone is +60 KB with the locale optimiser. Once React Aria is
  in, take the other widgets from it too: its Menu and Select then add
  +24 KB, against +33 KB for Radix alongside it.
- **Dialog, disclosure, accordion, popover without positioning:** native, no
  library.

## Not adopted: Astryx

Meta's open-source design system (`@astryxdesign/core` 0.7, public beta
since 2026-06, MIT) is built on StyleX and on the platform features this
template prefers: `<dialog>`, the Popover API and anchor positioning. It is
a styled system with its own theme, not a headless library, so it doesn't
fit the per-widget slot:

- A fixed cost before any widget: +20 KB of JS for its theme provider and
  +35 KB of CSS for every component's styles. A Menu alone is +103 KB of JS.
- Its browser guide puts Safari 17–25 in "Tier 2": menus, selects and
  tooltips open but may not sit next to their trigger without a polyfill.
  That covers this template's Safari 18 floor.
- Every 0.x minor so far has shipped breaking changes, about one every two
  to three weeks.
- Its accessibility testing is serious (axe on every PR, an APG conformance
  programme), but its checked-in baseline still tolerates 149 serious axe
  violations, most of them colour contrast.
- It shares StyleX's `x` class prefix; clean layering needs its own Vite
  plugin, which wraps `@stylexjs/unplugin`.

## Revisit when

- Astryx reaches 1.0, or ships unstyled primitives.

- Safari 27 becomes the floor (about three Safari majors from now): anchor
  positioning and stylable selects remove most of the remaining need.
- A project needs several complex widgets at once; then one kit may beat
  several per-widget picks.
