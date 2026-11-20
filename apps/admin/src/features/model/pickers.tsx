import { useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Dialog from '@mui/material/Dialog';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import CloseOutlined from '@mui/icons-material/CloseOutlined';
import { FIELD_CATEGORY_LABELS, FIELD_TYPES, FIELD_TYPE_META, type FieldCategory, type FieldType } from '@meridian/shared';
import { IconFor, SELECTABLE_ICONS } from '@/components/icons';
import { SearchInput } from '@/components/ui';

/** Grid of the icons a content type, component or project can use. */
export function IconPicker({ value, onChange, disabled, label = 'Icon' }: { value: string; onChange: (icon: string) => void; disabled?: boolean; label?: string }) {
  const icons = SELECTABLE_ICONS.includes(value) || !value ? SELECTABLE_ICONS : [value, ...SELECTABLE_ICONS];
  return (
    <Box>
      <Typography variant="subtitle2" component="div" id="icon-picker-label" sx={{ fontWeight: 500, mb: 1.5 }}>
        {label}
      </Typography>
      <Stack direction="row" role="radiogroup" aria-labelledby="icon-picker-label" sx={{ flexWrap: 'wrap', gap: 1 }}>
        {icons.map((icon) => {
          const selected = icon === value;
          return (
            <Tooltip key={icon} title={icon.replace(/-/g, ' ')}>
              <span>
                <ButtonBase
                  role="radio"
                  aria-checked={selected}
                  aria-label={icon}
                  disabled={disabled}
                  onClick={() => onChange(icon)}
                  sx={{
                    width: 32,
                    height: 32,
                    borderRadius: '7px',
                    border: 1,
                    borderColor: selected ? 'secondary.main' : 'border.subtle',
                    bgcolor: selected ? 'action.selected' : 'transparent',
                    color: selected ? 'secondary.main' : 'text.secondary',
                    transition: 'background-color 120ms, border-color 120ms, color 120ms',
                    '&:hover': { bgcolor: selected ? 'action.selected' : 'action.hover', color: selected ? 'secondary.main' : 'text.primary' },
                    '&.Mui-disabled': { opacity: 0.5 },
                    '& svg': { fontSize: 17 },
                  }}
                >
                  <IconFor name={icon} />
                </ButtonBase>
              </span>
            </Tooltip>
          );
        })}
      </Stack>
    </Box>
  );
}

const CATEGORY_ORDER: FieldCategory[] = ['text', 'number', 'choice', 'date', 'media', 'relation', 'structure', 'special'];

/** First step of adding a field: choose its type. */
export function FieldTypePicker({ open, onClose, onPick, title = 'Add a field' }: { open: boolean; onClose: () => void; onPick: (type: FieldType) => void; title?: string }) {
  const [search, setSearch] = useState('');
  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    return CATEGORY_ORDER.map((category) => ({
      category,
      types: FIELD_TYPES.map((t) => FIELD_TYPE_META[t]).filter((m) => m.category === category && (!q || `${m.label} ${m.description} ${m.type}`.toLowerCase().includes(q))),
    })).filter((g) => g.types.length > 0);
  }, [search]);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" aria-labelledby="field-type-title" slotProps={{ transition: { onExited: () => setSearch('') } }}>
      <DialogTitle id="field-type-title" sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        {title}
        <IconButton aria-label="Close" onClick={onClose} edge="end">
          <CloseOutlined />
        </IconButton>
      </DialogTitle>
      <DialogContent sx={{ minHeight: 420 }}>
        <SearchInput value={search} onChange={setSearch} placeholder="Search field types…" width="100%" autoFocus />
        {groups.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ py: 10, textAlign: 'center' }}>
            No field type matches “{search.trim()}”
          </Typography>
        )}
        {groups.map((group) => (
          <Box key={group.category} sx={{ mt: 5 }}>
            <Typography variant="overline" color="text.disabled" component="h3" sx={{ mb: 2 }}>
              {FIELD_CATEGORY_LABELS[group.category]}
            </Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)' }, gap: 2 }}>
              {group.types.map((meta) => (
                <ButtonBase
                  key={meta.type}
                  onClick={() => onPick(meta.type)}
                  sx={{
                    p: 2.5,
                    gap: 3,
                    borderRadius: '8px',
                    border: 1,
                    borderColor: 'border.subtle',
                    justifyContent: 'flex-start',
                    alignItems: 'center',
                    textAlign: 'left',
                    transition: 'border-color 120ms, background-color 120ms',
                    '&:hover, &:focus-visible': { borderColor: 'secondary.main', bgcolor: 'action.hover' },
                  }}
                >
                  <Box sx={{ width: 32, height: 32, borderRadius: '8px', bgcolor: 'surface.sunken', color: 'text.secondary', display: 'grid', placeItems: 'center', flexShrink: 0, '& svg': { fontSize: 17 } }}>
                    <IconFor name={meta.icon} />
                  </Box>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 600, lineHeight: 1.3 }}>
                      {meta.label}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" component="div" sx={{ lineHeight: 1.35 }}>
                      {meta.description}
                    </Typography>
                  </Box>
                </ButtonBase>
              ))}
            </Box>
          </Box>
        ))}
      </DialogContent>
    </Dialog>
  );
}

/** Square tile with a type or component icon, used across the modeling screens. */
export function IconTile({ name, size = 32, color }: { name: string | null | undefined; size?: number; color?: string }) {
  return (
    <Box
      component="span"
      sx={{
        width: size,
        height: size,
        borderRadius: `${Math.round(size / 4)}px`,
        bgcolor: color ?? 'surface.sunken',
        color: color ? '#fff' : 'text.secondary',
        display: 'grid',
        placeItems: 'center',
        flexShrink: 0,
        '& svg': { fontSize: Math.round(size * 0.53) },
      }}
    >
      <IconFor name={name ?? undefined} />
    </Box>
  );
}
