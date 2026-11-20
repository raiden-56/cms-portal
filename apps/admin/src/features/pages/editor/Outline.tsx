import { useState } from 'react';
import { useDraggable } from '@dnd-kit/core';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import AccountTreeOutlined from '@mui/icons-material/AccountTreeOutlined';
import ChevronRightOutlined from '@mui/icons-material/ChevronRightOutlined';
import ContentCopyOutlined from '@mui/icons-material/ContentCopyOutlined';
import DeleteOutlineOutlined from '@mui/icons-material/DeleteOutlineOutlined';
import ErrorOutlineOutlined from '@mui/icons-material/ErrorOutlineOutlined';
import VisibilityOffOutlined from '@mui/icons-material/VisibilityOffOutlined';
import type { BlockDefinition, BlockNode } from '@meridian/shared';
import { IconFor } from '@/components/icons';
import { EmptyState } from '@/components/ui';
import { useEditorLive, useEditorStatic } from './context';
import type { DragSource } from './dnd';

/** A short, human reading of a block's content, so similar blocks can be told apart in the outline. */
export function blockSummary(node: BlockNode, def: BlockDefinition | undefined): string {
  const props = node.props ?? {};
  for (const key of ['heading', 'title', 'label', 'message', 'brand', 'caption', 'contentType', 'component']) {
    const value = props[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  for (const field of def?.fields ?? []) {
    const value = props[field.apiId];
    if ((field.type === 'text' || field.type === 'textarea') && typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function OutlineRow({ node, parentId, index, count, depth }: { node: BlockNode; parentId: string | null; index: number; count: number; depth: number }) {
  const st = useEditorStatic();
  const live = useEditorLive();
  const def = st.registry[node.type] as BlockDefinition | undefined;
  const [open, setOpen] = useState(true);
  const { attributes, listeners, setNodeRef } = useDraggable({ id: `outline:${node.id}`, data: { kind: 'block', id: node.id } satisfies DragSource, disabled: st.readOnly });
  const children = node.children ?? [];
  const isContainer = !!def?.acceptsChildren;
  const selected = live.selectedId === node.id;
  const summary = blockSummary(node, def);
  const target = live.dropTarget;
  const before = !!target && target.parentId === parentId && target.index === index;
  const after = !!target && target.parentId === parentId && target.index === count && index === count - 1;
  const inside = !!target && target.parentId === node.id;
  const hidden = node.style?.visibility?.[live.device] === false;
  const line = { content: '""', position: 'absolute', left: 8 + depth * 14, right: 4, height: 2, borderRadius: 1, bgcolor: 'secondary.main', zIndex: 2 } as const;

  return (
    <Box component="li" sx={{ listStyle: 'none' }}>
      <Box
        data-drop-kind="outline"
        data-block-id={node.id}
        sx={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          height: 30,
          pl: `${4 + depth * 14}px`,
          pr: 0.5,
          borderRadius: '6px',
          opacity: live.draggingId === node.id ? 0.4 : 1,
          bgcolor: inside ? 'action.focus' : selected ? 'action.selected' : 'transparent',
          '&:hover': { bgcolor: inside ? 'action.focus' : selected ? 'action.selected' : 'action.hover' },
          '&:hover .outline-actions, &:focus-within .outline-actions': { opacity: 1 },
          '&::before': before ? { ...line, top: -1 } : undefined,
          '&::after': after && !inside ? { ...line, bottom: -1 } : undefined,
        }}
      >
        {isContainer ? (
          <IconButton size="small" aria-label={open ? `Collapse ${def?.label ?? node.type}` : `Expand ${def?.label ?? node.type}`} aria-expanded={open} onClick={() => setOpen((o) => !o)} sx={{ p: 0.25, mr: 0.25 }}>
            <ChevronRightOutlined sx={{ fontSize: '15px !important', transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 120ms' }} />
          </IconButton>
        ) : (
          <Box sx={{ width: 20, flexShrink: 0 }} />
        )}
        <ButtonBase
          ref={setNodeRef}
          {...listeners}
          {...attributes}
          onClick={() => st.select(node.id)}
          aria-current={selected ? 'true' : undefined}
          sx={{ flex: 1, minWidth: 0, height: '100%', justifyContent: 'flex-start', gap: 1.5, borderRadius: '6px', textAlign: 'left', cursor: st.readOnly ? 'pointer' : 'grab', touchAction: 'none' }}
        >
          <IconFor name={def?.icon ?? 'component'} sx={{ fontSize: 15, color: selected ? 'secondary.main' : 'text.secondary', flexShrink: 0 }} />
          <Typography variant="body2" noWrap sx={{ fontWeight: selected ? 600 : 500, flexShrink: 0, maxWidth: '60%', color: def ? 'text.primary' : 'error.main' }}>
            {def?.label ?? node.type}
          </Typography>
          {summary && (
            <Typography variant="caption" noWrap color="text.disabled" sx={{ minWidth: 0 }}>
              {summary}
            </Typography>
          )}
        </ButtonBase>
        {live.issueIds.has(node.id) && (
          <Tooltip title="Needs attention before publishing">
            <ErrorOutlineOutlined sx={{ fontSize: 15, color: 'error.main', mx: 0.5, flexShrink: 0 }} />
          </Tooltip>
        )}
        {hidden && (
          <Tooltip title="Hidden on the device being previewed">
            <VisibilityOffOutlined sx={{ fontSize: 14, color: 'text.disabled', mx: 0.5, flexShrink: 0 }} />
          </Tooltip>
        )}
        {!st.readOnly && (
          <Box className="outline-actions" sx={{ display: 'flex', opacity: 0, transition: 'opacity 100ms', flexShrink: 0 }}>
            <Tooltip title="Duplicate">
              <IconButton size="small" aria-label={`Duplicate ${def?.label ?? node.type}`} onClick={() => st.duplicate(node.id)} sx={{ p: 0.5 }}>
                <ContentCopyOutlined sx={{ fontSize: '13px !important' }} />
              </IconButton>
            </Tooltip>
            <Tooltip title="Delete">
              <IconButton size="small" aria-label={`Delete ${def?.label ?? node.type}`} onClick={() => st.remove(node.id)} sx={{ p: 0.5, '&:hover': { color: 'error.main' } }}>
                <DeleteOutlineOutlined sx={{ fontSize: '15px !important' }} />
              </IconButton>
            </Tooltip>
          </Box>
        )}
      </Box>
      {isContainer && open && (
        <Box component="ul" sx={{ m: 0, p: 0 }}>
          {children.map((child, i) => (
            <OutlineRow key={child.id} node={child} parentId={node.id} index={i} count={children.length} depth={depth + 1} />
          ))}
          {children.length === 0 && (
            <Typography variant="caption" color="text.disabled" component="li" sx={{ listStyle: 'none', pl: `${28 + (depth + 1) * 14}px`, py: 1 }}>
              Empty — drop blocks here
            </Typography>
          )}
        </Box>
      )}
    </Box>
  );
}

/** The page as a tree: select, reorder and nest blocks without hunting for them on the canvas. */
export function Outline({ blocks }: { blocks: BlockNode[] }) {
  if (blocks.length === 0) {
    return <EmptyState compact icon={<AccountTreeOutlined />} title="No blocks yet" description="Blocks you add to the page are listed here in order." />;
  }
  return (
    <Box component="ul" aria-label="Page outline" sx={{ m: 0, p: 2, overflowY: 'auto', height: '100%' }}>
      {blocks.map((node, index) => (
        <OutlineRow key={node.id} node={node} parentId={null} index={index} count={blocks.length} depth={0} />
      ))}
    </Box>
  );
}
