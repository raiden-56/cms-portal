import { useMemo, useState } from 'react';
import { useDraggable } from '@dnd-kit/core';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import SearchOffOutlined from '@mui/icons-material/SearchOffOutlined';
import { BLOCK_CATEGORY_LABELS, type BlockCategory, type BlockDefinition } from '@meridian/shared';
import { IconFor } from '@/components/icons';
import { EmptyState, SearchInput } from '@/components/ui';
import { useEditorStatic } from './context';
import type { DragSource } from './dnd';

const CATEGORY_ORDER: BlockCategory[] = ['layout', 'content', 'media', 'marketing', 'data', 'navigation', 'advanced', 'custom'];

function PaletteItem({ def, disabled, onAdd }: { def: BlockDefinition; disabled: boolean; onAdd: (def: BlockDefinition) => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `palette:${def.type}`, data: { kind: 'palette', type: def.type } satisfies DragSource, disabled });
  return (
    <Tooltip title={def.description} placement="right" enterDelay={600}>
      <ButtonBase
        ref={setNodeRef}
        {...listeners}
        {...attributes}
        disabled={disabled}
        onClick={() => onAdd(def)}
        aria-label={`Add ${def.label} block`}
        sx={{
          flexDirection: 'column',
          gap: 1.5,
          height: 68,
          px: 1,
          borderRadius: '8px',
          border: 1,
          borderColor: 'border.subtle',
          bgcolor: 'background.paper',
          color: 'text.secondary',
          cursor: disabled ? 'default' : 'grab',
          touchAction: 'none',
          opacity: isDragging ? 0.4 : 1,
          transition: 'border-color 120ms, color 120ms, background-color 120ms',
          '&:hover': { borderColor: 'secondary.main', color: 'text.primary', bgcolor: 'action.hover' },
          '&.Mui-disabled': { opacity: 0.5 },
          '& svg': { fontSize: 19 },
        }}
      >
        <IconFor name={def.icon} />
        <Typography variant="caption" noWrap sx={{ maxWidth: '100%', fontWeight: 500, color: 'text.primary', lineHeight: 1.2 }}>
          {def.label}
        </Typography>
      </ButtonBase>
    </Tooltip>
  );
}

/** Catalogue of blocks: click to add after the selection, or drag onto the page. */
export function Palette({ onAdd }: { onAdd: (def: BlockDefinition) => void }) {
  const st = useEditorStatic();
  const [search, setSearch] = useState('');

  const groups = useMemo(() => {
    const term = search.trim().toLowerCase();
    const all = Object.values(st.registry).filter((def) => !term || `${def.label} ${def.description} ${def.type}`.toLowerCase().includes(term));
    return CATEGORY_ORDER.map((category) => ({ category, items: all.filter((def) => def.category === category) })).filter((g) => g.items.length > 0);
  }, [st.registry, search]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <Box sx={{ p: 3, pb: 2 }}>
        <SearchInput value={search} onChange={setSearch} placeholder="Search blocks…" width="100%" />
      </Box>
      <Box sx={{ flex: 1, overflowY: 'auto', px: 3, pb: 4 }}>
        {groups.length === 0 ? (
          <EmptyState compact icon={<SearchOffOutlined />} title="No blocks match" description="Try a different word, or create a custom component and mark it as a page block." />
        ) : (
          groups.map((group) => (
            <Box key={group.category} sx={{ mb: 4 }}>
              <Typography variant="overline" color="text.disabled" component="h3" sx={{ mb: 1.5 }}>
                {BLOCK_CATEGORY_LABELS[group.category]}
              </Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 2 }}>
                {group.items.map((def) => (
                  <PaletteItem key={def.type} def={def} disabled={st.readOnly} onAdd={onAdd} />
                ))}
              </Box>
            </Box>
          ))
        )}
      </Box>
    </Box>
  );
}
