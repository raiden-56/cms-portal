import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import ChevronRightOutlined from '@mui/icons-material/ChevronRightOutlined';
import ExpandMoreOutlined from '@mui/icons-material/ExpandMoreOutlined';
import PlayArrowOutlined from '@mui/icons-material/PlayArrowOutlined';
import RestartAltOutlined from '@mui/icons-material/RestartAltOutlined';
import SchemaOutlined from '@mui/icons-material/SchemaOutlined';
import { PAGE_TYPE_ID } from '@meridian/shared';
import { EmptyState, ErrorState, Mono, Pill, SearchInput, TableSkeleton } from '@/components/ui';
import { API_URL, deliveryFetch, errorMessage } from '@/lib/api';
import type { SchemaResponse } from '@/lib/types';
import { CodeEditor, JsonEditor } from '@/features/fields/CodeEditor';
import { FONT_MONO } from '@/theme/theme';
import { type SnippetItem, Snippets } from '../shared';
import { type GraphqlTypeRef, describeGraphql, graphqlQueryFor, starterGraphqlQuery } from '../snippets';
import { type Probe, ResponseBody, ResponseHeaders, ResponseSummary } from './parts';

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** Variables that make a starter query runnable as it stands. */
const variablesFor = (query: string): Record<string, unknown> => (/\$limit\b/.test(query) ? { limit: 5 } : {});

/** The starter query for the first collection the team created, falling back to pages. */
function starterFor(schema: SchemaResponse | undefined, refs: GraphqlTypeRef[]): string {
  const first = schema?.types.find((t) => !t.isSystem && t.kind === 'COLLECTION');
  const ref = first ? refs.find((r) => r.apiId === first.apiId) : undefined;
  return ref ? graphqlQueryFor(ref) : starterGraphqlQuery(schema);
}

/** The current GraphQL request as copyable code. Keys are always read from the environment. */
function graphqlSnippets(query: string, variables: Record<string, unknown>, apiUrl: string): SnippetItem[] {
  const hasVariables = Object.keys(variables).length > 0;
  const payload = JSON.stringify(hasVariables ? { query, variables } : { query });
  const template = query.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
  const variablesLiteral = JSON.stringify(variables);

  const curl = [
    `curl -X POST "${apiUrl}/api/v1/graphql"`,
    '  -H "Authorization: Bearer $MERIDIAN_API_KEY"',
    '  -H "Content-Type: application/json"',
    `  -d '${payload.replace(/'/g, "'\\''")}'`,
  ].join(' \\\n');

  const javascript = `const query = /* GraphQL */ \`
${template}
\`;

const response = await fetch('${apiUrl}/api/v1/graphql', {
  method: 'POST',
  headers: {
    Authorization: \`Bearer \${process.env.MERIDIAN_API_KEY}\`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ query${hasVariables ? `, variables: ${variablesLiteral}` : ''} }),
});

// GraphQL reports problems in "errors", usually with HTTP 200.
const { data, errors } = await response.json();
if (errors?.length) throw new Error(errors[0].message);`;

  const sdk = `import { createCMSClient } from '@meridian/sdk';

const cms = createCMSClient({
  baseURL: process.env.MERIDIAN_URL!,
  apiKey: process.env.MERIDIAN_API_KEY!,
});

// Resolves to the "data" object and throws MeridianError when the response has errors.
const data = await cms.graphql(
  /* GraphQL */ \`
${template}
\`,${hasVariables ? `\n  ${variablesLiteral},` : ''}
);`;

  return [
    { label: 'cURL', language: 'bash', code: curl },
    { label: 'JavaScript', language: 'javascript', code: javascript },
    { label: 'TypeScript (SDK)', language: 'typescript', code: sdk },
  ];
}

function signatures(ref: GraphqlTypeRef): string[] {
  if (ref.single || !ref.listField) return [`${ref.itemField}(locale): ${ref.typeName}`];
  return [
    `${ref.listField}(limit, offset, sort, filter, search, locale): ${ref.typeName}Connection!`,
    `${ref.itemField}(id, slug, ${ref.apiId === PAGE_TYPE_ID ? 'path, ' : ''}locale): ${ref.typeName}`,
  ];
}

