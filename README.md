# JSON Workbench

Single-page JSON utility focused on speed and zero account friction.

## Features

- Real-time JSON validation with line/column diagnostics and fix hints
- Formatted, syntax-highlighted, collapsible JSON view with line numbers
- Miller-column explorer with breadcrumbs, path copy, and leaf metadata
- Side-by-side JSON diff with key-order normalization
- Optional order-sensitive arrays in diff mode
- Folded unchanged diff sections for faster review
- Utilities: minify, search/filter, type stats, copy formatted output

## Tech

- Static frontend (`index.html`, `styles.css`)
- TypeScript source of truth: `app.ts`
- Generated browser runtime: `app.js`

## Local usage

1. Install dependencies:
   ```bash
   npm install
   ```
2. Build:
   ```bash
   npm run build
   ```
3. Start a local static server:
   ```bash
   npm run dev
   ```
4. Open `http://localhost:4173`.

## Deploy to Vercel

1. Import the repository into Vercel.
2. Keep the default install command (`npm install`).
3. Build command is configured in `vercel.json` as:
   - `npm run build`
4. Deploy.

The app is static and deploys as a single-page utility.
