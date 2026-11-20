import { type CSSProperties, type ReactNode, createContext, memo, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useDraggable } from '@dnd-kit/core';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import ContentCopyOutlined from '@mui/icons-material/ContentCopyOutlined';
import DeleteOutlineOutlined from '@mui/icons-material/DeleteOutlineOutlined';
import DragIndicatorOutlined from '@mui/icons-material/DragIndicatorOutlined';
import KeyboardArrowDownOutlined from '@mui/icons-material/KeyboardArrowDownOutlined';
import KeyboardArrowUpOutlined from '@mui/icons-material/KeyboardArrowUpOutlined';
import WidgetsOutlined from '@mui/icons-material/WidgetsOutlined';
import { type BlockDefinition, type BlockNode, type BlockStyle, createBlockNode } from '@meridian/shared';
import { IconFor } from '@/components/icons';
import { useAppDispatch } from '@/store';
import { BlockPreview, type PreviewContext, SITE, SITE_FONT, imageUrl } from './BlockPreview';
import { DEVICE_LABELS, useEditorLive, useEditorStatic } from './context';
import type { DragSource } from './dnd';
import { type Device, pageEditorActions } from './editorSlice';

const ACCENT = '#1F8A70';
const DEVICE_WIDTH: Record<Device, number> = { desktop: 1200, tablet: 820, mobile: 390 };
const MAX_WIDTH: Record<NonNullable<BlockStyle['maxWidth']>, string> = { sm: '640px', md: '768px', lg: '1024px', xl: '1280px', full: 'none' };
const HEADING: Record<string, [number, number]> = { sm: [34, 22], md: [44, 28], lg: [54, 32], xl: [66, 38] };
const BODY: Record<string, number> = { sm: 14, md: 16, lg: 18 };
const WEIGHT: Record<string, number> = { regular: 500, medium: 600, bold: 700 };
const DEVICE_SCALE: Record<Device, number> = { desktop: 1, tablet: 0.86, mobile: 0.68 };
const GAP: Record<string, string> = { sm: '12px', md: '24px', lg: '40px' };

const PreviewCtx = createContext<PreviewContext | null>(null);
/** Scale of the page sheet. Floating chrome inside it is counter-scaled so it stays a constant size. */
const ZoomCtx = createContext(1);

export function columnsFor(style: BlockStyle | undefined, def: BlockDefinition | undefined, device: Device): number {
  const fallback = { desktop: 3, tablet: 2, mobile: 1 }[device];
  return Math.max(1, Math.round(style?.columns?.[device] ?? def?.defaultStyle?.columns?.[device] ?? fallback));
}

function ToolButton({ label, onClick, disabled, children, danger }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode; danger?: boolean }) {
  return (
    <Tooltip title={label} placement="top">
      <span>
        <ButtonBase
          aria-label={label}
          disabled={disabled}
          onClick={(e) => {
            e.stopPropagation();
            onClick();
          }}
          sx={{ width: 24, height: 24, borderRadius: '5px', color: '#fff', '&:hover': { bgcolor: danger ? '#B4443C' : 'rgba(255,255,255,0.18)' }, '&.Mui-disabled': { opacity: 0.35 }, '& svg': { fontSize: 16 } }}
        >
          {children}
        </ButtonBase>
      </span>
    </Tooltip>
  );
}

function DragHandle({ id, label }: { id: string; label: string }) {
  const { attributes, listeners, setNodeRef } = useDraggable({ id: `block:${id}`, data: { kind: 'block', id } satisfies DragSource });
  return (
    <Tooltip title="Drag to move" placement="top">
      <ButtonBase
        ref={setNodeRef}
        {...listeners}
        {...attributes}
        aria-label={`Drag ${label} to move it. Alt with the arrow keys also moves it.`}
        onClick={(e) => e.stopPropagation()}
        sx={{ width: 22, height: 24, borderRadius: '5px', color: '#fff', cursor: 'grab', touchAction: 'none', '&:hover': { bgcolor: 'rgba(255,255,255,0.18)' }, '& svg': { fontSize: 16 } }}
      >
        <DragIndicatorOutlined />
      </ButtonBase>
    </Tooltip>
  );
}

