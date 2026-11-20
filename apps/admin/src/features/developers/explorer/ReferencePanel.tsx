import { useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import ChevronRightOutlined from '@mui/icons-material/ChevronRightOutlined';
import ExpandMoreOutlined from '@mui/icons-material/ExpandMoreOutlined';
import FileDownloadOutlined from '@mui/icons-material/FileDownloadOutlined';
import SearchOffOutlined from '@mui/icons-material/SearchOffOutlined';
import { CopyButton, EmptyState, Mono, Pill, SearchInput } from '@/components/ui';
import { API_URL } from '@/lib/api';
import { toast } from '@/store';
import { FONT_MONO } from '@/theme/theme';
import { MethodBadge } from '../shared';
import { type OpenApiDocument, type OpenApiSchema, type Operation, groupOperations, paramType, schemaName } from './openapi';

const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function downloadDocument(doc: OpenApiDocument) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'openapi.json';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

const firstSchema = (content: Record<string, { schema?: OpenApiSchema }> | undefined) => (content ? Object.values(content)[0]?.schema : undefined);

const propertyType = (schema: OpenApiSchema): string => {
  if (schema.enum) return schema.enum.filter((v) => v !== null).join(' | ');
  return schemaName(schema) || 'any';
};

function OperationCard({ operation }: { operation: Operation }) {
  const body = schemaName(firstSchema(operation.raw.requestBody?.content));
  const responses = Object.entries(operation.raw.responses ?? {});
  return (
    <Paper component="article" aria-label={`${operation.method} ${operation.path}`} sx={{ borderRadius: '10px', overflow: 'hidden' }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={{ xs: 1.5, sm: 2.5 }} sx={{ px: 4, py: 3, alignItems: { sm: 'center' }, borderBottom: 1, borderColor: 'border.subtle' }}>
        <Stack direction="row" spacing={2} sx={{ alignItems: 'center', minWidth: 0 }}>
          <MethodBadge method={operation.method} />
          <Box component="code" sx={{ fontFamily: FONT_MONO, fontSize: '0.8125rem', fontWeight: 600, overflowWrap: 'anywhere' }}>
            {operation.path}
          </Box>
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ flex: 1, minWidth: 0 }}>
          {operation.summary}
        </Typography>
        {operation.public ? <Pill label="No API key" title="Authorised by a signed preview token instead of an API key" /> : operation.method !== 'GET' && operation.path !== '/graphql' ? <Pill label="Read/write key" fg="warning.dark" bg="warning.light" /> : null}
      </Stack>

      {operation.parameters.length > 0 ? (
        <TableContainer>
          <Table size="small" aria-label={`Parameters of ${operation.method} ${operation.path}`}>
            <TableHead>
              <TableRow>
                <TableCell sx={{ width: 180 }}>Parameter</TableCell>
                <TableCell sx={{ width: 80 }}>In</TableCell>
                <TableCell sx={{ width: 200 }}>Type</TableCell>
                <TableCell>Description</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {operation.parameters.map((param) => (
                <TableRow key={`${param.in}:${param.name}`}>
                  <TableCell sx={{ verticalAlign: 'top' }}>
                    <Mono sx={{ fontWeight: 600 }}>{param.name === 'filter' ? 'filter[field][op]' : param.name}</Mono>
                    {param.required && (
                      <Typography variant="caption" color="text.secondary" component="div">
                        Required
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell sx={{ verticalAlign: 'top', color: 'text.secondary' }}>{param.in}</TableCell>
                  <TableCell sx={{ verticalAlign: 'top' }}>
                    <Mono sx={{ color: 'text.secondary', overflowWrap: 'anywhere' }}>{paramType(param)}</Mono>
                    {param.schema?.default !== undefined && (
                      <Typography variant="caption" color="text.secondary" component="div">
                        Default {String(param.schema.default)}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell sx={{ verticalAlign: 'top', color: 'text.secondary' }}>{param.description ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      ) : (
        <Typography variant="body2" color="text.secondary" sx={{ px: 4, py: 3 }}>
          This operation takes no parameters.
        </Typography>
      )}

      {(body || responses.length > 0) && (
        <Stack direction="row" sx={{ px: 4, py: 2.5, gap: 2, flexWrap: 'wrap', alignItems: 'center', borderTop: 1, borderColor: 'border.subtle', bgcolor: 'surface.subtle' }}>
          {body && (
            <Typography variant="caption" color="text.secondary">
              Body <Mono>{body}</Mono>
            </Typography>
          )}
          {responses.map(([status, response]) => {
            const shape = schemaName(firstSchema(response.content));
            return (
              <Typography key={status} variant="caption" color="text.secondary">
                <Mono sx={{ fontWeight: 600, color: 'text.primary' }}>{status}</Mono> {response.description ?? ''}
                {shape ? (
                  <>
                    {' '}
                    <Mono>{shape}</Mono>
                  </>
                ) : null}
              </Typography>
            );
          })}
        </Stack>
      )}
    </Paper>
  );
}

function SchemaRow({ name, schema }: { name: string; schema: OpenApiSchema }) {
  const [open, setOpen] = useState(false);
  const properties = Object.entries(schema.properties ?? {});
  const panelId = `openapi-schema-${slug(name)}`;
  return (
    <Box component="li" sx={{ '&:not(:last-of-type)': { borderBottom: 1, borderColor: 'border.subtle' } }}>
      <ButtonBase onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls={panelId} sx={{ width: '100%', justifyContent: 'flex-start', gap: 2, px: 4, py: 2.5, textAlign: 'left', '&:hover': { bgcolor: 'action.hover' } }}>
        {open ? <ExpandMoreOutlined sx={{ fontSize: 16, color: 'text.secondary' }} /> : <ChevronRightOutlined sx={{ fontSize: 16, color: 'text.secondary' }} />}
        <Mono sx={{ fontWeight: 600, flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{name}</Mono>
        <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
          {properties.length > 0 ? `${properties.length} propert${properties.length === 1 ? 'y' : 'ies'}` : propertyType(schema)}
        </Typography>
      </ButtonBase>
      {open && (
        <Box id={panelId} sx={{ px: 4, pb: 3 }}>
          {schema.description && (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {schema.description}
            </Typography>
          )}
          {properties.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No named properties — the value is {propertyType(schema) || 'free-form'}.
            </Typography>
          ) : (
            <Box sx={{ border: 1, borderColor: 'border.subtle', borderRadius: '8px', overflow: 'auto' }}>
              <Table size="small" aria-label={`Properties of ${name}`}>
                <TableBody>
                  {properties.map(([property, definition]) => (
                    <TableRow key={property}>
                      <TableCell sx={{ width: 220, verticalAlign: 'top' }}>
                        <Mono sx={{ fontWeight: 600 }}>{property}</Mono>
                      </TableCell>
                      <TableCell sx={{ width: 220, verticalAlign: 'top' }}>
                        <Mono sx={{ color: 'text.secondary', overflowWrap: 'anywhere' }}>{propertyType(definition)}</Mono>
                      </TableCell>
                      <TableCell sx={{ verticalAlign: 'top', color: 'text.secondary' }}>{definition.description ?? ''}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
}

export function ReferencePanel({ doc, operations }: { doc: OpenApiDocument; operations: Operation[] }) {
  const [search, setSearch] = useState('');
  const groups = useMemo(() => groupOperations(doc, operations), [doc, operations]);
  const descriptions = useMemo(() => new Map((doc.tags ?? []).map((tag) => [tag.name, tag.description])), [doc.tags]);
  const schemas = useMemo(() => Object.entries(doc.components?.schemas ?? {}), [doc.components?.schemas]);

  const term = search.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!term) return groups;
    return groups
      .map((group) => ({
        ...group,
        operations: group.operations.filter((op) => `${op.method} ${op.path} ${op.summary} ${group.tag} ${op.parameters.map((p) => p.name).join(' ')}`.toLowerCase().includes(term)),
      }))
      .filter((group) => group.operations.length > 0);
  }, [groups, term]);
  const filteredSchemas = useMemo(() => (term ? schemas.filter(([name]) => name.toLowerCase().includes(term)) : schemas), [schemas, term]);
  const shown = filtered.reduce((n, group) => n + group.operations.length, 0);

  const download = () => {
    try {
      downloadDocument(doc);
      toast.success('openapi.json downloaded');
    } catch {
      toast.error('The document could not be downloaded');
    }
  };

  return (
    <Stack spacing={5}>
      <Paper sx={{ borderRadius: '10px', p: 4 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={3} sx={{ alignItems: { md: 'center' }, justifyContent: 'space-between' }}>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="h5" component="h2">
              {doc.info.title}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              OpenAPI {doc.openapi} · version {doc.info.version} · {operations.length} operation{operations.length === 1 ? '' : 's'} · {schemas.length} schema{schemas.length === 1 ? '' : 's'}
            </Typography>
            <Stack direction="row" spacing={1} sx={{ mt: 1.5, alignItems: 'center', minWidth: 0 }}>
              <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
                Base URL
              </Typography>
              <Mono sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{API_URL}/api/v1</Mono>
              <CopyButton value={`${API_URL}/api/v1`} label="Copy base URL" />
            </Stack>
          </Box>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ flexShrink: 0, alignItems: { sm: 'center' } }}>
            <SearchInput value={search} onChange={setSearch} placeholder="Filter the reference…" />
            <Button variant="outlined" startIcon={<FileDownloadOutlined />} onClick={download} sx={{ flexShrink: 0 }}>
              Download openapi.json
            </Button>
          </Stack>
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 3, maxWidth: 760 }}>
          Every request carries <Mono>Authorization: Bearer &lt;API key&gt;</Mono>. The key decides the project and environment, and whether drafts or writes are allowed. Import the document into Postman, Insomnia or an OpenAPI generator to
          produce a typed client.
        </Typography>
      </Paper>

      {shown === 0 && filteredSchemas.length === 0 ? (
        <Paper sx={{ borderRadius: '10px' }}>
          <EmptyState compact icon={<SearchOffOutlined />} title="Nothing matches" description={`No operation or schema matches “${search.trim()}”.`} action={<Button onClick={() => setSearch('')}>Clear filter</Button>} />
        </Paper>
      ) : (
        <>
          {filtered.map((group) => (
            <Box key={group.tag} component="section" aria-labelledby={`reference-${slug(group.tag)}`}>
              <Stack direction="row" spacing={2} sx={{ alignItems: 'baseline', mb: 2.5, flexWrap: 'wrap', rowGap: 0.5 }}>
                <Typography variant="h4" component="h3" id={`reference-${slug(group.tag)}`}>
                  {group.tag}
                </Typography>
                {descriptions.get(group.tag) && (
                  <Typography variant="body2" color="text.secondary">
                    {descriptions.get(group.tag)}
                  </Typography>
                )}
              </Stack>
              <Stack spacing={3}>
                {group.operations.map((operation) => (
                  <OperationCard key={operation.id} operation={operation} />
                ))}
              </Stack>
            </Box>
          ))}

          {filteredSchemas.length > 0 && (
            <Box component="section" aria-labelledby="reference-schemas">
              <Stack direction="row" spacing={2} sx={{ alignItems: 'baseline', mb: 2.5, flexWrap: 'wrap', rowGap: 0.5 }}>
                <Typography variant="h4" component="h3" id="reference-schemas">
                  Schemas
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  The shapes used in request and response bodies.
                </Typography>
              </Stack>
              <Paper sx={{ borderRadius: '10px', overflow: 'hidden' }}>
                <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
                  {filteredSchemas.map(([name, schema]) => (
                    <SchemaRow key={name} name={name} schema={schema} />
                  ))}
                </Box>
              </Paper>
            </Box>
          )}
        </>
      )}
    </Stack>
  );
}
