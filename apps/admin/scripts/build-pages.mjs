/**
 * Builds the admin as a static, guest-only site for GitHub Pages.
 *
 *   npm run build:pages -w @meridian/admin          → apps/admin/dist
 *   PAGES_BASE=/other-repo/ npm run build:pages …   → a different sub-path
 *
 * Pages serves files only: there is no API behind this build, so it starts in guest mode and
 * keeps its demo data in the visitor's browser.
 */
import { copyFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const base = process.env.PAGES_BASE || '/cms-portal/';
if (!base.startsWith('/') || !base.endsWith('/')) throw new Error(`PAGES_BASE must start and end with "/" (got "${base}")`);

process.env.VITE_BASE = base;
process.env.VITE_DEMO_ONLY = 'true';
await build({ root, mode: 'production' });

const dist = resolve(root, 'dist');
// Pages has no rewrite rules: it answers unknown paths with 404.html, so that file is the app
// itself and deep links such as /cms-portal/w/acme/projects still open the right screen.
copyFileSync(resolve(dist, 'index.html'), resolve(dist, '404.html'));
// Stops Pages from running the files through Jekyll, which would drop paths starting with "_".
writeFileSync(resolve(dist, '.nojekyll'), '');
console.log(`\nGuest-only build for ${base} is in ${dist}`);
