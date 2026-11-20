import { type ReactNode, useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import MenuItem from '@mui/material/MenuItem';
import Slider from '@mui/material/Slider';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import CloseOutlined from '@mui/icons-material/CloseOutlined';
import FormatAlignCenterOutlined from '@mui/icons-material/FormatAlignCenterOutlined';
import FormatAlignLeftOutlined from '@mui/icons-material/FormatAlignLeftOutlined';
import FormatAlignRightOutlined from '@mui/icons-material/FormatAlignRightOutlined';
import type { BlockDefinition, BlockNode, BlockStyle } from '@meridian/shared';
import { AssetThumb, MediaPickerDialog } from '@/features/fields/MediaField';
import { useAppDispatch } from '@/store';
import { columnsFor } from './Canvas';
import { useEditorLive, useEditorStatic } from './context';
import { pageEditorActions } from './editorSlice';

/** Drops undefined values and empty groups so the stored style only holds what was actually set. */
function clean<T>(value: T): T | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const cleaned = clean(entry);
    if (cleaned !== undefined) out[key] = cleaned;
  }
  return Object.keys(out).length ? (out as T) : undefined;
}

function Group({ title, hint, isSet, onReset, disabled, children }: { title: string; hint?: string; isSet: boolean; onReset: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <Box component="section" sx={{ px: 4, py: 3.5, borderBottom: 1, borderColor: 'border.subtle' }}>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', minHeight: 24, mb: 2.5 }}>
        <Typography variant="overline" color="text.secondary" component="h4">
          {title}
        </Typography>
        {isSet && !disabled && (
          <Button size="small" onClick={onReset} sx={{ minHeight: 22, px: 1.5, fontSize: '0.6875rem', color: 'text.secondary' }}>
            Reset
          </Button>
        )}
      </Stack>
      <Stack spacing={3}>{children}</Stack>
      {hint && (
        <Typography variant="caption" color="text.disabled" component="p" sx={{ mt: 2, mb: 0 }}>
          {hint}
        </Typography>
      )}
    </Box>
  );
}

function Row({ label, children, htmlFor }: { label: string; children: ReactNode; htmlFor?: string }) {
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: '88px minmax(0, 1fr)', alignItems: 'center', gap: 2 }}>
      <Typography variant="caption" color="text.secondary" component="label" htmlFor={htmlFor}>
        {label}
      </Typography>
      <Box sx={{ minWidth: 0 }}>{children}</Box>
    </Box>
  );
}

function NumberControl({ label, value, onChange, min = 0, max, unit = 'px', disabled, placeholder }: { label: string; value: number | undefined; onChange: (value: number | undefined) => void; min?: number; max: number; unit?: string; disabled?: boolean; placeholder?: string }) {
  return (
    <TextField
      type="number"
      disabled={disabled}
      value={value ?? ''}
      placeholder={placeholder ?? 'Auto'}
      onChange={(e) => {
        if (e.target.value === '') return onChange(undefined);
        const n = Number(e.target.value);
        if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n)));
      }}
      slotProps={{
        htmlInput: { min, max, 'aria-label': label, inputMode: 'numeric' },
        input: {
          startAdornment: (
            <InputAdornment position="start">
              <Typography variant="caption" color="text.disabled" sx={{ minWidth: 12 }}>
                {label.length <= 2 ? label : ''}
              </Typography>
            </InputAdornment>
          ),
          endAdornment: unit ? (
            <InputAdornment position="end">
              <Typography variant="caption" color="text.disabled">
                {unit}
              </Typography>
            </InputAdornment>
          ) : undefined,
        },
      }}
    />
  );
}

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

