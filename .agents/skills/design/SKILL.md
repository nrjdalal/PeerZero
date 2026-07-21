---
name: design
description: Follow and maintain the app's UI conventions. Use for any UI, styling, or component work (spacing, color, cursor, layout, typography), or when making or changing a design-system convention.
---

# Design Conventions

When a change establishes or alters a convention, update this file in the same change so it never drifts. Propose a genuinely new design-token choice before committing; the maintainer owns the design language.

## Principles

- **Defaults first.** Use primitives bare at their defaults; add a class only where a specific spot genuinely needs it. Per-instance overrides are how drift starts. Example: `<Spinner />`, not `<Spinner className="size-5" />`.
- **One source per concern.** Shared styling lives in the component or its variant, never copy-pasted across call sites. Brand identity (name, description, social links) is `@packages/config/site`.

## Cursor

Every interactive control shows the pointer cursor - links, anchors, buttons, menu triggers, toggles, mutation buttons, and dropdown menu items alike. The pointer signals "this is clickable," not specifically "this navigates."

- This is set once at the primitives, not per call site: `buttonVariants` includes `cursor-pointer` on its base, and the dropdown menu parts (`DropdownMenuItem`, `DropdownMenuCheckboxItem`, `DropdownMenuRadioItem`, `DropdownMenuSubTrigger`) use `cursor-pointer`. `<a href>` shows the pointer natively. So no per-instance `cursor-pointer` class is needed.
- These are shadcn primitives, so the override lives in `.github/scripts/shadcn-customize.ts` (`patchCursor`) - editing `ui/*` directly is wiped by the next sync.
- A readOnly button-like input (the docs search trigger, `DocsSearch` in `components/docs/sidebar.tsx`) uses `cursor-default` to avoid the text I-beam; disabled controls fall back to the default arrow via `disabled:pointer-events-none`.

## Spacing

- Stay on the Tailwind scale; snap to the nearest step, no off-ladder one-offs (`gap-7.5`, `size-4.5`, `w-45`, `mb-18`, `text-[0.6rem]`).
- `gap-2` is the workhorse for tight clusters.
- Dashboard and console pages use the collapsible `SidebarShell` (`components/shell/sidebar-shell.tsx`) and wrap content in `PageShell` (`components/shell/page-shell.tsx`): it owns `mx-auto` + width + `p-4 sm:p-6` via a `size` variant (`sm`/`md`/`lg`/`full`, default `md` = `max-w-4xl`). The title/description/actions row is `PageHeader` (`components/shell/page-header.tsx`). Never hand-roll `mx-auto`/`max-w-*`/`p-*` or the header layout.
- Marketing pages share one vertical scale: `py-24` sections and a `px-4 md:px-6` container gutter.

## Typography and headings

- Exactly one `<h1>` per page (the page title); sections use `<h2>` and below, never skipping a level.
- Use the existing type scale and tokens; no off-scale font sizes.
- Marketing-page headings are `font-bold`. Sub-headings within a section stay lighter (a `font-semibold` `h3`) to preserve hierarchy; non-heading display text (a stat value) follows its own weight.

## Color and theming

