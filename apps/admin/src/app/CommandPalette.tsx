import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import Box from '@mui/material/Box';
import Dialog from '@mui/material/Dialog';
import InputBase from '@mui/material/InputBase';
import LinearProgress from '@mui/material/LinearProgress';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useColorScheme } from '@mui/material/styles';
import AddOutlined from '@mui/icons-material/AddOutlined';
import ContrastOutlined from '@mui/icons-material/ContrastOutlined';
import SearchOutlined from '@mui/icons-material/SearchOutlined';
import { IconFor } from '@/components/icons';
import { StatusChip, useDebounced } from '@/components/ui';
import { api } from '@/lib/api';
import type { SearchHit } from '@/lib/types';
import { setCommandOpen, useAppDispatch, useAppSelector } from '@/store';
import { NAV_GROUPS } from './nav';
import { useSchema, useWorkspace } from './workspace';

interface Command {
  id: string;
  group: string;
  label: string;
  hint?: ReactNode;
  icon: ReactNode;
  keywords?: string;
  run: () => void;
}

/** Ctrl/⌘+K: jump to any section, open any entry by title, or start creating content. */
export function CommandPalette() {
  const open = useAppSelector((s) => s.ui.commandOpen);
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const ws = useWorkspace();
  const schema = useSchema();
  const { mode, setMode } = useColorScheme();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const term = useDebounced(query.trim(), 180);

  const search = useQuery({
    queryKey: ['search', ws.environment?.id, term],
    queryFn: () => api.get<{ items: SearchHit[] }>(`${ws.envBase}/search`, { q: term }).then((r) => r.items),
    enabled: open && !!ws.environment && term.length >= 2 && ws.can('content.read'),
    staleTime: 10_000,
  });

  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
    }
  }, [open]);

  const close = () => dispatch(setCommandOpen(false));

  const commands = useMemo<Command[]>(() => {
    const go = (to: string) => () => navigate(to);
    const list: Command[] = [];
    for (const hit of search.data ?? []) {
      list.push({
        id: `hit-${hit.id}`,
        group: 'Content',
        label: hit.title ?? 'Untitled',
        hint: (
          <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
            <Typography variant="caption" color="text.secondary">
              {hit.isPage ? hit.path : hit.contentTypeName}
            </Typography>
            <StatusChip status={hit.status} />
          </Stack>
        ),
        icon: <IconFor name={hit.isPage ? 'page' : 'document'} />,
        run: go(ws.href(hit.isPage ? `pages/${hit.id}` : `content/${hit.contentType}/${hit.id}`)),
      });
    }
    for (const group of NAV_GROUPS) {
      for (const item of group.items) {
        if (item.permission && !ws.can(item.permission)) continue;
        if (item.scope === 'project' && !ws.project) continue;
        list.push({
          id: `nav-${item.label}`,
          group: 'Go to',
          label: item.label,
          hint: <Typography variant="caption" color="text.disabled">{group.label}</Typography>,
          icon: item.icon,
          keywords: item.keywords,
          run: go(item.scope === 'org' ? ws.orgHref(item.path) : ws.href(item.path)),
        });
      }
    }
    if (ws.project && ws.can('content.read')) {
      for (const type of schema.data?.types ?? []) {
        if (type.isSystem) continue;
        list.push({ id: `type-${type.id}`, group: 'Content types', label: type.displayName, icon: <IconFor name={type.icon} />, keywords: type.apiId, run: go(ws.href(`content/${type.apiId}`)) });
        if (ws.can('content.create') && type.kind === 'COLLECTION') {
          list.push({ id: `new-${type.id}`, group: 'Create', label: `New ${type.singularName.toLowerCase()}`, icon: <AddOutlined />, keywords: `create add ${type.apiId}`, run: go(ws.href(`content/${type.apiId}/new`)) });
        }
      }
      if (ws.can('content.create')) list.push({ id: 'new-page', group: 'Create', label: 'New page', icon: <AddOutlined />, keywords: 'create add page', run: go(`${ws.href('pages')}?new=1`) });
    }
    list.push({
      id: 'theme',
      group: 'Preferences',
      label: mode === 'dark' ? 'Switch to light theme' : 'Switch to dark theme',
      icon: <ContrastOutlined />,
      keywords: 'dark light appearance mode',
      run: () => setMode(mode === 'dark' ? 'light' : 'dark'),
    });
    return list;
  }, [search.data, schema.data, ws, navigate, mode, setMode]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = q ? commands.filter((c) => c.id.startsWith('hit-') || `${c.label} ${c.keywords ?? ''}`.toLowerCase().includes(q)) : commands.filter((c) => c.group !== 'Content');
    return matches.slice(0, 40);
  }, [commands, query]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const run = (command: Command | undefined) => {
    if (!command) return;
    close();
    command.run();
  };

  let lastGroup = '';
  return (
    <Dialog
      open={open}
      onClose={close}
      maxWidth="sm"
      // The label belongs on the paper, which is the element with the dialog role; a label on the root is never announced.
      slotProps={{
        // `autoFocus` alone is not enough: the dialog's focus trap can take focus back while it opens
        // (it does whenever its effects run twice, as in development), and typing would then go nowhere.
        transition: { onEntered: () => inputRef.current?.focus() },
        paper: { 'aria-label': 'Search and commands', sx: { position: 'fixed', top: { xs: 16, sm: '14vh' }, m: 0, width: 'calc(100% - 32px)', maxWidth: 600, overflow: 'hidden' } },
      }}
    >
      <Stack direction="row" spacing={2.5} sx={{ px: 4, height: 50, alignItems: 'center', borderBottom: 1, borderColor: 'border.subtle' }}>
        <SearchOutlined sx={{ fontSize: 18, color: 'text.disabled' }} />
        <InputBase
          autoFocus
          inputRef={inputRef}
          fullWidth
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search content or jump to…"
          inputProps={{ 'aria-label': 'Search content or jump to', role: 'combobox', 'aria-expanded': true, 'aria-controls': 'command-list', 'aria-activedescendant': visible[active] ? `command-${visible[active].id}` : undefined }}
          sx={{ fontSize: '0.9375rem' }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((i) => Math.min(visible.length - 1, i + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((i) => Math.max(0, i - 1));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              run(visible[active]);
            }
          }}
        />
        <Box component="kbd" sx={{ fontSize: '0.6875rem', px: 1.25, py: 0.25, borderRadius: '4px', border: 1, borderColor: 'border.strong', color: 'text.disabled' }}>
          Esc
        </Box>
      </Stack>
      {search.isFetching && <LinearProgress sx={{ height: 2 }} />}
      <Box ref={listRef} id="command-list" role="listbox" sx={{ maxHeight: 400, overflowY: 'auto', p: 1.5 }}>
        {visible.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ px: 3, py: 6, textAlign: 'center' }}>
            {search.isFetching ? 'Searching…' : `Nothing matches “${query.trim()}”`}
          </Typography>
        )}
        {visible.map((command, index) => {
          const header = command.group !== lastGroup;
          lastGroup = command.group;
          return (
            <Box key={command.id}>
              {header && (
                <Typography variant="overline" color="text.disabled" component="div" sx={{ px: 2.5, pt: 2.5, pb: 1 }}>
                  {command.group}
                </Typography>
              )}
              <Box
                id={`command-${command.id}`}
                role="option"
                aria-selected={index === active}
                data-index={index}
                onMouseMove={() => setActive(index)}
                onClick={() => run(command)}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 2.5,
                  px: 2.5,
                  height: 36,
                  borderRadius: '7px',
                  cursor: 'pointer',
                  bgcolor: index === active ? 'action.selected' : 'transparent',
                  '& > svg': { fontSize: 16, color: index === active ? 'secondary.main' : 'text.secondary', flexShrink: 0 },
                }}
              >
                {command.icon}
                <Typography variant="body2" noWrap sx={{ flex: 1, fontWeight: 500 }}>
                  {command.label}
                </Typography>
                {command.hint}
              </Box>
            </Box>
          );
        })}
      </Box>
    </Dialog>
  );
}
