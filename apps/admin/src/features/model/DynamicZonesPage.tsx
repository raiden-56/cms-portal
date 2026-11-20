import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link as RouterLink } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import DynamicFeedOutlined from '@mui/icons-material/DynamicFeedOutlined';
import EditOutlined from '@mui/icons-material/EditOutlined';
import ExtensionOutlined from '@mui/icons-material/ExtensionOutlined';
import { BLOCK_CATEGORY_LABELS, type BlockCategory, type BlockDefinition, type FieldDef } from '@meridian/shared';
import { useProject, useSchema } from '@/app/workspace';
import { CardSkeleton, EmptyState, ErrorState, Mono, Page, PageHeader, Pill, Section, TableSkeleton } from '@/components/ui';
import { ApiError, api, errorMessage } from '@/lib/api';
import type { ComponentDef, SchemaResponse } from '@/lib/types';
import { toast } from '@/store';
import { fromDefs, toPayload } from './fieldModel';
import { IconTile } from './pickers';

interface Zone {
  ownerKind: 'type' | 'component';
  ownerId: string;
  ownerApiId: string;
  ownerName: string;
  ownerIcon: string;
  ownerFields: FieldDef[];
  field: FieldDef;
}

function collectZones(schema: SchemaResponse): Zone[] {
  const zones: Zone[] = [];
  for (const type of schema.types) {
    for (const field of type.fields) {
      if (field.type === 'dynamiczone') zones.push({ ownerKind: 'type', ownerId: type.id, ownerApiId: type.apiId, ownerName: type.displayName, ownerIcon: type.icon, ownerFields: type.fields, field });
    }
  }
  for (const component of schema.components) {
    for (const field of component.fields) {
      if (field.type === 'dynamiczone') zones.push({ ownerKind: 'component', ownerId: component.id, ownerApiId: component.apiId, ownerName: component.displayName, ownerIcon: component.icon, ownerFields: component.fields, field });
    }
  }
  return zones;
}

const toNumber = (raw: string): number | undefined => {
  if (raw.trim() === '') return undefined;
  const n = Math.trunc(Number(raw));
  return Number.isFinite(n) ? n : undefined;
};

