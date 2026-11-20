import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link as RouterLink } from 'react-router-dom';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Typography from '@mui/material/Typography';
import ApiOutlined from '@mui/icons-material/ApiOutlined';
import MenuBookOutlined from '@mui/icons-material/MenuBookOutlined';
import { useCrumbs } from '@/app/shell';
import { useProject, useSchema } from '@/app/workspace';
import { CardSkeleton, CopyButton, EmptyState, ErrorState, Mono, Page, PageHeader, Pill } from '@/components/ui';
import { API_URL, api } from '@/lib/api';
import type { SchemaResponse } from '@/lib/types';
import { GraphqlPanel } from './explorer/GraphqlPanel';
import { type OpenApiDocument, listOperations } from './explorer/openapi';
import { CredentialBar, useExplorerKey } from './explorer/parts';
import { ReferencePanel } from './explorer/ReferencePanel';
import { RestPanel } from './explorer/RestPanel';
import { NoAccess } from './shared';

type ExplorerTab = 'rest' | 'graphql' | 'reference';

const TABS: { value: ExplorerTab; label: string }[] = [
  { value: 'rest', label: 'REST' },
  { value: 'graphql', label: 'GraphQL' },
  { value: 'reference', label: 'Reference' },
];

function ExplorerSkeleton() {
  return (
    <Box aria-busy="true" aria-label="Loading the API description" sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '280px minmax(0, 1fr)' }, gap: 4, alignItems: 'start' }}>
      <CardSkeleton height={420} />
      <Stack spacing={4}>
        <CardSkeleton height={260} />
        <CardSkeleton height={200} />
      </Stack>
    </Box>
  );
}

/**
 * The three tools share one key and one API description. A tool is mounted the first time it is
 * opened and then kept, so a half-built request or a response survives switching tabs.
 */
function Explorer({
  doc,
  schema,
  schemaLoading,
  schemaError,
  onRetrySchema,
  apiKey,
}: {
  doc: OpenApiDocument;
  schema: SchemaResponse | undefined;
  schemaLoading: boolean;
  schemaError: unknown;
  onRetrySchema: () => void;
  apiKey: string;
}) {
  const ws = useProject();
  const operations = useMemo(() => listOperations(doc), [doc]);
  const [tab, setTab] = useState<ExplorerTab>('rest');
  const [opened, setOpened] = useState<Record<ExplorerTab, boolean>>({ rest: true, graphql: false, reference: false });

  const open = (next: ExplorerTab) => {
    setTab(next);
    setOpened((current) => (current[next] ? current : { ...current, [next]: true }));
  };

  if (operations.length === 0) {
    return (
      <Paper sx={{ borderRadius: '10px' }}>
        <EmptyState
          icon={<ApiOutlined />}
          title="No endpoints yet"
          description="Endpoints are generated from the content model. Create a content type and its REST and GraphQL operations appear here automatically."
          action={
            <Button variant="outlined" component={RouterLink} to={ws.href('model/types')}>
              Open content types
            </Button>
          }
        />
      </Paper>
    );
  }

  return (
    <>
      <Stack direction={{ xs: 'column', md: 'row' }} sx={{ mb: 4, gap: { xs: 2, md: 4 }, alignItems: { md: 'center' }, justifyContent: 'space-between', borderBottom: 1, borderColor: 'border.subtle' }}>
        <Tabs value={tab} onChange={(_, next: ExplorerTab) => open(next)} aria-label="API explorer tools" sx={{ borderBottom: 0 }}>
          {TABS.map((item) => (
            <Tab key={item.value} value={item.value} label={item.label} id={`explorer-tab-${item.value}`} aria-controls={`explorer-panel-${item.value}`} />
          ))}
        </Tabs>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', minWidth: 0, pb: { xs: 2, md: 0 } }}>
          <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
            Base URL
          </Typography>
          <Mono sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{API_URL}/api/v1</Mono>
          <CopyButton value={`${API_URL}/api/v1`} label="Copy base URL" />
        </Stack>
      </Stack>

      <Box role="tabpanel" id="explorer-panel-rest" aria-labelledby="explorer-tab-rest" hidden={tab !== 'rest'}>
        {opened.rest && <RestPanel doc={doc} operations={operations} schema={schema} apiKey={apiKey} onOpenGraphql={() => open('graphql')} />}
      </Box>
      <Box role="tabpanel" id="explorer-panel-graphql" aria-labelledby="explorer-tab-graphql" hidden={tab !== 'graphql'}>
        {opened.graphql && <GraphqlPanel schema={schema} schemaLoading={schemaLoading} schemaError={schemaError} onRetrySchema={onRetrySchema} apiKey={apiKey} />}
      </Box>
      <Box role="tabpanel" id="explorer-panel-reference" aria-labelledby="explorer-tab-reference" hidden={tab !== 'reference'}>
        {opened.reference && <ReferencePanel doc={doc} operations={operations} />}
      </Box>
    </>
  );
}

export default function ApiExplorerPage() {
  const ws = useProject();
  const schema = useSchema();
  useCrumbs([]);

  const canRead = ws.can('schema.read');
  const [apiKey, setApiKey] = useExplorerKey(ws.environment.id);
  const openapi = useQuery({
    queryKey: ['openapi', ws.environment.id],
    queryFn: () => api.get<OpenApiDocument>(`${ws.envBase}/openapi`),
    enabled: canRead,
    staleTime: 30_000,
  });

  if (!canRead) return <NoAccess title="the API explorer" what="view the content model" />;

  return (
    <Page width={1440}>
      <PageHeader
        title="API explorer"
        description="Send real requests to the content delivery API of this environment, inspect the responses, and copy working code for your framework."
        meta={<Pill label={ws.environment.name} dot title="Requests are sent to this environment" />}
        actions={
          <Button variant="outlined" startIcon={<MenuBookOutlined />} component={RouterLink} to={ws.href('dev/sdk')}>
            SDK documentation
          </Button>
        }
      />

      <CredentialBar apiKey={apiKey} onChange={setApiKey} />

      {openapi.isPending ? (
        <ExplorerSkeleton />
      ) : openapi.isError ? (
        <Paper sx={{ borderRadius: '10px' }}>
          <ErrorState error={openapi.error} onRetry={() => void openapi.refetch()} />
        </Paper>
      ) : (
        <Explorer
          // A request built for one environment must never be replayed against another.
          key={ws.environment.id}
          doc={openapi.data}
          schema={schema.data}
          schemaLoading={schema.isPending}
          schemaError={schema.error}
          onRetrySchema={() => void schema.refetch()}
          apiKey={apiKey}
        />
      )}
    </Page>
  );
}
