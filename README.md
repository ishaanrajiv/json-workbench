# JSON Workbench

JSON Workbench is a fast, static, browser-based workspace for validating, formatting, exploring, and diffing JSON.

It runs entirely on the client as a single-page app, with no backend required.

## What it does

- Real-time JSON validation with line/column diagnostics, fix hints, and click-to-jump error focus
- Two-pane workflow: source JSON on the left, generated or edited output on the right
- Right-side view modes:
  - `JSON`: pretty printed, syntax highlighted, and foldable
  - `Minify`: compact JSON output
  - `Table`: tabular rendering for top-level arrays (auto-shown when available)
  - `Inspector`: Miller-column style navigator with breadcrumbs and search
  - `Diff`: inline unified diff with context folding and optional auto-recompute
- Path tools: copy both dot-path and JSONPath for the currently selected Inspector node
- Quality-of-life tools: load sample payload, resync right side from left, copy right output
- Pane resizer with pointer and keyboard support (`ArrowLeft`, `ArrowRight`, `Home`, `End`)

## Stack

- `index.html`: static app shell
- `styles.css`: all styling and layout
- `app.ts`: source of truth for app logic
- `app.js`: generated browser runtime (compiled from `app.ts`)
- TypeScript compiler only (no framework, no bundler)

## Requirements

- Node.js + npm
- Python 3 (used by the local static dev server script)

## Local development

1. Install dependencies:

```bash
npm install
```

2. Compile TypeScript:

```bash
npm run build
```

3. Start local server:

```bash
npm run dev
```

4. Open:

```text
http://localhost:4173
```

## NPM scripts

- `npm run build`: compile `app.ts` -> `app.js`
- `npm run typecheck`: run TypeScript type checking without emit
- `npm run dev`: serve the project via `python3 -m http.server 4173`

## Usage flow

1. Paste JSON into the left editor.
2. Right editor unlocks automatically.
3. Switch right-side modes depending on task:
   - Use `JSON` for readable formatted output and folding.
   - Use `Minify` for compact output or manual right-side edits.
   - Use `Inspector` for navigation/search through nested structures.
   - Use `Diff` to compare left and right payloads.
   - Use `Table` when right JSON is a top-level array.
4. Copy output or paths as needed.

## Notes on behavior

- Right-side JSON mode is read-only when valid and displayed with syntax highlighting/folding.
- Invalid JSON in either pane surfaces parser diagnostics with contextual hints.
- Diff mode requires both sides to be valid JSON and can auto-recompute on edits.
- Inspector search is bounded (up to 80 hits) to keep interactions responsive.
- On narrow screens, layout collapses to a single-column flow automatically.

## Deployment

This project is configured for static deployment on Vercel.

- Build command: `npm run build` (see `vercel.json`)
- No server/runtime needed after build
- Security headers are set in `vercel.json`

## Project structure

```text
.
├── index.html
├── styles.css
├── app.ts
├── app.js
├── package.json
├── tsconfig.json
└── vercel.json
```
