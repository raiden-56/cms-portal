import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Link as RouterLink, Navigate, useBlocker, useNavigate, useParams } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import Badge from '@mui/material/Badge';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
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
import Popover from '@mui/material/Popover';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import ArchiveOutlined from '@mui/icons-material/ArchiveOutlined';
import CheckCircleOutlined from '@mui/icons-material/CheckCircleOutlined';
import CloudDoneOutlined from '@mui/icons-material/CloudDoneOutlined';
import ContentCopyOutlined from '@mui/icons-material/ContentCopyOutlined';
import DeleteForeverOutlined from '@mui/icons-material/DeleteForeverOutlined';
import DeleteOutlineOutlined from '@mui/icons-material/DeleteOutlineOutlined';
import EditNoteOutlined from '@mui/icons-material/EditNoteOutlined';
import ErrorOutlineOutlined from '@mui/icons-material/ErrorOutlineOutlined';
import EventOutlined from '@mui/icons-material/EventOutlined';
import KeyboardOutlined from '@mui/icons-material/KeyboardOutlined';
import MoreHorizOutlined from '@mui/icons-material/MoreHorizOutlined';
import OpenInNewOutlined from '@mui/icons-material/OpenInNewOutlined';
import PublicOffOutlined from '@mui/icons-material/PublicOffOutlined';
import PublicOutlined from '@mui/icons-material/PublicOutlined';
import RestoreFromTrashOutlined from '@mui/icons-material/RestoreFromTrashOutlined';
import SearchOffOutlined from '@mui/icons-material/SearchOffOutlined';
import UnarchiveOutlined from '@mui/icons-material/UnarchiveOutlined';
import VisibilityOutlined from '@mui/icons-material/VisibilityOutlined';
import { type FieldDef, WORKFLOW_TRANSITIONS, type WorkflowAction, buildDefaults, canTransition, canonicalJson, isEmptyValue } from '@meridian/shared';
import { useCrumbs } from '@/app/shell';
import { useProject, useSchema } from '@/app/workspace';
import { useConfirm } from '@/components/feedback';
import { CodeBlock, EmptyState, ErrorState, Page, PageHeader, Pill, StatusChip } from '@/components/ui';
import { FieldForm, componentIndex, toFieldErrors } from '@/features/fields/FieldForm';
import { ApiError, api, errorMessage } from '@/lib/api';
import { fullDateTime } from '@/lib/format';
import type { ContentType, EntryDetail } from '@/lib/types';
import { toast } from '@/store';
import { ActivityPanel, CommentsPanel, InfoPanel, VersionsPanel } from './EntryPanels';
import { NoteDialog, ProblemAlert, ScheduleDialog } from './dialogs';
import { snapshotOf, toPayload, useContentType, useInvalidateContent, useMembers } from './hooks';
import { GuestNote } from '@/features/guest/guest';

export default function EntryEditorPage() {
  const { typeId, entryId } = useParams();
  const ws = useProject();
  const { schema, type } = useContentType(typeId);

  if (schema.isLoading) return <EditorSkeleton />;
  if (schema.isError) {
    return (
      <Page>
        <Paper sx={{ borderRadius: '10px' }}>
          <ErrorState error={schema.error} onRetry={() => void schema.refetch()} />
        </Paper>
      </Page>
    );
  }
  if (!type) {
    return (
      <Page>
        <Paper sx={{ borderRadius: '10px' }}>
          <EmptyState
            icon={<SearchOffOutlined />}
            title="Content type not found"
            description={`There is no content type “${typeId}” in the ${ws.environment.name} environment.`}
            action={
              <Button variant="contained" component={RouterLink} to={ws.href('content')}>
                All content
              </Button>
            }
          />
        </Paper>
      </Page>
    );
  }
  if (type.isSystem) return <Navigate to={ws.href(entryId ? `pages/${entryId}` : 'pages')} replace />;
  // Remounting per entry keeps form state, undo history and timers from leaking between entries.
  return entryId ? <ExistingEntry key={entryId} type={type} entryId={entryId} /> : <EditorForm key="new" type={type} entry={null} />;
}

function EditorSkeleton() {
  return (
    <Page width={1360}>
      <Skeleton variant="rounded" width={320} height={30} sx={{ mb: 6 }} />
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1fr) 340px' }, gap: 5 }} aria-busy="true">
        <Skeleton variant="rounded" height={520} sx={{ borderRadius: '10px' }} />
        <Skeleton variant="rounded" height={320} sx={{ borderRadius: '10px' }} />
      </Box>
    </Page>
  );
}

