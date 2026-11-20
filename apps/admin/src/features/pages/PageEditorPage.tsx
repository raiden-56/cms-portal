import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DndContext, type DragStartEvent, DragOverlay, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { useQueryClient } from '@tanstack/react-query';
import { Link as RouterLink, useBlocker, useParams } from 'react-router-dom';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Drawer from '@mui/material/Drawer';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import WebOutlined from '@mui/icons-material/WebOutlined';
import { type BlockDefinition, type FieldDef, type PageData, type WorkflowAction, createBlockNode, findBlock } from '@meridian/shared';
import { useCrumbs } from '@/app/shell';
import { useProject, useSchema } from '@/app/workspace';
import { useConfirm } from '@/components/feedback';
import { IconFor } from '@/components/icons';
import { EmptyState, ErrorState } from '@/components/ui';
import { componentIndex } from '@/features/fields/FieldForm';
import { useAssets } from '@/features/fields/MediaField';
import { ApiError, api, errorMessage } from '@/lib/api';
import type { EntryDetail, EntryVersion, MediaAsset, SchemaResponse } from '@/lib/types';
import { store, toast, useAppDispatch, useAppSelector } from '@/store';
import { Canvas } from './editor/Canvas';
import { type EditorLive, EditorLiveContext, type EditorStatic, EditorStaticContext } from './editor/context';
import { CommentDialog, ConflictDialog, type ConflictInfo, DeliveryDialog, LeaveDialog, ScheduleDialog, VersionsDrawer } from './editor/dialogs';
import { type DragSource, type DropTarget, type IssueMap, NO_ISSUES, collectPageMedia, computeDropTarget, flattenBlocks, isEditableTarget, mapIssues, sameTarget, siblingsOf } from './editor/dnd';
import { type Device, pageEditorActions, selectIsDirty } from './editor/editorSlice';
import { Inspector, type InspectorTab } from './editor/Inspector';
import { Outline } from './editor/Outline';
import { Palette } from './editor/Palette';
import { type SaveState, Toolbar } from './editor/Toolbar';
import { PAGES_TYPE, joinPagePath, useInvalidatePages, usePageEntry } from './hooks';

const NO_ASSETS = new Map<string, MediaAsset>();
const LEFT_WIDTH = 272;
const RIGHT_WIDTH = 320;

/** The stored page, with every optional part made explicit so the editor never has to guess. */
function toPageData(data: Record<string, unknown> | null | undefined): PageData {
  const d = (data ?? {}) as Partial<PageData>;
  return {
    title: typeof d.title === 'string' ? d.title : '',
    slug: typeof d.slug === 'string' ? d.slug : '',
    ...(d.description ? { description: d.description } : {}),
    template: d.template || 'default',
    ...(d.category ? { category: d.category } : {}),
    seo: d.seo && typeof d.seo === 'object' ? d.seo : {},
    blocks: Array.isArray(d.blocks) ? d.blocks : [],
  };
}

function EditorSkeleton() {
  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }} aria-busy="true" aria-label="Loading page editor">
      <Box sx={{ height: 48, borderBottom: 1, borderColor: 'border.subtle', bgcolor: 'background.paper', display: 'flex', alignItems: 'center', px: 4, gap: 3 }}>
        <Skeleton variant="rounded" width={28} height={28} />
        <Skeleton variant="rounded" width={220} height={18} />
        <Box sx={{ flex: 1 }} />
        <Skeleton variant="rounded" width={160} height={28} />
      </Box>
      <Box sx={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <Box sx={{ width: LEFT_WIDTH, borderRight: 1, borderColor: 'border.subtle', bgcolor: 'background.paper', p: 3, display: { xs: 'none', lg: 'block' } }}>
          <Skeleton variant="rounded" height={32} sx={{ mb: 3 }} />
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} variant="rounded" height={68} />
            ))}
          </Box>
        </Box>
        <Box sx={{ flex: 1, bgcolor: 'surface.sunken', p: 6 }}>
          <Skeleton variant="rounded" height="100%" sx={{ maxWidth: 1000, mx: 'auto' }} />
        </Box>
        <Box sx={{ width: RIGHT_WIDTH, borderLeft: 1, borderColor: 'border.subtle', bgcolor: 'background.paper', display: { xs: 'none', lg: 'block' } }} />
      </Box>
    </Box>
  );
}