function TypeReference({ type, open, onToggle, onInsert }: { type: GraphqlTypeRef; open: boolean; onToggle: () => void; onInsert: () => void }) {
  const panelId = `graphql-type-${type.apiId}`;
  return (
    <Box component="li" sx={{ '&:not(:last-of-type)': { borderBottom: 1, borderColor: 'border.subtle' } }}>
      <ButtonBase
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={panelId}
        sx={{ width: '100%', justifyContent: 'flex-start', gap: 1.5, px: 2.5, py: 2, textAlign: 'left', '&:hover': { bgcolor: 'action.hover' } }}
      >
        {open ? <ExpandMoreOutlined sx={{ fontSize: 16, color: 'text.secondary' }} /> : <ChevronRightOutlined sx={{ fontSize: 16, color: 'text.secondary' }} />}
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Box component="span" sx={{ display: 'block', fontFamily: FONT_MONO, fontSize: '0.75rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{type.typeName}</Box>
          <Typography variant="caption" color="text.secondary" noWrap component="span" sx={{ display: 'block' }}>
            {type.displayName} · {type.fields.length} fields
          </Typography>
        </Box>
        {type.single && <Pill label="Single" />}
      </ButtonBase>
      {open && (
        <Box id={panelId} sx={{ px: 2.5, pb: 3 }}>
          <Typography variant="caption" color="text.secondary" component="div" sx={{ fontWeight: 600, mb: 1 }}>
            Query fields
          </Typography>
          <Stack spacing={1} sx={{ mb: 2.5 }}>
            {signatures(type).map((signature) => (
              <Mono key={signature} sx={{ display: 'block', overflowWrap: 'anywhere', color: 'text.secondary' }}>
                {signature}
              </Mono>
            ))}
          </Stack>
          <Typography variant="caption" color="text.secondary" component="div" sx={{ fontWeight: 600, mb: 1 }}>
            Fields
          </Typography>
          <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0, mb: 2.5 }}>
            {type.fields.map((field) => (
              <Tooltip key={field.name} title={field.description ?? ''} placement="right" enterDelay={400}>
                <Stack component="li" direction="row" spacing={2} sx={{ justifyContent: 'space-between', alignItems: 'baseline', py: 0.75 }}>
                  <Mono sx={{ overflowWrap: 'anywhere' }}>{field.name}</Mono>
                  <Mono sx={{ color: 'text.secondary', flexShrink: 0 }}>{field.type}</Mono>
                </Stack>
              </Tooltip>
            ))}
          </Box>
          <Button size="small" variant="outlined" onClick={onInsert}>
            Use a starter query
          </Button>
        </Box>
      )}
    </Box>
  );
}