function DropBar({ side, horizontal }: { side: 'before' | 'after'; horizontal: boolean }) {
  const position: CSSProperties = horizontal
    ? { top: 0, bottom: 0, width: 4, [side === 'before' ? 'left' : 'right']: -2 }
    : { left: 0, right: 0, height: 4, [side === 'before' ? 'top' : 'bottom']: -2 };
  return <Box aria-hidden style={position} sx={{ position: 'absolute', zIndex: 6, borderRadius: '2px', bgcolor: ACCENT, pointerEvents: 'none', boxShadow: `0 0 0 3px ${ACCENT}33` }} />;
}

interface FrameProps {
  node: BlockNode;
  parentId: string | null;
  index: number;
  count: number;
  horizontal: boolean;
}

const BlockFrame = memo(function BlockFrame({ node, parentId, index, count, horizontal }: FrameProps) {
  const st = useEditorStatic();
  const live = useEditorLive();
  const preview = useContext(PreviewCtx) as PreviewContext;
  const zoom = useContext(ZoomCtx);
  const def = st.registry[node.type] as BlockDefinition | undefined;
  const { device } = live;
  const style = node.style ?? {};
  const selected = live.selectedId === node.id;
  const hasIssue = live.issueIds.has(node.id);
  const hiddenHere = style.visibility?.[device] === false;
  const isContainer = !!def?.acceptsChildren;
  const children = node.children ?? [];
  const cols = columnsFor(node.style, def, device);
  const nested = parentId !== null;
  const label = def?.label ?? node.type;

  const target = live.dropTarget;
  const dropBefore = !!target && target.parentId === parentId && target.index === index;
  const dropAfter = !!target && target.parentId === parentId && target.index === count && index === count - 1;
  const dropInside = !!target && target.parentId === node.id && children.length === 0;

  const background = style.background?.imageId ? imageUrl(live.assets.get(style.background.imageId), 1600) : null;
  const [h1, h2] = HEADING[style.typography?.headingSize ?? 'md'];
  const align = style.align ?? 'left';
  const vars = {
    '--site-h1': `${Math.round(h1 * DEVICE_SCALE[device])}px`,
    '--site-h2': `${Math.round(h2 * DEVICE_SCALE[device])}px`,
    '--site-body': `${BODY[style.typography?.bodySize ?? 'md']}px`,
    '--site-hw': String(WEIGHT[style.typography?.fontWeight ?? 'medium']),
    '--site-cols': String(cols),
    '--site-justify': align === 'center' ? 'center' : align === 'right' ? 'flex-end' : 'flex-start',
    '--site-mx': align === 'center' ? 'auto' : align === 'right' ? 'auto 0' : '0 auto',
  } as CSSProperties;

  const defaultX = nested ? 0 : device === 'mobile' ? 20 : 40;
  const defaultY = isContainer ? 0 : nested ? 12 : 28;
  const border = style.border;
  const showToolbar = selected && !st.readOnly && !live.dragging;
  const tabInside = !nested && index === 0;

  return (
    <Box
      role="group"
      aria-label={`${label} block`}
      data-drop-kind="block"
      data-block-id={node.id}
      data-horizontal={horizontal}
      id={style.anchor ? `anchor-${style.anchor}` : undefined}
      onClick={(e) => {
        e.stopPropagation();
        st.select(node.id);
      }}
      sx={{
        position: 'relative',
        minWidth: 0,
        mt: style.margin?.top ? `${style.margin.top}px` : 0,
        mb: style.margin?.bottom ? `${style.margin.bottom}px` : 0,
        opacity: live.draggingId === node.id ? 0.35 : 1,
        outline: selected ? `2px solid ${ACCENT}` : hasIssue ? '2px solid #B4443C' : '2px solid transparent',
        outlineOffset: '-2px',
        cursor: 'default',
        transition: 'outline-color 100ms',
        // Only the innermost hovered block shows the hover ring.
        '&:hover:not(:has([data-block-id]:hover))': selected || live.dragging ? undefined : { outlineColor: `${ACCENT}66` },
      }}
    >
      {dropBefore && <DropBar side="before" horizontal={horizontal} />}
      {dropAfter && <DropBar side="after" horizontal={horizontal} />}

      <Box
        style={vars}
        sx={{
          position: 'relative',
          bgcolor: style.background?.color ?? 'transparent',
          color: style.textColor ?? 'inherit',
          border: border?.width ? `${border.width}px solid ${border.color ?? SITE.line}` : 'none',
          borderRadius: border?.radius ? `${border.radius}px` : 0,
          overflow: border?.radius || background ? 'hidden' : 'visible',
          opacity: hiddenHere ? 0.35 : 1,
        }}
      >
        {background && <Box component="img" src={background} alt="" draggable={false} sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />}
        {background && !!style.background?.overlay && <Box sx={{ position: 'absolute', inset: 0, bgcolor: `rgba(0,0,0,${style.background.overlay})` }} />}
        <Box
          sx={{
            position: 'relative',
            maxWidth: style.maxWidth ? MAX_WIDTH[style.maxWidth] : nested ? 'none' : '1120px',
            mx: 'auto',
            pt: `${style.padding?.top ?? defaultY}px`,
            pb: `${style.padding?.bottom ?? defaultY}px`,
            pl: `${style.padding?.left ?? defaultX}px`,
            pr: `${style.padding?.right ?? defaultX}px`,
            textAlign: align,
          }}
        >
          {!def ? (
            <Box sx={{ border: '1.5px dashed #B4443C', borderRadius: '10px', p: '20px', color: '#B4443C', fontSize: 14, textAlign: 'left', fontFamily: SITE_FONT }}>
              The block type “{node.type}” is no longer available in this environment. Remove this block, or restore the component it was built from.
            </Box>
          ) : isContainer ? (
            children.length === 0 ? (
              <Box
                sx={{
                  border: `1.5px dashed ${dropInside ? ACCENT : SITE.line}`,
                  bgcolor: dropInside ? `${ACCENT}14` : 'transparent',
                  borderRadius: '10px',
                  minHeight: 96,
                  display: 'grid',
                  placeItems: 'center',
                  color: dropInside ? ACCENT : SITE.faint,
                  fontSize: 14,
                  fontFamily: SITE_FONT,
                  transition: 'background-color 120ms, border-color 120ms',
                }}
              >
                Drop blocks here
              </Box>
            ) : node.type === 'columns' ? (
              <Box sx={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: GAP[String(node.props?.gap ?? 'md')] ?? GAP.md, alignItems: 'start' }}>
                <BlockList nodes={children} parentId={node.id} horizontal={cols > 1} />
              </Box>
            ) : (
              <BlockList nodes={children} parentId={node.id} horizontal={false} />
            )
          ) : (
            <BlockPreview node={node} def={def} ctx={preview} />
          )}
        </Box>
      </Box>

      {hiddenHere && (
        <Box sx={{ position: 'absolute', top: 6, right: 6, zIndex: 4, px: '8px', py: '3px', borderRadius: '6px', bgcolor: '#1C1C1A', color: '#fff', fontSize: 11, fontWeight: 600, fontFamily: SITE_FONT, pointerEvents: 'none' }} style={{ zoom: 1 / zoom }}>
          Hidden on {DEVICE_LABELS[device].toLowerCase()}
        </Box>
      )}

      {(showToolbar || (selected && st.readOnly)) && (
        <Stack
          direction="row"
          onClick={(e) => e.stopPropagation()}
          style={{ zoom: 1 / zoom }}
          sx={{
            position: 'absolute',
            left: 0,
            zIndex: 8,
            alignItems: 'center',
            gap: '1px',
            height: 28,
            pl: '6px',
            pr: '3px',
            bgcolor: ACCENT,
            color: '#fff',
            fontFamily: SITE_FONT,
            whiteSpace: 'nowrap',
            ...(tabInside ? { top: 0, borderRadius: '0 0 7px 0' } : { top: 0, transform: 'translateY(-100%)', borderRadius: '7px 7px 0 0' }),
          }}
        >
          <IconFor name={def?.icon ?? 'component'} sx={{ fontSize: 14 }} />
          <Box component="span" sx={{ fontSize: 12, fontWeight: 600, px: '6px' }}>
            {label}
          </Box>
          {showToolbar && (
            <>
              <DragHandle id={node.id} label={label} />
              <ToolButton label="Move up (Alt+↑)" disabled={index === 0} onClick={() => st.moveBy(node.id, -1)}>
                <KeyboardArrowUpOutlined />
              </ToolButton>
              <ToolButton label="Move down (Alt+↓)" disabled={index === count - 1} onClick={() => st.moveBy(node.id, 1)}>
                <KeyboardArrowDownOutlined />
              </ToolButton>
              <ToolButton label="Duplicate (Ctrl+D)" onClick={() => st.duplicate(node.id)}>
                <ContentCopyOutlined sx={{ fontSize: '14px !important' }} />
              </ToolButton>
              <ToolButton label="Delete (Del)" danger onClick={() => st.remove(node.id)}>
                <DeleteOutlineOutlined />
              </ToolButton>
            </>
          )}
        </Stack>
      )}
    </Box>
  );
});