function Editor({ entry, schema }: { entry: EntryDetail; schema: SchemaResponse }) {
  const ws = useProject();
  const dispatch = useAppDispatch();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const invalidate = useInvalidatePages();
  const entryId = entry.id;
  const envId = ws.environment.id;
  const entryKey = useMemo(() => ['entry', envId, entryId], [envId, entryId]);

  const editor = useAppSelector((s) => s.pageEditor);
  const dirty = useAppSelector(selectIsDirty);
  const ready = editor.entryId === entryId && !!editor.page;
  const page = editor.page;

  const can = useMemo(() => ({ update: ws.can('content.update'), publish: ws.can('content.publish'), review: ws.can('content.review') }), [ws]);
  const readOnly = !can.update || entry.status === 'ARCHIVED' || !!entry.deletedAt;
  const readOnlyReason = entry.deletedAt ? 'This page is in the trash.' : entry.status === 'ARCHIVED' ? 'Archived pages are read-only. Restore the page from the archive to edit it.' : 'Your role can view pages but not edit them.';

  // ── Catalogue ────────────────────────────────────────────────────────────
  const registry = useMemo<Record<string, BlockDefinition>>(() => Object.fromEntries(schema.blocks.map((b) => [b.type, b])), [schema.blocks]);
  const components = useMemo(() => componentIndex(schema), [schema]);
  const componentFields = useMemo<Record<string, FieldDef[]>>(() => ({ ...schema.builtinComponents, ...Object.fromEntries(schema.components.map((c) => [c.apiId, c.fields])) }), [schema]);
  const typeIds = useMemo(() => new Set(schema.types.map((t) => t.apiId)), [schema.types]);

  // ── Load / unload ────────────────────────────────────────────────────────
  useEffect(() => {
    dispatch(pageEditorActions.loaded({ entryId, page: toPageData(entry.data), lockVersion: entry.lockVersion }));
    return () => {
      dispatch(pageEditorActions.closed());
    };
    // The working copy is initialised once per page; later server responses are applied explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryId, dispatch]);

  // ── UI state ─────────────────────────────────────────────────────────────
  const wide = useMediaQuery('(min-width:1100px)');
  const [leftOpen, setLeftOpen] = useState(wide);
  const [rightOpen, setRightOpen] = useState(wide);
  const [leftTab, setLeftTab] = useState<'blocks' | 'outline'>('blocks');
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('page');
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [issues, setIssues] = useState<IssueMap>(NO_ISSUES);
  const [conflict, setConflict] = useState<ConflictInfo | null>(null);
  const [resolving, setResolving] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [deliveryOpen, setDeliveryOpen] = useState(false);
  const [commentFor, setCommentFor] = useState<'request_changes' | 'approve' | null>(null);
  const [leaving, setLeaving] = useState(false);
  const failedPage = useRef<PageData | null>(null);
  const savingRef = useRef(false);

  useEffect(() => {
    setLeftOpen(wide);
    setRightOpen(wide);
  }, [wide]);

  useCrumbs([{ label: page?.title || entry.title || 'Untitled page' }]);

  // ── Derived page facts ───────────────────────────────────────────────────
  const parentPath = useMemo(() => {
    if (!entry.parentId) return null;
    const saved = entry.path ?? '/';
    const slug = entry.slug ?? '';
    const base = slug && saved.endsWith(`/${slug}`) ? saved.slice(0, -(slug.length + 1)) : saved;
    return base || '/';
  }, [entry.parentId, entry.path, entry.slug]);
  const pagePath = joinPagePath(parentPath, page?.slug ?? '');

  const mediaIds = useMemo(() => (page ? collectPageMedia(page, registry, componentFields) : []), [page, registry, componentFields]);
  const assets = useAssets(mediaIds).data ?? NO_ASSETS;

  // ── Server sync ──────────────────────────────────────────────────────────
  /** Adopts a server response: always the new lock version, and the content too when it replaced ours. */
  const applyDetail = useCallback(
    (detail: EntryDetail, replace = false) => {
      queryClient.setQueryData(entryKey, detail);
      if (replace) dispatch(pageEditorActions.loaded({ entryId, page: toPageData(detail.data), lockVersion: detail.lockVersion }));
      else dispatch(pageEditorActions.saved({ snapshot: store.getState().pageEditor.savedSnapshot, lockVersion: detail.lockVersion }));
      invalidate();
    },
    [queryClient, entryKey, dispatch, entryId, invalidate],
  );

  const save = useCallback(
    async (opts: { autosave?: boolean; overwrite?: boolean } = {}): Promise<EntryDetail | null> => {
      const state = store.getState().pageEditor;
      const current = queryClient.getQueryData<EntryDetail>(entryKey) ?? entry;
      if (!state.page || state.entryId !== entryId) return null;
      const sent = state.page;
      const snapshot = JSON.stringify(sent);
      if (snapshot === state.savedSnapshot && !opts.overwrite) return current;
      if (savingRef.current) return null;
      savingRef.current = true;
      setSaving(true);
      setSaveState('saving');
      try {
        const detail = await api.put<EntryDetail>(`${ws.envBase}/entry/${entryId}`, {
          data: sent,
          autosave: !!opts.autosave,
          ...(opts.overwrite ? {} : { lockVersion: state.lockVersion }),
        });
        queryClient.setQueryData(entryKey, detail);
        const after = store.getState().pageEditor;
        const stored = toPageData(detail.data);
        // If nothing was typed during the request, adopt the server's normalised copy; otherwise keep typing uninterrupted.
        if (after.page === sent && JSON.stringify(stored) !== snapshot) dispatch(pageEditorActions.loaded({ entryId, page: stored, lockVersion: detail.lockVersion }));
        else dispatch(pageEditorActions.saved({ snapshot, lockVersion: detail.lockVersion }));
        failedPage.current = null;
        setSaveState('saved');
        setIssues((prev) => (Object.keys(prev.page).length ? { ...prev, page: {}, list: prev.list.filter((i) => i.blockId !== null) } : prev));
        if (!opts.autosave) invalidate();
        return detail;
      } catch (err) {
        failedPage.current = sent;
        setSaveState('error');
        if (err instanceof ApiError && err.status === 409 && err.details && !Array.isArray(err.details) && 'currentLockVersion' in err.details) {
          setConflict({ updatedBy: (err.details.updatedBy as string | null) ?? null, updatedAt: (err.details.updatedAt as string | null) ?? null });
        } else if (err instanceof ApiError && err.status === 422) {
          const mapped = mapIssues(err.details, sent, registry);
          setIssues(mapped);
          if (Object.keys(mapped.page).length) {
            dispatch(pageEditorActions.selected(null));
            setInspectorTab('page');
            setRightOpen(true);
          }
          if (!opts.autosave) toast.error(mapped.list[0]?.message ?? err.message);
        } else if (!opts.autosave) {
          toast.error(errorMessage(err, 'The page could not be saved.'));
        }
        return null;
      } finally {
        savingRef.current = false;
        setSaving(false);
      }
    },
    [queryClient, entryKey, entry, entryId, ws.envBase, dispatch, invalidate, registry],
  );

  // Autosave a few seconds after the last change. A failed copy is not retried until it changes again.
  useEffect(() => {
    if (!ready || !dirty || readOnly || conflict || saving || page === failedPage.current) return;
    const timer = setTimeout(() => void save({ autosave: true }), 3000);
    return () => clearTimeout(timer);
  }, [ready, dirty, readOnly, conflict, saving, page, save]);

  // Page-level errors (title, URL) clear as soon as the field they refer to is edited.
  useEffect(() => {
    setIssues((prev) => (prev.page.title || prev.page.slug ? { ...prev, page: {}, list: prev.list.filter((i) => i.blockId !== null) } : prev));
  }, [page?.title, page?.slug]);

  // ── Leaving ──────────────────────────────────────────────────────────────
  const blocker = useBlocker(({ currentLocation, nextLocation }) => !readOnly && selectIsDirty(store.getState()) && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (!dirty || readOnly) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, readOnly]);

  // ── Commands ─────────────────────────────────────────────────────────────
  const select = useCallback((id: string | null) => dispatch(pageEditorActions.selected(id)), [dispatch]);
  const moveBy = useCallback(
    (id: string, delta: -1 | 1) => {
      const place = siblingsOf(store.getState().pageEditor.page?.blocks ?? [], id);
      if (!place) return;
      const next = place.index + delta;
      if (next < 0 || next >= place.siblings.length) return;
      // Indexes address the gaps of the current list, so moving down one step targets the gap after the next sibling.
      dispatch(pageEditorActions.blockMoved({ id, parentId: place.parentId, index: delta < 0 ? next : next + 1 }));
    },
    [dispatch],
  );

  const staticCtx = useMemo<EditorStatic>(
    () => ({
      registry,
      components,
      componentFields,
      typeIds,
      envBase: ws.envBase,
      envId,
      readOnly,
      select,
      remove: (id) => dispatch(pageEditorActions.blockRemoved(id)),
      duplicate: (id) => dispatch(pageEditorActions.blockDuplicated(id)),
      moveBy,
    }),
    [registry, components, componentFields, typeIds, ws.envBase, envId, readOnly, select, dispatch, moveBy],
  );

  const addBlock = useCallback(
    (def: BlockDefinition) => {
      const state = store.getState().pageEditor;
      const blocks = state.page?.blocks ?? [];
      const selected = state.selectedId ? findBlock(blocks, state.selectedId) : null;
      const block = createBlockNode(def);
      if (selected && registry[selected.type]?.acceptsChildren && (selected.children ?? []).length === 0) {
        // An empty container that is selected is clearly where the new block is meant to go.
        dispatch(pageEditorActions.blockInserted({ block, parentId: selected.id, index: 0 }));
      } else if (selected) {
        const place = siblingsOf(blocks, selected.id);
        dispatch(pageEditorActions.blockInserted({ block, parentId: place?.parentId ?? null, index: (place?.index ?? blocks.length - 1) + 1 }));
      } else {
        dispatch(pageEditorActions.blockInserted({ block, parentId: null, index: blocks.length }));
      }
      setInspectorTab('content');
      if (!wide) setLeftOpen(false);
    },
    [dispatch, registry, wide],
  );

  // ── Drag and drop ────────────────────────────────────────────────────────
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const [drag, setDrag] = useState<DragSource | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const dragRef = useRef<DragSource | null>(null);
  const dropRef = useRef<DropTarget | null>(null);

  useEffect(() => {
    if (!drag) return;
    let frame = 0;
    let point: { x: number; y: number } | null = null;
    const update = () => {
      frame = 0;
      if (!point) return;
      const target = computeDropTarget(point.x, point.y, store.getState().pageEditor.page?.blocks ?? [], registry, drag);
      if (!sameTarget(target, dropRef.current)) {
        dropRef.current = target;
        setDropTarget(target);
      }
    };
    const onMove = (e: PointerEvent) => {
      point = { x: e.clientX, y: e.clientY };
      if (!frame) frame = requestAnimationFrame(update);
    };
    window.addEventListener('pointermove', onMove);
    document.body.style.cursor = 'grabbing';
    return () => {
      window.removeEventListener('pointermove', onMove);
      cancelAnimationFrame(frame);
      document.body.style.cursor = '';
    };
  }, [drag, registry]);

  const endDrag = (commit: boolean) => {
    const source = dragRef.current;
    const target = dropRef.current;
    dragRef.current = null;
    dropRef.current = null;
    setDrag(null);
    setDropTarget(null);
    if (!commit || !source || !target) return;
    if (source.kind === 'palette') {
      const def = registry[source.type];
      if (def) dispatch(pageEditorActions.blockInserted({ block: createBlockNode(def), parentId: target.parentId, index: target.index }));
    } else {
      dispatch(pageEditorActions.blockMoved({ id: source.id, parentId: target.parentId, index: target.index }));
      select(source.id);
    }
  };
  const onDragStart = (event: DragStartEvent) => {
    const source = event.active.data.current as DragSource | undefined;
    if (!source) return;
    dragRef.current = source;
    setDrag(source);
    if (!wide && source.kind === 'palette') setLeftOpen(false);
  };

  // ── Actions ──────────────────────────────────────────────────────────────
  const reportIssues = (err: ApiError, forPage: PageData) => {
    const mapped = mapIssues(err.details, forPage, registry);
    setIssues(mapped);
    const first = mapped.list.find((i) => i.blockId);
    if (first?.blockId) {
      select(first.blockId);
      setInspectorTab('content');
    } else if (Object.keys(mapped.page).length) {
      select(null);
      setInspectorTab('page');
    }
    setRightOpen(true);
    return mapped;
  };

  const publish = async () => {
    setPublishing(true);
    try {
      if (selectIsDirty(store.getState()) && !(await save())) return;
      const detail = await api.post<EntryDetail>(`${ws.envBase}/entry/${entryId}/publish`, {});
      applyDetail(detail);
      setIssues(NO_ISSUES);
      toast.success(`“${detail.title ?? 'Page'}” is live at ${detail.path ?? '/'}`);
    } catch (err) {
      const current = store.getState().pageEditor.page;
      if (err instanceof ApiError && err.status === 422 && current) {
        const mapped = reportIssues(err, current);
        toast.error(mapped.list.length === 1 ? 'One problem needs fixing before this page can be published.' : `${mapped.list.length} problems need fixing before this page can be published.`);
      } else {
        toast.error(errorMessage(err, 'The page could not be published.'));
      }
    } finally {
      setPublishing(false);
    }
  };

  const transition = async (action: WorkflowAction, comment?: string) => {
    try {
      if (action === 'submit' && selectIsDirty(store.getState()) && !(await save())) return;
      const detail = await api.post<EntryDetail>(`${ws.envBase}/entry/${entryId}/transition`, { action, ...(comment ? { comment } : {}) });
      applyDetail(detail);
      const messages: Partial<Record<WorkflowAction, string>> = {
        submit: 'Submitted for review',
        withdraw: 'Withdrawn from review',
        approve: 'Page approved',
        request_changes: 'Changes requested',
        archive: 'Page archived',
        unarchive: 'Page restored from the archive',
      };
      toast.success(messages[action] ?? 'Done');
    } catch (err) {
      const current = store.getState().pageEditor.page;
      if (err instanceof ApiError && err.status === 422 && current) {
        reportIssues(err, current);
        toast.error(err.message);
      } else if (comment !== undefined) {
        throw err;
      } else {
        toast.error(errorMessage(err));
      }
    }
  };

  const onTransition = (action: WorkflowAction) => {
    if (action === 'request_changes' || action === 'approve') return setCommentFor(action);
    if (action === 'archive') {
      void confirm({
        title: 'Archive this page?',
        message: entry.isPublished ? 'It will be taken offline immediately and become read-only. You can restore it later.' : 'It becomes read-only and leaves the editorial workflow. You can restore it later.',
        confirmLabel: 'Archive',
        destructive: entry.isPublished,
        onConfirm: () => transition('archive'),
      });
      return;
    }
    void transition(action);
  };

  const unpublish = () =>
    void confirm({
      title: 'Unpublish this page?',
      message: `“${entry.title ?? 'This page'}” will stop being served at ${entry.path ?? '/'} right away. Your draft is kept.`,
      confirmLabel: 'Unpublish',
      destructive: true,
      onConfirm: async () => {
        const detail = await api.post<EntryDetail>(`${ws.envBase}/entry/${entryId}/unpublish`, {});
        applyDetail(detail);
        toast.success('Page unpublished');
      },
    });

  const schedule = async (input: { publishAt: string | null; unpublishAt: string | null }) => {
    if (selectIsDirty(store.getState()) && !(await save())) throw new Error('Save the page before scheduling it.');
    try {
      const detail = await api.post<EntryDetail>(`${ws.envBase}/entry/${entryId}/schedule`, input);
      applyDetail(detail);
      toast.success(input.publishAt || input.unpublishAt ? 'Schedule saved' : 'Schedule cleared');
    } catch (err) {
      const current = store.getState().pageEditor.page;
      if (err instanceof ApiError && err.status === 422 && current) reportIssues(err, current);
      throw err;
    }
  };

  const restoreVersion = async (version: EntryVersion) => {
    const ok = await confirm({
      title: `Restore version ${version.number}?`,
      message: selectIsDirty(store.getState())
        ? 'This replaces the page’s current draft, including changes you have not saved. The live version is not affected until you publish.'
        : 'This replaces the page’s current draft with that version’s content. The live version is not affected until you publish.',
      confirmLabel: 'Restore',
      onConfirm: async () => {
        const detail = await api.post<EntryDetail>(`${ws.envBase}/entry/${entryId}/versions/${version.id}/restore`, {});
        applyDetail(detail, true);
        void queryClient.invalidateQueries({ queryKey: ['entry-versions', envId, entryId] });
      },
    });
    if (ok) {
      setIssues(NO_ISSUES);
      setVersionsOpen(false);
      toast.success(`Version ${version.number} restored as a draft`);
    }
  };

  const previewToken = async () => {
    if (!readOnly && selectIsDirty(store.getState()) && !(await save())) return null;
    return api.post<{ token: string; apiUrl: string; previewUrl: string | null; expiresIn: number }>(`${ws.envBase}/entry/${entryId}/preview-token`, {});
  };
  const previewDraft = () => {
    // Opened synchronously so the browser treats it as a user-initiated tab, then pointed at the preview.
    const tab = window.open('', '_blank');
    void previewToken()
      .then((result) => {
        if (!result) return tab?.close();
        if (tab) {
          tab.opener = null;
          tab.location.href = result.previewUrl ?? result.apiUrl;
        }
        if (!result.previewUrl) toast.info('No preview URL is set for this project, so the draft opened as API data. Add one under Settings.');
      })
      .catch((err) => {
        tab?.close();
        toast.error(errorMessage(err, 'The preview could not be created.'));
      });
  };
  const copyPreviewLink = () =>
    void previewToken()
      .then(async (result) => {
        if (!result) return;
        await navigator.clipboard.writeText(result.previewUrl ?? result.apiUrl);
        toast.success('Preview link copied. It works for one hour.');
      })
      .catch((err) => toast.error(errorMessage(err, 'The preview link could not be created.')));

  const reloadTheirs = async () => {
    setResolving(true);
    try {
      const detail = await api.get<EntryDetail>(`${ws.envBase}/entry/${entryId}`);
      applyDetail(detail, true);
      failedPage.current = null;
      setConflict(null);
      setSaveState('saved');
      toast.info('Loaded the latest version of this page');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setResolving(false);
    }
  };
  const overwriteTheirs = async () => {
    setResolving(true);
    const detail = await save({ overwrite: true });
    setResolving(false);
    if (detail) {
      setConflict(null);
      toast.success('Your version was saved');
    }
  };

  // ── Keyboard ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if (meta && key === 's') {
        e.preventDefault();
        if (!readOnly) void save();
        return;
      }
      if (isEditableTarget(e.target) || readOnly) {
        if (e.key === 'Escape' && !isEditableTarget(e.target)) select(null);
        return;
      }
      const state = store.getState().pageEditor;
      const selectedId = state.selectedId;
      if (meta && key === 'z') {
        e.preventDefault();
        dispatch(e.shiftKey ? pageEditorActions.redone() : pageEditorActions.undone());
      } else if (meta && key === 'y') {
        e.preventDefault();
        dispatch(pageEditorActions.redone());
      } else if (meta && key === 'd' && selectedId) {
        e.preventDefault();
        dispatch(pageEditorActions.blockDuplicated(selectedId));
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        e.preventDefault();
        dispatch(pageEditorActions.blockRemoved(selectedId));
      } else if (e.key === 'Escape') {
        select(null);
      } else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && e.altKey && selectedId) {
        e.preventDefault();
        moveBy(selectedId, e.key === 'ArrowUp' ? -1 : 1);
      } else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !meta) {
        const flat = flattenBlocks(state.page?.blocks ?? []);
        if (flat.length === 0) return;
        e.preventDefault();
        const index = selectedId ? flat.findIndex((b) => b.id === selectedId) : -1;
        const next = e.key === 'ArrowDown' ? Math.min(flat.length - 1, index + 1) : Math.max(0, index === -1 ? 0 : index - 1);
        select(flat[next].id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dispatch, readOnly, save, select, moveBy]);

  const issueIds = useMemo(() => new Set(Object.keys(issues.blocks)), [issues.blocks]);
  const liveCtx = useMemo<EditorLive>(
    () => ({
      selectedId: editor.selectedId,
      dropTarget,
      draggingId: drag?.kind === 'block' ? drag.id : null,
      dragging: !!drag,
      device: editor.device,
      assets,
      pagePath,
      pageTitle: page?.title ?? '',
      issueIds,
    }),
    [editor.selectedId, dropTarget, drag, editor.device, assets, pagePath, page?.title, issueIds],
  );

  if (!ready || !page) return <EditorSkeleton />;

  const dragLabel = drag ? (drag.kind === 'palette' ? registry[drag.type] : registry[findBlock(page.blocks, drag.id)?.type ?? '']) : undefined;

  const leftPanel = (
    <Box sx={{ width: LEFT_WIDTH, height: '100%', display: 'flex', flexDirection: 'column', bgcolor: 'background.paper', minHeight: 0 }}>
      <Tabs value={leftTab} onChange={(_, next: 'blocks' | 'outline') => setLeftTab(next)} variant="fullWidth" sx={{ flexShrink: 0 }}>
        <Tab value="blocks" label="Blocks" />
        <Tab value="outline" label={`Outline · ${flattenBlocks(page.blocks).length}`} />
      </Tabs>
      <Box sx={{ flex: 1, minHeight: 0 }}>{leftTab === 'blocks' ? <Palette onAdd={addBlock} /> : <Outline blocks={page.blocks} />}</Box>
    </Box>
  );

  const rightPanel = (
    <Box sx={{ width: { xs: 'min(100vw, 340px)', lg: RIGHT_WIDTH }, height: '100%', bgcolor: 'background.paper', minHeight: 0 }}>
      <Inspector
        page={page}
        parentPath={parentPath}
        siteUrl={ws.project.settings.siteUrl}
        issues={issues}
        tab={inspectorTab}
        onTab={setInspectorTab}
        onFieldsEdited={(blockId, keys) =>
          setIssues((prev) => {
            const current = prev.blocks[blockId];
            if (!current) return prev;
            const remaining = Object.fromEntries(Object.entries(current).filter(([path]) => !keys.some((key) => path === key || path.startsWith(`${key}.`))));
            const blocks = { ...prev.blocks };
            if (Object.keys(remaining).length) blocks[blockId] = remaining;
            else delete blocks[blockId];
            return { ...prev, blocks, list: Object.keys(remaining).length ? prev.list : prev.list.filter((i) => i.blockId !== blockId) };
          })
        }
      />
    </Box>
  );

  return (
    <EditorStaticContext.Provider value={staticCtx}>
      <EditorLiveContext.Provider value={liveCtx}>
        <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={() => endDrag(true)} onDragCancel={() => endDrag(false)} autoScroll={{ threshold: { x: 0, y: 0.12 } }}>
          <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <Toolbar
              backHref={ws.href('pages')}
              title={page.title}
              titleInvalid={!page.title.trim() || !!issues.page.title}
              onTitle={(title) => dispatch(pageEditorActions.metaChanged({ title }))}
              entry={entry}
              dirty={dirty}
              saveState={saveState}
              readOnly={readOnly}
              readOnlyReason={readOnlyReason}
              can={can}
              canUndo={editor.past.length > 0}
              canRedo={editor.future.length > 0}
              onUndo={() => dispatch(pageEditorActions.undone())}
              onRedo={() => dispatch(pageEditorActions.redone())}
              device={editor.device}
              onDevice={(device: Device) => dispatch(pageEditorActions.deviceChanged(device))}
              leftOpen={leftOpen}
              rightOpen={rightOpen}
              onToggleLeft={() => setLeftOpen((o) => !o)}
              onToggleRight={() => setRightOpen((o) => !o)}
              issues={issues.list}
              onIssue={(issue) => {
                select(issue.blockId);
                setInspectorTab(issue.blockId ? 'content' : 'page');
                setRightOpen(true);
              }}
              saving={saving}
              publishing={publishing}
              onSave={() => void save()}
              onPublish={() => void publish()}
              onPreviewDraft={previewDraft}
              onCopyPreviewLink={copyPreviewLink}
              onDeliveryInfo={() => setDeliveryOpen(true)}
              onUnpublish={unpublish}
              onSchedule={() => setScheduleOpen(true)}
              onTransition={onTransition}
              onVersions={() => setVersionsOpen(true)}
              onPageSettings={() => {
                select(null);
                setInspectorTab('page');
                setRightOpen(true);
              }}
            />
            <Box sx={{ flex: 1, display: 'flex', minHeight: 0 }}>
              {wide ? (
                <Box component="aside" aria-label="Blocks and outline" sx={{ width: leftOpen ? LEFT_WIDTH : 0, flexShrink: 0, overflow: 'hidden', borderRight: leftOpen ? 1 : 0, borderColor: 'border.subtle', transition: 'width 180ms cubic-bezier(0.2, 0, 0, 1)' }}>
                  {leftPanel}
                </Box>
              ) : (
                <Drawer open={leftOpen} onClose={() => setLeftOpen(false)} keepMounted>
                  {leftPanel}
                </Drawer>
              )}
              <Canvas blocks={page.blocks} />
              {wide ? (
                <Box component="aside" aria-label="Inspector" sx={{ width: rightOpen ? RIGHT_WIDTH : 0, flexShrink: 0, overflow: 'hidden', borderLeft: rightOpen ? 1 : 0, borderColor: 'border.subtle', transition: 'width 180ms cubic-bezier(0.2, 0, 0, 1)' }}>
                  {rightPanel}
                </Box>
              ) : (
                <Drawer anchor="right" open={rightOpen} onClose={() => setRightOpen(false)}>
                  {rightPanel}
                </Drawer>
              )}
            </Box>
          </Box>
          <DragOverlay dropAnimation={null}>
            {drag && (
              <Stack direction="row" spacing={2} sx={{ alignItems: 'center', display: 'inline-flex', height: 34, px: 3, borderRadius: '8px', bgcolor: 'background.paper', border: 1, borderColor: 'secondary.main', boxShadow: '0 10px 30px rgba(17,17,16,0.18)', pointerEvents: 'none', whiteSpace: 'nowrap' }}>
                <IconFor name={dragLabel?.icon ?? 'component'} sx={{ fontSize: 16, color: 'secondary.main' }} />
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {dragLabel?.label ?? 'Block'}
                </Typography>
              </Stack>
            )}
          </DragOverlay>
        </DndContext>

        <ScheduleDialog open={scheduleOpen} onClose={() => setScheduleOpen(false)} entry={entry} onSchedule={schedule} />
        <VersionsDrawer open={versionsOpen} onClose={() => setVersionsOpen(false)} entryId={entryId} canRestore={!readOnly} onRestore={(version) => void restoreVersion(version)} />
        <DeliveryDialog open={deliveryOpen} onClose={() => setDeliveryOpen(false)} path={entry.path ?? pagePath} isPublished={entry.isPublished} hasChanges={entry.hasChanges || dirty} />
        <CommentDialog
          open={commentFor !== null}
          onClose={() => setCommentFor(null)}
          title={commentFor === 'approve' ? 'Approve this page' : 'Request changes'}
          description={commentFor === 'approve' ? 'Approval covers the page exactly as it is now. Any later edit sends it back to draft.' : 'The page goes back to its author with your note.'}
          confirmLabel={commentFor === 'approve' ? 'Approve' : 'Request changes'}
          required={commentFor === 'request_changes'}
          onSubmit={(comment) => transition(commentFor ?? 'approve', comment)}
        />
        <ConflictDialog conflict={conflict} busy={resolving} onClose={() => setConflict(null)} onReload={() => void reloadTheirs()} onOverwrite={() => void overwriteTheirs()} />
        <LeaveDialog
          open={blocker.state === 'blocked'}
          busy={leaving}
          onStay={() => blocker.reset?.()}
          onDiscard={() => blocker.proceed?.()}
          onSave={() => {
            setLeaving(true);
            void save().then((detail) => {
              setLeaving(false);
              if (detail) blocker.proceed?.();
              else blocker.reset?.();
            });
          }}
        />
      </EditorLiveContext.Provider>
    </EditorStaticContext.Provider>
  );
}

