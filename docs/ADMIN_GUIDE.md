# Admin guide

For editors, content managers and administrators working in the Meridian studio.

## Finding your way

- **Sidebar** — everything is grouped as Workspace, Content modeling, Publishing, Developers and Administration. Collapse it with the arrows at the bottom.
- **Project switcher** (top of the sidebar) — move between projects.
- **Environment switcher** (top right) — Development, Staging and Production each have their own content model and content. Check which one you are in before publishing.
- **Search** — press `Ctrl K` (`⌘ K` on Mac) to jump to any section, open any entry by title, or start creating content.
- **Bell** — content waiting for your review and recent publishing activity.
- **Avatar** — your account, theme (light / dark / system) and sign out.

## Modeling content

*Content modeling → Content Types.* A content type describes one kind of content — articles, products, authors.

1. **New content type.** Give it a name; choose *Collection* (many entries) or *Single* (exactly one, such as site settings).
2. **Add fields.** Pick a type — text, rich text, number, date, select, image, relationship, and more — then set its label, whether it is required or unique, validation rules, help text and layout (width, group, tab).
3. **Drag** fields to reorder them. The *Form preview* shows what editors will see.
4. **Save.** Before anything is applied you see exactly what will change. Changes that would discard existing values (removing a field that holds content, switching to an incompatible type) ask you to confirm; renaming a field keeps its content.

**Components** are reusable groups of fields — an SEO block, a call-to-action. Use one inside a content type as a single *component*, a *repeatable* list, or as one of the options in a *dynamic zone* (a flexible list where editors choose which component to add). Tick *Offer as a page builder block* to make a component available in the page builder.

## Writing content

*Workspace → Content*, then choose a type.

- **List** — search, filter by status or any field, sort by column, choose which columns to show, and save filter combinations you use often. Select rows to publish, unpublish, archive or delete in bulk. *Import* and *Export* move entries as JSON.
- **Editor** — your work is saved automatically as you type, and `Ctrl S` saves a named revision. Nothing reaches the public until you publish.
- **Status** — *Draft* → *In review* → *Approved* → *Published*. *Modified* means a published entry has newer changes that are not live yet; the site keeps showing the published version until you publish again.
- **Two people, one entry** — you will see who else has it open. If someone saves before you, you are asked whether to load their version or keep yours; nothing is overwritten silently.

### Publishing

| Action | What happens |
| --- | --- |
| **Publish** | The current content goes live immediately on every connected website and app |
| **Unpublish** | Removes it from the public API; your draft stays |
| **Schedule** | Publishes (and optionally unpublishes) automatically at the times you choose |
| **Archive** | Takes it offline and makes it read-only until restored |

If a content type requires approval, *Publish* is unavailable until a reviewer approves — use **Submit for review**. Reviewers can **Approve** or **Request changes** with a comment. Editing after approval sends the entry back to draft, because approval covers the exact content that was reviewed.

### Versions, comments and activity

Every save is kept. In the editor's **Versions** panel, compare any two versions field by field and restore an earlier one — restoring changes your draft only, so the live site is unaffected until you publish. **Comments** are for discussion with your team; **Activity** shows who did what and when.

## Building pages

*Workspace → Pages.* Pages form a tree; a page's address is its parent's address plus its own slug (leave the slug empty for the home page).

In the editor:

- **Left** — the block library (hero, text, image, feature grid, FAQ, pricing, and your team's custom blocks) and an outline of the page.
- **Centre** — the page. Click a block to select it; drag to reorder; drop blocks into *Section* or *Columns* to nest them.
- **Right** — the selected block's content and style (background, spacing, alignment, columns per device, visibility per device). With nothing selected: page settings and SEO.
- **Top** — undo / redo, desktop / tablet / mobile preview, save, preview and publish.

The canvas is a faithful sketch, not the final design: your website renders each block with its own components and styling. Use **Preview** to see the page on the real site.

**SEO** — set the title and description (with a search-result preview and checks), canonical URL, indexing rules and social sharing image.

## Media library

*Workspace → Media Library.* Drag files in or use **Upload**. Images, video, PDFs and office documents are supported; files are checked by content, not by name.

- Organise with **folders** and **tags**; filter by type, or show **unused** files.
- Open a file to edit its name, **alt text** and caption, see **where it is used**, copy its URL, or **replace** it — replacing keeps every reference working.
- A file that is in use cannot be deleted by accident: you are shown where it is used first.
- Uploading a file that is already in the library reuses the existing copy.

## Releases

*Publishing → Releases.* Group changes that must go live together — a homepage update, a new navigation and a pricing page.

1. Create a release and add entries (to publish or to unpublish).
2. **Validate** to see whether everything is ready.
3. **Publish** now or **schedule** it. A release is all-or-nothing: if one item cannot be published, none are.

## Languages

*Administration → Settings → Locales.* Add locales and choose a fallback for each. For content types marked *localized*, use the language switcher in the editor to add a translation; each translation has its own status and history, and the API falls back to the fallback locale when a translation does not exist.

## People and access

*Administration → Users.* **Invite** someone with a role; share the invitation link with them (valid for seven days). Change a role, suspend or remove a member at any time — access changes take effect immediately.

*Roles & Permissions.* Built-in roles:

| Role | Can |
| --- | --- |
| Organization Administrator | Everything |
| Project Administrator | Everything inside projects; view the audit log |
| Developer | Model content, manage API keys and webhooks, edit content |
| Content Manager | Edit, review, publish, manage releases and media |
| Publisher | Edit, publish and schedule |
| Editor | Edit and delete any content, review others' work |
| Reviewer | Read, approve and request changes |
| Author | Create and edit content, submit for review |
| Viewer | Read only |

Create **custom roles** when none fit. You can only grant permissions you hold yourself, and an organization always keeps at least one administrator.

*Audit Logs* records every change with who, what, when, and the before and after values. Filter, search and export to CSV.

## Your account

*Avatar → Account & security.* Change your name and password, see where you are signed in, and sign out other devices. Changing your password signs out every other session.

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `Ctrl/⌘ K` | Search and commands |
| `Ctrl/⌘ S` | Save |
| `Ctrl/⌘ Enter` | Publish (content editor) |
| `Ctrl/⌘ Z` / `Shift Ctrl/⌘ Z` | Undo / redo (page builder) |
| `Ctrl/⌘ D` | Duplicate the selected block |
| `Delete` | Remove the selected block |
| `Esc` | Deselect / close |