function ColorControl({ label, value, onChange, disabled }: { label: string; value: string | undefined; onChange: (value: string | undefined) => void; disabled?: boolean }) {
  const [text, setText] = useState(value ?? '');
  useEffect(() => setText(value ?? ''), [value]);
  const invalid = text !== '' && !HEX.test(text);
  return (
    <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
      <Box
        component="input"
        type="color"
        aria-label={`${label} picker`}
        disabled={disabled}
        value={value && /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#ffffff'}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value.toUpperCase())}
        sx={{ width: 32, height: 32, p: 0.5, border: 1, borderColor: 'border.strong', borderRadius: '7px', bgcolor: 'background.paper', cursor: disabled ? 'default' : 'pointer', flexShrink: 0 }}
      />
      <TextField
        value={text}
        disabled={disabled}
        error={invalid}
        placeholder="None"
        onChange={(e) => {
          const next = e.target.value.trim();
          setText(next);
          // Only complete hex colors are stored; half-typed values stay local.
          if (next === '') onChange(undefined);
          else if (HEX.test(next)) onChange(next.toUpperCase());
        }}
        slotProps={{ htmlInput: { 'aria-label': label, spellCheck: false, maxLength: 9 } }}
      />
      {value && !disabled && (
        <Tooltip title="Clear">
          <IconButton size="small" aria-label={`Clear ${label.toLowerCase()}`} onClick={() => onChange(undefined)}>
            <CloseOutlined sx={{ fontSize: '15px !important' }} />
          </IconButton>
        </Tooltip>
      )}
    </Stack>
  );
}

function Choice<T extends string>({ label, value, options, onChange, disabled }: { label: string; value: T | undefined; options: { value: T; label: ReactNode; title?: string }[]; onChange: (value: T | undefined) => void; disabled?: boolean }) {
  return (
    <ToggleButtonGroup exclusive fullWidth size="small" value={value ?? null} disabled={disabled} onChange={(_, next: T | null) => onChange(next ?? undefined)} aria-label={label}>
      {options.map((option) => (
        <ToggleButton key={option.value} value={option.value} aria-label={option.title ?? String(option.value)} sx={{ py: 1, px: 1 }}>
          {option.label}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}

const SIZES = [
  { value: 'sm' as const, label: 'S' },
  { value: 'md' as const, label: 'M' },
  { value: 'lg' as const, label: 'L' },
];

/** Presentation hints for one block. These are stored as data; each frontend decides how to honour them. */
export function StylePanel({ node, def }: { node: BlockNode; def: BlockDefinition | undefined }) {
  const st = useEditorStatic();
  const live = useEditorLive();
  const dispatch = useAppDispatch();
  const [picking, setPicking] = useState(false);
  const [anchorText, setAnchorText] = useState(node.style?.anchor ?? '');
  const [classText, setClassText] = useState(node.style?.cssClass ?? '');
  const style: BlockStyle = node.style ?? {};
  const off = st.readOnly;

  useEffect(() => {
    setAnchorText(node.style?.anchor ?? '');
    setClassText(node.style?.cssClass ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id]);
  // Follow outside changes (undo, redo) without fighting what is being typed right now.
  useEffect(() => {
    const anchor = node.style?.anchor ?? '';
    const cssClass = node.style?.cssClass ?? '';
    setAnchorText((current) => (current === '' || /^[A-Za-z][\w-]{0,60}$/.test(current) ? anchor : current));
    setClassText((current) => (current.trim() === cssClass ? current : cssClass));
  }, [node.style?.anchor, node.style?.cssClass]);

  const update = (patch: Partial<BlockStyle>) => dispatch(pageEditorActions.blockStyleChanged({ id: node.id, style: clean({ ...style, ...patch }) }));
  const backgroundAsset = style.background?.imageId ? live.assets.get(style.background.imageId) : undefined;
  const usesColumns = !!def?.defaultStyle?.columns || node.type === 'columns' || !!style.columns;
  const anchorInvalid = anchorText !== '' && !/^[A-Za-z][\w-]{0,60}$/.test(anchorText);
  const classInvalid = !/^[\w\- ]{0,120}$/.test(classText);

  return (
    <Box>
      <Group title="Layout" isSet={!!(style.align || style.maxWidth || style.columns)} onReset={() => update({ align: undefined, maxWidth: undefined, columns: undefined })} disabled={off}>
        <Row label="Alignment">
          <Choice
            label="Alignment"
            value={style.align}
            disabled={off}
            onChange={(align) => update({ align })}
            options={[
              { value: 'left', title: 'Align left', label: <FormatAlignLeftOutlined sx={{ fontSize: 16 }} /> },
              { value: 'center', title: 'Align center', label: <FormatAlignCenterOutlined sx={{ fontSize: 16 }} /> },
              { value: 'right', title: 'Align right', label: <FormatAlignRightOutlined sx={{ fontSize: 16 }} /> },
            ]}
          />
        </Row>
        <Row label="Max width" htmlFor="style-max-width">
          <TextField id="style-max-width" select disabled={off} value={style.maxWidth ?? ''} onChange={(e) => update({ maxWidth: (e.target.value || undefined) as BlockStyle['maxWidth'] })} slotProps={{ select: { displayEmpty: true } }}>
            <MenuItem value="">Default</MenuItem>
            <MenuItem value="sm">Small · 640px</MenuItem>
            <MenuItem value="md">Medium · 768px</MenuItem>
            <MenuItem value="lg">Large · 1024px</MenuItem>
            <MenuItem value="xl">Extra large · 1280px</MenuItem>
            <MenuItem value="full">Full width</MenuItem>
          </TextField>
        </Row>
        {usesColumns && (
          <Row label="Columns">
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1.5 }}>
              {(
                [
                  ['desktop', 6],
                  ['tablet', 4],
                  ['mobile', 2],
                ] as const
              ).map(([device, max]) => (
                <TextField
                  key={device}
                  type="number"
                  disabled={off}
                  label={device[0].toUpperCase() + device.slice(1)}
                  value={style.columns?.[device] ?? ''}
                  placeholder={String(columnsFor(undefined, def, device))}
                  onChange={(e) => {
                    const n = e.target.value === '' ? undefined : Math.min(max, Math.max(1, Math.round(Number(e.target.value))));
                    update({ columns: { ...style.columns, [device]: Number.isFinite(n as number) ? n : undefined } });
                  }}
                  slotProps={{ htmlInput: { min: 1, max, 'aria-label': `Columns on ${device}` }, inputLabel: { shrink: true } }}
                />
              ))}
            </Box>
          </Row>
        )}
      </Group>

      <Group title="Spacing" isSet={!!(style.padding || style.margin)} onReset={() => update({ padding: undefined, margin: undefined })} disabled={off}>
        <Row label="Padding">
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
            {(
              [
                ['top', 'T'],
                ['bottom', 'B'],
                ['left', 'L'],
                ['right', 'R'],
              ] as const
            ).map(([side, short]) => (
              <Tooltip key={side} title={`Padding ${side}`} placement="top">
                <Box>
                  <NumberControl label={short} max={400} disabled={off} value={style.padding?.[side]} onChange={(v) => update({ padding: { ...style.padding, [side]: v } })} unit="" />
                </Box>
              </Tooltip>
            ))}
          </Box>
        </Row>
        <Row label="Margin">
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
            {(
              [
                ['top', 'T'],
                ['bottom', 'B'],
              ] as const
            ).map(([side, short]) => (
              <Tooltip key={side} title={`Margin ${side}`} placement="top">
                <Box>
                  <NumberControl label={short} max={400} disabled={off} value={style.margin?.[side]} onChange={(v) => update({ margin: { ...style.margin, [side]: v } })} unit="" placeholder="0" />
                </Box>
              </Tooltip>
            ))}
          </Box>
        </Row>
      </Group>

      <Group title="Background" isSet={!!style.background} onReset={() => update({ background: undefined })} disabled={off}>
        <Row label="Color">
          <ColorControl label="Background color" value={style.background?.color} disabled={off} onChange={(color) => update({ background: { ...style.background, color } })} />
        </Row>
        <Row label="Image">
          {style.background?.imageId ? (
            <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
              {backgroundAsset ? <AssetThumb asset={backgroundAsset} size={40} radius={6} /> : <Box sx={{ width: 40, height: 40, borderRadius: '6px', bgcolor: 'surface.sunken' }} />}
              <Typography variant="caption" noWrap sx={{ flex: 1, minWidth: 0 }}>
                {backgroundAsset?.filename ?? 'Image'}
              </Typography>
              {!off && (
                <>
                  <Button size="small" onClick={() => setPicking(true)}>
                    Change
                  </Button>
                  <IconButton size="small" aria-label="Remove background image" onClick={() => update({ background: { ...style.background, imageId: undefined, overlay: undefined } })}>
                    <CloseOutlined sx={{ fontSize: '15px !important' }} />
                  </IconButton>
                </>
              )}
            </Stack>
          ) : (
            <Button size="small" variant="outlined" fullWidth disabled={off} onClick={() => setPicking(true)}>
              Choose image
            </Button>
          )}
        </Row>
        {style.background?.imageId && (
          <Row label="Overlay">
            <Stack direction="row" spacing={3} sx={{ alignItems: 'center', pr: 1 }}>
              <Slider
                size="small"
                color="secondary"
                disabled={off}
                min={0}
                max={0.9}
                step={0.05}
                value={style.background.overlay ?? 0}
                onChange={(_, value) => update({ background: { ...style.background, overlay: (value as number) || undefined } })}
                aria-label="Dark overlay strength"
                valueLabelDisplay="auto"
                valueLabelFormat={(v) => `${Math.round(v * 100)}%`}
              />
              <Typography variant="caption" color="text.secondary" sx={{ width: 34, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {Math.round((style.background.overlay ?? 0) * 100)}%
              </Typography>
            </Stack>
          </Row>
        )}
      </Group>

      <Group title="Text" isSet={!!(style.textColor || style.typography)} onReset={() => update({ textColor: undefined, typography: undefined })} disabled={off}>
        <Row label="Color">
          <ColorControl label="Text color" value={style.textColor} disabled={off} onChange={(textColor) => update({ textColor })} />
        </Row>
        <Row label="Headings">
          <Choice label="Heading size" value={style.typography?.headingSize} disabled={off} onChange={(headingSize) => update({ typography: { ...style.typography, headingSize } })} options={[...SIZES.map((s) => ({ ...s, title: `Heading size ${s.label}` })), { value: 'xl' as const, label: 'XL', title: 'Heading size XL' }]} />
        </Row>
        <Row label="Body">
          <Choice label="Body size" value={style.typography?.bodySize} disabled={off} onChange={(bodySize) => update({ typography: { ...style.typography, bodySize } })} options={SIZES.map((s) => ({ ...s, title: `Body size ${s.label}` }))} />
        </Row>
        <Row label="Weight">
          <Choice
            label="Heading weight"
            value={style.typography?.fontWeight}
            disabled={off}
            onChange={(fontWeight) => update({ typography: { ...style.typography, fontWeight } })}
            options={[
              { value: 'regular', label: 'Regular' },
              { value: 'medium', label: 'Medium' },
              { value: 'bold', label: 'Bold' },
            ]}
          />
        </Row>
      </Group>

      <Group title="Border" isSet={!!style.border} onReset={() => update({ border: undefined })} disabled={off}>
        <Row label="Width">
          <NumberControl label="Border width" max={20} disabled={off} value={style.border?.width} onChange={(width) => update({ border: { ...style.border, width } })} placeholder="0" />
        </Row>
        <Row label="Color">
          <ColorControl label="Border color" value={style.border?.color} disabled={off} onChange={(color) => update({ border: { ...style.border, color } })} />
        </Row>
        <Row label="Radius">
          <NumberControl label="Border radius" max={200} disabled={off} value={style.border?.radius} onChange={(radius) => update({ border: { ...style.border, radius } })} placeholder="0" />
        </Row>
      </Group>

      <Group title="Visibility" isSet={!!style.visibility} onReset={() => update({ visibility: undefined })} disabled={off} hint="Hidden blocks stay in the page data; your frontend skips them on that device.">
        {(['desktop', 'tablet', 'mobile'] as const).map((device) => (
          <FormControlLabel
            key={device}
            sx={{ ml: 0, justifyContent: 'space-between', flexDirection: 'row-reverse' }}
            control={<Switch disabled={off} checked={style.visibility?.[device] !== false} onChange={(e) => update({ visibility: { ...style.visibility, [device]: e.target.checked ? undefined : false } })} />}
            label={<Typography variant="body2">Show on {device}</Typography>}
          />
        ))}
      </Group>

      <Group title="Animation" isSet={!!style.animation} onReset={() => update({ animation: undefined })} disabled={off} hint="Entrance animations are a hint for your frontend. They are not played in the editor.">
        <Row label="Effect" htmlFor="style-animation">
          <TextField
            id="style-animation"
            select
            disabled={off}
            value={style.animation?.type ?? 'none'}
            onChange={(e) => update({ animation: e.target.value === 'none' ? undefined : { ...style.animation, type: e.target.value as NonNullable<BlockStyle['animation']>['type'] } })}
          >
            <MenuItem value="none">None</MenuItem>
            <MenuItem value="fade">Fade in</MenuItem>
            <MenuItem value="slide-up">Slide up</MenuItem>
            <MenuItem value="slide-left">Slide from right</MenuItem>
            <MenuItem value="slide-right">Slide from left</MenuItem>
            <MenuItem value="zoom">Zoom in</MenuItem>
          </TextField>
        </Row>
        {style.animation?.type && (
          <>
            <Row label="Delay">
              <NumberControl label="Animation delay" max={5000} unit="ms" disabled={off} value={style.animation.delay} onChange={(delay) => update({ animation: { ...style.animation, delay } })} placeholder="0" />
            </Row>
            <Row label="Duration">
              <NumberControl label="Animation duration" max={5000} unit="ms" disabled={off} value={style.animation.duration} onChange={(duration) => update({ animation: { ...style.animation, duration } })} placeholder="400" />
            </Row>
          </>
        )}
      </Group>

      <Group title="Advanced" isSet={!!(style.anchor || style.cssClass)} onReset={() => update({ anchor: undefined, cssClass: undefined })} disabled={off}>
        <TextField
          label="Anchor"
          disabled={off}
          value={anchorText}
          error={anchorInvalid}
          helperText={anchorInvalid ? 'Start with a letter; use letters, numbers, hyphens and underscores' : 'Lets links jump to this block, e.g. /about#team'}
          onChange={(e) => {
            const next = e.target.value.trim().replace(/^#/, '');
            setAnchorText(next);
            if (next === '' || /^[A-Za-z][\w-]{0,60}$/.test(next)) update({ anchor: next || undefined });
          }}
          slotProps={{ htmlInput: { spellCheck: false, maxLength: 61 }, input: { startAdornment: <InputAdornment position="start">#</InputAdornment> } }}
        />
        <TextField
          label="CSS class"
          disabled={off}
          value={classText}
          error={classInvalid}
          helperText={classInvalid ? 'Use letters, numbers, hyphens, underscores and spaces' : 'Passed to your frontend for custom styling'}
          onChange={(e) => {
            const next = e.target.value;
            setClassText(next);
            if (/^[\w\- ]{0,120}$/.test(next)) update({ cssClass: next.trim() || undefined });
          }}
          slotProps={{ htmlInput: { spellCheck: false, maxLength: 120 } }}
        />
      </Group>

      <MediaPickerDialog
        open={picking}
        kind="image"
        onClose={() => setPicking(false)}
        selected={style.background?.imageId ? [style.background.imageId] : []}
        onSelect={([asset]) => {
          if (asset) update({ background: { ...style.background, imageId: asset.id } });
        }}
      />
    </Box>
  );
}