function BlockList({ nodes, parentId, horizontal }: { nodes: BlockNode[]; parentId: string | null; horizontal: boolean }) {
  return (
    <>
      {nodes.map((node, index) => (
        <BlockFrame key={node.id} node={node} parentId={parentId} index={index} count={nodes.length} horizontal={horizontal} />
      ))}
    </>
  );
}

const STARTERS: { label: string; description: string; blocks: string[] }[] = [
  { label: 'Landing page', description: 'Navigation, hero, features, call to action, footer', blocks: ['navigation', 'hero', 'feature-grid', 'cta', 'footer'] },
  { label: 'Article', description: 'Navigation, text, footer', blocks: ['navigation', 'text', 'footer'] },
  { label: 'About page', description: 'Navigation, hero, image and text, team, footer', blocks: ['navigation', 'hero', 'split', 'team', 'footer'] },
];

function EmptyCanvas({ dropActive }: { dropActive: boolean }) {
  const st = useEditorStatic();
  const dispatch = useAppDispatch();
  const start = (types: string[]) => {
    types.forEach((type, index) => {
      const def = st.registry[type];
      if (def) dispatch(pageEditorActions.blockInserted({ block: createBlockNode(def), parentId: null, index }));
    });
    dispatch(pageEditorActions.selected(null));
  };
  return (
    <Box sx={{ minHeight: 520, display: 'grid', placeItems: 'center', p: '48px', fontFamily: SITE_FONT }}>
      <Box sx={{ width: '100%', maxWidth: 560, textAlign: 'center', border: `1.5px dashed ${dropActive ? ACCENT : SITE.line}`, bgcolor: dropActive ? `${ACCENT}10` : 'transparent', borderRadius: '16px', p: '40px', transition: 'background-color 120ms, border-color 120ms' }}>
        <Box sx={{ width: 44, height: 44, borderRadius: '12px', bgcolor: SITE.soft, color: SITE.muted, display: 'grid', placeItems: 'center', mx: 'auto', mb: '16px' }}>
          <WidgetsOutlined />
        </Box>
        <Box sx={{ fontSize: 18, fontWeight: 600, color: SITE.ink }}>This page is empty</Box>
        <Box sx={{ fontSize: 14, color: SITE.muted, mt: '6px' }}>
          {st.readOnly ? 'No blocks have been added to this page.' : 'Drag a block from the left, or begin with a starter layout.'}
        </Box>
        {!st.readOnly && (
          <Box sx={{ display: 'grid', gap: '10px', mt: '24px', textAlign: 'left' }}>
            {STARTERS.map((starter) => (
              <ButtonBase
                key={starter.label}
                onClick={(e) => {
                  e.stopPropagation();
                  start(starter.blocks);
                }}
                sx={{ justifyContent: 'space-between', gap: '16px', px: '16px', py: '12px', borderRadius: '10px', border: `1px solid ${SITE.line}`, bgcolor: SITE.surface, color: SITE.ink, textAlign: 'left', fontFamily: 'inherit', '&:hover': { borderColor: ACCENT, bgcolor: `${ACCENT}0A` } }}
              >
                <Box>
                  <Box sx={{ fontSize: 14, fontWeight: 600 }}>{starter.label}</Box>
                  <Box sx={{ fontSize: 13, color: SITE.muted }}>{starter.description}</Box>
                </Box>
                <Box sx={{ fontSize: 13, fontWeight: 600, color: ACCENT, whiteSpace: 'nowrap' }}>Use layout</Box>
              </ButtonBase>
            ))}
          </Box>
        )}
      </Box>
    </Box>
  );
}

