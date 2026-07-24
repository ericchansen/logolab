# LogoLab design system

## Intent

One continuous, cool-neutral workbench puts the artboard first. Compact document and property
controls flank the dominant canvas without becoming full-height rails. Boundaries are reserved for
the interactive canvas, proof artboards, controls, and short-lived menus. There are no panel fills,
section rules, cards, or full-height tool zones.

## Tokens

```css
--surface: oklch(0.965 0.006 255);
--surface-strong: oklch(0.985 0.003 255);
--line: oklch(0.86 0.011 255);
--line-soft: oklch(0.91 0.008 255);
--ink: oklch(0.22 0.014 255);
--muted: oklch(0.47 0.013 255);
--accent: oklch(0.56 0.205 260);
--accent-dark: oklch(0.49 0.205 260);
--accent-soft: oklch(0.93 0.04 260);
--danger: oklch(0.52 0.19 25);
```

The cobalt accent is reserved for focus, selection, active state, and the primary Export
action. Artwork colors never carry unrelated UI meaning. Essential text meets WCAG 2.2 AA.

## Shell

- A flexible dominant canvas with a compact toolbar for zoom, fit, transient `Saving…`, Import,
  and Export, plus artboard bounds and attached proofs.
- Narrow, responsive side groups: document, font, and glyph controls on the left; selected-glyph
  properties and overlaps on the right.

There is no LogoLab title in chrome, permanent save state, command-bar band, or panel heading
scaffolding. Side groups size to their controls, have no borders or distinct backgrounds, and never
stretch to viewport height. Self-evident controls use their value or object as the visible
affordance and retain a precise accessible name instead of a permanent title.

## Typography and rhythm

Use the self-hosted Figtree variable font for interface text, with the system sans stack as
fallback. The only UI weights are 400, 500, and 600. Labels are 0.75 rem, primary controls and
glyph/overlap values are 0.8125 rem, the active font value is 0.875 rem, and metadata is
0.6875 rem. Numeric fields, indices, dimensions, and coverage use tabular figures. Font choices
continue to preview in their own face. Hierarchy comes from alignment, weight, and proximity
rather than uppercase labels.

## States

- Glyph layers are an accessible multi-select list. Selected layers use concise weight and a small
  circular marker, with a stronger marker for the primary layer, never a tinted slab or inset stripe.
- Selected outlines use a thin cobalt and white vector halo; the primary outline is slightly stronger.
  Deselecting removes outlines fully.
- X/Y display the primary glyph and move every selected glyph by the resulting delta. The chain action
  visibly selects the primary glyph and every glyph after it instead of enabling a hidden move mode.
- Position changes keep the current overlap paint visible and show `Stale`.
- Recalculate refreshes identities, coverage, and mixed colors.
- Overlap rows show glyph identity, coverage, explicit swatch, and mixed/custom mode.
- Errors persist in a compact text-and-icon banner. Successful save completion is hidden.
- Font choices preview in their own face. Local fonts form a separate group and removal is
  confirmed before font data and saved variants are deleted.

## Proofs and export

Light and dark artboards hold stable geometry in the first proof row. The actual-size proof occupies
a separate reserved slot below them, with no surrounding box, so changing its 8–64 px size never
moves either artboard. Each artboard is itself the background color target; the actual-size logo
renders centered from its painted outline bounds, with its compact pixel control beside it but
outside that centering calculation. Main and proof framing ignores advance width, side bearings, and
empty glyphs without changing design coordinates or export geometry. Normalize is the separate,
explicit model action: it translates every glyph by one offset so the primary glyph becomes `0,0`,
then refreshes overlap geometry. Export exposes SVG, PNG presets or custom longest side, and portable
JSON in a light-dismiss popover. Every export flushes live text and refreshes stale overlap geometry.

## Motion and access

Use 150-220 ms ease-out feedback for border, color, and small transforms only. Disable motion
under `prefers-reduced-motion`. Keep 3 px visible focus rings, semantic names, non-color state cues,
roving layer-list focus, continuous keyboard nudging, Escape deselection, light-dismiss popovers,
and minimum 30 px targets.

## Responsive behavior

Above 820 px, compact content-driven controls flank the canvas while leaving it materially dominant.
Below 820 px, keep the canvas first, then proofs, document controls, glyphs, and properties on the
same background without horizontal section bands or tiled cells. At 390 px the artboard owns the
first viewport and the page has no horizontal overflow.

## Avoid

Marketing copy, intro sections, tracked uppercase eyebrows, nested cards, decorative identity
marks, visible panel chrome, row separators, repeated shadows, ordinary empty-space drag
panning, hidden accuracy state, or renderer logic that differs between live proofs and exports.
