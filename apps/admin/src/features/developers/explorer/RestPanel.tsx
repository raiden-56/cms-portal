import { useEffect, useMemo, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import AddOutlined from '@mui/icons-material/AddOutlined';
import CheckOutlined from '@mui/icons-material/CheckOutlined';
import ContentCopyOutlined from '@mui/icons-material/ContentCopyOutlined';
import DeleteOutlineOutlined from '@mui/icons-material/DeleteOutlineOutlined';
import SendOutlined from '@mui/icons-material/SendOutlined';
import { EmptyState, SearchInput, useCopy } from '@/components/ui';
import { API_URL, deliveryFetch, errorMessage } from '@/lib/api';
import type { SchemaResponse } from '@/lib/types';
import { JsonEditor } from '@/features/fields/CodeEditor';
import { FONT_MONO } from '@/theme/theme';
import { MethodBadge, Snippets } from '../shared';
import { type RequestFilter, type RequestSpec, curlSnippet, enc, requestPath, requestSnippets } from '../snippets';
import { type OpenApiDocument, type Operation, groupOperations, sampleBody } from './openapi';
import { type Probe, ResponseBody, ResponseHeaders, ResponseSummary } from './parts';

const FILTER_OPS = [
  { value: 'eq', label: 'equals' },
  { value: 'ne', label: 'not equal' },
  { value: 'gt', label: 'greater than' },
  { value: 'gte', label: 'at least' },
  { value: 'lt', label: 'less than' },
  { value: 'lte', label: 'at most' },
  { value: 'contains', label: 'contains' },
  { value: 'startsWith', label: 'starts with' },
  { value: 'in', label: 'is one of' },
  { value: 'nin', label: 'is none of' },
  { value: 'null', label: 'is empty' },
];
const SYSTEM_FILTER_FIELDS = ['id', 'title', 'slug', 'createdAt', 'updatedAt', 'publishedAt'];

interface DraftRequest {
  path: Record<string, string>;
  query: Record<string, string>;
  filters: RequestFilter[];
  body: unknown;
}

export function RestPanel({
  doc,
  operations,
  schema,
  apiKey,
  onOpenGraphql,
}: {
  doc: OpenApiDocument;
  operations: Operation[];
  schema: SchemaResponse | undefined;
  apiKey: string;
  onOpenGraphql: () => void;
}) {
  const groups = useMemo(() => groupOperations(doc, operations), [doc, operations]);
  const [search, setSearch] = useState('');
  const initial = useMemo(() => operations.find((op) => op.method === 'GET' && !op.path.includes('{') && !['/pages', '/preview'].includes(op.path)) ?? operations[0], [operations]);
  const [selectedId, setSelectedId] = useState(initial?.id ?? '');
  const operation = operations.find((op) => op.id === selectedId) ?? initial;
  const type = schema?.types.find((t) => t.apiId === operation?.path.split('/')[1]);

  const blank = (op: Operation | undefined): DraftRequest => ({
    path: {},
    query: {},
    filters: [],
    body: op?.hasBody ? sampleBody(schema?.types.find((t) => t.apiId === op.path.split('/')[1]), op.method) : undefined,
  });
  const [draft, setDraft] = useState<DraftRequest>(() => blank(initial));
  const [bodyValid, setBodyValid] = useState(true);
  const [response, setResponse] = useState<Probe | null>(null);
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [view, setView] = useState<'response' | 'headers' | 'code'>('response');
  const [copied, copy] = useCopy();

  // Each endpoint starts from a clean request; a previous endpoint's answer would be misleading.
  useEffect(() => {
    setDraft(blank(operation));
    setResponse(null);
    setFailure(null);
    setBodyValid(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [operation?.id]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return groups;
    return groups
      .map((g) => ({ ...g, operations: g.operations.filter((op) => `${op.method} ${op.path} ${op.summary} ${g.tag}`.toLowerCase().includes(term)) }))
      .filter((g) => g.operations.length > 0);
  }, [groups, search]);

  if (!operation) {
    return (
      <Paper sx={{ borderRadius: '10px' }}>
        <EmptyState title="No endpoints yet" description="Create a content type and its endpoints appear here automatically." />
      </Paper>
    );
  }

  const pathParams = operation.parameters.filter((p) => p.in === 'path');
  const queryParams = operation.parameters.filter((p) => p.in === 'query' && p.name !== 'filter');
  const supportsFilters = operation.parameters.some((p) => p.name === 'filter');
  const missingPath = pathParams.filter((p) => !draft.path[p.name]?.trim()).map((p) => p.name);
  const resolvedPath = operation.path.replace(/\{(\w+)\}/g, (_, name: string) => (draft.path[name]?.trim() ? enc(draft.path[name].trim()) : `{${name}}`));
  const spec: RequestSpec = { method: operation.method, path: resolvedPath, params: draft.query, filters: draft.filters, body: operation.hasBody ? draft.body : undefined };
  const url = `${API_URL}/api/v1${requestPath(spec)}`;
  const filterFields = [...SYSTEM_FILTER_FIELDS, ...(type?.fields.filter((f) => !f.config.private && f.type !== 'password' && !SYSTEM_FILTER_FIELDS.includes(f.apiId)).map((f) => f.apiId) ?? [])];
  const needsKey = !operation.public && !apiKey;
  const blocked = needsKey || missingPath.length > 0 || (operation.hasBody && !bodyValid);

  const send = async () => {
    setSending(true);
    setFailure(null);
    try {
      const result = await deliveryFetch(requestPath(spec), apiKey, { method: operation.method, body: operation.hasBody ? draft.body : undefined });
      setResponse(result);
      setView('response');
    } catch (err) {
      setResponse(null);
      setFailure(`The request could not be sent: ${errorMessage(err)}`);
    } finally {
      setSending(false);
    }
  };

  const setQuery = (name: string, value: string) => setDraft((d) => ({ ...d, query: { ...d.query, [name]: value } }));
  const setFilter = (index: number, patch: Partial<RequestFilter>) => setDraft((d) => ({ ...d, filters: d.filters.map((f, i) => (i === index ? { ...f, ...patch } : f)) }));

  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '280px minmax(0, 1fr)' }, gap: 4, alignItems: 'start' }}>
      {/* Endpoint browser */}
      <Paper sx={{ borderRadius: '10px', overflow: 'hidden', position: { lg: 'sticky' }, top: { lg: 16 } }}>
        <Box sx={{ p: 2.5, borderBottom: 1, borderColor: 'border.subtle' }}>
          <SearchInput value={search} onChange={setSearch} placeholder="Find an endpoint…" width="100%" />
        </Box>
        <Box component="nav" aria-label="Endpoints" sx={{ maxHeight: { xs: 280, lg: 'calc(100vh - 330px)' }, minHeight: 160, overflowY: 'auto', p: 1.5 }}>
          {filtered.length === 0 && (
            <Typography variant="body2" color="text.secondary" sx={{ p: 3, textAlign: 'center' }}>
              No endpoint matches “{search.trim()}”
            </Typography>
          )}
          {filtered.map((group) => (
            <Box key={group.tag} sx={{ mb: 2 }}>
              <Typography variant="overline" color="text.disabled" component="div" sx={{ px: 2, py: 1 }}>
                {group.tag}
              </Typography>
              {group.operations.map((op) => {
                const active = op.id === operation.id;
                return (
                  <Tooltip key={op.id} title={op.summary} placement="right" enterDelay={600}>
                    <ButtonBase
                      onClick={() => (op.path === '/graphql' ? onOpenGraphql() : setSelectedId(op.id))}
                      aria-current={active ? 'true' : undefined}
                      sx={{ width: '100%', justifyContent: 'flex-start', gap: 2, px: 2, height: 30, borderRadius: '7px', bgcolor: active ? 'action.selected' : 'transparent', '&:hover': { bgcolor: active ? 'action.selected' : 'action.hover' } }}
                    >
                      <MethodBadge method={op.method} width={46} />
                      <Box component="span" sx={{ fontFamily: FONT_MONO, fontSize: '0.75rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: active ? 'text.primary' : 'text.secondary', fontWeight: active ? 600 : 400 }}>
                        {op.path}
                      </Box>
                    </ButtonBase>
                  </Tooltip>
                );
              })}
            </Box>
          ))}
        </Box>
      </Paper>

      {/* Request builder and response */}
      <Stack spacing={4} sx={{ minWidth: 0 }}>
        <Paper sx={{ borderRadius: '10px', overflow: 'hidden' }}>
          <Box sx={{ p: 4, borderBottom: 1, borderColor: 'border.subtle' }}>
            <Typography variant="h5" component="h2">
              {operation.summary || `${operation.method} ${operation.path}`}
            </Typography>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ mt: 2.5, alignItems: { md: 'center' } }}>
              <Stack direction="row" spacing={2} sx={{ flex: 1, minWidth: 0, alignItems: 'center', border: 1, borderColor: 'border.strong', borderRadius: '7px', bgcolor: 'surface.subtle', px: 2, minHeight: 34 }}>
                <MethodBadge method={operation.method} />
                <Box component="code" sx={{ fontFamily: FONT_MONO, fontSize: '0.75rem', overflowX: 'auto', whiteSpace: 'nowrap', py: 1.5, flex: 1 }} aria-label="Request URL">
                  {url}
                </Box>
              </Stack>
              <Stack direction="row" spacing={2} sx={{ flexShrink: 0 }}>
                <Button variant="outlined" startIcon={copied ? <CheckOutlined /> : <ContentCopyOutlined />} onClick={() => copy(curlSnippet(spec, API_URL))}>
                  {copied ? 'Copied' : 'Copy as cURL'}
                </Button>
                <Button variant="contained" endIcon={<SendOutlined />} onClick={() => void send()} loading={sending} disabled={blocked}>
                  Send
                </Button>
              </Stack>
            </Stack>
            {(needsKey || missingPath.length > 0) && (
              <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 1.5 }}>
                {needsKey ? 'Add an API key above to send this request.' : `Fill in ${missingPath.map((n) => `{${n}}`).join(', ')} to send this request.`}
              </Typography>
            )}
            {operation.method !== 'GET' && (
              <Alert severity="warning" sx={{ mt: 3 }}>
                This request changes real content in this environment. It needs a read/write key.
              </Alert>
            )}
          </Box>

          <Box sx={{ p: 4, display: 'grid', gap: 5 }}>
            {pathParams.length > 0 && (
              <Box>
                <Typography variant="subtitle2" sx={{ mb: 2 }}>
                  Path parameters
                </Typography>
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' }, gap: 3 }}>
                  {pathParams.map((p) => (
                    <TextField
                      key={p.name}
                      label={p.name}
                      required
                      value={draft.path[p.name] ?? ''}
                      onChange={(e) => setDraft((d) => ({ ...d, path: { ...d.path, [p.name]: e.target.value } }))}
                      helperText={p.description ?? (operation.method === 'GET' ? 'Document id or slug' : 'Document id')}
                      slotProps={{ htmlInput: { spellCheck: false, style: { fontFamily: FONT_MONO } } }}
                    />
                  ))}
                </Box>
              </Box>
            )}

            {queryParams.length > 0 && (
              <Box>
                <Typography variant="subtitle2" sx={{ mb: 2 }}>
                  Query parameters
                </Typography>
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))', xl: 'repeat(3, minmax(0, 1fr))' }, gap: 3 }}>
                  {queryParams.map((p) => {
                    const options = p.schema?.enum?.filter((v): v is string => typeof v === 'string');
                    const numeric = p.schema?.type === 'integer' || p.schema?.type === 'number';
                    const common = {
                      label: p.name,
                      value: draft.query[p.name] ?? '',
                      helperText: p.description,
                      onChange: (e: { target: { value: string } }) => setQuery(p.name, e.target.value),
                    };
                    return options?.length ? (
                      <TextField key={p.name} select {...common} slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}>
                        <MenuItem value="">
                          <Typography variant="body2" color="text.disabled">
                            Default{p.schema?.default !== undefined ? ` (${String(p.schema.default)})` : ''}
                          </Typography>
                        </MenuItem>
                        {options.map((o) => (
                          <MenuItem key={o} value={o}>
                            {o}
                          </MenuItem>
                        ))}
                      </TextField>
                    ) : (
                      <TextField
                        key={p.name}
                        {...common}
                        type={numeric ? 'number' : 'text'}
                        placeholder={p.schema?.default !== undefined ? String(p.schema.default) : undefined}
                        slotProps={{ htmlInput: { min: p.schema?.minimum, max: p.schema?.maximum, spellCheck: false }, inputLabel: { shrink: true } }}
                      />
                    );
                  })}
                </Box>
              </Box>
            )}

            {supportsFilters && (
              <Box>
                <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
                  <Box>
                    <Typography variant="subtitle2">Filters</Typography>
                    <Typography variant="caption" color="text.secondary">
                      Each row becomes <code>filter[field][operator]=value</code>. Rows are combined with AND.
                    </Typography>
                  </Box>
                  <Button size="small" startIcon={<AddOutlined />} onClick={() => setDraft((d) => ({ ...d, filters: [...d.filters, { field: filterFields[0] ?? 'id', op: 'eq', value: '' }] }))}>
                    Add filter
                  </Button>
                </Stack>
                <Stack spacing={2}>
                  {draft.filters.map((filter, index) => (
                    <Stack key={index} direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'center' } }}>
                      <TextField select value={filter.field} onChange={(e) => setFilter(index, { field: e.target.value })} sx={{ width: { sm: 200 }, flexShrink: 0 }} slotProps={{ htmlInput: { 'aria-label': `Filter ${index + 1} field` } }}>
                        {filterFields.map((name) => (
                          <MenuItem key={name} value={name}>
                            {name}
                          </MenuItem>
                        ))}
                      </TextField>
                      <TextField select value={filter.op} onChange={(e) => setFilter(index, { op: e.target.value })} sx={{ width: { sm: 160 }, flexShrink: 0 }} slotProps={{ htmlInput: { 'aria-label': `Filter ${index + 1} operator` } }}>
                        {FILTER_OPS.map((op) => (
                          <MenuItem key={op.value} value={op.value}>
                            {op.label}
                          </MenuItem>
                        ))}
                      </TextField>
                      <TextField
                        value={filter.value}
                        onChange={(e) => setFilter(index, { value: e.target.value })}
                        placeholder={filter.op === 'in' || filter.op === 'nin' ? 'a,b,c' : filter.op === 'null' ? 'true or false' : 'Value'}
                        slotProps={{ htmlInput: { 'aria-label': `Filter ${index + 1} value` } }}
                      />
                      <IconButton aria-label={`Remove filter ${index + 1}`} onClick={() => setDraft((d) => ({ ...d, filters: d.filters.filter((_, i) => i !== index) }))}>
                        <DeleteOutlineOutlined />
                      </IconButton>
                    </Stack>
                  ))}
                </Stack>
              </Box>
            )}

            {operation.hasBody && (
              <Box>
                <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                  Request body
                </Typography>
                <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 1.5 }}>
                  {type ? `Prefilled from the fields of ${type.displayName}. ` : ''}
                  Set <code>publish</code> to true to publish in the same call.
                </Typography>
                <JsonEditor value={draft.body} onChange={(value) => setDraft((d) => ({ ...d, body: value }))} onValidity={setBodyValid} minHeight={160} maxHeight={360} ariaLabel="Request body" />
              </Box>
            )}

            {pathParams.length === 0 && queryParams.length === 0 && !supportsFilters && !operation.hasBody && (
              <Typography variant="body2" color="text.secondary">
                This endpoint takes no parameters.
              </Typography>
            )}
          </Box>
        </Paper>

        <Paper sx={{ borderRadius: '10px', overflow: 'hidden' }}>
          <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', pr: 4, borderBottom: 1, borderColor: 'border.subtle', flexWrap: 'wrap' }}>
            <Tabs value={view} onChange={(_, next) => setView(next)} sx={{ borderBottom: 0, px: 2 }}>
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
            {view === 'code' ? (
              <Snippets items={requestSnippets(spec, API_URL)} maxHeight={460} />
            ) : !response ? (
              <EmptyState compact icon={<SendOutlined />} title="No response yet" description="Send the request to see the live response from the delivery API." />
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
