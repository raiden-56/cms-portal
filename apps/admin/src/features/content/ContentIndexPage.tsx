import { useMemo, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import AddOutlined from '@mui/icons-material/AddOutlined';
import ArticleOutlined from '@mui/icons-material/ArticleOutlined';
import ChevronRightOutlined from '@mui/icons-material/ChevronRightOutlined';
import SchemaOutlined from '@mui/icons-material/SchemaOutlined';
import { useProject, useSchema } from '@/app/workspace';
import { IconFor } from '@/components/icons';
import { CardSkeleton, EmptyState, ErrorState, Mono, Page, PageHeader, Pill, RelativeTime, SearchInput } from '@/components/ui';
import { compactNumber } from '@/lib/format';

/** /content — every content type in this environment, as the way into its entries. */
export default function ContentIndexPage() {
  const ws = useProject();
  const schema = useSchema();
  const [search, setSearch] = useState('');
  const types = useMemo(() => (schema.data?.types ?? []).filter((t) => !t.isSystem), [schema.data]);
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? types.filter((t) => `${t.displayName} ${t.apiId} ${t.description}`.toLowerCase().includes(q)) : types;
  }, [types, search]);
  const total = types.reduce((n, t) => n + t.entryCount, 0);

  return (
    <Page width={1120}>
      <PageHeader
        title="Content"
        description={
          types.length > 0
            ? `${compactNumber(total)} ${total === 1 ? 'entry' : 'entries'} across ${types.length} content type${types.length === 1 ? '' : 's'} in ${ws.environment.name}.`
            : 'Entries are organised by content type.'
        }
        actions={
          ws.can('schema.manage') && (
            <Button variant="outlined" startIcon={<SchemaOutlined />} component={RouterLink} to={ws.href('model/types')}>
              Manage content types
            </Button>
          )
        }
      />

      {schema.isLoading ? (
        <Stack spacing={3} aria-busy="true">
          <CardSkeleton count={5} height={68} />
        </Stack>
      ) : schema.isError ? (
        <Paper sx={{ borderRadius: '10px' }}>
          <ErrorState error={schema.error} onRetry={() => void schema.refetch()} />
        </Paper>
      ) : types.length === 0 ? (
        <Paper sx={{ borderRadius: '10px' }}>
          <EmptyState
            icon={<ArticleOutlined />}
            title="No content types yet"
            description={
              ws.can('schema.manage')
                ? 'Content types describe what your content looks like — articles, products, authors. Create one to start adding entries.'
                : 'Someone with access to the content model needs to create a content type before entries can be added.'
            }
            action={
              ws.can('schema.manage') && (
                <Button variant="contained" startIcon={<AddOutlined />} component={RouterLink} to={`${ws.href('model/types')}?new=1`}>
                  Create a content type
                </Button>
              )
            }
          />
        </Paper>
      ) : (
        <>
          {types.length > 6 && (
            <Box sx={{ mb: 4 }}>
              <SearchInput value={search} onChange={setSearch} placeholder="Find a content type…" />
            </Box>
          )}
          <Paper sx={{ borderRadius: '10px', overflow: 'hidden' }}>
            {shown.length === 0 ? (
              <EmptyState compact icon={<ArticleOutlined />} title="No content types match" description={`Nothing matches “${search.trim()}”.`} />
            ) : (
              <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
                {shown.map((type) => {
                  const single = type.kind === 'SINGLE';
                  return (
                    <Box component="li" key={type.id} sx={{ display: 'flex', alignItems: 'stretch', '&:not(:last-of-type)': { borderBottom: 1, borderColor: 'border.subtle' } }}>
                      <ButtonBase
                        component={RouterLink}
                        to={ws.href(`content/${type.apiId}`)}
                        sx={{ flex: 1, minWidth: 0, px: 5, py: 3.5, gap: 4, justifyContent: 'flex-start', textAlign: 'left', color: 'text.primary', textDecoration: 'none !important', transition: 'background-color 120ms', '&:hover': { bgcolor: 'action.hover' } }}
                      >
                        <Box sx={{ width: 36, height: 36, borderRadius: '9px', bgcolor: 'surface.sunken', color: 'text.secondary', display: 'grid', placeItems: 'center', flexShrink: 0, '& svg': { fontSize: 18 } }}>
                          <IconFor name={type.icon} />
                        </Box>
                        <Box sx={{ minWidth: 0, flex: 1 }}>
                          <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
                            <Typography variant="subtitle1" noWrap sx={{ fontWeight: 600 }}>
                              {type.displayName}
                            </Typography>
                            {single && <Pill label="Single" title="Holds exactly one entry" />}
                            {type.options.localized && <Pill label="Localized" />}
                            {type.options.requireApproval && <Pill label="Approval required" fg="info.dark" bg="info.light" />}
                          </Stack>
                          <Typography variant="body2" color="text.secondary" noWrap>
                            {type.description || (
                              <>
                                <Mono>{type.apiId}</Mono> · {type.fields.length} field{type.fields.length === 1 ? '' : 's'}
                              </>
                            )}
                          </Typography>
                        </Box>
                        <Box sx={{ textAlign: 'right', flexShrink: 0, display: { xs: 'none', sm: 'block' } }}>
                          <Typography variant="subtitle2" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                            {single ? (type.entryCount > 0 ? 'Filled in' : 'Empty') : compactNumber(type.entryCount)}
                          </Typography>
                          <Typography variant="caption" color="text.secondary" component="div">
                            {single ? (
                              <>
                                updated <RelativeTime value={type.updatedAt} />
                              </>
                            ) : type.entryCount === 1 ? (
                              'entry'
                            ) : (
                              'entries'
                            )}
                          </Typography>
                        </Box>
                        <ChevronRightOutlined sx={{ fontSize: 18, color: 'text.disabled', flexShrink: 0 }} />
                      </ButtonBase>
                      {!single && ws.can('content.create') && (
                        <Box sx={{ display: { xs: 'none', md: 'flex' }, alignItems: 'center', pr: 4, borderLeft: 1, borderColor: 'border.subtle', pl: 4 }}>
                          <Tooltip title={`New ${type.singularName.toLowerCase()}`}>
                            <Button size="small" variant="outlined" startIcon={<AddOutlined />} component={RouterLink} to={ws.href(`content/${type.apiId}/new`)} aria-label={`New ${type.singularName}`}>
                              New
                            </Button>
                          </Tooltip>
                        </Box>
                      )}
                    </Box>
                  );
                })}
              </Box>
            )}
          </Paper>
        </>
      )}
    </Page>
  );
}
