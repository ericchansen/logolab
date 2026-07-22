# Logo Lab

Logo Lab is a public, open-source studio for composing logos and wordmarks from real
font outlines. Move glyphs directly, tune exact positions, and assign a deterministic
color to each adjacent-glyph intersection. The same geometry powers the editor,
proofs, SVG export, and PNG export.

## What the MVP includes

- Text from 1 to 12 Unicode characters with explicit unsupported-glyph errors
- Sora, Figtree, Work Sans, and Rubik at ExtraBold weight
- Local TTF and OTF upload with browser-only storage
- Direct letter drag, arrow-key nudging, exact X/Y fields, and move-one or
  move-with-following modes
- Space-drag panning, wheel/button zoom, and fit-to-artwork
- Per-glyph base colors and per-adjacent-pair overlap colors
- Optional overlap color suggestions that become explicit stored values
- Synchronized light, dark, and exact small-size proofs
- Independent autosave for every font and text combination
- Portable design JSON, tight transparent SVG, and high-resolution transparent PNG

Logo Lab preserves the font's native paths. It translates glyphs but never rebuilds,
equalizes, stretches, or otherwise distorts their geometry.

## Privacy and local data

Logo Lab has no backend, account system, analytics, or upload endpoint. Font parsing,
outline rendering, design storage, and exports happen in the browser.

Built-in font files are served as static application assets. A font selected from your
computer is read locally, stored in IndexedDB for reuse on that device, and included in
a portable design JSON only when you explicitly export one. Clearing site data removes
saved designs and local fonts.

## Development

Requirements:

- Node.js 22 or newer
- npm 10 or newer
- Microsoft Edge for the browser regression suite

```powershell
npm install
npm run dev
```

The development server prints its local URL. No environment variables or external
services are required.

Validation commands:

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
```

The Playwright configuration launches the installed Microsoft Edge channel rather than
Playwright's bundled Chromium.

## Browser support

The MVP targets current desktop Microsoft Edge, Chrome, Firefox, and Safari releases.
It uses modern browser features including SVG clip paths, Pointer Events, IndexedDB,
the Web Crypto API, canvas export, and ES2022 modules. Microsoft Edge is the browser
used for the automated interaction and rendered-pixel regression suite.

## Architecture

The application is a Vite, React, and strict TypeScript client.

- `src/domain/fonts.ts` parses built-in and local OpenType data with
  [opentype.js](https://opentype.js.org) and extracts native glyph path data.
- `src/domain/geometry.ts` owns positions, bounds, movement, and pair-relative math.
- `src/domain/svg.ts` is the single SVG document generator used by the editor, proofs,
  SVG export, and the source image for PNG export.
- `src/domain/persistence.ts` isolates designs by font and text and stores local fonts
  in IndexedDB.
- `src/components/LogoStage.tsx` maps pointer and keyboard input into domain movement
  without duplicating renderer geometry.
- `tests/e2e/logo-lab.spec.ts` runs in Edge and checks persistence, drag versus pan,
  export geometry, local-font use, narrow layout, and actual overlap-colored pixels.

### Pair-relative clipping invariant

For adjacent glyphs `left` and `right`, the right outline inside the clip path is
translated in the left glyph's local coordinate system:

```text
translate(right.x - left.x, right.y - left.y)
```

Absolute right-glyph coordinates are incorrect when the left glyph is not at the
origin. Every render also receives fresh clip-path IDs to avoid stale clip geometry in
Edge. Exported SVG uses the same generator, so live and exported intersections cannot
diverge.

## Font licensing

The bundled fonts are unmodified variable font binaries configured to weight 800 in
the browser. Each is distributed under the SIL Open Font License 1.1.

| Font | Project | Copyright notice and license |
| --- | --- | --- |
| Sora | [sora-xor/sora-font](https://github.com/sora-xor/sora-font) | `third_party/fonts/Sora/OFL.txt` |
| Figtree | [erikdkennedy/figtree](https://github.com/erikdkennedy/figtree) | `third_party/fonts/Figtree/OFL.txt` |
| Work Sans | [weiweihuanghuang/Work-Sans](https://github.com/weiweihuanghuang/Work-Sans) | `third_party/fonts/Work-Sans/OFL.txt` |
| Rubik | [googlefonts/rubik](https://github.com/googlefonts/rubik) | `third_party/fonts/Rubik/OFL.txt` |

The application source is licensed under the MIT License in `LICENSE`. Font binaries
remain covered by their OFL licenses.
