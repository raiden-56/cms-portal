# Development progress

Product name: **Meridian**. Updated in the fifth session (guest mode, GitHub Pages demo, switch and text-field fixes). Code: https://github.com/raiden-56/cms-portal · Live demo (guest mode): https://raiden-56.github.io/cms-portal/

## Status at a glance

| Area | State |
| --- | --- |
| Backend engine (API, database, queues) | **Built and tested** |
| Shared schema package, SDK | **Built and tested** |
| Admin: all 30 screens | **Built.** Every screen compiles and loads with real data; see "How the admin was verified" for what was and was not exercised |
| Docker, CI, documentation | Built. API image verified by running it; admin image not built yet |
| Browser end-to-end tests | **Written and passing** — 62 tests in 7 files, against the dev server and against the production build; see "End-to-end coverage" for what they do and do not reach |
| Guest mode and GitHub Pages demo | **Built and tested** — see "Guest mode" |

## Test results (last run)

| Suite | Result |
| --- | --- |
| `apps/api` integration tests (real PostgreSQL + Redis, isolated schema) | **60 passed** (7 files) |
| `packages/shared` unit tests | **21 passed** |
| `packages/sdk` unit tests | **16 passed** |
| `apps/admin` unit tests (form engine, page-editor state, formatters, demo backend) | **40 passed** |
| Guest-mode browser tests (`e2e-demo`, no API running; any request leaving the page's origin fails the test) | **51 passed** |
| TypeScript: api, sdk, shared, admin | clean |
| Admin production build (`vite build`) | succeeds, and the built app now loads and works in a browser (it did not before the fourth session — see below) |
| API Docker image | builds; container applied migrations and answered `/health` as a non-root user |
| Playwright end-to-end (62 tests in 7 files, Edge) | **62 passed** — two consecutive full runs against the dev server, and one full run against the production build served by `vite preview` |

The spec's 18 critical scenarios are all covered by the API integration tests (organization → project → content type → fields → content → media → draft → preview → approve → publish → REST → GraphQL → update → new version live → webhook delivery → connected-frontend revalidation through the SDK → permission restrictions → restore a version). The browser tests repeat that chain through the real UI, now including the approval flow and permission restrictions; preview tokens, GraphQL and SDK revalidation are exercised through the API only.

## Guest mode

The admin can run with no server: a demo backend in the browser (`apps/admin/src/demo`) answers every management-API and delivery-API call, seeded with an organization, project, content types, entries in every state, pages, media, a release, API keys, webhooks, members, audit history and 30 days of analytics. A guest's changes are kept in IndexedDB in their own browser only; nothing is sent over the network.

- **Entering:** "Explore as guest" on the sign-in page. A build with `VITE_DEMO_ONLY=true` starts in guest mode and has no sign-in. A banner offers "Reset demo data" and, outside a demo-only build, "Exit guest mode".
- **Works in the browser:** every screen and action, including publishing, approval, versions, scheduling, releases, media upload/replace, delivery-API requests from the explorer and integration wizard, API keys, roles, members and audit log. The server's rules (validation on publish, optimistic locking, approval before publish, destructive schema confirmation, last-administrator protection, drafts and private fields never delivered) are ported from the API.
- **Simulated, and labelled so:** webhook deliveries (marked "Simulated"; nothing is sent).
- **Not available, with a message saying so:** GraphQL, password change, session revocation, real sign-in and invitations.
- **Limits:** 5 MB per uploaded file, 60 MB library; two tabs on the same demo overwrite each other; the demo backend trusts the UI's role checks rather than checking permissions itself.

### Hosting the demo on GitHub Pages

```powershell
npm run build:pages -w @meridian/admin
```

This builds a guest-only site for the `/cms-portal/` sub-path into `apps/admin/dist` (set `PAGES_BASE` for another path), with `404.html` so deep links work and `.nojekyll`. Publish the contents of `dist` (without `*.map` files) to the `gh-pages` branch. The current site was published that way by hand; there is no workflow that redeploys it on push yet.

## Fixed in the fifth session

- **Switch:** the thumb sat off-centre and ran past the end of the track when switched on. MUI's size styles outranked the theme's overrides; the geometry is now set through the switch root.
- **Text fields** were about 34px tall with 13px text; single-line fields, selects and autocompletes are now 40px with 14px text.
- **Sub-path hosting:** the router, "not found" buttons and the reload after renaming an organization assumed the app was served from `/`.

## Backend (built and tested)

- Auth: registration, login, httpOnly refresh cookie, session revocation, password change, login history, invitations.
- Multi-tenancy: organizations → projects → environments; every route scope-guarded; cross-tenant access returns 404.
- RBAC: nine system roles plus custom roles, enforced server-side; escalation and last-administrator protections.
- Content modeling: 34 field types, components, dynamic zones; schema changes with a dry-run plan, safe renames, and confirmation for destructive changes; promotion of a content model between environments.
- Publishing engine: draft/published split, autosave coalescing, version history and restore, optimistic locking, review/approval workflow, scheduling, atomic releases, trash.
- Pages: block tree stored as framework-neutral data, nested URLs, 25 built-in blocks plus custom blocks.
- Delivery: generated REST and GraphQL, filter/sort/search/populate/fields/locale, OpenAPI, preview tokens, Redis cache invalidated on publish, ETag.
- Distribution: signed webhooks with retries, delivery log and redelivery; WebSocket events; usage analytics; audit log with CSV export.
- Media: content-sniffed uploads, duplicate detection, usage tracking, replace-in-place, on-the-fly image transforms, local and S3 drivers.
- SDK (`@meridian/sdk`), Next.js example, seed data.

## Admin (built)

Sign-in / register / invitation, app shell (sidebar, breadcrumbs, project and environment switchers, command palette, notifications, light/dark theme), dashboard (real metrics, charts, saved reorderable layout), projects, content-type builder, component builder, dynamic zones, content list (filters, saved views, columns, bulk actions, import/export), entry editor (dynamic form, rich text, autosave, publish/schedule/workflow, versions with diff, comments, activity, locales), pages tree, visual page builder (palette, canvas, inspector, style and SEO panels, undo/redo, device preview), media library, workflows, releases, scheduled content, version history, API explorer (REST, GraphQL, reference), API keys, integration wizard, webhooks and delivery log, SDK documentation, analytics, users, roles, audit logs, settings, account.

### How the admin was verified

- All screens: TypeScript clean, production build succeeds, and each was opened in a browser against the seeded project and rendered real data without an error screen.
- Used interactively in the browser: sign-in, dashboard, content list, opening an entry (confirmed it no longer saves on open), page builder (loading a page, selecting a block, inspector).
- Driven by automated browser tests: everything listed under "End-to-end coverage".
- **Not exercised by hand or by automated browser tests:** see "Not covered in the browser" below. The API endpoints behind those screens are tested; the buttons that call them are not, so some UI bugs may remain there.

## End-to-end coverage

Run from `apps/admin` with the API and admin dev servers running:

```powershell
$env:PLAYWRIGHT_CHANNEL='msedge'; npx playwright test --reporter=line
```

Add `--workers=4` to run the spec files side by side (about two and a half minutes). Each spec signs up its own organization through the real registration form, so no seed data is needed. Repeated runs create many sign-ups from one address; raise `AUTH_RATE_LIMIT_PER_MINUTE` in the local `apps/api/.env` (it is 300 on this machine) if sign-up starts returning 429.

To test the production build instead, stop the admin dev server, run `npm run build -w @meridian/admin` and `npm run preview -w @meridian/admin` from the repository root (it serves the build on the same port), then run the same command. Do this before a release: the dev server and the built bundle can differ, and once did.

If a run needs its own output folder (`--output=…`), name it `test-results-…`: the dev server ignores folders with that prefix. Any other folder inside `apps/admin` is watched, which reloads the page under test.

| Spec | Tests | Driven through the real UI and checked against the API |
| --- | --- | --- |
| `e2e/auth.spec.ts` | 8 | Sign out (the old access token and cookie both stop working); protected pages lead to sign-in; sign-in validation, wrong password, return to the page asked for; accept an invitation as a new person; a used, revoked or made-up invitation link is refused; an Author can write and submit but not publish, and every hidden action is also refused by the server; changing a member to Viewer makes the editor read-only; suspending locks a member out at once, reactivating restores access, removing leaves only "sign out"; an existing account accepts with its own password and switches between two organizations |
| `e2e/dragdrop.spec.ts` | 5 | Real mouse drags: reorder fields in the content type builder (also by keyboard, and Escape cancels); drag blocks from the palette to a chosen position; move blocks by their handle on the canvas and in the outline, with undo/redo; drop a block into a section, and refuse dropping a section into itself; drop files on the media library |
| `e2e/editorial.spec.ts` | 12 | Approval rule: no publishing until submitted and approved (button disabled, server answers 409); request changes, withdraw, re-approve, editing approved content needs a new approval; the review queue; schedule dialog; comments (add, resolve, reopen, delete); a translation edited and published on its own and delivered per locale; dynamic zones (allowed components, min/max, add, reorder, remove); saved views; column settings; export; import from a file and from pasted JSON |
| `e2e/workspace.spec.ts` | 10 | Release scheduling, rescheduling and unscheduling; integration wizard end to end (the key works; its secret is never shown again); media replace-in-place and bulk move/tag/trash/restore; dashboard layout saved per user; analytics counts real delivery requests; SDK documentation prints no real key; command palette by keyboard; dark theme persists; phone-width layout (390×844) without sideways scrolling |
| `e2e/content.spec.ts` | 9 | Build a content type with five fields in the builder; create an entry; publish and read it from the delivery API; edit → Modified → republish (old version stays live until then); required-field validation blocks publishing; restore a version; list: search, status filter, row publish, bulk unpublish, trash and restore; removing a field that holds data demands explicit confirmation; create a component and use it as a field |
| `e2e/pages-media.spec.ts` | 8 | New page dialog; builder: add blocks, edit content, move, duplicate, delete, undo/redo, outline; block style and SEO settings; save, reload, publish, read the page from the delivery API; nested page URL, publish from the list, duplicate, delete; media: upload, alt text, duplicate detection, folders, search, trash and restore; pick an uploaded image in the builder |
| `e2e/platform.spec.ts` | 10 | API keys: secret shown once, rotate and revoke cut off access; releases: add entries, validate, publish atomically; webhooks: create, send a test event, delivery log, pause, delete; invitations; custom roles; locales and project rename; account profile; audit log filter and CSV export; API explorer sends a real request; scheduled content: cancel a schedule |

### Not covered in the browser

The GraphQL and reference tabs of the API explorer; preview links from the entry editor; changing a password and revoking sessions on the Account page; creating a project and the project and environment switchers; the notifications menu; the Version History screen (restoring a version is tested from the entry editor); editing conflicts between two people in the same entry; permanent deletion of media and its "still in use" confirmation; the integration wizard's server-side key types (Preview, Read/write); dragging dashboard widgets with the mouse (the test uses the keyboard); rescheduling from the Scheduled page; custom page blocks and the page builder's device preview; tablet widths.

## Fixed in the fourth session

Found by the extended browser tests:

- **The production build opened to a blank page.** The build's hand-written vendor chunks imported each other in a circle, so the bundle failed while loading. `vite build` succeeded and nothing had ever opened the result in a browser. The manual chunks are gone; all 62 browser tests pass against the built app. Until this fix the built admin could not be used at all; only the dev server worked.
- **Signing in did not return to the page that was asked for.** Two redirects ran at once after sign-in and the one to the dashboard won. Both now agree on the destination (workspace paths only, so a crafted link cannot redirect elsewhere).
- **Someone with no organization was stranded.** After being removed or suspended, a person landed on a page with no way to sign out. It now names the signed-in account and offers Sign out.
- **Typing during "Create" could be lost.** Between sending a new entry and its saved editor appearing, the form still accepted input that was then discarded. The form does not accept input in that window.
- **A column or saved-view change made while preferences were still loading could be reverted on screen.** The pending load is now cancelled before the change is applied.
- **Command palette:** the dialog had no accessible name, and the search box could lose focus as the palette opened (seen in development), so typing went nowhere. Both fixed.
- **Tooltips replaced the accessible name** of "Resubmit" (review queue) and "Unused only" (media library); they now describe the control instead.
- **Dev server:** it watched browser-test output folders other than `test-results/`, which reloaded pages under test and crashed it once on a locked file. `test-results-*` and `playwright-report` are now ignored.

One failure was a mistake in a test, not the app: a keyboard reorder pressed the arrow key before the drag had started.

## Fixed in the third session

Found by the browser tests:

- **A confirmation message with a link crashed the whole admin to a blank page.** Messages are rendered outside the router, and their link used a router component. This affected "Test event queued → View deliveries", "Duplicated page → Open copy" and "Restored version → Open entry". The link is now a plain anchor that navigates in-app.
- **Confirmation messages were hidden from assistive technology while a dialog or drawer was open** (for example "File details saved" in the media drawer). The message region now sits directly under `<body>` and stays exposed.
- **Content list status filter lost a quick second click.** Choosing two statuses in fast succession computed the second change from a stale URL. The filter now applies each change immediately.
- Entry editor compared what it sent with the saved snapshot using two different serialisations, so a save could leave the editor looking unsaved.
- Select fields in the entry form and blocks on the page canvas had no accessible name.

Two other test failures were mistakes in the tests, not the app: a hero block is centred by default, so "click centre" switched centring off; and an ambiguous "Alt text" locator matched the library's search box.

## Fixed in the second session

- Saving unchanged content created a new version and marked published entries as modified (PostgreSQL JSONB reorders keys; comparisons are now order-independent on the server and in the editors). Regression test added.
- Duplicating a block in the page editor threw (deep clone of a state proxy). Covered by a unit test.
- Production build failed because of an invalid manual chunk entry.
- Page entrance animation moved from script-driven to CSS so content always reaches full opacity.

## Next steps

1. Add a GitHub Actions workflow that runs `build:pages` and redeploys the demo on every push to `main` (today it is published by hand).
1. Run the browser tests in CI, against the production build (the workflow currently runs type-checks, unit/integration tests and the builds, but not Playwright — which is how a build that could not load went unnoticed).
2. Build the admin Docker image and run the full Compose profile once. The image is meant to serve the production build — the bundle that could not load until this session — and it has still never been built or run.
3. Add the "promote content model" dialog to Settings → Environments (API and tests exist).
4. Cover the remaining areas listed under "Not covered in the browser".
5. The admin's entry file is now about 1,074 kB (341 kB gzipped); roughly the same total was loaded up front before, as three files. If first load matters, split vendor code again with care — check that no two chunks import each other and run the browser tests against the build.

## Not built

MFA, password reset and any email sending (invitation links are copied manually); custom multi-stage workflows (a fixed review flow exists); plugin system; AI features; video metadata and thumbnails; signed URLs for private files; per-project and per-field role overrides; promotion of content (entries) between environments; translation comparison view; CDN purge adapters (a webhook recipe is documented instead).

## Known issues

- Refresh tokens are not rotated on use (sessions are revocable and expire when idle) — chosen to avoid multi-tab sign-outs.
- Webhook SSRF protection resolves the host before the request; it does not pin the resolved address.
- The API explorer's GraphQL editor has no syntax highlighting.
- In development, the first visit to a screen can show a brief blank state while Vite compiles it.
- In development only, a dialog's autofocused field can lose focus to the dialog itself as it opens (React re-runs effects in development). The command palette guards against it; other dialogs do not, and production builds are not affected.
- The production build warns that the entry file is larger than 900 kB.