function ExistingEntry({ type, entryId }: { type: ContentType; entryId: string }) {
  const ws = useProject();
  const entry = useQuery({
    queryKey: ['entry', ws.environment.id, entryId],
    queryFn: () => api.get<EntryDetail>(`${ws.envBase}/entry/${entryId}`),
  });
  if (entry.isLoading) return <EditorSkeleton />;
  if (entry.isError || !entry.data) {
    const missing = entry.error instanceof ApiError && entry.error.status === 404;
    return (
      <Page>
        <Paper sx={{ borderRadius: '10px' }}>
          {missing ? (
            <EmptyState
              icon={<SearchOffOutlined />}
              title={`${type.singularName} not found`}
              description="It may have been deleted permanently, or it belongs to another environment."
              action={
                <Button variant="contained" component={RouterLink} to={ws.href(`content/${type.apiId}`)}>
                  Back to {type.pluralName.toLowerCase()}
                </Button>
              }
            />
          ) : (
            <ErrorState error={entry.error} onRetry={() => void entry.refetch()} />
          )}
        </Paper>
      </Page>
    );
  }
  // The id in the URL belongs to another content type: send the user to its real address.
  if (entry.data.contentType !== type.apiId) return <Navigate to={ws.href(`content/${entry.data.contentType}/${entry.data.id}`)} replace />;
  return <EditorForm type={type} entry={entry.data} />;
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error';
type RailTab = 'versions' | 'comments' | 'activity' | 'info';
type NoteMode = 'request_changes' | 'save' | 'publish' | 'approve';

/** Values the server filled in (generated slugs, sealed secrets) are folded into the form without touching what was typed. */
function mergeServer(fields: FieldDef[], local: Record<string, unknown>, server: Record<string, unknown>): Record<string, unknown> {
  const out = { ...local };
  for (const field of fields) {
    if (field.type === 'password') out[field.apiId] = server[field.apiId] ?? null;
    else if (isEmptyValue(local[field.apiId]) && !isEmptyValue(server[field.apiId])) out[field.apiId] = server[field.apiId];
  }
  return out;
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? '⌘' : 'Ctrl';

function Kbd({ children }: { children: ReactNode }) {
  return (
    <Box component="kbd" sx={{ fontSize: '0.6875rem', px: 1.25, py: 0.25, borderRadius: '4px', border: 1, borderColor: 'border.strong', bgcolor: 'surface.subtle', color: 'text.secondary', whiteSpace: 'nowrap' }}>
      {children}
    </Box>
  );
}

function EditorForm({ type, entry }: { type: ContentType; entry: EntryDetail | null }) {
  const ws = useProject();
  const schema = useSchema();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const invalidate = useInvalidateContent();
  const envId = ws.environment.id;
  const isNew = !entry;
  const entryId = entry?.id;
  const base = `${ws.envBase}/entry/${entryId}`;
  const listHref = ws.href(`content/${type.apiId}`);
  const single = type.kind === 'SINGLE';

  const fields = useMemo(() => [...type.fields].sort((a, b) => a.position - b.position), [type.fields]);
  const components = useMemo(() => componentIndex(schema.data), [schema.data]);

  const [data, setData] = useState<Record<string, unknown>>(() => (entry ? entry.data : buildDefaults(fields)));
  const [saved, setSaved] = useState(() => snapshotOf(fields, data));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<unknown>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [conflict, setConflict] = useState<{ updatedBy: string | null; updatedAt: string | null } | null>(null);
  const [failedSnapshot, setFailedSnapshot] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [others, setOthers] = useState<{ id: string; name: string }[]>([]);
  const [tab, setTab] = useState<RailTab>('versions');
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [helpAnchor, setHelpAnchor] = useState<HTMLElement | null>(null);
  const [noteMode, setNoteMode] = useState<NoteMode | null>(null);
  const [scheduling, setScheduling] = useState(false);
  const [preview, setPreview] = useState<{ previewUrl: string | null; apiUrl: string; expiresIn: number } | null>(null);

  const snapshot = useMemo(() => snapshotOf(fields, data), [fields, data]);
  const dirty = snapshot !== saved;
  const dataRef = useRef(data);
  dataRef.current = data;
  const savedRef = useRef(saved);
  savedRef.current = saved;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const lockVersion = useRef(entry?.lockVersion ?? 1);
  const inFlight = useRef<Promise<boolean> | null>(null);
  const bypassGuard = useRef(false);
  const problemRef = useRef<HTMLDivElement>(null);

  const deleted = !!entry?.deletedAt;
  const archived = entry?.status === 'ARCHIVED';
  const canEdit = isNew ? ws.can('content.create') : ws.can('content.update');
  const readOnly = !canEdit || archived || deleted;
  // From sending a new entry until its saved editor takes over, this form is about to be replaced:
  // anything typed into it in that window would be thrown away, so it does not accept input.
  const creating = isNew && saveState === 'saving';

  const titleFieldId = type.options.titleField ?? fields.find((f) => f.type === 'text')?.apiId;
  const typedTitle = titleFieldId && typeof data[titleFieldId] === 'string' ? (data[titleFieldId] as string).trim() : '';
  const title = typedTitle || entry?.title || (isNew ? `New ${type.singularName.toLowerCase()}` : `Untitled ${type.singularName.toLowerCase()}`);
  useCrumbs(single ? [{ label: type.displayName }] : [{ label: type.displayName, to: listHref }, { label: title }]);

  const markSaved = useCallback((value: string) => {
    savedRef.current = value;
    setSaved(value);
  }, []);

  const handleChange = useCallback((next: Record<string, unknown>) => {
    const previous = dataRef.current;
    const changed = Object.keys(next).filter((key) => next[key] !== previous[key]);
    if (changed.length) {
      // A field that was just edited no longer shows the error from the previous attempt.
      setErrors((current) => {
        const keys = Object.keys(current);
        const kept = keys.filter((path) => !changed.some((key) => path === key || path.startsWith(`${key}.`)));
        return kept.length === keys.length ? current : Object.fromEntries(kept.map((k) => [k, current[k]]));
      });
    }
    setData(next);
  }, []);

  /** Accepts the server's view of the entry after an action. `replace` also swaps the form content. */
  const applyDetail = useCallback(
    (detail: EntryDetail, mode: 'meta' | 'replace' = 'meta') => {
      queryClient.setQueryData(['entry', envId, detail.id], detail);
      lockVersion.current = detail.lockVersion;
      if (mode === 'replace') {
        setData(detail.data);
        markSaved(snapshotOf(fields, detail.data));
        setErrors({});
        setProblem(null);
        setFailedSnapshot(null);
        setConflict(null);
        setSaveState('idle');
      }
      invalidate(detail.id);
    },
    [queryClient, envId, fields, invalidate, markSaved],
  );

  const save = useCallback(
    async (opts: { autosave?: boolean; note?: string; force?: boolean } = {}): Promise<boolean> => {
      // One write at a time: a save requested while another is in flight waits, then sends the newest content.
      if (inFlight.current) await inFlight.current.catch(() => false);
      const payload = toPayload(fields, dataRef.current);
      // Same serialisation as `snapshotOf`, so it can be compared with (and stored as) the saved snapshot.
      const sent = canonicalJson(payload);
      if (entryId && sent === savedRef.current && !opts.force) return true;

      const run = (async (): Promise<boolean> => {
        setSaveState('saving');
        try {
          if (!entryId) {
            const created = await api.post<EntryDetail>(`${ws.envBase}/entries/${type.apiId}`, { data: payload });
            queryClient.setQueryData(['entry', envId, created.id], created);
            invalidate();
            bypassGuard.current = true;
            toast.success(`${type.singularName} created`);
            navigate(ws.href(`content/${type.apiId}/${created.id}`), { replace: true });
            return true;
          }
          const detail = await api.put<EntryDetail>(`${ws.envBase}/entry/${entryId}`, {
            data: payload,
            lockVersion: opts.force ? undefined : lockVersion.current,
            autosave: !!opts.autosave,
            note: opts.note || undefined,
          });
          queryClient.setQueryData(['entry', envId, detail.id], detail);
          lockVersion.current = detail.lockVersion;
          const untouched = snapshotOf(fields, dataRef.current) === sent;
          if (!opts.autosave && untouched) {
            // After an explicit save nobody is mid-keystroke, so server-side additions can be shown.
            const merged = mergeServer(fields, dataRef.current, detail.data);
            setData(merged);
            markSaved(snapshotOf(fields, merged));
          } else {
            markSaved(sent);
          }
          setErrors({});
          setProblem(null);
          setFailedSnapshot(null);
          setConflict(null);
          setSaveState('saved');
          setSavedAt(new Date());
          invalidate(detail.id);
          return true;
        } catch (err) {
          setSaveState('error');
          const details = err instanceof ApiError ? err.details : undefined;
          if (err instanceof ApiError && err.status === 409 && details && !Array.isArray(details) && typeof details.currentLockVersion === 'number') {
            setConflict({ updatedBy: (details.updatedBy as string | null) ?? null, updatedAt: (details.updatedAt as string | null) ?? null });
          } else if (err instanceof ApiError && err.status === 422) {
            setErrors(toFieldErrors(err.details));
            setProblem(err);
            // Do not resend content the server has already rejected; wait for the next edit.
            if (opts.autosave) setFailedSnapshot(sent);
          } else if (opts.autosave) {
            // Transient failure: hold off, then let autosave try again.
            setFailedSnapshot(sent);
            window.setTimeout(() => setFailedSnapshot((current) => (current === sent ? null : current)), 12_000);
          } else {
            toast.error(errorMessage(err));
          }
          return false;
        }
      })();
      inFlight.current = run;
      try {
        return await run;
      } finally {
        if (inFlight.current === run) inFlight.current = null;
      }
    },
    [fields, entryId, ws, type.apiId, type.singularName, queryClient, envId, invalidate, navigate, markSaved],
  );

  // Autosave: a pause in editing writes the draft. Explicit saves create the named versions.
  useEffect(() => {
    if (!entryId || readOnly || !dirty || conflict || busy || snapshot === failedSnapshot) return;
    const id = window.setTimeout(() => void save({ autosave: true }), 2500);
    return () => window.clearTimeout(id);
  }, [entryId, readOnly, dirty, conflict, busy, snapshot, failedSnapshot, save]);

  const manualSave = useCallback(
    async (note?: string) => {
      if (readOnly) return false;
      if (entryId && !dirtyRef.current) {
        toast.info('Everything is already saved');
        return true;
      }
      const ok = await save({ note });
      if (ok && entryId) toast.success('Saved');
      return ok;
    },
    [readOnly, entryId, save],
  );

  /** Runs a lifecycle action against the saved entry, saving pending edits first. */
  const runAction = useCallback(
    async (key: string, request: () => Promise<EntryDetail>, success: string, mode: 'meta' | 'replace' = 'meta'): Promise<boolean> => {
      setBusy(key);
      setProblem(null);
      try {
        if (dirtyRef.current && !readOnly && !(await save())) return false;
        const detail = await request();
        applyDetail(detail, mode);
        toast.success(success);
        return true;
      } catch (err) {
        if (err instanceof ApiError && err.status === 422) {
          setErrors(toFieldErrors(err.details));
          setProblem(err);
        } else if (err instanceof ApiError && err.status === 409) setProblem(err);
        else toast.error(errorMessage(err));
        return false;
      } finally {
        setBusy(null);
      }
    },
    [readOnly, save, applyDetail],
  );

  useEffect(() => {
    if (problem) problemRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [problem]);

  // ── Lifecycle rules ────────────────────────────────────────────────────────

  const status = entry?.status ?? 'DRAFT';
  const live = !!entry?.isPublished;
  const pendingChanges = dirty || !!entry?.hasChanges;
  const can = (action: WorkflowAction) => !!entry && !deleted && canTransition(action, status) && ws.can(WORKFLOW_TRANSITIONS[action].permission);
  const needsApproval = !!entry?.requiresApproval && status !== 'APPROVED' && !(live && !pendingChanges);
  const publishVisible = !isNew && !deleted && !archived && ws.can('content.publish');
  const publishDisabled = needsApproval || (live && !pendingChanges && status === 'PUBLISHED');
  const publishHint = needsApproval ? `${type.displayName} must be approved before publishing` : publishDisabled ? 'The live version is up to date' : '';

  const publish = useCallback(
    (note?: string) => runAction('publish', () => api.post<EntryDetail>(`${base}/publish`, note ? { note } : {}), live ? 'Changes published' : 'Published'),
    [runAction, base, live],
  );
  const transition = (action: WorkflowAction, success: string, comment?: string) =>
    runAction(action, () => api.post<EntryDetail>(`${base}/transition`, { action, ...(comment ? { comment } : {}) }), success);

  /**
   * Same as `runAction`, but lets the error propagate so the dialog that started the action
   * can show it next to the input that caused it.
   */
  const direct = async (request: () => Promise<EntryDetail>, success: string) => {
    if (dirtyRef.current && !readOnly && !(await save())) throw new Error('Your latest changes could not be saved. Fix the highlighted fields and try again.');
    try {
      applyDetail(await request());
      toast.success(success);
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) setErrors(toFieldErrors(err.details));
      throw err;
    }
  };

  const unpublish = () =>
    confirm({
      title: 'Unpublish this entry?',
      message: 'It disappears from the API immediately. The draft is kept and can be published again at any time.',
      confirmLabel: 'Unpublish',
      onConfirm: () => direct(() => api.post<EntryDetail>(`${base}/unpublish`), 'Unpublished'),
    });
  const archive = () =>
    confirm({
      title: 'Archive this entry?',
      message: live ? 'It is taken offline and becomes read-only until it is restored from the archive.' : 'It becomes read-only until it is restored from the archive.',
      confirmLabel: 'Archive',
      onConfirm: () => direct(() => api.post<EntryDetail>(`${base}/transition`, { action: 'archive' }), 'Archived'),
    });
  const leave = (to: string) => {
    bypassGuard.current = true;
    navigate(to);
  };
  const trash = () =>
    confirm({
      title: `Move “${title}” to the trash?`,
      message: live ? 'It is published, so it also disappears from the API immediately. You can restore it from the trash.' : 'You can restore it from the trash later.',
      confirmLabel: 'Move to trash',
      destructive: true,
      onConfirm: async () => {
        await api.delete(base);
        invalidate(entryId);
        void queryClient.removeQueries({ queryKey: ['entry', envId, entryId] });
        toast.success('Moved to trash');
        leave(single ? ws.href('content') : listHref);
      },
    });
  const purge = () =>
    confirm({
      title: `Delete “${title}” permanently?`,
      message: 'The entry and its entire version history will be erased. This cannot be undone.',
      confirmLabel: 'Delete permanently',
      destructive: true,
      onConfirm: async () => {
        await api.delete(base, { permanent: true });
        invalidate(entryId);
        void queryClient.removeQueries({ queryKey: ['entry', envId, entryId] });
        toast.success('Deleted permanently');
        leave(single ? ws.href('content') : `${listHref}?view=trash`);
      },
    });
  const duplicate = async () => {
    setBusy('duplicate');
    try {
      if (dirtyRef.current && !(await save())) return;
      const copy = await api.post<EntryDetail>(`${base}/duplicate`);
      queryClient.setQueryData(['entry', envId, copy.id], copy);
      invalidate();
      toast.success('Duplicated — you are now editing the copy');
      leave(ws.href(`content/${type.apiId}/${copy.id}`));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };
  const openPreview = async () => {
    setBusy('preview');
    try {
      if (dirtyRef.current && !readOnly && !(await save())) return;
      setPreview(await api.post<{ previewUrl: string | null; apiUrl: string; expiresIn: number }>(`${base}/preview-token`));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };
  const addTranslation = async (locale: string) => {
    if (!entry) return;
    setBusy('translate');
    try {
      if (dirtyRef.current && !readOnly && !(await save())) return;
      const created = await api.post<EntryDetail>(`${ws.envBase}/entries/${type.apiId}`, { data: toPayload(fields, dataRef.current), locale, documentId: entry.documentId });
      queryClient.setQueryData(['entry', envId, created.id], created);
      void queryClient.invalidateQueries({ queryKey: ['entry', envId, entry.id] });
      invalidate();
      toast.success(`${locale} translation created from this version`);
      leave(ws.href(`content/${type.apiId}/${created.id}`));
    } catch (err) {
      const first = err instanceof ApiError && Array.isArray(err.details) ? err.details[0]?.message : undefined;
      toast.error(first ? `${errorMessage(err)} — ${first}` : errorMessage(err));
    } finally {
      setBusy(null);
    }
  };
  const assign = async (assigneeId: string | null) => {
    try {
      const detail = await api.patch<EntryDetail>(`${base}/assignee`, { assigneeId });
      queryClient.setQueryData(['entry', envId, detail.id], detail);
      invalidate();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  const reloadLatest = async () => {
    setBusy('reload');
    try {
      applyDetail(await api.get<EntryDetail>(base), 'replace');
      toast.info('Loaded the latest version');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────

  const shortcuts = useRef({ save: () => {}, publish: () => {} });
  shortcuts.current = {
    save: () => void manualSave(),
    publish: () => {
      if (publishVisible && !publishDisabled && !busy) void publish();
    },
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.defaultPrevented) return;
      if (e.key.toLowerCase() === 's') {
        e.preventDefault();
        shortcuts.current.save();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        shortcuts.current.publish();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ── Presence ───────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!entryId || deleted) return;
    let stopped = false;
    const beat = () => {
      if (document.visibilityState === 'hidden') return;
      api
        .post<{ others: { id: string; name: string }[] }>(`${ws.envBase}/entry/${entryId}/presence`)
        .then((r) => !stopped && setOthers(r.others))
        .catch(() => undefined);
    };
    beat();
    const id = window.setInterval(beat, 30_000);
    return () => {
      stopped = true;
      window.clearInterval(id);
      void api.delete(`${ws.envBase}/entry/${entryId}/presence`).catch(() => undefined);
    };
  }, [entryId, deleted, ws.envBase]);

  // ── Leaving with unsaved changes ───────────────────────────────────────────

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current && !bypassGuard.current) e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirtyRef.current && !bypassGuard.current && currentLocation.pathname !== nextLocation.pathname);
  const blockerRef = useRef(blocker);
  blockerRef.current = blocker;
  const leaveState = useRef({ canAutosave: false });
  leaveState.current.canAutosave = !!entryId && !readOnly && !conflict;
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    let cancelled = false;
    void (async () => {
      // An existing draft is simply saved on the way out; only what cannot be saved needs a decision.
      if (leaveState.current.canAutosave && (await save({ autosave: true }))) {
        if (!cancelled) blockerRef.current.proceed?.();
        return;
      }
      const discard = await confirm({
        title: 'Leave without saving?',
        message: entryId ? 'Your latest changes could not be saved. If you leave now they will be lost.' : `This ${type.singularName.toLowerCase()} has not been created yet. If you leave now, what you entered will be lost.`,
        confirmLabel: 'Leave',
        cancelLabel: 'Stay',
        destructive: true,
      });
      if (cancelled) return;
      if (discard) blockerRef.current.proceed?.();
      else blockerRef.current.reset?.();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocker.state]);

  // ── Derived UI ─────────────────────────────────────────────────────────────

  const members = useMembers(!isNew && ws.can('content.update'));
  const locales = ws.project.locales;
  const showLocales = !isNew && !!type.options.localized && locales.length > 1;
  const variantByLocale = new Map((entry?.variants ?? []).map((v) => [v.locale, v]));

  let indicator: { icon: ReactNode; text: string; tone: string };
  if (isNew) indicator = { icon: <EditNoteOutlined />, text: 'Not created yet', tone: 'text.secondary' };
  else if (conflict) indicator = { icon: <ErrorOutlineOutlined />, text: 'Save conflict', tone: 'error.main' };
  else if (saveState === 'saving') indicator = { icon: <CircularProgress size={12} color="inherit" thickness={5} />, text: 'Saving…', tone: 'text.secondary' };
  else if (dirty && saveState === 'error') indicator = { icon: <ErrorOutlineOutlined />, text: Object.keys(errors).length ? 'Not saved — fix the highlighted fields' : 'Not saved — retrying shortly', tone: 'error.main' };
  else if (dirty) indicator = { icon: <EditNoteOutlined />, text: 'Unsaved changes', tone: 'warning.dark' };
  else if (savedAt) indicator = { icon: <CloudDoneOutlined />, text: `Saved at ${format(savedAt, 'HH:mm')}`, tone: 'text.secondary' };
  else indicator = { icon: <CloudDoneOutlined />, text: 'All changes saved', tone: 'text.secondary' };

  const closeMenu = () => setMenuAnchor(null);
  const noteConfig: Record<NoteMode, { title: string; label: string; confirmLabel: string; required?: boolean; description?: string; run: (text: string) => Promise<unknown> }> = {
    request_changes: {
      title: 'Request changes',
      description: 'The author sees this note on the entry and it returns to them for another pass.',
      label: 'What needs to change?',
      confirmLabel: 'Request changes',
      required: true,
      run: async (text) => {
        await direct(() => api.post<EntryDetail>(`${base}/transition`, { action: 'request_changes', comment: text }), 'Changes requested');
        setTab('comments');
      },
    },
    approve: {
      title: 'Approve',
      description: 'Approval covers the content exactly as it is now. Any later edit needs approving again.',
      label: 'Note for the author (optional)',
      confirmLabel: 'Approve',
      run: (text) => direct(() => api.post<EntryDetail>(`${base}/transition`, { action: 'approve', ...(text ? { comment: text } : {}) }), 'Approved'),
    },
    save: {
      title: 'Save with a note',
      description: 'The note is stored with this version and shown in the version history.',
      label: 'What changed?',
      confirmLabel: 'Save version',
      required: true,
      run: async (text) => {
        if (!(await manualSave(text))) throw new Error('The entry could not be saved. Fix the highlighted fields and try again.');
      },
    },
    publish: {
      title: 'Publish with a note',
      description: 'The note is stored with the published version.',
      label: 'Release note',
      confirmLabel: 'Publish',
      required: true,
      run: (text) => direct(() => api.post<EntryDetail>(`${base}/publish`, { note: text }), live ? 'Changes published' : 'Published'),
    },
  };

  return (
    <Page width={1360}>
      <PageHeader
        title={title}
        meta={
          entry && (
            <>
              <StatusChip status={entry.status} isPublished={entry.isPublished} hasChanges={entry.hasChanges} />
              {showLocales && <Pill label={entry.locale} title="Locale of this version" />}
            </>
          )
        }
        description={isNew ? `Fill in the fields and create the ${type.singularName.toLowerCase()}. It stays a draft until someone publishes it.` : undefined}
        actions={
          <>
            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', color: indicator.tone, mr: 1, '& svg': { fontSize: 16 } }} role="status" aria-live="polite">
              {indicator.icon}
              <Typography variant="caption" sx={{ color: 'inherit', fontWeight: 500, whiteSpace: 'nowrap' }}>
                {indicator.text}
              </Typography>
            </Stack>
            <Tooltip title="Keyboard shortcuts">
              <IconButton aria-label="Keyboard shortcuts" onClick={(e) => setHelpAnchor(e.currentTarget)}>
                <KeyboardOutlined />
              </IconButton>
            </Tooltip>
            {!isNew && (
              <Tooltip title="More actions">
                <IconButton aria-label="More actions" aria-haspopup="menu" onClick={(e) => setMenuAnchor(e.currentTarget)}>
                  <MoreHorizOutlined />
                </IconButton>
              </Tooltip>
            )}
          </>
        }
      />

      <Stack spacing={3} sx={{ mb: problem || deleted || archived || others.length || (!canEdit && !deleted && !archived) ? 4 : 0 }}>
        {deleted && (
          <Alert
            severity="warning"
            action={
              ws.can('content.delete') && (
                <Stack direction="row" spacing={1}>
                  <Button color="inherit" size="small" startIcon={<RestoreFromTrashOutlined />} loading={busy === 'restore'} onClick={() => void runAction('restore', () => api.post<EntryDetail>(`${base}/restore`), 'Restored from trash', 'replace')}>
                    Restore
                  </Button>
                  <Button color="inherit" size="small" onClick={() => void purge()}>
                    Delete permanently
                  </Button>
                </Stack>
              )
            }
          >
            This {type.singularName.toLowerCase()} is in the trash{entry?.deletedAt ? ` (deleted ${fullDateTime(entry.deletedAt)})` : ''}. It is read-only until restored.
          </Alert>
        )}
        {archived && !deleted && (
          <Alert
            severity="info"
            action={
              can('unarchive') && (
                <Button color="inherit" size="small" startIcon={<UnarchiveOutlined />} loading={busy === 'unarchive'} onClick={() => void transition('unarchive', 'Restored from archive')}>
                  Restore from archive
                </Button>
              )
            }
          >
            This {type.singularName.toLowerCase()} is archived. Archived content is offline and read-only.
          </Alert>
        )}
        {!canEdit && !deleted && !archived && <Alert severity="info">You can view this {type.singularName.toLowerCase()} but your role does not allow editing it.</Alert>}
        {others.length > 0 && (
          <Alert severity="info">
            {others.map((o) => o.name).join(', ')} {others.length === 1 ? 'is' : 'are'} also editing this {type.singularName.toLowerCase()}. Saves are checked for conflicts, so nobody’s work is overwritten silently.
          </Alert>
        )}
        {!!problem && (
          <Box ref={problemRef}>
            <ProblemAlert error={problem} onClose={() => setProblem(null)} />
          </Box>
        )}
      </Stack>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1fr) 340px' }, gap: 5, alignItems: 'start' }}>
        <Paper sx={{ borderRadius: '10px', p: { xs: 4, md: 6 }, minWidth: 0, order: { xs: 2, lg: 1 } }}>
          {fields.length === 0 ? (
            <EmptyState
              compact
              icon={<EditNoteOutlined />}
              title="This content type has no fields yet"
              description="Add fields in the content type builder, then come back to fill them in."
              action={
                ws.can('schema.manage') && (
                  <Button variant="outlined" component={RouterLink} to={ws.href(`model/types/${type.id}`)}>
                    Open the builder
                  </Button>
                )
              }
            />
          ) : (
            <FieldForm fields={fields} value={data} onChange={handleChange} errors={errors} disabled={readOnly || creating} components={components} />
          )}
        </Paper>

        <Stack spacing={4} sx={{ order: { xs: 1, lg: 2 }, position: { lg: 'sticky' }, top: { lg: 16 }, maxHeight: { lg: 'calc(100dvh - 84px)' }, overflowY: { lg: 'auto' }, minWidth: 0 }}>
          <Paper sx={{ borderRadius: '10px', p: 4 }}>
            <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
              <Typography variant="h5" component="h2">
                Status
              </Typography>
              {entry ? <StatusChip status={entry.status} isPublished={entry.isPublished} hasChanges={entry.hasChanges} /> : <Pill label="New" />}
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3.5 }}>
              {isNew
                ? 'Nothing is saved until you create the entry.'
                : live
                  ? pendingChanges
                    ? `Live since ${fullDateTime(entry?.publishedAt)}. Newer changes are not public yet.`
                    : `Live since ${fullDateTime(entry?.publishedAt)}.`
                  : 'Not published. Only people in this workspace can see it.'}
            </Typography>

            {!deleted && (
              <Stack spacing={2}>
                {isNew ? (
                  <Button variant="contained" size="large" disabled={readOnly} loading={saveState === 'saving'} onClick={() => void manualSave()}>
                    Create {type.singularName.toLowerCase()}
                  </Button>
                ) : (
                  <Stack direction="row" spacing={2}>
                    {!readOnly && (
                      <Button variant="outlined" fullWidth disabled={!dirty || !!busy} loading={saveState === 'saving' && !busy} onClick={() => void manualSave()}>
                        Save draft
                      </Button>
                    )}
                    {publishVisible && (
                      <Tooltip title={publishHint}>
                        <Box component="span" sx={{ display: 'flex', flex: 1 }}>
                          <Button variant="contained" fullWidth startIcon={<PublicOutlined />} disabled={publishDisabled || (!!busy && busy !== 'publish')} loading={busy === 'publish'} onClick={() => void publish()}>
                            {live ? 'Publish changes' : 'Publish'}
                          </Button>
                        </Box>
                      </Tooltip>
                    )}
                  </Stack>
                )}

                {can('submit') && (needsApproval || !ws.can('content.publish')) && (
                  <Button variant={publishVisible && !needsApproval ? 'outlined' : 'contained'} color={publishVisible && !needsApproval ? 'primary' : 'secondary'} loading={busy === 'submit'} disabled={!!busy && busy !== 'submit'} onClick={() => void transition('submit', 'Submitted for review')}>
                    Submit for review
                  </Button>
                )}
                {can('approve') && (
                  <Button variant="contained" color="secondary" startIcon={<CheckCircleOutlined />} disabled={!!busy} onClick={() => setNoteMode('approve')}>
                    Approve
                  </Button>
                )}
                {can('request_changes') && (
                  <Button variant="outlined" disabled={!!busy} onClick={() => setNoteMode('request_changes')}>
                    Request changes
                  </Button>
                )}
                {can('withdraw') && (
                  <Button variant="outlined" loading={busy === 'withdraw'} disabled={!!busy && busy !== 'withdraw'} onClick={() => void transition('withdraw', 'Withdrawn from review')}>
                    Withdraw from review
                  </Button>
                )}
                {can('submit') && !needsApproval && ws.can('content.publish') && (
                  <Button variant="text" size="small" loading={busy === 'submit'} disabled={!!busy && busy !== 'submit'} onClick={() => void transition('submit', 'Submitted for review')} sx={{ alignSelf: 'flex-start', color: 'text.secondary' }}>
                    Ask for a review first
                  </Button>
                )}
              </Stack>
            )}

            {entry?.requiresApproval && !deleted && (
              <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 3 }}>
                {status === 'IN_REVIEW'
                  ? 'Waiting for a reviewer to approve or request changes.'
                  : status === 'APPROVED'
                    ? 'Approved. Editing the content will require a new approval.'
                    : status === 'CHANGES_REQUESTED'
                      ? 'A reviewer asked for changes — see the comments.'
                      : `${type.displayName} need approval before they can be published.`}
              </Typography>
            )}

            {entry && (entry.scheduledPublishAt || entry.scheduledUnpublishAt) && (
              <Box sx={{ mt: 3.5, p: 3, borderRadius: '8px', bgcolor: 'info.light', color: 'info.dark' }}>
                <Stack direction="row" spacing={2} sx={{ alignItems: 'flex-start' }}>
                  <EventOutlined sx={{ fontSize: 17, mt: 0.25 }} />
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    {entry.scheduledPublishAt && <Typography variant="body2">Publishes {fullDateTime(entry.scheduledPublishAt)}</Typography>}
                    {entry.scheduledUnpublishAt && <Typography variant="body2">Unpublishes {fullDateTime(entry.scheduledUnpublishAt)}</Typography>}
                  </Box>
                  {ws.can('content.publish') && !deleted && (
                    <Button size="small" color="inherit" onClick={() => setScheduling(true)}>
                      Change
                    </Button>
                  )}
                </Stack>
              </Box>
            )}

            {entry && !deleted && !archived && ws.can('content.publish') && (
              <Stack direction="row" sx={{ mt: 3.5, pt: 3, gap: 1.5, flexWrap: 'wrap', borderTop: 1, borderColor: 'border.subtle' }}>
                {!entry.scheduledPublishAt && !entry.scheduledUnpublishAt && (
                  <Button size="small" startIcon={<EventOutlined />} disabled={!!busy} onClick={() => setScheduling(true)}>
                    Schedule
                  </Button>
                )}
                {live && (
                  <Button size="small" startIcon={<PublicOffOutlined />} disabled={!!busy} onClick={() => void unpublish()}>
                    Unpublish
                  </Button>
                )}
              </Stack>
            )}
          </Paper>

          {entry && (showLocales || ws.can('content.update')) && (
            <Paper sx={{ borderRadius: '10px', p: 4 }}>
              <Stack spacing={3.5}>
                {showLocales && (
                  <TextField
                    select
                    label="Locale"
                    value={entry.locale}
                    disabled={busy === 'translate'}
                    helperText="Each locale is edited and published on its own."
                    onChange={(e) => {
                      const code = e.target.value;
                      const variant = variantByLocale.get(code);
                      if (variant) navigate(ws.href(`content/${type.apiId}/${variant.id}`));
                      else void addTranslation(code);
                    }}
                  >
                    {locales.map((l) => {
                      const variant = variantByLocale.get(l.code);
                      const creatable = !variant && ws.can('content.create') && !deleted;
                      return (
                        <MenuItem key={l.code} value={l.code} disabled={!variant && !creatable}>
                          <Box sx={{ flex: 1 }}>
                            {l.name} ({l.code})
                          </Box>
                          {variant ? <StatusChip status={variant.status} isPublished={variant.isPublished} /> : <Typography variant="caption" color="text.secondary">{creatable ? 'Add translation' : 'Not translated'}</Typography>}
                        </MenuItem>
                      );
                    })}
                  </TextField>
                )}
                {ws.can('content.update') && (
                  <TextField
                    select
                    label="Assigned to"
                    value={members.data ? (entry.assigneeId ?? '') : ''}
                    disabled={deleted || members.isLoading}
                    onChange={(e) => void assign(e.target.value || null)}
                    helperText={members.isError ? 'Members could not be loaded' : undefined}
                    slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
                  >
                    <MenuItem value="">
                      <Typography variant="body2" color="text.secondary">
                        Nobody
                      </Typography>
                    </MenuItem>
                    {(members.data ?? [])
                      .filter((m) => m.status === 'ACTIVE' || m.user.id === entry.assigneeId)
                      .map((m) => (
                        <MenuItem key={m.user.id} value={m.user.id}>
                          {m.user.name}
                        </MenuItem>
                      ))}
                    {/* The assignee may have left the organization since; keep the value representable. */}
                    {entry.assigneeId && members.data && !members.data.some((m) => m.user.id === entry.assigneeId) && <MenuItem value={entry.assigneeId}>{entry.assignee ?? 'Former member'}</MenuItem>}
                  </TextField>
                )}
              </Stack>
            </Paper>
          )}

          {entry && (
            <Paper sx={{ borderRadius: '10px', overflow: 'hidden' }}>
              <Tabs value={tab} onChange={(_, next: RailTab) => setTab(next)} variant="fullWidth" aria-label="Entry details">
                <Tab value="versions" label="Versions" />
                <Tab
                  value="comments"
                  label={
                    <Badge color="secondary" variant="dot" invisible={entry.openComments === 0} sx={{ '& .MuiBadge-badge': { right: -6, top: 4 } }}>
                      Comments
                    </Badge>
                  }
                />
                <Tab value="activity" label="Activity" />
                <Tab value="info" label="Info" />
              </Tabs>
              <Box role="tabpanel" sx={{ maxHeight: { lg: 520 }, overflowY: { lg: 'auto' } }}>
                {tab === 'versions' && (
                  <VersionsPanel
                    entry={entry}
                    type={type}
                    currentData={data}
                    hasUnsavedChanges={dirty}
                    canRestore={ws.can('content.update') && !archived && !deleted}
                    onRestored={(detail) => applyDetail(detail, 'replace')}
                  />
                )}
                {tab === 'comments' && <CommentsPanel entry={entry} readOnly={deleted} canModerate={ws.can('content.delete')} />}
                {tab === 'activity' && <ActivityPanel entry={entry} />}
                {tab === 'info' && <InfoPanel entry={entry} type={type} />}
              </Box>
            </Paper>
          )}
        </Stack>
      </Box>

      {/* More actions */}
      <Menu anchorEl={menuAnchor} open={!!menuAnchor} onClose={closeMenu} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}>
        {!readOnly && (
          <MenuItem onClick={() => { closeMenu(); setNoteMode('save'); }} disabled={!dirty}>
            <ListItemIcon><EditNoteOutlined /></ListItemIcon>
            Save with a note…
          </MenuItem>
        )}
        {publishVisible && (
          <MenuItem onClick={() => { closeMenu(); setNoteMode('publish'); }} disabled={publishDisabled}>
            <ListItemIcon><PublicOutlined /></ListItemIcon>
            Publish with a note…
          </MenuItem>
        )}
        {!deleted && (
          <MenuItem onClick={() => { closeMenu(); void openPreview(); }}>
            <ListItemIcon><VisibilityOutlined /></ListItemIcon>
            Preview draft
          </MenuItem>
        )}
        {!deleted && !single && ws.can('content.create') && (
          <MenuItem onClick={() => { closeMenu(); void duplicate(); }}>
            <ListItemIcon><ContentCopyOutlined /></ListItemIcon>
            Duplicate
          </MenuItem>
        )}
        {can('archive') && (
          <MenuItem onClick={() => { closeMenu(); void archive(); }}>
            <ListItemIcon><ArchiveOutlined /></ListItemIcon>
            Archive
          </MenuItem>
        )}
        {can('unarchive') && (
          <MenuItem onClick={() => { closeMenu(); void transition('unarchive', 'Restored from archive'); }}>
            <ListItemIcon><UnarchiveOutlined /></ListItemIcon>
            Restore from archive
          </MenuItem>
        )}
        {ws.can('content.delete') && <Divider sx={{ my: 1 }} />}
        {ws.can('content.delete') && !deleted && (
          <MenuItem sx={{ color: 'error.main' }} onClick={() => { closeMenu(); void trash(); }}>
            <ListItemIcon><DeleteOutlineOutlined /></ListItemIcon>
            Move to trash
          </MenuItem>
        )}
        {ws.can('content.delete') && deleted && (
          <MenuItem sx={{ color: 'error.main' }} onClick={() => { closeMenu(); void purge(); }}>
            <ListItemIcon><DeleteForeverOutlined /></ListItemIcon>
            Delete permanently
          </MenuItem>
        )}
      </Menu>

      {/* Keyboard shortcuts */}
      <Popover open={!!helpAnchor} anchorEl={helpAnchor} onClose={() => setHelpAnchor(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }} slotProps={{ paper: { sx: { mt: 1, p: 4, width: 300, borderRadius: '10px' } } }}>
        <Typography variant="h5" component="h2" sx={{ mb: 2.5 }}>
          Keyboard shortcuts
        </Typography>
        {(
          [
            ['Save', `${MOD} S`],
            ['Publish', `${MOD} Enter`],
            ['Search and commands', `${MOD} K`],
            ['Bold / italic / underline', `${MOD} B / I / U`],
            ['Undo / redo in text', `${MOD} Z / ${isMac ? '⇧⌘ Z' : 'Ctrl Y'}`],
          ] as const
        ).map(([label, keys]) => (
          <Stack key={label} direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', py: 1.25 }}>
            <Typography variant="body2">{label}</Typography>
            <Kbd>{keys}</Kbd>
          </Stack>
        ))}
        <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 2 }}>
          Drafts are saved automatically a moment after you stop typing.
        </Typography>
      </Popover>

      {/* Save conflict */}
      <Dialog open={!!conflict} maxWidth="xs" aria-labelledby="conflict-title">
        <DialogTitle id="conflict-title">Someone else changed this entry</DialogTitle>
        <DialogContent>
          <Typography variant="body1" color="text.secondary">
            {conflict?.updatedBy ?? 'Another editor'} saved a newer version{conflict?.updatedAt ? ` on ${fullDateTime(conflict.updatedAt)}` : ''} while you were editing. Your changes have not been saved.
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 3 }}>
            Load their version to continue from it (your unsaved edits are discarded), or keep yours and save it as the newest version — theirs stays in the version history.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button loading={busy === 'reload'} onClick={() => void reloadLatest()}>
            Load latest
          </Button>
          <Button
            variant="contained"
            color="error"
            loading={saveState === 'saving'}
            onClick={() => {
              setConflict(null);
              void save({ force: true }).then((ok) => ok && toast.success('Saved your version'));
            }}
          >
            Overwrite with mine
          </Button>
        </DialogActions>
      </Dialog>

      {/* Preview */}
      <Dialog open={!!preview} onClose={() => setPreview(null)} maxWidth="sm" aria-labelledby="preview-title">
        <DialogTitle id="preview-title">Preview this draft</DialogTitle>
        <DialogContent>
          <Stack spacing={3.5} sx={{ pt: 1 }}>
            <GuestNote>
              Guest mode: the demo project’s website does not exist and there is no server, so neither link below leads anywhere. The token itself is real inside this browser — the API explorer’s <code>GET /preview</code> request accepts it.
            </GuestNote>
            {preview?.previewUrl ? (
              <>
                <Typography variant="body2" color="text.secondary">
                  Open the draft in your frontend. The link carries a signed token that unlocks only this entry and expires in {Math.round((preview.expiresIn ?? 3600) / 60)} minutes.
                </Typography>
                <Box>
                  <Button variant="contained" startIcon={<OpenInNewOutlined />} component="a" href={preview.previewUrl} target="_blank" rel="noopener noreferrer">
                    Open preview
                  </Button>
                </Box>
              </>
            ) : (
              <Alert severity="info">
                No preview URL is configured for {type.displayName} or this project, so there is no frontend to open. Set one in the content type or project settings — for example{' '}
                <code>{'https://your-site.com/api/preview?token={token}&slug={slug}'}</code>.
              </Alert>
            )}
            <Box>
              <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 1.5 }}>
                Draft content through the delivery API (no API key needed, valid for {Math.round((preview?.expiresIn ?? 3600) / 60)} minutes):
              </Typography>
              <CodeBlock code={preview?.apiUrl ?? ''} maxHeight={120} />
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button variant="contained" onClick={() => setPreview(null)}>
            Done
          </Button>
        </DialogActions>
      </Dialog>

      <ScheduleDialog
        entry={scheduling && entry ? entry : null}
        onClose={() => setScheduling(false)}
        onDone={(detail) => {
          applyDetail(detail);
          toast.success(detail.scheduledPublishAt || detail.scheduledUnpublishAt ? 'Schedule saved' : 'Schedule cleared');
        }}
      />
      <NoteDialog
        open={!!noteMode}
        title={noteMode ? noteConfig[noteMode].title : ''}
        description={noteMode ? noteConfig[noteMode].description : undefined}
        label={noteMode ? noteConfig[noteMode].label : ''}
        confirmLabel={noteMode ? noteConfig[noteMode].confirmLabel : ''}
        required={noteMode ? noteConfig[noteMode].required : false}
        onClose={() => setNoteMode(null)}
        onSubmit={(text) => (noteMode ? noteConfig[noteMode].run(text) : Promise.resolve())}
      />
    </Page>
  );
}