- Semantic tokens only: `text-muted-foreground`, `bg-card`, `border-border`, `bg-sidebar`, and friends. No hardcoded hex, rgb, or hsl in classNames or inline styles. The one exception is Satori-rendered OG images, which have no theme context.
- Dark mode is `next-themes` (`attribute="class"`, `app/providers.tsx`); pair every `dark:` with a token.
- Success uses the `--success` token (green-600 light, green-500 dark, mirroring `--destructive`): `text-success`, `bg-success/10`, `border-success/20`. Foreground-less, like `--destructive`.
- Status badges are the one documented exception to "semantic tokens only": they follow shadcn's Custom Colors pattern (ui.shadcn.com/docs/components/base/badge#custom-colors), a soft palette fill paired light/dark, e.g. `bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300` (blue = downloading, green = completed; paused, fetching, and syncing stay neutral on `bg-muted`, and fetching + syncing `animate-pulse` to mark transient work). Palette colors also color-code the torrent row-action icons: state actions mirror the status they produce (blue resume returns to Downloading, muted pause matches the Paused badge), the reveal icon follows the row's own current status, and delete uses the destructive token. Everything else stays on semantic tokens. (`--primary` is neutral, chroma 0, so it can't carry a status hue.) The badge border matches the text via `border-current` at a `border-[0.5px]` hairline.

## Layout and landmarks

- Each top-level page wraps its content in a single `<main>`. Route-group layouts (dashboard via `SidebarShell`, docs, blog) already render their own `<main>`, so add none to the root layout or you nest landmarks.
- Top-level full-height surfaces (the body, marketing pages, the `SidebarShell` root) use `min-h-svh`, matching the shadcn sidebar; no `dvh`. Surfaces nested inside the shell content pane (route `error`/`loading`, dashboard/console content) fill it with `flex-1`: the shell `<main>` is `flex min-h-svh min-w-0 flex-1 flex-col`, so don't re-assert `min-h-svh` inside an already-full-height parent.

## Components

- **Loading:** `<Spinner />`, bare, at its default `size-4`. Never hand-roll `RiLoaderLine`.
- **Empty states:** the `Empty` primitive (`EmptyHeader` / `EmptyMedia` / `EmptyTitle` / ...). Do not hand-roll empty messages.
- **Badges and pills:** `<Badge>` (with a variant, plus className for semantic color like `text-success`) over a hand-rolled rounded-full span. Identity rows (avatar + name + email) use `Item` / `ItemMedia` / `ItemContent`. Exceptions: the sidebar trigger identity stays hand-rolled inside `SidebarMenuButton` (the chevron is a sibling there); the marketing landing (`web/next/src/app/(marketing)/page.tsx`) hand-rolls a larger `Eyebrow` pill for section eyebrows and the hero badge, since `<Badge>` is sized for compact UI (`h-5`, `text-xs`).
- **Forms:** native `<form>` then `<FieldGroup>` then `<form.Field>` then `<Field>` + `<FieldLabel>` + `<Input>` + conditional `<FieldError>`, with `@tanstack/react-form` + zod. Let `FieldGroup` own the vertical rhythm (no second `space-y-*`). Do not hand-roll labels or error markup.
- **Dialogs:** one canonical structure, always in this order: `<DialogContent>` (size) then `<DialogHeader>` (title + description) then `<DialogBody>` then `<DialogFooter>` (actions, optional). `DialogBody` is the scroll region (`max-h-[60svh]`, `gap-6` between sections) - put every block that isn't the header or footer inside it, so a long dialog scrolls while the header and footer stay put. Section headings inside the body are an `<h3 className="text-sm font-semibold">`. Never hand-roll `p-0` / `p-6` / a bare `ScrollArea` on a dialog to fake this. Sizes: bare `DialogContent` is `sm:max-w-sm`; content-heavy dialogs (Sources, Settings) use `sm:max-w-2xl`; the auth dialog (`components/common/access.tsx`) uses `max-w-md`. Off-by-default toggles live under an `Accordion` "Advanced" section (see Settings). Header and footer read as matching muted bars bookending the body: `DialogFooter` keeps shadcn's `bg-muted/50` bar and `DialogHeader` gets the same bar mirrored to the top (`border-b` + `rounded-t-xl` instead of `border-t` + `rounded-b-xl`). `DialogBody` (a local addition) and that header-bar normalization are both re-applied after a shadcn sync by `patchDialog()` in `.github/scripts/shadcn-customize.ts`.
- **Expandable rows:** the shared `DataGrid` (`components/torrents/data-grid.tsx`) renders a full-width sub-row under an expanded row via the `renderSubRow` + `getRowCanExpand` props (TanStack `getExpandedRowModel`, no `getSubRows`, so nav/selection stay 1:1 with data rows). The expand affordance is the row itself: clicking a torrent row toggles its sub-row (`row.toggleExpanded()`), and rows show `cursor-pointer` only when `getCanExpand()`. Row clicks no longer select - selection is checkbox + keyboard only (clicks on the checkbox, action buttons, or links still act normally). There is no chevron column. First consumer: the Transfers file tree (`components/torrents/file-tree.tsx`) - a flat, roving-tabindex ARIA tree (`role="tree"` / `treeitem` with `aria-level`/`aria-expanded`), folders collapsed by default, per-file `Progress` bars, on the grid's own background (no tint). It owns its keyboard nav (Up/Down move, Left/Right collapse-or-step, Home/End, Enter/Space toggle), so the grid's arrow-key row nav bails when focus is inside it (`[role="tree"]` is in the grid's ignore list). Rows indent from the Name column's first character (a `3.5rem` base = 48px checkbox column + 8px cell padding, plus `1.5rem`/level so a child's icon lands under its parent's name); the sub-row grows to fit, no fixed height. The focused row highlights only while the tree holds focus (no pre-selected first row); the chevron column is reserved only when the tree has folders (a folder-less single-file torrent shows none); and the sub-row neutralizes the base row's `has-aria-expanded` + hover tints (`has-aria-expanded:bg-transparent hover:bg-transparent`) so opening a folder never shades the whole tree.
- **Media player:** a playable file (video/audio, `isPlayable` in `file-tree.tsx`) shows a ▶ affordance - the file icon swaps to a play glyph on hover (no layout shift, so columns stay aligned), and Enter/Space on a focused file plays it. **Every** file plays in one **Netflix-style player** (`components/torrents/libmedia-player.tsx`) - a full-screen `Dialog` filling the viewport (`h-svh w-svw`) on black with a custom control overlay: red (`#E50914`) scrubber + remaining time, play/pause, +-10s, volume, centered title, subtitle + speed (`[0.5, 0.75, 1, 1.25, 1.5]`) menus, fullscreen, and a top-left back arrow. Controls auto-hide after 3s idle (the cursor with them) while playing and stay up while paused; keyboard shortcuts (Space/`K` play, arrows +-10s / volume, `M` mute, `F` fullscreen) and click-to-pause. **Resume playback:** reopening a video seeks to ~5s before where you left off - the position per file (keyed `${infoHash}:${fileIndex}`) is saved every 5s + on close by `useResumePosition` (`lib/use-resume-position.ts`, shared by both players) into the server-side prefs blob so it survives the desktop restart, and cleared once watched to within 15s of the end. It uses **@libmedia** (headless) as the decode engine - hardware WebCodecs when the codec is available (e.g. HEVC in a macOS WebView), else its own FFmpeg WASM (AC3/DTS have no WebCodecs path anywhere) - so mp4, mkv, HEVC and AC3/DTS all play through the same UI. `enableWorker:true` keeps decode off the main thread; no COOP/COEP (no SharedArrayBuffer). The ESM chunks + codec WASM are **self-hosted** from `/public/libmedia` (vendored by `.github/scripts/vendor-libmedia.ts`) so it runs fully offline, and libmedia's own chrome is hidden in `libmedia-player.css` (overlays sit at `z-30` above the canvas). If libmedia can't load/decode a file it falls back to the **native-player handoff** (`@tauri-apps/plugin-opener` `openUrl(url, "VLC")` on desktop, a toast in a plain browser).

  The stream is a Range endpoint (`GET /api/torrents/:infoHash/stream/:fileIdx`, absolute `config.api.url`, no credentials, exempt from the rate limiter) proxying `file.createReadStream` from the engine.
- **Grid selection + keyboard:** `DataGrid` follows the WAI-ARIA grid model (mirrors AG Grid / Finder / Windows Explorer). Mouse: a row-body click toggles expansion, the checkbox toggles selection (its cell swallows the click so it never also expands), action buttons act normally. Keyboard: Up/Down move a focus-cursor (a `bg-accent` background highlight, not a ring; `activeId`) with no selection, and form one continuous **treegrid** - Down on an expanded row descends into its file tree and Up/Down flow through the tree, handing focus back to the grid at the tree's boundaries. Space toggles the focused row's selection, Enter opens/closes its sub-row, Shift+Up/Down extend a range from the anchor, Cmd/Ctrl+A selects all. Navigation never selects on its own. Bulk actions render in a floating bottom **dock** (`fixed inset-x-0 bottom-10`, centered `bg-popover` pill, `shadow-lg`, `pointer-events-none` wrapper + `pointer-events-auto` dock) that overlays content, so selecting never shifts the table.
- **Icons:** `@remixicon/react` only. `size-4` inside buttons by default.
- **shadcn (`components/ui/*`):** customize only via `.github/scripts/shadcn-customize.ts` (the sync wipes and re-scaffolds `ui/`). Extend the primitive in place; do not fork a copy.

## File and export naming

- Components are grouped by domain folder (`common/`, `shell/`, `console/`, `dashboard/`, `docs/`, `blog/`, `marketing/`, `ui/`); file names are kebab-case. A single-component file's basename matches its export; a multi-export slot file is named `<area>/sidebar.tsx` (console, dashboard, docs) and its exports follow the sidebar-slot rule below. `docs/` holds one of each (`docs/sidebar.tsx` + `docs/copy-as-markdown.tsx`).
- Sidebar slot exports follow one rule: domain-prefix the generic-role names (`Nav`, `Header`, `Footer`, `Search`) so they read unambiguously and never collide across areas (`console/sidebar.tsx` imports `DocsNav`). So `ConsoleNav`, `ConsoleHeader`, `DashboardFooter`, `DocsNav`, `DocsFooter`, `DocsSearch`. Leave distinctive content names bare (`OrgSwitcher`, `CopyAsMarkdown`): a domain prefix on a self-explaining name is redundant.
- `shell/` holds the shared app-shell chrome as two families, `Sidebar*` (`SidebarShell`, `SidebarAdaptive`, `SidebarFloatingTrigger`, `SidebarDropdownMenu`, `SidebarUserMenu`) and `Page*` (`PageShell`, `PageHeader`). "Shell" denotes structural layout scaffolding, not one specific component.

## Open decisions

None open. Resolved decisions fold into the sections above; add new ones here (move up once chosen).