function ZoneDialog({ zone, schema, onClose }: { zone: Zone; schema: SchemaResponse; onClose: () => void }) {
  const ws = useProject();
  const queryClient = useQueryClient();
  const [allowed, setAllowed] = useState<string[]>(zone.field.config.allowedComponents ?? []);
  const [minItems, setMinItems] = useState(zone.field.config.minItems?.toString() ?? '');
  const [maxItems, setMaxItems] = useState(zone.field.config.maxItems?.toString() ?? '');
  const candidates = schema.components.filter((c) => !(zone.ownerKind === 'component' && c.apiId === zone.ownerApiId));
  const min = toNumber(minItems);
  const max = toNumber(maxItems);
  const rangeError = min !== undefined && min < 0 ? 'Minimum cannot be negative' : max !== undefined && max < 1 ? 'Maximum must be at least 1' : min !== undefined && max !== undefined && min > max ? 'Maximum must not be less than the minimum' : null;

  const save = useMutation({
    mutationFn: () => {
      // The fields endpoint replaces the whole list, so the owner's other fields are sent back unchanged.
      const fields = toPayload(fromDefs(zone.ownerFields)).map((f) =>
        f.apiId === zone.field.apiId ? { ...f, config: { ...f.config, allowedComponents: allowed.length ? allowed : undefined, minItems: min, maxItems: max } } : f,
      );
      const base = zone.ownerKind === 'type' ? 'content-types' : 'components';
      return api.put(`${ws.envBase}/${base}/${zone.ownerId}/fields`, { fields, confirmDestructive: false });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['schema', ws.environment.id] });
      toast.success(`${zone.field.label} updated`);
      onClose();
    },
  });
  const problem = save.error instanceof ApiError && Array.isArray(save.error.details) && save.error.details[0] ? save.error.details[0].message : save.error ? errorMessage(save.error) : null;

  return (
    <Dialog open onClose={() => !save.isPending && onClose()} aria-labelledby="zone-dialog-title">
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!rangeError) save.mutate();
        }}
      >
        <DialogTitle id="zone-dialog-title">
          {zone.field.label}
          <Typography variant="body2" color="text.secondary" component="div" sx={{ fontWeight: 400 }}>
            Dynamic zone in {zone.ownerName}
          </Typography>
        </DialogTitle>
        <DialogContent>
          {problem && (
            <Alert severity="error" sx={{ mb: 3 }}>
              {problem}
            </Alert>
          )}
          <Stack spacing={4} sx={{ pt: 1 }}>
            <Autocomplete
              multiple
              disableCloseOnSelect
              options={candidates.map((c) => c.apiId)}
              getOptionLabel={(apiId) => schema.components.find((c) => c.apiId === apiId)?.displayName ?? apiId}
              value={allowed}
              onChange={(_, next) => setAllowed(next)}
              noOptionsText="No components to choose from"
              renderInput={(params) => <TextField {...params} autoFocus label="Allowed components" helperText="Editors can insert and reorder these inside the zone. Leave empty to allow every component." />}
            />
            <Stack direction="row" spacing={2}>
              <TextField label="At least" type="number" value={minItems} onChange={(e) => setMinItems(e.target.value)} error={!!rangeError} slotProps={{ htmlInput: { min: 0, step: 1 } }} />
              <TextField label="At most" type="number" value={maxItems} onChange={(e) => setMaxItems(e.target.value)} error={!!rangeError} slotProps={{ htmlInput: { min: 1, step: 1 } }} />
            </Stack>
            <Typography variant="caption" color={rangeError ? 'error' : 'text.secondary'} role={rangeError ? 'alert' : undefined} sx={{ mt: '-8px !important' }}>
              {rangeError ?? 'Item limits are checked when an entry is published. Leave empty for no limit.'}
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button type="submit" variant="contained" disabled={!!rangeError} loading={save.isPending}>
            Save
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

function BlockCard({ block, control }: { block: Pick<BlockDefinition, 'label' | 'description' | 'icon' | 'type'> & { fieldCount: number; container?: boolean; muted?: boolean }; control?: React.ReactNode }) {
  return (
    <Stack direction="row" spacing={3} sx={{ p: 3, border: 1, borderColor: 'border.subtle', borderRadius: '8px', alignItems: 'center', bgcolor: 'background.paper', opacity: block.muted ? 0.72 : 1 }}>
      <IconTile name={block.icon} />
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
          <Typography variant="subtitle2" noWrap sx={{ fontWeight: 600 }}>
            {block.label}
          </Typography>
          {block.container && <Pill label="Container" title="Other blocks can be placed inside it" />}
        </Stack>
        <Typography variant="caption" color="text.secondary" noWrap component="div" title={block.description}>
          {block.description}
        </Typography>
        <Typography variant="caption" color="text.disabled" component="div">
          <Mono>{block.type}</Mono> · {block.fieldCount} field{block.fieldCount === 1 ? '' : 's'}
        </Typography>
      </Box>
      {control}
    </Stack>
  );
}

const BUILTIN_CATEGORIES: BlockCategory[] = ['layout', 'content', 'media', 'marketing', 'data', 'navigation', 'advanced'];

