import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Controller, useForm } from 'react-hook-form';
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import AccountTreeOutlined from '@mui/icons-material/AccountTreeOutlined';
import AddOutlined from '@mui/icons-material/AddOutlined';
import ArchiveOutlined from '@mui/icons-material/ArchiveOutlined';
import ArrowDownwardOutlined from '@mui/icons-material/ArrowDownwardOutlined';
import ArrowUpwardOutlined from '@mui/icons-material/ArrowUpwardOutlined';
import ChevronRightOutlined from '@mui/icons-material/ChevronRightOutlined';
import ContentCopyOutlined from '@mui/icons-material/ContentCopyOutlined';
import DeleteOutlineOutlined from '@mui/icons-material/DeleteOutlineOutlined';
import DriveFileMoveOutlined from '@mui/icons-material/DriveFileMoveOutlined';
import EditOutlined from '@mui/icons-material/EditOutlined';
import MoreHorizOutlined from '@mui/icons-material/MoreHorizOutlined';
import PublicOffOutlined from '@mui/icons-material/PublicOffOutlined';
import PublicOutlined from '@mui/icons-material/PublicOutlined';
import SearchOffOutlined from '@mui/icons-material/SearchOffOutlined';
import SubdirectoryArrowRightOutlined from '@mui/icons-material/SubdirectoryArrowRightOutlined';
import UnarchiveOutlined from '@mui/icons-material/UnarchiveOutlined';
import UnfoldLessOutlined from '@mui/icons-material/UnfoldLessOutlined';
import UnfoldMoreOutlined from '@mui/icons-material/UnfoldMoreOutlined';
import { type EntryStatus, PAGE_TEMPLATES, WORKFLOW_TRANSITIONS, slugify } from '@meridian/shared';
import { useProject } from '@/app/workspace';
import { useConfirm } from '@/components/feedback';
import { EmptyState, ErrorState, FormError, Mono, Page, PageHeader, RelativeTime, SearchInput, StatusChip, TableSkeleton, useDebounced } from '@/components/ui';
import { ApiError, type ApiErrorDetail, api, errorMessage } from '@/lib/api';
import type { EntryDetail, PageTreeItem } from '@/lib/types';
import { toast } from '@/store';
import { FONT_MONO } from '@/theme/theme';
import { PAGES_TYPE, type PageTreeNode, SLUG_PATTERN, buildPageTree, collectDescendantIds, joinPagePath, useInvalidatePages, usePageTree } from './hooks';

// ─── Shared bits ─────────────────────────────────────────────────────────────

type StatusFilter = 'all' | 'DRAFT' | 'IN_REVIEW' | 'PUBLISHED' | 'SCHEDULED' | 'ARCHIVED';

/** "In review" covers the whole review step, so pages that were sent back or approved stay findable. */
const STATUS_FILTERS: { value: StatusFilter; label: string; statuses: EntryStatus[] }[] = [
  { value: 'all', label: 'All statuses', statuses: [] },
  { value: 'DRAFT', label: 'Draft', statuses: ['DRAFT'] },
  { value: 'IN_REVIEW', label: 'In review', statuses: ['IN_REVIEW', 'CHANGES_REQUESTED', 'APPROVED'] },
  { value: 'PUBLISHED', label: 'Published', statuses: ['PUBLISHED'] },
  { value: 'SCHEDULED', label: 'Scheduled', statuses: ['SCHEDULED'] },
  { value: 'ARCHIVED', label: 'Archived', statuses: ['ARCHIVED'] },
];

const ellipsis = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } as const;
const fromMd = { display: { xs: 'none', md: 'table-cell' } } as const;

const pageTitle = (page: Pick<PageTreeItem, 'title'>) => page.title?.trim() || 'Untitled page';
const templateLabel = (value: string) => PAGE_TEMPLATES.find((t) => t.value === value)?.label ?? value;

/** A failed request's message, followed by its first validation problems. */
function explain(err: unknown): string {
  const base = errorMessage(err);
  if (!(err instanceof ApiError) || !Array.isArray(err.details)) return base;
  const details: ApiErrorDetail[] = err.details;
  const messages = details.map((d) => d.message).filter(Boolean);
  if (messages.length === 0) return base;
  const more = messages.length - 2;
  return `${base} — ${messages.slice(0, 2).join(' · ')}${more > 0 ? ` (and ${more} more)` : ''}`;
}