export function GraphqlPanel({
  schema,
  schemaLoading,
  schemaError,
  onRetrySchema,
  apiKey,
}: {
  schema: SchemaResponse | undefined;
  schemaLoading: boolean;
  schemaError: unknown;
  onRetrySchema: () => void;
  apiKey: string;
}) {
  const refs = useMemo(() => (schema ? describeGraphql(schema) : []), [schema]);
  const starter = useMemo(() => starterFor(schema, refs), [schema, refs]);

  const [query, setQuery] = useState(starter);
  const [variables, setVariables] = useState<unknown>(() => variablesFor(starter));
  const [variablesValid, setVariablesValid] = useState(true);
  const [response, setResponse] = useState<Probe | null>(null);
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [view, setView] = useState<'response' | 'headers' | 'code'>('response');
  const [search, setSearch] = useState('');
  const [openType, setOpenType] = useState<string | null>(null);
  const edited = useRef(false);

  // The content model may arrive after the first render; seed the editor unless the user already typed.
  useEffect(() => {
    if (edited.current) return;
    setQuery(starter);
    setVariables(variablesFor(starter));
  }, [starter]);

  const filteredTypes = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return refs;
    return refs.filter((r) => `${r.typeName} ${r.displayName} ${r.apiId} ${r.listField ?? ''} ${r.itemField} ${r.fields.map((f) => f.name).join(' ')}`.toLowerCase().includes(term));
  }, [refs, search]);

  const variablesObject = variables === null || variables === undefined ? {} : variables;
  const variablesAreObject = isRecord(variablesObject);
  const isMutation = /^\s*mutation\b/m.test(query);
  const blocked = !apiKey || !query.trim() || !variablesValid || !variablesAreObject;

  const run = async () => {
    if (blocked || sending) return;
    setSending(true);
    setFailure(null);
    try {
      const result = await deliveryFetch('/graphql', apiKey, { method: 'POST', body: { query, variables: variablesObject } });
      setResponse(result);
      setView('response');
    } catch (err) {
      setResponse(null);
      setFailure(`The request could not be sent: ${errorMessage(err)}`);
    } finally {
      setSending(false);
    }
  };

  const load = (next: string) => {
    edited.current = true;
    setQuery(next);
    setVariables(variablesFor(next));
    setVariablesValid(true);
    setResponse(null);
    setFailure(null);
  };

  // Ctrl/Cmd + Enter runs the query from inside either editor.
  const onShortcut = (event: KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      void run();
    }
  };

  const graphqlErrors = response && isRecord(response.body) && Array.isArray(response.body.errors) ? (response.body.errors as { message?: unknown }[]) : [];

  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '280px minmax(0, 1fr)' }, gap: 4, alignItems: 'start' }}>
      {/* Schema reference */}
      <Paper sx={{ borderRadius: '10px', overflow: 'hidden', order: { xs: 2, lg: 0 }, position: { lg: 'sticky' }, top: { lg: 16 } }}>
        <Box sx={{ px: 3.5, pt: 3, pb: 2.5, borderBottom: 1, borderColor: 'border.subtle' }}>
          <Typography variant="h5" component="h2" sx={{ mb: 0.5 }}>
            Schema reference
          </Typography>
          <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 0, mb: 2 }}>
            Generated from the content model of this environment.
          </Typography>
          <SearchInput value={search} onChange={setSearch} placeholder="Find a type or field…" width="100%" />
        </Box>
        <Box sx={{ maxHeight: { xs: 360, lg: 'calc(100vh - 420px)' }, minHeight: 160, overflowY: 'auto' }}>
          {schemaLoading ? (
            <TableSkeleton rows={6} columns={2} />
          ) : schemaError ? (
            <ErrorState compact error={schemaError} onRetry={onRetrySchema} />
          ) : refs.length === 0 ? (
            <EmptyState compact icon={<SchemaOutlined />} title="No types yet" description="Create a content type and its GraphQL type appears here." />
          ) : filteredTypes.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ p: 5, textAlign: 'center' }}>
              Nothing matches “{search.trim()}”
            </Typography>
          ) : (
            <Box component="ul" aria-label="GraphQL types" sx={{ listStyle: 'none', m: 0, p: 0 }}>
              {filteredTypes.map((type) => (
                <TypeReference
                  key={type.apiId}
                  type={type}
                  open={openType === type.apiId}
                  onToggle={() => setOpenType((current) => (current === type.apiId ? null : type.apiId))}
                  onInsert={() => load(graphqlQueryFor(type))}
                />
              ))}
            </Box>
          )}
        </Box>
        <Box sx={{ px: 3.5, py: 2.5, borderTop: 1, borderColor: 'border.subtle', bgcolor: 'surface.subtle' }}>
          <Typography variant="caption" color="text.secondary" component="p" sx={{ m: 0 }}>
            Lists return a connection with <Mono>items</Mono>, <Mono>total</Mono>, <Mono>limit</Mono> and <Mono>offset</Mono>. Media fields select <Mono>url</Mono>, <Mono>alt</Mono>, <Mono>width</Mono> and{' '}
            <Mono>height</Mono>. Read/write keys also get create, update, publish, unpublish and delete mutations. Queries may nest up to 10 levels.
          </Typography>
        </Box>
      </Paper>

      {/* Editor and response */}
      <Stack spacing={4} sx={{ minWidth: 0 }}>
        <Paper sx={{ borderRadius: '10px', overflow: 'hidden' }}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ p: 4, borderBottom: 1, borderColor: 'border.subtle', alignItems: { sm: 'center' }, justifyContent: 'space-between' }}>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="h5" component="h2">
                GraphQL query
              </Typography>
              <Stack direction="row" spacing={1.5} sx={{ mt: 1, alignItems: 'center', minWidth: 0 }}>
                <Pill label="POST" />
                <Mono sx={{ color: 'text.secondary', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{API_URL}/api/v1/graphql</Mono>
              </Stack>
            </Box>
            <Stack direction="row" spacing={2} sx={{ flexShrink: 0 }}>
              <Button variant="outlined" startIcon={<RestartAltOutlined />} onClick={() => load(starter)} disabled={query === starter}>
                Reset
              </Button>
              <Tooltip title="Ctrl or ⌘ + Enter">
                <span>
                  <Button variant="contained" endIcon={<PlayArrowOutlined />} onClick={() => void run()} loading={sending} disabled={blocked}>
                    Run
                  </Button>
                </span>
              </Tooltip>
            </Stack>
          </Stack>

          <Box sx={{ p: 4, display: 'grid', gridTemplateColumns: { xs: '1fr', xl: 'minmax(0, 3fr) minmax(0, 2fr)' }, gap: 4 }} onKeyDownCapture={onShortcut}>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="subtitle2" sx={{ mb: 1.5 }}>
                Query
              </Typography>
              <CodeEditor
                value={query}
                onChange={(next) => {
                  edited.current = true;
                  setQuery(next);
                }}
                language="graphql"
                minHeight={260}
                maxHeight={460}
                placeholder="{ __typename }"
                ariaLabel="GraphQL query"
              />
            </Box>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="subtitle2" sx={{ mb: 1.5 }}>
                Variables
              </Typography>
              <JsonEditor
                value={variables}
                onChange={(value) => {
                  edited.current = true;
                  setVariables(value);
                }}
                onValidity={setVariablesValid}
                minHeight={120}
                maxHeight={460}
                ariaLabel="GraphQL variables"
              />
              {variablesValid && !variablesAreObject && (
                <Typography variant="caption" color="error" role="alert" sx={{ mt: 1, display: 'block' }}>
                  Variables must be a JSON object, for example {'{ "limit": 5 }'}.
                </Typography>
              )}
              <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1.5, mb: 0 }}>
                Values for the <Mono>$variables</Mono> declared by the query. <Mono>filter</Mono> takes the same shape as the SDK, for example <Mono>{'{ "price": { "gte": 10 } }'}</Mono>.
              </Typography>
            </Box>
          </Box>

          {(!apiKey || isMutation) && (
            <Box sx={{ px: 4, pb: 4 }}>
              {!apiKey && (
                <Typography variant="caption" color="text.secondary" component="div">
                  Add an API key above to run this query.
                </Typography>
              )}
              {isMutation && (
                <Alert severity="warning" sx={{ mt: apiKey ? 0 : 2 }}>
                  Mutations change real content in this environment. They need a read/write key.
                </Alert>
              )}
            </Box>
          )}
        </Paper>

        <Paper sx={{ borderRadius: '10px', overflow: 'hidden' }}>
          <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', pr: 4, borderBottom: 1, borderColor: 'border.subtle', flexWrap: 'wrap' }}>
            <Tabs value={view} onChange={(_, next) => setView(next)} sx={{ borderBottom: 0, px: 2 }} aria-label="GraphQL result">
              <Tab value="response" label="Response" />
              <Tab value="headers" label={`Headers${response ? ` (${Object.keys(response.headers).length})` : ''}`} />
              <Tab value="code" label="Code" />
            </Tabs>
            {response && <ResponseSummary probe={response} />}
          </Stack>
          <Box sx={{ p: 4 }}>
            {failure && (
              <Alert severity="error" sx={{ mb: 3 }}>
                {failure}
              </Alert>
            )}
            {view !== 'code' && graphqlErrors.length > 0 && (
              <Alert severity="error" sx={{ mb: 3 }}>
                <Box component="ul" sx={{ m: 0, pl: 4 }}>
                  {graphqlErrors.map((error, index) => (
                    <li key={index}>{typeof error?.message === 'string' ? error.message : 'The query returned an error'}</li>
                  ))}
                </Box>
              </Alert>
            )}
            {view === 'code' ? (
              <Snippets items={graphqlSnippets(query, variablesAreObject ? variablesObject : {}, API_URL)} maxHeight={460} />
            ) : !response ? (
              <EmptyState compact icon={<PlayArrowOutlined />} title="No response yet" description="Run the query to see the live response from the delivery API." />
            ) : view === 'headers' ? (
              <ResponseHeaders probe={response} />
            ) : (
              <ResponseBody probe={response} />
            )}
          </Box>
        </Paper>
      </Stack>
    </Box>
  );
}