export default function PageEditorPage() {
  const { entryId } = useParams();
  const ws = useProject();
  const schema = useSchema();
  const entry = usePageEntry(entryId);

  if (entry.isLoading || schema.isLoading) return <EditorSkeleton />;
  if (entry.isError || schema.isError || !entry.data || !schema.data) {
    return (
      <Box sx={{ height: '100%', display: 'grid', placeItems: 'center' }}>
        <Box>
          <ErrorState error={entry.error ?? schema.error ?? new Error('This page could not be loaded.')} onRetry={() => void Promise.all([entry.refetch(), schema.refetch()])} />
          <Box sx={{ textAlign: 'center', mt: -8 }}>
            <Button component={RouterLink} to={ws.href('pages')}>
              Back to pages
            </Button>
          </Box>
        </Box>
      </Box>
    );
  }
  if (entry.data.contentType !== PAGES_TYPE) {
    return (
      <Box sx={{ height: '100%', display: 'grid', placeItems: 'center' }}>
        <EmptyState
          icon={<WebOutlined />}
          title="This entry is not a page"
          description="It belongs to another content type and is edited in the content manager."
          action={
            <Button variant="contained" component={RouterLink} to={ws.href(`content/${entry.data.contentType}/${entry.data.id}`)}>
              Open in the content manager
            </Button>
          }
        />
      </Box>
    );
  }
  return <Editor key={entry.data.id} entry={entry.data} schema={schema.data} />;
}