/** Every page in reading order: parents first, then their children. */
function flattenTree(nodes: PageTreeNode[], into: PageTreeNode[] = []): PageTreeNode[] {
  for (const node of nodes) {
    into.push(node);
    flattenTree(node.children, into);
  }
  return into;
}

function UrlPreview({ label, path, note }: { label: string; path: string; note?: ReactNode }) {
  const { project } = useProject();
  const origin = project.settings.siteUrl?.replace(/\/+$/, '') ?? '';
  return (
    <Box sx={{ px: 3, py: 2.5, borderRadius: '8px', border: 1, borderColor: 'border.subtle', bgcolor: 'surface.subtle' }}>
      <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 0.5 }}>
        {label}
      </Typography>
      <Mono sx={{ display: 'block', fontSize: '0.8125rem', overflowWrap: 'anywhere' }}>
        {origin && (
          <Box component="span" sx={{ color: 'text.disabled' }}>
            {origin}
          </Box>
        )}
        {path}
      </Mono>
      {note && (
        <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 1 }}>
          {note}
        </Typography>
      )}
    </Box>
  );
}

function ParentSelect({ label, value, onChange, options, helperText, disabled }: { label: string; value: string; onChange: (value: string) => void; options: PageTreeNode[]; helperText?: ReactNode; disabled?: boolean }) {
  const byId = useMemo(() => new Map(options.map((o) => [o.id, o])), [options]);
  return (
    <TextField
      select
      label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      helperText={helperText}
      disabled={disabled}
      slotProps={{
        inputLabel: { shrink: true },
        select: {
          displayEmpty: true,
          MenuProps: { slotProps: { paper: { sx: { maxHeight: 340 } } } },
          renderValue: (selected: unknown) => {
            const node = typeof selected === 'string' ? byId.get(selected) : undefined;
            if (!node) return 'None (top level)';
            return (
              <Box component="span" sx={{ display: 'flex', alignItems: 'baseline', gap: 2, minWidth: 0 }}>
                <Box component="span" sx={ellipsis}>
                  {pageTitle(node)}
                </Box>
                <Mono sx={{ ...ellipsis, color: 'text.secondary' }}>{node.path}</Mono>
              </Box>
            );
          },
        },
      }}
    >
      <MenuItem value="">None (top level)</MenuItem>
      {options.map((node) => (
        <MenuItem key={node.id} value={node.id} sx={{ pl: 2 + Math.min(node.depth, 8) * 3 }}>
          <Box component="span" sx={{ ...ellipsis, flex: 1 }}>
            {pageTitle(node)}
          </Box>
          <Mono sx={{ ...ellipsis, ml: 3, maxWidth: '50%', color: 'text.secondary' }}>{node.path}</Mono>
        </MenuItem>
      ))}
    </TextField>
  );
}

// ─── New page ────────────────────────────────────────────────────────────────

const createSchema = (pages: PageTreeItem[]) =>
  z
    .object({
      title: z.string().trim().min(1, 'Give the page a title').max(200, 'Keep the title under 200 characters'),
      slug: z
        .string()
        .trim()
        .max(96, 'Keep the slug under 96 characters')
        .refine((v) => v === '' || SLUG_PATTERN.test(v), 'Use lowercase letters, numbers and hyphens'),
      parentId: z.string(),
      template: z.string().min(1, 'Choose a template'),
      category: z.string().trim().max(80, 'Keep the category under 80 characters'),
    })
    .superRefine((values, ctx) => {
      if (values.slug !== '' && !SLUG_PATTERN.test(values.slug)) return;
      if (values.slug === '' && values.parentId) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['slug'], message: 'Enter a slug. Only the top-level home page can leave it empty.' });
        return;
      }
      const parent = pages.find((p) => p.id === values.parentId);
      const path = joinPagePath(parent?.path, values.slug);
      const clash = pages.find((p) => p.path === path);
      if (clash) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['slug'], message: `${path} is already used by “${pageTitle(clash)}”` });
    });
type CreateValues = z.infer<ReturnType<typeof createSchema>>;

const CREATE_FIELDS = ['title', 'slug', 'template', 'category'] as const;
/** The API reports problems as `slug` or `data.slug`; both belong to the same input. */
const toCreateField = (path: string) => CREATE_FIELDS.find((field) => path === field || path === `data.${field}`);