/**
 * The page sheet. A full-width layout is rendered at its real width and zoomed out to fit,
 * so editors see true proportions instead of a squeezed desktop layout.
 */
export function Canvas({ blocks }: { blocks: BlockNode[] }) {
  const st = useEditorStatic();
  const live = useEditorLive();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 1000, height: 600 });

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    measure();
    return () => observer.disconnect();
  }, []);

  // Bring the selected block into view when it was chosen from the outline, the palette or the issue list.
  useEffect(() => {
    if (!live.selectedId) return;
    const el = scrollRef.current?.querySelector(`[data-drop-kind="block"][data-block-id="${live.selectedId}"]`);
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [live.selectedId]);

  const preview = useMemo<PreviewContext>(
    () => ({
      device: live.device,
      assets: live.assets,
      registry: st.registry,
      componentFields: st.componentFields,
      typeIds: st.typeIds,
      envBase: st.envBase,
      envId: st.envId,
      pagePath: live.pagePath,
      pageTitle: live.pageTitle,
    }),
    [live.device, live.assets, live.pagePath, live.pageTitle, st],
  );

  const rootDrop = live.dropTarget?.parentId === null && blocks.length === 0;
  // Desktop is laid out at no less than a real desktop width and zoomed out to fit the space available.
  const available = Math.max(240, size.width - 48);
  const logical = live.device === 'desktop' ? Math.max(available, DEVICE_WIDTH.desktop) : DEVICE_WIDTH[live.device];
  const zoom = Math.max(0.35, Math.min(1, available / logical));

  return (
    <Box
      ref={scrollRef}
      data-drop-kind="canvas"
      data-canvas-scroll
      onClick={() => st.select(null)}
      sx={{ flex: 1, minWidth: 0, height: '100%', overflow: 'auto', bgcolor: 'surface.sunken', px: 6, pt: 9, pb: 12, userSelect: 'none' }}
    >
      <PreviewCtx.Provider value={preview}>
        <ZoomCtx.Provider value={zoom}>
        <Box
          data-color-scheme="light"
          data-canvas
          aria-label={`Page canvas, ${DEVICE_LABELS[live.device].toLowerCase()} preview`}
          style={{ zoom }}
          sx={{
            // Percentages are not scaled by zoom, pixel lengths are: 100% fills the space, px widths shrink with it.
            width: live.device === 'desktop' ? '100%' : `${DEVICE_WIDTH[live.device]}px`,
            minHeight: Math.max(480, (size.height - 84) / zoom),
            mx: 'auto',
            bgcolor: SITE.surface,
            color: SITE.ink,
            fontFamily: SITE_FONT,
            boxShadow: '0 1px 2px rgba(17,17,16,0.08), 0 12px 40px rgba(17,17,16,0.10)',
            borderRadius: live.device === 'desktop' ? '6px' : '14px',
            transition: 'width 220ms cubic-bezier(0.2, 0, 0, 1), border-radius 220ms',
            position: 'relative',
          }}
        >
          {blocks.length === 0 ? <EmptyCanvas dropActive={rootDrop} /> : <BlockList nodes={blocks} parentId={null} horizontal={false} />}
        </Box>
        </ZoomCtx.Provider>
      </PreviewCtx.Provider>
      {blocks.length > 0 && !st.readOnly && (
        <Typography variant="caption" color="text.disabled" component="div" sx={{ textAlign: 'center', mt: 4 }}>
          Drag blocks from the palette, or select a block and add after it.
        </Typography>
      )}
    </Box>
  );
}
