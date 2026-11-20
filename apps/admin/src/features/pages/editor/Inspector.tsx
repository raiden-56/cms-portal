import { useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import ContentCopyOutlined from '@mui/icons-material/ContentCopyOutlined';
import DeleteOutlineOutlined from '@mui/icons-material/DeleteOutlineOutlined';
import TuneOutlined from '@mui/icons-material/TuneOutlined';
import { type PageData, findBlock } from '@meridian/shared';
import { IconFor } from '@/components/icons';
import { EmptyState, Mono } from '@/components/ui';
import { FieldForm } from '@/features/fields/FieldForm';
import { useAppDispatch } from '@/store';
import { useEditorLive, useEditorStatic } from './context';
import type { IssueMap } from './dnd';
import { pageEditorActions } from './editorSlice';
import { PageSettingsPanel, SeoSettingsPanel } from './SeoPanel';
import { StylePanel } from './StylePanel';

export type InspectorTab = 'content' | 'style' | 'page' | 'seo';

interface InspectorProps {
  page: PageData;
  parentPath: string | null;
  siteUrl?: string;
  issues: IssueMap;
  /** Called when a block's fields were edited, so stale publish errors for them can be cleared. */
  onFieldsEdited: (blockId: string, keys: string[]) => void;
  tab: InspectorTab;
  onTab: (tab: InspectorTab) => void;
}

/** Right-hand panel: the selected block's content and style, or the page's own settings. */
export function Inspector({ page, parentPath, siteUrl, issues, onFieldsEdited, tab, onTab }: InspectorProps) {
  const st = useEditorStatic();
  const live = useEditorLive();
  const dispatch = useAppDispatch();
  const node = live.selectedId ? findBlock(page.blocks, live.selectedId) : null;
  const def = node ? st.registry[node.type] : undefined;
  const [lastBlockTab, setLastBlockTab] = useState<'content' | 'style'>('content');

  // Keep the tab meaningful for what is selected: block tabs for a block, page tabs otherwise.
  useEffect(() => {
    if (node && (tab === 'page' || tab === 'seo')) onTab(lastBlockTab);
    if (!node && (tab === 'content' || tab === 'style')) onTab('page');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node?.id]);

  if (!node) {
    const active = tab === 'seo' ? 'seo' : 'page';
    const pageProblems = Object.keys(issues.page).length;
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
        <Tabs value={active} onChange={(_, next: InspectorTab) => onTab(next)} variant="fullWidth" sx={{ flexShrink: 0 }}>
          <Tab value="page" label="Page" sx={pageProblems ? { color: 'error.main !important' } : undefined} />
          <Tab value="seo" label="SEO" />
        </Tabs>
        <Box sx={{ flex: 1, overflowY: 'auto' }}>
          {active === 'page' ? <PageSettingsPanel page={page} parentPath={parentPath} errors={issues.page} /> : <SeoSettingsPanel page={page} parentPath={parentPath} siteUrl={siteUrl} />}
          {active === 'page' && (
            <Typography variant="caption" color="text.disabled" component="p" sx={{ px: 4, pb: 4, m: 0 }}>
              Select a block on the canvas to edit its content and style.
            </Typography>
          )}
        </Box>
      </Box>
    );
  }

  const active = tab === 'style' ? 'style' : 'content';
  const errors = issues.blocks[node.id] ?? {};
  const errorCount = Object.keys(errors).length;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <Stack direction="row" spacing={2} sx={{ px: 4, height: 48, alignItems: 'center', flexShrink: 0, borderBottom: 1, borderColor: 'border.subtle' }}>
        <IconFor name={def?.icon ?? 'component'} sx={{ fontSize: 17, color: 'secondary.main' }} />
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography variant="subtitle2" noWrap sx={{ fontWeight: 600, lineHeight: 1.2 }}>
            {def?.label ?? 'Unknown block'}
          </Typography>
          <Typography variant="caption" color="text.disabled" noWrap component="div" sx={{ lineHeight: 1.2 }}>
            <Mono sx={{ fontSize: '0.6875rem' }}>{node.type}</Mono>
          </Typography>
        </Box>
        {!st.readOnly && (
          <>
            <Tooltip title="Duplicate">
              <IconButton size="small" aria-label="Duplicate block" onClick={() => st.duplicate(node.id)}>
                <ContentCopyOutlined sx={{ fontSize: '15px !important' }} />
              </IconButton>
            </Tooltip>
            <Tooltip title="Delete">
              <IconButton size="small" aria-label="Delete block" onClick={() => st.remove(node.id)} sx={{ '&:hover': { color: 'error.main' } }}>
                <DeleteOutlineOutlined />
              </IconButton>
            </Tooltip>
          </>
        )}
      </Stack>
      <Tabs
        value={active}
        onChange={(_, next: 'content' | 'style') => {
          setLastBlockTab(next);
          onTab(next);
        }}
        variant="fullWidth"
        sx={{ flexShrink: 0 }}
      >
        <Tab value="content" label={errorCount ? `Content · ${errorCount}` : 'Content'} sx={errorCount ? { color: 'error.main !important' } : undefined} />
        <Tab value="style" label="Style" />
      </Tabs>
      <Box sx={{ flex: 1, overflowY: 'auto' }}>
        {!def ? (
          <Box sx={{ p: 4 }}>
            <Alert severity="warning">This block’s type is no longer available in this environment, so it cannot be edited or published. Delete it, or restore the component it was built from.</Alert>
            {!st.readOnly && (
              <Button color="error" variant="outlined" sx={{ mt: 3 }} onClick={() => st.remove(node.id)}>
                Delete block
              </Button>
            )}
          </Box>
        ) : active === 'content' ? (
          def.fields.length === 0 ? (
            <EmptyState compact icon={<TuneOutlined />} title="Nothing to fill in" description="This block has no content fields. Use the Style tab to adjust how it looks." />
          ) : (
            <Box sx={{ p: 4 }}>
              {errorCount > 0 && (
                <Alert severity="error" sx={{ mb: 4 }}>
                  {errorCount === 1 ? 'One field needs attention before this page can be published.' : `${errorCount} fields need attention before this page can be published.`}
                </Alert>
              )}
              <FieldForm
                key={node.id}
                dense
                fields={def.fields}
                value={node.props ?? {}}
                errors={errors}
                disabled={st.readOnly}
                components={st.components}
                onChange={(next) => {
                  const changed = Object.keys(next).filter((key) => next[key] !== (node.props ?? {})[key]);
                  dispatch(pageEditorActions.blockPropsChanged({ id: node.id, props: next }));
                  if (errorCount && changed.length) onFieldsEdited(node.id, changed);
                }}
              />
            </Box>
          )
        ) : (
          <StylePanel node={node} def={def} />
        )}
      </Box>
    </Box>
  );
}