function NewPageDialog({ open, parentId, pages, locale, onClose, onExited }: { open: boolean; parentId: string | null; pages: PageTreeNode[]; locale: string; onClose: () => void; onExited: () => void }) {
  const ws = useProject();
  const navigate = useNavigate();
  const invalidate = useInvalidatePages();
  const categoriesId = useId();
  /** The slug follows the title until it is edited by hand — including being cleared for the home page. */
  const slugEdited = useRef(false);
  const schema = useMemo(() => createSchema(pages), [pages]);
  const form = useForm<CreateValues>({
    resolver: zodResolver(schema),
    defaultValues: { title: '', slug: '', parentId: parentId && pages.some((p) => p.id === parentId) ? parentId : '', template: PAGE_TEMPLATES[0].value, category: '' },
  });
  const { errors, isSubmitted } = form.formState;
  const [slug, selectedParent] = form.watch(['slug', 'parentId']);
  const parent = pages.find((p) => p.id === selectedParent);
  const hasHome = pages.some((p) => p.path === '/');
  const categories = useMemo(() => [...new Set(pages.map((p) => p.category).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b)), [pages]);

  const create = useMutation({
    mutationFn: (values: CreateValues) =>
      api.post<EntryDetail>(`${ws.envBase}/entries/${PAGES_TYPE}`, {
        data: { title: values.title, slug: values.slug, template: values.template, category: values.category || undefined, seo: {}, blocks: [] },
        parentId: values.parentId || null,
        locale,
      }),
    onSuccess: (created) => {
      invalidate();
      toast.success(`Created “${pageTitle(created)}”`);
      navigate(ws.href(`pages/${created.id}`));
    },
    onError: (err) => {
      if (!(err instanceof ApiError)) return;
      let focused = false;
      for (const [path, message] of Object.entries(err.fieldErrors)) {
        const field = toCreateField(path);
        if (!field) continue;
        form.setError(field, { type: 'server', message }, { shouldFocus: !focused });
        focused = true;
      }
    },
  });
  const shownOnField = create.error instanceof ApiError && Object.keys(create.error.fieldErrors).some((path) => !!toCreateField(path));

  return (
    <Dialog open={open} onClose={() => !create.isPending && onClose()} aria-labelledby="new-page-title" slotProps={{ transition: { onExited } }}>
      <form noValidate onSubmit={form.handleSubmit((values) => create.mutate(values))}>
        <DialogTitle id="new-page-title">New page</DialogTitle>
        <DialogContent>
          <FormError error={shownOnField ? null : create.error} />
          <Stack spacing={4} sx={{ pt: 1 }}>
            <TextField
              label="Title"
              autoFocus
              placeholder="About us"
              error={!!errors.title}
              helperText={errors.title?.message ?? 'Shown in the page tree and used as the default browser title'}
              {...form.register('title', {
                onChange: (e: { target: { value: string } }) => {
                  if (!slugEdited.current) form.setValue('slug', slugify(e.target.value), { shouldValidate: isSubmitted });
                },
              })}
            />
            <TextField
              label="Slug"
              placeholder={selectedParent || hasHome ? 'about-us' : 'Empty for the home page'}
              error={!!errors.slug}
              helperText={errors.slug?.message ?? (selectedParent || hasHome ? 'Lowercase letters, numbers and hyphens' : 'Lowercase letters, numbers and hyphens. Leave it empty for the home page.')}
              slotProps={{ htmlInput: { spellCheck: false, autoCapitalize: 'none', autoCorrect: 'off' }, input: { sx: { fontFamily: FONT_MONO } }, inputLabel: { shrink: true } }}
              {...form.register('slug', {
                onChange: () => {
                  slugEdited.current = true;
                },
              })}
            />
            <Controller
              control={form.control}
              name="parentId"
              render={({ field }) => (
                <ParentSelect
                  label="Parent page"
                  value={field.value}
                  options={pages}
                  onChange={(value) => {
                    field.onChange(value);
                    // The slug's rules depend on where the page sits.
                    if (isSubmitted) void form.trigger('slug');
                  }}
                />
              )}
            />
            <UrlPreview label="Page URL" path={joinPagePath(parent?.path, slug.trim())} />
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={{ xs: 4, sm: 2 }}>
              <Controller
                control={form.control}
                name="template"
                render={({ field }) => (
                  <TextField select label="Template" value={field.value} onChange={field.onChange} onBlur={field.onBlur} inputRef={field.ref} error={!!errors.template} helperText={errors.template?.message ?? 'The layout around the page’s blocks'}>
                    {PAGE_TEMPLATES.map((t) => (
                      <MenuItem key={t.value} value={t.value}>
                        {t.label}
                      </MenuItem>
                    ))}
                  </TextField>
                )}
              />
              <TextField
                label="Category"
                placeholder="Marketing"
                error={!!errors.category}
                helperText={errors.category?.message ?? 'Optional. Groups related pages.'}
                slotProps={{ htmlInput: { list: categories.length > 0 ? categoriesId : undefined }, inputLabel: { shrink: true } }}
                {...form.register('category')}
              />
            </Stack>
          </Stack>
          {categories.length > 0 && (
            <datalist id={categoriesId}>
              {categories.map((category) => (
                <option key={category} value={category} />
              ))}
            </datalist>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} disabled={create.isPending}>
            Cancel
          </Button>
          <Button type="submit" variant="contained" loading={create.isPending}>
            Create and open editor
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

// ─── Move to another parent ──────────────────────────────────────────────────

function MovePageDialog({ open, page, pages, onClose, onExited }: { open: boolean; page: PageTreeNode; pages: PageTreeNode[]; onClose: () => void; onExited: () => void }) {
  const ws = useProject();
  const invalidate = useInvalidatePages();
  const name = pageTitle(page);
  /** A page cannot sit underneath itself, so it and its descendants are not offered. */
  const options = useMemo(() => {
    const blocked = collectDescendantIds(page);
    blocked.add(page.id);
    return pages.filter((p) => !blocked.has(p.id));
  }, [page, pages]);
  const [parentId, setParentId] = useState(() => (page.parentId && options.some((o) => o.id === page.parentId) ? page.parentId : ''));
  const parent = options.find((o) => o.id === parentId);
  const unchanged = parentId === (page.parentId ?? '');
  const previewPath = unchanged && page.path ? page.path : joinPagePath(parent?.path, page.slug ?? '');

  const move = useMutation({
    mutationFn: async () => {
      // The parent is saved with the page's content, so the current draft is read first and sent back unchanged.
      const url = `${ws.envBase}/entry/${page.id}`;
      const entry = await api.get<EntryDetail>(url);
      return api.put<EntryDetail>(url, { data: entry.data, lockVersion: entry.lockVersion, parentId: parentId || null });
    },
    onSuccess: () => {
      toast.success(parent ? `Moved “${name}” under “${pageTitle(parent)}”` : `Moved “${name}” to the top level`);
      invalidate();
      onClose();
    },
  });

  return (
    <Dialog open={open} onClose={() => !move.isPending && onClose()} maxWidth="xs" aria-labelledby="move-page-title" slotProps={{ transition: { onExited } }}>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!unchanged) move.mutate();
        }}
      >
        <DialogTitle id="move-page-title" sx={{ overflowWrap: 'anywhere' }}>
          Move “{name}”
        </DialogTitle>
        <DialogContent>
          {move.isError && (
            <Alert severity="error" sx={{ mb: 3 }}>
              {explain(move.error)}
            </Alert>
          )}
          <Stack spacing={4} sx={{ pt: 1 }}>
            <ParentSelect label="New parent page" value={parentId} onChange={setParentId} options={options} disabled={move.isPending} helperText={page.children.length > 0 ? 'Its child pages move with it.' : undefined} />
            <UrlPreview label={unchanged ? 'Current URL' : 'New URL'} path={previewPath} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} disabled={move.isPending}>
            Cancel
          </Button>
          <Button type="submit" variant="contained" loading={move.isPending} disabled={unchanged}>
            Move page
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

// ─── Screen ──────────────────────────────────────────────────────────────────

interface Row {
  node: PageTreeNode;
  expandable: boolean;
  expanded: boolean;
}

export default function PagesPage() {
  const ws = useProject();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const invalidate = useInvalidatePages();
  const [params, setParams] = useSearchParams();
  const envId = ws.environment.id;

  // The locale lives in the URL so the tree comes back in the same language after a trip to the editor.
  const locales = ws.project.locales;
  const requestedLocale = params.get('locale');
  const locale = requestedLocale && locales.some((l) => l.code === requestedLocale) ? requestedLocale : ws.defaultLocale;
  const setLocale = (code: string) => {
    const next = new URLSearchParams(params);
    if (code === ws.defaultLocale) next.delete('locale');
    else next.set('locale', code);
    setParams(next, { replace: true });
  };

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ anchor: HTMLElement; node: PageTreeNode; open: boolean } | null>(null);
  const [creating, setCreating] = useState<{ parentId: string | null; open: boolean } | null>(null);
  const [moving, setMoving] = useState<{ node: PageTreeNode; open: boolean } | null>(null);

  const canCreate = ws.can('content.create');
  const canUpdate = ws.can('content.update');
  const canPublish = ws.can('content.publish');
  const canDelete = ws.can('content.delete');
  const canArchive = ws.can(WORKFLOW_TRANSITIONS.archive.permission);
  const canUnarchive = ws.can(WORKFLOW_TRANSITIONS.unarchive.permission);

  // Deep link from the dashboard and the command palette: …/pages?new=1
  useEffect(() => {
    if (params.get('new') !== '1') return;
    if (canCreate) setCreating({ parentId: null, open: true });
    const next = new URLSearchParams(params);
    next.delete('new');
    setParams(next, { replace: true });
  }, [params, setParams, canCreate]);

  const tree = usePageTree(locale);
  const roots = useMemo(() => buildPageTree(tree.data ?? []), [tree.data]);
  const ordered = useMemo(() => flattenTree(roots), [roots]);
  const byId = useMemo(() => new Map(ordered.map((node) => [node.id, node])), [ordered]);
  const parents = useMemo(() => ordered.filter((node) => node.children.length > 0), [ordered]);

  const query = useDebounced(search, 200).trim().toLowerCase();
  const filtering = query !== '' || status !== 'all';
  const rows = useMemo<Row[]>(() => {
    if (filtering) {
      // Matches can sit anywhere in the tree, so a filtered view is a flat list; the URL path says where each page lives.
      const statuses = STATUS_FILTERS.find((f) => f.value === status)?.statuses ?? [];
      return ordered
        .filter((node) => statuses.length === 0 || statuses.includes(node.status))
        .filter((node) => query === '' || (node.title ?? '').toLowerCase().includes(query) || (node.path ?? '').toLowerCase().includes(query))
        .map((node) => ({ node, expandable: false, expanded: false }));
    }
    const out: Row[] = [];
    const walk = (nodes: PageTreeNode[]) => {
      for (const node of nodes) {
        const expandable = node.children.length > 0;
        const expanded = expandable && !collapsed.has(node.id);
        out.push({ node, expandable, expanded });
        if (expanded) walk(node.children);
      }
    };
    walk(roots);
    return out;
  }, [filtering, status, query, ordered, roots, collapsed]);

  const toggle = (id: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const anyCollapsed = parents.some((node) => collapsed.has(node.id));
  const clearFilters = () => {
    setSearch('');
    setStatus('all');
  };

  const openCreate = (parentId: string | null) => setCreating({ parentId, open: true });
  const closeMenu = () => setMenu((current) => current && { ...current, open: false });
  const entryUrl = (node: PageTreeItem) => `${ws.envBase}/entry/${node.id}`;
  const editorHref = (id: string) => ws.href(`pages/${id}`);

  /** Pages that share a parent, in tree order. This is exactly the set the reorder endpoint expects. */
  const siblingsOf = (node: PageTreeNode): PageTreeNode[] => {
    const pool = (node.parentId ? byId.get(node.parentId)?.children : undefined) ?? roots;
    return pool.filter((other) => other.parentId === node.parentId);
  };

  const run = async <T,>(node: PageTreeNode, request: () => Promise<T>, done: string | ((result: T) => void)) => {
    setBusy(node.id);
    try {
      const result = await request();
      if (typeof done === 'string') toast.success(done);
      else done(result);
      invalidate();
    } catch (err) {
      toast.error(explain(err));
    } finally {
      setBusy(null);
    }
  };

  const duplicate = (node: PageTreeNode) =>
    run(
      node,
      () => api.post<EntryDetail>(`${entryUrl(node)}/duplicate`),
      (copy) => toast.success(`Duplicated “${pageTitle(node)}”`, { label: 'Open copy', href: editorHref(copy.id) }),
    );

  const publish = (node: PageTreeNode) => run(node, () => api.post<EntryDetail>(`${entryUrl(node)}/publish`, {}), `Published “${pageTitle(node)}”`);

  const unarchive = (node: PageTreeNode) => run(node, () => api.post<EntryDetail>(`${entryUrl(node)}/transition`, { action: 'unarchive' }), `Restored “${pageTitle(node)}” from the archive`);

  const unpublish = (node: PageTreeNode) =>
    confirm({
      title: `Unpublish “${pageTitle(node)}”?`,
      message: 'It goes offline immediately and returns to draft. Nothing is deleted.',
      confirmLabel: 'Unpublish',
      onConfirm: async () => {
        await api.post<EntryDetail>(`${entryUrl(node)}/unpublish`, {});
        toast.success(`Unpublished “${pageTitle(node)}”`);
        invalidate();
      },
    });

  const archive = (node: PageTreeNode) =>
    confirm({
      title: `Archive “${pageTitle(node)}”?`,
      message: node.isPublished ? 'It is published, so it goes offline immediately. Archived pages are read-only until they are restored.' : 'Archived pages are read-only until they are restored.',
      confirmLabel: 'Archive',
      onConfirm: async () => {
        await api.post<EntryDetail>(`${entryUrl(node)}/transition`, { action: 'archive' });
        toast.success(`Archived “${pageTitle(node)}”`);
        invalidate();
      },
    });

  const remove = (node: PageTreeNode) =>
    confirm({
      title: `Delete “${pageTitle(node)}”?`,
      message: node.isPublished ? 'It is published, so it goes offline immediately. The page is moved to the trash.' : 'The page is moved to the trash.',
      confirmLabel: 'Delete page',
      destructive: true,
      onConfirm: async () => {
        await api.delete(entryUrl(node));
        toast.success(`Deleted “${pageTitle(node)}”`);
        invalidate();
      },
    });

  const reorder = (node: PageTreeNode, delta: -1 | 1) => {
    const siblings = siblingsOf(node);
    const index = siblings.findIndex((other) => other.id === node.id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= siblings.length) return Promise.resolve();
    const orderedIds = siblings.map((other) => other.id);
    orderedIds.splice(target, 0, ...orderedIds.splice(index, 1));
    return run(
      node,
      async () => {
        await api.post(`${ws.envBase}/pages/reorder`, { parentId: node.parentId, orderedIds });
        // Show the new order straight away; the refetch that follows confirms it.
        const position = new Map(orderedIds.map((id, at) => [id, at]));
        queryClient.setQueryData<PageTreeItem[]>(['pages', envId, 'tree', locale], (items) =>
          items?.map((item) => {
            const at = position.get(item.id);
            return at === undefined ? item : { ...item, position: at };
          }),
        );
      },
      `Moved “${pageTitle(node)}” ${delta < 0 ? 'up' : 'down'}`,
    );
  };

  const menuItems = (node: PageTreeNode): ReactNode[] => {
    const archived = node.status === 'ARCHIVED';
    const siblings = siblingsOf(node);
    const index = siblings.findIndex((other) => other.id === node.id);
    const entry = (key: string, icon: ReactNode, label: string, onClick: () => void, options: { disabled?: boolean; destructive?: boolean } = {}) => (
      <MenuItem
        key={key}
        disabled={options.disabled}
        onClick={() => {
          closeMenu();
          onClick();
        }}
        sx={options.destructive ? { color: 'error.main' } : undefined}
      >
        <ListItemIcon>{icon}</ListItemIcon>
        {label}
      </MenuItem>
    );

    const primary = [entry('edit', <EditOutlined />, canUpdate && !archived ? 'Edit' : 'Open', () => navigate(editorHref(node.id)))];
    if (canCreate && !archived) primary.push(entry('child', <SubdirectoryArrowRightOutlined />, 'Add child page', () => openCreate(node.id)));
    if (canCreate) primary.push(entry('duplicate', <ContentCopyOutlined />, 'Duplicate', () => void duplicate(node)));

    const lifecycle = [];
    if (canPublish && !archived && node.status !== 'PUBLISHED') lifecycle.push(entry('publish', <PublicOutlined />, node.isPublished ? 'Publish changes' : 'Publish', () => void publish(node)));
    if (canPublish && !archived && node.isPublished) lifecycle.push(entry('unpublish', <PublicOffOutlined />, 'Unpublish', () => void unpublish(node)));
    if (canArchive && !archived) lifecycle.push(entry('archive', <ArchiveOutlined />, 'Archive', () => void archive(node)));
    if (canUnarchive && archived) lifecycle.push(entry('unarchive', <UnarchiveOutlined />, 'Restore from archive', () => void unarchive(node)));

    const structure = [];
    if (canUpdate) {
      structure.push(entry('up', <ArrowUpwardOutlined />, 'Move up', () => void reorder(node, -1), { disabled: index <= 0 }));
      structure.push(entry('down', <ArrowDownwardOutlined />, 'Move down', () => void reorder(node, 1), { disabled: index < 0 || index >= siblings.length - 1 }));
      // Archived pages are read-only, and a new parent is saved as an edit.
      if (!archived) structure.push(entry('move', <DriveFileMoveOutlined />, 'Move to…', () => setMoving({ node, open: true })));
    }

    const danger = canDelete ? [entry('delete', <DeleteOutlineOutlined />, 'Delete', () => void remove(node), { destructive: true })] : [];

    return [primary, lifecycle, structure, danger].filter((group) => group.length > 0).flatMap((group, at) => (at === 0 ? group : [<Divider key={`divider-${at}`} sx={{ my: 1 }} />, ...group]));
  };

  const newPageButton = canCreate && (
    <Button variant="contained" startIcon={<AddOutlined />} onClick={() => openCreate(null)}>
      New page
    </Button>
  );
  const isEmpty = tree.isSuccess && ordered.length === 0;
  const multiLocale = locales.length > 1;

  return (
    <Page>
      <PageHeader title="Pages" description="Build pages from blocks and arrange them in the tree that shapes your site’s URLs." actions={newPageButton} />

      {(!isEmpty || multiLocale) && (
        <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 2, mb: 3, alignItems: 'center' }}>
          {!isEmpty && (
            <>
              <SearchInput value={search} onChange={setSearch} placeholder="Search by title or URL…" />
              <TextField select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} sx={{ flex: { xs: 1, sm: 'none' }, width: { sm: 160 }, minWidth: 140 }} slotProps={{ htmlInput: { 'aria-label': 'Filter by status' } }}>
                {STATUS_FILTERS.map((f) => (
                  <MenuItem key={f.value} value={f.value}>
                    {f.label}
                  </MenuItem>
                ))}
              </TextField>
            </>
          )}
          {multiLocale && (
            <TextField select value={locale} onChange={(e) => setLocale(e.target.value)} sx={{ flex: { xs: 1, sm: 'none' }, width: { sm: 170 }, minWidth: 140 }} slotProps={{ htmlInput: { 'aria-label': 'Locale' } }}>
              {locales.map((l) => (
                <MenuItem key={l.code} value={l.code}>
                  {l.name} ({l.code})
                </MenuItem>
              ))}
            </TextField>
          )}
          <Box sx={{ flex: 1, display: { xs: 'none', sm: 'block' } }} />
          {tree.isSuccess && !isEmpty && (
            <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }} role="status">
              {filtering ? `${rows.length} of ${ordered.length} pages` : `${ordered.length} ${ordered.length === 1 ? 'page' : 'pages'}`}
            </Typography>
          )}
          {!filtering && parents.length > 0 && (
            <Button
              size="small"
              color="inherit"
              startIcon={anyCollapsed ? <UnfoldMoreOutlined /> : <UnfoldLessOutlined />}
              onClick={() => setCollapsed(anyCollapsed ? new Set() : new Set(parents.map((node) => node.id)))}
              sx={{ color: 'text.secondary' }}
            >
              {anyCollapsed ? 'Expand all' : 'Collapse all'}
            </Button>
          )}
        </Stack>
      )}

      <Paper sx={{ borderRadius: '10px', overflow: 'hidden' }}>
        {tree.isPending ? (
          <TableSkeleton rows={6} columns={5} />
        ) : tree.isError ? (
          <ErrorState error={tree.error} onRetry={() => void tree.refetch()} />
        ) : isEmpty ? (
          <EmptyState
            icon={<AccountTreeOutlined />}
            title={locale === ws.defaultLocale ? 'Create your first page' : `No pages in ${locales.find((l) => l.code === locale)?.name ?? locale} yet`}
            description={
              canCreate
                ? 'Start with the home page, then add the pages underneath it. Each one is built from blocks, and its place in the tree becomes its URL.'
                : 'Pages appear here once someone creates them. Your role can view pages but cannot create them.'
            }
            action={newPageButton}
          />
        ) : rows.length === 0 ? (
          <EmptyState
            compact
            icon={<SearchOffOutlined />}
            title="No pages match"
            description="Try a different search term or another status."
            action={
              <Button variant="outlined" onClick={clearFilters}>
                Clear search and filters
              </Button>
            }
          />
        ) : (
          <TableContainer>
            <Table aria-label="Pages">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ minWidth: 200 }}>Page</TableCell>
                  <TableCell sx={fromMd}>URL path</TableCell>
                  <TableCell sx={fromMd}>Template</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell align="right" sx={fromMd}>
                    Blocks
                  </TableCell>
                  <TableCell sx={fromMd}>Updated</TableCell>
                  <TableCell align="right" sx={{ width: 48 }}>
                    <Box component="span" sx={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
                      Actions
                    </Box>
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map(({ node, expandable, expanded }) => {
                  const name = pageTitle(node);
                  const depth = filtering ? 0 : node.depth;
                  return (
                    <TableRow key={node.id} hover sx={{ opacity: busy === node.id ? 0.5 : 1 }} aria-busy={busy === node.id || undefined}>
                      <TableCell sx={{ maxWidth: { xs: 240, md: 420 } }}>
                        <Stack direction="row" sx={{ alignItems: 'center', minWidth: 0, pl: { xs: Math.min(depth, 6) * 3, md: Math.min(depth, 8) * 5 } }}>
                          {expandable ? (
                            <IconButton aria-label={`${expanded ? 'Collapse' : 'Expand'} ${name}`} aria-expanded={expanded} onClick={() => toggle(node.id)} sx={{ width: 24, height: 24, mr: 1, flexShrink: 0 }}>
                              <ChevronRightOutlined sx={{ fontSize: 18, transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 120ms', '@media (prefers-reduced-motion: reduce)': { transition: 'none' } }} />
                            </IconButton>
                          ) : (
                            !filtering && <Box sx={{ width: 24, mr: 1, flexShrink: 0 }} aria-hidden />
                          )}
                          <Box sx={{ minWidth: 0 }}>
                            <Typography
                              component={RouterLink}
                              to={editorHref(node.id)}
                              variant="body2"
                              noWrap
                              sx={{ display: 'block', fontWeight: 500, color: node.title ? 'text.primary' : 'text.secondary', fontStyle: node.title ? 'normal' : 'italic', '&:hover': { color: 'secondary.main', textDecoration: 'none' } }}
                            >
                              {name}
                            </Typography>
                            <Mono sx={{ ...ellipsis, display: { xs: 'block', md: 'none' }, color: 'text.secondary' }}>{node.path ?? '—'}</Mono>
                          </Box>
                        </Stack>
                      </TableCell>
                      <TableCell sx={{ ...fromMd, maxWidth: 280 }}>
                        <Mono sx={{ ...ellipsis, display: 'block', color: 'text.secondary' }}>{node.path ?? '—'}</Mono>
                      </TableCell>
                      <TableCell sx={{ ...fromMd, whiteSpace: 'nowrap', color: 'text.secondary' }}>
                        {templateLabel(node.template)}
                        {node.category && (
                          <Box component="span" sx={{ color: 'text.disabled' }}>
                            {' · '}
                            {node.category}
                          </Box>
                        )}
                      </TableCell>
                      <TableCell>
                        <StatusChip status={node.status} isPublished={node.isPublished} hasChanges={node.hasChanges} />
                      </TableCell>
                      <TableCell align="right" sx={{ ...fromMd, color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>
                        {node.blockCount}
                      </TableCell>
                      <TableCell sx={{ ...fromMd, whiteSpace: 'nowrap', color: 'text.secondary' }}>
                        <RelativeTime value={node.updatedAt} />
                        {node.updatedBy ? ` by ${node.updatedBy}` : ''}
                      </TableCell>
                      <TableCell align="right" padding="none" sx={{ pr: 2 }}>
                        <IconButton aria-label={`Actions for ${name}`} aria-haspopup="menu" onClick={(e) => setMenu({ anchor: e.currentTarget, node, open: true })}>
                          <MoreHorizOutlined />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Paper>

      <Menu anchorEl={menu?.anchor} open={!!menu?.open} onClose={closeMenu} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}>
        {menu && menuItems(menu.node)}
      </Menu>

      {creating && (
        <NewPageDialog open={creating.open} parentId={creating.parentId} pages={ordered} locale={locale} onClose={() => setCreating((current) => current && { ...current, open: false })} onExited={() => setCreating(null)} />
      )}

      {moving && (
        <MovePageDialog key={moving.node.id} open={moving.open} page={moving.node} pages={ordered} onClose={() => setMoving((current) => current && { ...current, open: false })} onExited={() => setMoving(null)} />
      )}
    </Page>
  );
}