export default function DynamicZonesPage() {
  const ws = useProject();
  const schema = useSchema();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Zone | null>(null);
  const canManage = ws.can('schema.manage');
  const data = schema.data;
  const zones = useMemo(() => (data ? collectZones(data) : []), [data]);
  const builtIn = useMemo(() => (data?.blocks ?? []).filter((b) => b.builtIn), [data]);

  const toggleBlock = useMutation({
    mutationFn: ({ component, isBlock }: { component: ComponentDef; isBlock: boolean }) => api.patch<ComponentDef>(`${ws.envBase}/components/${component.id}`, { isBlock }),
    onSuccess: async (_, { component, isBlock }) => {
      await queryClient.invalidateQueries({ queryKey: ['schema', ws.environment.id] });
      toast.success(isBlock ? `${component.displayName} is now available in the page builder` : `${component.displayName} was removed from the page builder`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <Page>
      <PageHeader
        title="Dynamic zones"
        description="Places where editors assemble content from components instead of filling a fixed form — inside content types, and on pages through the page builder."
      />

      {schema.isLoading ? (
        <Stack spacing={4} aria-busy="true">
          <Paper sx={{ borderRadius: '10px' }}>
            <TableSkeleton rows={3} columns={4} />
          </Paper>
          <CardSkeleton height={280} />
        </Stack>
      ) : schema.isError || !data ? (
        <Paper sx={{ borderRadius: '10px' }}>
          <ErrorState error={schema.error} onRetry={() => void schema.refetch()} />
        </Paper>
      ) : (
        <Stack spacing={5}>
          <Section flush title="Zones in the content model" description="Every dynamic zone field, with the components editors may use in it.">
            {zones.length === 0 ? (
              <EmptyState
                compact
                icon={<DynamicFeedOutlined />}
                title="No dynamic zones yet"
                description="A dynamic zone is a field that holds a flexible, ordered list of components — for example an article body mixing quotes, galleries and call-outs. Add a “Dynamic zone” field to a content type to create one."
                action={
                  <Button variant="outlined" component={RouterLink} to={ws.href('model/types')}>
                    Open content types
                  </Button>
                }
              />
            ) : (
              <TableContainer>
                <Table aria-label="Dynamic zones">
                  <TableHead>
                    <TableRow>
                      <TableCell>Zone</TableCell>
                      <TableCell>In</TableCell>
                      <TableCell>Allowed components</TableCell>
                      <TableCell>Items</TableCell>
                      <TableCell padding="checkbox" />
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {zones.map((zone) => {
                      const allowed = zone.field.config.allowedComponents ?? [];
                      const { minItems, maxItems } = zone.field.config;
                      const ownerLink = ws.href(zone.ownerKind === 'type' ? `model/types/${zone.ownerApiId}` : `model/components/${zone.ownerApiId}`);
                      return (
                        <TableRow key={`${zone.ownerId}-${zone.field.apiId}`}>
                          <TableCell sx={{ minWidth: 180 }}>
                            <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                              {zone.field.label}
                            </Typography>
                            <Mono sx={{ color: 'text.secondary' }}>{zone.field.apiId}</Mono>
                          </TableCell>
                          <TableCell sx={{ minWidth: 180 }}>
                            <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
                              <IconTile name={zone.ownerIcon} size={24} />
                              <Box sx={{ minWidth: 0 }}>
                                <Typography variant="body2" component={RouterLink} to={ownerLink} sx={{ color: 'text.primary', fontWeight: 500 }}>
                                  {zone.ownerName}
                                </Typography>
                                <Typography variant="caption" color="text.secondary" component="div">
                                  {zone.ownerKind === 'type' ? 'Content type' : 'Component'}
                                </Typography>
                              </Box>
                            </Stack>
                          </TableCell>
                          <TableCell>
                            {allowed.length === 0 ? (
                              <Typography variant="body2" color="text.secondary">
                                Any component
                              </Typography>
                            ) : (
                              <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}>
                                {allowed.map((apiId) => {
                                  const component = data.components.find((c) => c.apiId === apiId);
                                  return <Chip key={apiId} label={component?.displayName ?? `${apiId} (missing)`} variant="outlined" color={component ? 'default' : 'error'} />;
                                })}
                              </Stack>
                            )}
                          </TableCell>
                          <TableCell sx={{ whiteSpace: 'nowrap', color: 'text.secondary' }}>
                            {minItems === undefined && maxItems === undefined ? 'No limit' : `${minItems ?? 0} – ${maxItems ?? '∞'}`}
                          </TableCell>
                          <TableCell padding="checkbox" sx={{ pr: 3 }}>
                            <Tooltip title={canManage ? 'Change allowed components' : 'You need permission to change the content model'}>
                              <span>
                                <IconButton aria-label={`Edit ${zone.field.label} in ${zone.ownerName}`} disabled={!canManage} onClick={() => setEditing(zone)}>
                                  <EditOutlined />
                                </IconButton>
                              </span>
                            </Tooltip>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </Section>

          <Section
            title="Page builder blocks"
            description="The page builder is a dynamic zone for whole pages. Built-in blocks are always available; your own components join them when offered as blocks."
          >
            <Stack spacing={5}>
              <Box>
                <Stack direction="row" sx={{ alignItems: 'baseline', justifyContent: 'space-between', mb: 2.5 }}>
                  <Typography variant="overline" color="text.disabled" component="h3">
                    {BLOCK_CATEGORY_LABELS.custom}
                  </Typography>
                  <Button size="small" component={RouterLink} to={ws.href('model/components')}>
                    Manage components
                  </Button>
                </Stack>
                {data.components.length === 0 ? (
                  <Box sx={{ border: '1px dashed', borderColor: 'border.strong', borderRadius: '8px' }}>
                    <EmptyState
                      compact
                      icon={<ExtensionOutlined />}
                      title="No custom components"
                      description="Create a component and switch on “Offer as a page builder block” to make it available to page editors."
                    />
                  </Box>
                ) : (
                  <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)', xl: 'repeat(3, 1fr)' }, gap: 2.5 }}>
                    {data.components.map((component) => {
                      const clash = data.builtinBlocks.includes(component.apiId) && !component.isBlock;
                      const pending = toggleBlock.isPending && toggleBlock.variables?.component.id === component.id;
                      return (
                        <BlockCard
                          key={component.id}
                          block={{ type: component.apiId, label: component.displayName, description: component.description || 'Custom component', icon: component.icon, fieldCount: component.fields.length, muted: !component.isBlock }}
                          control={
                            <Tooltip title={!canManage ? 'You need permission to change the content model' : clash ? 'A built-in block already uses this identifier' : component.isBlock ? 'Available in the page builder' : 'Not offered in the page builder'}>
                              <span>
                                <Switch
                                  checked={component.isBlock}
                                  disabled={!canManage || clash || pending}
                                  onChange={(e) => toggleBlock.mutate({ component, isBlock: e.target.checked })}
                                  slotProps={{ input: { 'aria-label': `Offer ${component.displayName} as a page builder block` } }}
                                />
                              </span>
                            </Tooltip>
                          }
                        />
                      );
                    })}
                  </Box>
                )}
              </Box>

              {BUILTIN_CATEGORIES.map((category) => {
                const blocks = builtIn.filter((b) => b.category === category);
                if (blocks.length === 0) return null;
                return (
                  <Box key={category}>
                    <Typography variant="overline" color="text.disabled" component="h3" sx={{ mb: 2.5 }}>
                      {BLOCK_CATEGORY_LABELS[category]} · built-in
                    </Typography>
                    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)', xl: 'repeat(3, 1fr)' }, gap: 2.5 }}>
                      {blocks.map((block) => (
                        <BlockCard key={block.type} block={{ type: block.type, label: block.label, description: block.description, icon: block.icon, fieldCount: block.fields.length, container: block.acceptsChildren }} />
                      ))}
                    </Box>
                  </Box>
                );
              })}
            </Stack>
          </Section>
        </Stack>
      )}

      {editing && data && <ZoneDialog key={`${editing.ownerId}-${editing.field.apiId}`} zone={editing} schema={data} onClose={() => setEditing(null)} />}
    </Page>
  );
}
