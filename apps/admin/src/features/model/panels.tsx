import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import HistoryOutlined from '@mui/icons-material/HistoryOutlined';
import { useProject } from '@/app/workspace';
import { CopyButton, EmptyState, ErrorState, Mono, Pill, RelativeTime, TableSkeleton, UserAvatar } from '@/components/ui';
import { api } from '@/lib/api';
import type { Page } from '@/lib/types';

interface SchemaChangeRow {
  id: string;
  targetKind: string;
  targetApiId: string;
  version: number;
  summary: string;
  userName: string | null;
  createdAt: string;
}

/** Append-only log of the schema changes made to one content type or component. */
export function SchemaHistory({ targetId }: { targetId: string }) {
  const ws = useProject();
  const changes = useQuery({
    queryKey: ['schema-changes', ws.environment.id, targetId],
    queryFn: () => api.get<Page<SchemaChangeRow>>(`${ws.envBase}/schema/changes`, { targetId, pageSize: 50 }),
  });

  return (
    <Paper sx={{ borderRadius: '10px', overflow: 'hidden' }}>
      {changes.isLoading ? (
        <TableSkeleton rows={4} columns={3} />
      ) : changes.isError ? (
        <ErrorState compact error={changes.error} onRetry={() => void changes.refetch()} />
      ) : (changes.data?.items.length ?? 0) === 0 ? (
        <EmptyState compact icon={<HistoryOutlined />} title="No changes recorded yet" description="Every saved change to this schema is listed here with who made it." />
      ) : (
        <Box component="ol" sx={{ listStyle: 'none', m: 0, p: 0 }}>
          {changes.data?.items.map((change) => (
            <Stack component="li" key={change.id} direction="row" spacing={3} sx={{ px: 5, py: 3, alignItems: 'center', '&:not(:last-of-type)': { borderBottom: 1, borderColor: 'border.subtle' } }}>
              <UserAvatar name={change.userName ?? 'System'} size={26} />
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography variant="body2" sx={{ fontWeight: 500, overflowWrap: 'anywhere' }}>
                  {change.summary.charAt(0).toUpperCase() + change.summary.slice(1)}
                </Typography>
                <Typography variant="caption" color="text.secondary" component="div">
                  {change.userName ?? 'System'} · <RelativeTime value={change.createdAt} />
                </Typography>
              </Box>
              <Pill label={`v${change.version}`} />
            </Stack>
          ))}
        </Box>
      )}
    </Paper>
  );
}

const METHOD_TONE: Record<string, { fg: string; bg: string }> = {
  GET: { fg: 'success.dark', bg: 'success.light' },
  POST: { fg: 'info.dark', bg: 'info.light' },
  PUT: { fg: 'warning.dark', bg: 'warning.light' },
  PATCH: { fg: 'warning.dark', bg: 'warning.light' },
  DELETE: { fg: 'error.dark', bg: 'error.light' },
};

export interface Endpoint {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  description: string;
  access: string;
}

export function EndpointList({ endpoints, baseUrl }: { endpoints: Endpoint[]; baseUrl: string }) {
  return (
    <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
      {endpoints.map((endpoint) => (
        <Stack
          component="li"
          key={`${endpoint.method} ${endpoint.path}`}
          direction={{ xs: 'column', sm: 'row' }}
          spacing={{ xs: 1, sm: 3 }}
          sx={{ px: 5, py: 2.5, alignItems: { sm: 'center' }, '&:not(:last-of-type)': { borderBottom: 1, borderColor: 'border.subtle' } }}
        >
          <Box sx={{ width: 64, flexShrink: 0 }}>
            <Pill label={endpoint.method} fg={METHOD_TONE[endpoint.method].fg} bg={METHOD_TONE[endpoint.method].bg} />
          </Box>
          <Mono sx={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere', fontSize: '0.8125rem' }}>{endpoint.path}</Mono>
          <Typography variant="caption" color="text.secondary" sx={{ flex: 1, minWidth: 0 }}>
            {endpoint.description} · {endpoint.access}
          </Typography>
          <CopyButton value={`${baseUrl}${endpoint.path}`} label="Copy URL" />
        </Stack>
      ))}
    </Box>
  );
}

/** Bordered block for irreversible actions. */
export function DangerZone({ title, description, action }: { title: string; description: ReactNode; action: ReactNode }) {
  return (
    <Paper sx={{ borderRadius: '10px', borderColor: 'error.main', p: 5 }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={4} sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h5" component="h2">
            {title}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, maxWidth: 620 }}>
            {description}
          </Typography>
        </Box>
        <Box sx={{ flexShrink: 0 }}>{action}</Box>
      </Stack>
    </Paper>
  );
}
