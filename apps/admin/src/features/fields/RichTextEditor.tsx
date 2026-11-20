import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Highlight } from '@tiptap/extension-highlight';
import { Image } from '@tiptap/extension-image';
import { TableKit } from '@tiptap/extension-table';
import { TextAlign } from '@tiptap/extension-text-align';
import { Color, TextStyle } from '@tiptap/extension-text-style';
import { Placeholder } from '@tiptap/extensions';
import { type Editor, EditorContent, type Extensions, Node, mergeAttributes, useEditor, useEditorState } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import Checkbox from '@mui/material/Checkbox';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Popover from '@mui/material/Popover';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import AddLinkOutlined from '@mui/icons-material/AddLinkOutlined';
import BorderColorOutlined from '@mui/icons-material/BorderColorOutlined';
import CodeOutlined from '@mui/icons-material/CodeOutlined';
import DataObjectOutlined from '@mui/icons-material/DataObjectOutlined';
import ExpandMoreOutlined from '@mui/icons-material/ExpandMoreOutlined';
import FormatAlignCenterOutlined from '@mui/icons-material/FormatAlignCenterOutlined';
import FormatAlignJustifyOutlined from '@mui/icons-material/FormatAlignJustifyOutlined';
import FormatAlignLeftOutlined from '@mui/icons-material/FormatAlignLeftOutlined';
import FormatAlignRightOutlined from '@mui/icons-material/FormatAlignRightOutlined';
import FormatBoldOutlined from '@mui/icons-material/FormatBoldOutlined';
import FormatClearOutlined from '@mui/icons-material/FormatClearOutlined';
import FormatColorTextOutlined from '@mui/icons-material/FormatColorTextOutlined';
import FormatItalicOutlined from '@mui/icons-material/FormatItalicOutlined';
import FormatListBulletedOutlined from '@mui/icons-material/FormatListBulletedOutlined';
import FormatListNumberedOutlined from '@mui/icons-material/FormatListNumberedOutlined';
import FormatQuoteOutlined from '@mui/icons-material/FormatQuoteOutlined';
import FormatUnderlinedOutlined from '@mui/icons-material/FormatUnderlinedOutlined';
import HorizontalRuleOutlined from '@mui/icons-material/HorizontalRuleOutlined';
import ImageOutlined from '@mui/icons-material/ImageOutlined';
import MovieOutlined from '@mui/icons-material/MovieOutlined';
import RedoOutlined from '@mui/icons-material/RedoOutlined';
import SmartDisplayOutlined from '@mui/icons-material/SmartDisplayOutlined';
import StrikethroughSOutlined from '@mui/icons-material/StrikethroughSOutlined';
import TableChartOutlined from '@mui/icons-material/TableChartOutlined';
import UndoOutlined from '@mui/icons-material/UndoOutlined';
import { type RichTextDoc, canonicalJson, emptyRichText, isRichTextDoc, sanitizeRichText } from '@meridian/shared';
import { proseSx } from './CodeEditor';
import { MediaPickerDialog } from './MediaField';

/** Uploaded video, stored as a block node so it survives the server-side whitelist. */
const Video = Node.create({
  name: 'video',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      src: { default: null },
      poster: { default: null },
      assetId: { default: null, parseHTML: (el: HTMLElement) => el.getAttribute('data-asset-id'), renderHTML: (attrs: { assetId?: string }) => (attrs.assetId ? { 'data-asset-id': attrs.assetId } : {}) },
    };
  },
  parseHTML() {
    return [{ tag: 'video[src]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['video', mergeAttributes(HTMLAttributes, { controls: 'true', preload: 'metadata' })];
  },
});

/** External embed (YouTube, Vimeo, …), rendered in a sandboxed frame. */
const Embed = Node.create({
  name: 'embed',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes() {
    return { src: { default: null }, provider: { default: null } };
  },
  parseHTML() {
    return [{ tag: 'iframe[src]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      { class: 'rt-embed' },
      ['iframe', { src: HTMLAttributes.src, loading: 'lazy', allowfullscreen: 'true', referrerpolicy: 'strict-origin-when-cross-origin', sandbox: 'allow-scripts allow-same-origin allow-presentation' }],
    ];
  },
});

const AssetImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      assetId: { default: null, parseHTML: (el: HTMLElement) => el.getAttribute('data-asset-id'), renderHTML: (attrs: { assetId?: string }) => (attrs.assetId ? { 'data-asset-id': attrs.assetId } : {}) },
    };
  },
});

/** Turns a watch/share link into its embeddable form. Returns null for anything that is not https. */
export function toEmbedUrl(raw: string): { src: string; provider: string } | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  const host = url.hostname.replace(/^www\./, '');
  if (host === 'youtube.com' && url.searchParams.get('v')) return { src: `https://www.youtube-nocookie.com/embed/${url.searchParams.get('v')}`, provider: 'youtube' };
  if (host === 'youtu.be' && url.pathname.length > 1) return { src: `https://www.youtube-nocookie.com/embed${url.pathname}`, provider: 'youtube' };
  if (host === 'vimeo.com' && /^\/\d+/.test(url.pathname)) return { src: `https://player.vimeo.com/video${url.pathname.match(/^\/\d+/)?.[0]}`, provider: 'vimeo' };
  return { src: url.toString(), provider: host };
}

export interface RichTextConfig {
  /** Toolbar groups to hide, for simpler editors (e.g. captions). */
  disable?: ('media' | 'tables' | 'colors' | 'alignment' | 'headings')[];
  placeholder?: string;
  minHeight?: number;
  /** Extra TipTap extensions, for project-specific nodes and marks. */
  extensions?: Extensions;
}

/** One place that defines the editor's schema, so every rich-text field stores the same structure. */
export function buildExtensions(config: RichTextConfig = {}): Extensions {
  const off = new Set(config.disable ?? []);
  return [
    StarterKit.configure({
      heading: off.has('headings') ? false : { levels: [1, 2, 3, 4] },
      link: { openOnClick: false, autolink: true, protocols: ['http', 'https', 'mailto', 'tel'], HTMLAttributes: { rel: 'noopener noreferrer' } },
    }),
    Placeholder.configure({ placeholder: config.placeholder ?? 'Write something…' }),
    ...(off.has('alignment') ? [] : [TextAlign.configure({ types: ['heading', 'paragraph'] })]),
    ...(off.has('colors') ? [] : [TextStyle, Color, Highlight.configure({ multicolor: true })]),
    ...(off.has('media') ? [] : [AssetImage, Video, Embed]),
    ...(off.has('tables') ? [] : [TableKit.configure({ table: { resizable: false } })]),
    ...(config.extensions ?? []),
  ];
}

function Tool({ label, active, disabled, onClick, children }: { label: string; active?: boolean; disabled?: boolean; onClick: (anchor: HTMLElement) => void; children: ReactNode }) {
  return (
    <Tooltip title={label}>
      <span>
        <ButtonBase
          aria-label={label}
          aria-pressed={active}
          disabled={disabled}
          // Keep the text selection: the toolbar must not take focus away from the document.
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => onClick(e.currentTarget)}
          sx={{ width: 28, height: 28, borderRadius: '6px', color: active ? 'secondary.main' : 'text.secondary', bgcolor: active ? 'action.selected' : 'transparent', '&:hover': { bgcolor: active ? 'action.selected' : 'action.hover', color: active ? 'secondary.main' : 'text.primary' }, '&.Mui-disabled': { opacity: 0.35 }, '& svg': { fontSize: 17 } }}
        >
          {children}
        </ButtonBase>
      </span>
    </Tooltip>
  );
}

const Sep = () => <Divider orientation="vertical" flexItem sx={{ mx: 1, my: 1 }} />;

const TEXT_COLORS = ['#1C1C1A', '#5E5C56', '#1F6F5C', '#4A6B85', '#B4721A', '#B4443C', '#6B5B7B'];
const HIGHLIGHTS = ['#FBF1DF', '#E6F2EC', '#E9EFF4', '#FAEBE9', '#EFE9F4'];

function Swatches({ colors, current, onPick, onClear, label }: { colors: string[]; current?: string | null; onPick: (color: string) => void; onClear: () => void; label: string }) {
  return (
    <Box sx={{ p: 3, width: 196 }}>
      <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 2 }}>
        {label}
      </Typography>
      <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1.5 }}>
        {colors.map((color) => (
          <ButtonBase key={color} aria-label={`${label} ${color}`} aria-pressed={current === color} onClick={() => onPick(color)} sx={{ width: 22, height: 22, borderRadius: '6px', bgcolor: color, border: 2, borderColor: current === color ? 'secondary.main' : 'border.strong' }} />
        ))}
      </Stack>
      <Button size="small" onClick={onClear} sx={{ mt: 2 }}>
        Remove
      </Button>
    </Box>
  );
}

function Toolbar({ editor, config }: { editor: Editor; config: RichTextConfig }) {
  const off = new Set(config.disable ?? []);
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      underline: e.isActive('underline'),
      strike: e.isActive('strike'),
      code: e.isActive('code'),
      bullet: e.isActive('bulletList'),
      ordered: e.isActive('orderedList'),
      quote: e.isActive('blockquote'),
      codeBlock: e.isActive('codeBlock'),
      link: e.isActive('link'),
      table: e.isActive('table'),
      heading: [1, 2, 3, 4].find((level) => e.isActive('heading', { level })) ?? 0,
      align: (['center', 'right', 'justify'] as const).find((a) => e.isActive({ textAlign: a })) ?? 'left',
      color: (e.getAttributes('textStyle').color as string | undefined) ?? null,
      highlight: e.isActive('highlight') ? ((e.getAttributes('highlight').color as string | undefined) ?? '#FBF1DF') : null,
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  });

  const [blockAnchor, setBlockAnchor] = useState<HTMLElement | null>(null);
  const [tableAnchor, setTableAnchor] = useState<HTMLElement | null>(null);
  const [popover, setPopover] = useState<{ kind: 'link' | 'color' | 'highlight' | 'embed'; anchor: HTMLElement } | null>(null);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkBlank, setLinkBlank] = useState(false);
  const [embedUrl, setEmbedUrl] = useState('');
  const [embedError, setEmbedError] = useState('');
  const [picker, setPicker] = useState<'image' | 'video' | null>(null);
  const chain = () => editor.chain().focus();

  const openLink = (anchor: HTMLElement) => {
    const attrs = editor.getAttributes('link');
    setLinkUrl((attrs.href as string) ?? '');
    setLinkBlank(attrs.target === '_blank');
    setPopover({ kind: 'link', anchor });
  };
  const applyLink = () => {
    const href = linkUrl.trim();
    if (!href) chain().extendMarkRange('link').unsetLink().run();
    else if (/^(https?:\/\/|mailto:|tel:|\/|#)/i.test(href)) chain().extendMarkRange('link').setLink({ href, target: linkBlank ? '_blank' : null }).run();
    else chain().extendMarkRange('link').setLink({ href: `https://${href}`, target: linkBlank ? '_blank' : null }).run();
    setPopover(null);
  };
  const applyEmbed = () => {
    const embed = toEmbedUrl(embedUrl);
    if (!embed) return setEmbedError('Enter a full https:// link');
    chain().insertContent({ type: 'embed', attrs: embed }).run();
    setEmbedUrl('');
    setEmbedError('');
    setPopover(null);
  };

  const blockLabel = state.heading ? `Heading ${state.heading}` : state.codeBlock ? 'Code block' : 'Paragraph';
  const alignments = [
    ['left', 'Align left', <FormatAlignLeftOutlined key="l" />],
    ['center', 'Align center', <FormatAlignCenterOutlined key="c" />],
    ['right', 'Align right', <FormatAlignRightOutlined key="r" />],
    ['justify', 'Justify', <FormatAlignJustifyOutlined key="j" />],
  ] as const;

  return (
    <Stack direction="row" role="toolbar" aria-label="Formatting" sx={{ flexWrap: 'wrap', alignItems: 'center', gap: 0.25, px: 1.5, py: 1, borderBottom: 1, borderColor: 'border.subtle', bgcolor: 'surface.subtle' }}>
      <Tool label="Undo" disabled={!state.canUndo} onClick={() => chain().undo().run()}><UndoOutlined /></Tool>
      <Tool label="Redo" disabled={!state.canRedo} onClick={() => chain().redo().run()}><RedoOutlined /></Tool>
      <Sep />
      {!off.has('headings') && (
        <>
          <ButtonBase aria-haspopup="menu" aria-label={`Text style: ${blockLabel}`} onMouseDown={(e) => e.preventDefault()} onClick={(e) => setBlockAnchor(e.currentTarget)} sx={{ height: 28, px: 2, gap: 0.5, borderRadius: '6px', fontSize: '0.75rem', fontWeight: 500, color: 'text.primary', minWidth: 104, justifyContent: 'space-between', '&:hover': { bgcolor: 'action.hover' } }}>
            {blockLabel}
            <ExpandMoreOutlined sx={{ fontSize: 15, color: 'text.disabled' }} />
          </ButtonBase>
          <Menu anchorEl={blockAnchor} open={!!blockAnchor} onClose={() => setBlockAnchor(null)}>
            <MenuItem selected={!state.heading && !state.codeBlock} onClick={() => { chain().setParagraph().run(); setBlockAnchor(null); }}>Paragraph</MenuItem>
            {([1, 2, 3, 4] as const).map((level) => (
              <MenuItem key={level} selected={state.heading === level} onClick={() => { chain().setHeading({ level }).run(); setBlockAnchor(null); }} sx={{ fontWeight: 600, fontSize: `${1.2 - level * 0.09}rem !important` }}>
                Heading {level}
              </MenuItem>
            ))}
          </Menu>
          <Sep />
        </>
      )}
      <Tool label="Bold (Ctrl+B)" active={state.bold} onClick={() => chain().toggleBold().run()}><FormatBoldOutlined /></Tool>
      <Tool label="Italic (Ctrl+I)" active={state.italic} onClick={() => chain().toggleItalic().run()}><FormatItalicOutlined /></Tool>
      <Tool label="Underline (Ctrl+U)" active={state.underline} onClick={() => chain().toggleUnderline().run()}><FormatUnderlinedOutlined /></Tool>
      <Tool label="Strikethrough" active={state.strike} onClick={() => chain().toggleStrike().run()}><StrikethroughSOutlined /></Tool>
      <Tool label="Inline code" active={state.code} onClick={() => chain().toggleCode().run()}><CodeOutlined /></Tool>
      <Tool label="Link" active={state.link} onClick={openLink}><AddLinkOutlined /></Tool>
      {!off.has('colors') && (
        <>
          <Tooltip title="Text color">
            <ButtonBase aria-label="Text color" onMouseDown={(e) => e.preventDefault()} onClick={(e) => setPopover({ kind: 'color', anchor: e.currentTarget })} sx={{ width: 28, height: 28, borderRadius: '6px', color: state.color ?? 'text.secondary', '&:hover': { bgcolor: 'action.hover' }, '& svg': { fontSize: 17 } }}>
              <FormatColorTextOutlined />
            </ButtonBase>
          </Tooltip>
          <Tooltip title="Highlight">
            <ButtonBase aria-label="Highlight" aria-pressed={!!state.highlight} onMouseDown={(e) => e.preventDefault()} onClick={(e) => setPopover({ kind: 'highlight', anchor: e.currentTarget })} sx={{ width: 28, height: 28, borderRadius: '6px', color: 'text.secondary', bgcolor: state.highlight ?? 'transparent', '&:hover': { bgcolor: state.highlight ?? 'action.hover' }, '& svg': { fontSize: 16 } }}>
              <BorderColorOutlined />
            </ButtonBase>
          </Tooltip>
        </>
      )}
      <Sep />
      <Tool label="Bulleted list" active={state.bullet} onClick={() => chain().toggleBulletList().run()}><FormatListBulletedOutlined /></Tool>
      <Tool label="Numbered list" active={state.ordered} onClick={() => chain().toggleOrderedList().run()}><FormatListNumberedOutlined /></Tool>
      <Tool label="Quote" active={state.quote} onClick={() => chain().toggleBlockquote().run()}><FormatQuoteOutlined /></Tool>
      <Tool label="Code block" active={state.codeBlock} onClick={() => chain().toggleCodeBlock().run()}><DataObjectOutlined /></Tool>
      <Tool label="Divider" onClick={() => chain().setHorizontalRule().run()}><HorizontalRuleOutlined /></Tool>
      {!off.has('alignment') && (
        <>
          <Sep />
          {alignments.map(([value, label, icon]) => (
            <Tool key={value} label={label} active={state.align === value} onClick={() => chain().setTextAlign(value).run()}>{icon}</Tool>
          ))}
        </>
      )}
      {(!off.has('media') || !off.has('tables')) && <Sep />}
      {!off.has('media') && (
        <>
          <Tool label="Insert image" onClick={() => setPicker('image')}><ImageOutlined /></Tool>
          <Tool label="Insert video" onClick={() => setPicker('video')}><MovieOutlined /></Tool>
          <Tooltip title="Embed (YouTube, Vimeo, …)">
            <ButtonBase aria-label="Insert embed" onMouseDown={(e) => e.preventDefault()} onClick={(e) => setPopover({ kind: 'embed', anchor: e.currentTarget })} sx={{ width: 28, height: 28, borderRadius: '6px', color: 'text.secondary', '&:hover': { bgcolor: 'action.hover', color: 'text.primary' }, '& svg': { fontSize: 17 } }}>
              <SmartDisplayOutlined />
            </ButtonBase>
          </Tooltip>
        </>
      )}
      {!off.has('tables') && (
        <>
          <Tooltip title="Table">
            <ButtonBase aria-label="Table" aria-haspopup="menu" aria-pressed={state.table} onMouseDown={(e) => e.preventDefault()} onClick={(e) => setTableAnchor(e.currentTarget)} sx={{ width: 28, height: 28, borderRadius: '6px', color: state.table ? 'secondary.main' : 'text.secondary', bgcolor: state.table ? 'action.selected' : 'transparent', '&:hover': { bgcolor: 'action.hover' }, '& svg': { fontSize: 17 } }}>
              <TableChartOutlined />
            </ButtonBase>
          </Tooltip>
          <Menu anchorEl={tableAnchor} open={!!tableAnchor} onClose={() => setTableAnchor(null)}>
            {(
              [
                ['Insert 3 × 3 table', () => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(), false],
                ['Add row below', () => chain().addRowAfter().run(), true],
                ['Add column right', () => chain().addColumnAfter().run(), true],
                ['Toggle header row', () => chain().toggleHeaderRow().run(), true],
                ['Delete row', () => chain().deleteRow().run(), true],
                ['Delete column', () => chain().deleteColumn().run(), true],
                ['Delete table', () => chain().deleteTable().run(), true],
              ] as const
            ).map(([label, action, needsTable]) => (
              <MenuItem key={label} disabled={needsTable && !state.table} onClick={() => { action(); setTableAnchor(null); }}>
                {label}
              </MenuItem>
            ))}
          </Menu>
        </>
      )}
      <Sep />
      <Tool label="Clear formatting" onClick={() => chain().unsetAllMarks().clearNodes().run()}><FormatClearOutlined /></Tool>

      <Popover open={!!popover} anchorEl={popover?.anchor} onClose={() => setPopover(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }} slotProps={{ paper: { sx: { mt: 1, borderRadius: '10px' } } }}>
        {popover?.kind === 'link' && (
          <Box sx={{ p: 3, width: 320 }}>
            <TextField autoFocus label="Link" placeholder="https://… or /path" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applyLink(); } }} />
            <FormControlLabel sx={{ mt: 1, ml: 0 }} control={<Checkbox checked={linkBlank} onChange={(e) => setLinkBlank(e.target.checked)} />} label={<Typography variant="body2">Open in a new tab</Typography>} />
            <Stack direction="row" spacing={2} sx={{ mt: 1, justifyContent: 'flex-end' }}>
              {state.link && <Button color="error" onClick={() => { chain().extendMarkRange('link').unsetLink().run(); setPopover(null); }}>Remove</Button>}
              <Button variant="contained" onClick={applyLink}>Apply</Button>
            </Stack>
          </Box>
        )}
        {popover?.kind === 'embed' && (
          <Box sx={{ p: 3, width: 340 }}>
            <TextField autoFocus label="Video or page link" placeholder="https://www.youtube.com/watch?v=…" value={embedUrl} error={!!embedError} helperText={embedError || 'YouTube and Vimeo links are converted automatically'} onChange={(e) => { setEmbedUrl(e.target.value); setEmbedError(''); }} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applyEmbed(); } }} />
            <Stack direction="row" sx={{ mt: 2, justifyContent: 'flex-end' }}>
              <Button variant="contained" onClick={applyEmbed}>Embed</Button>
            </Stack>
          </Box>
        )}
        {popover?.kind === 'color' && <Swatches label="Text color" colors={TEXT_COLORS} current={state.color} onPick={(c) => { chain().setColor(c).run(); setPopover(null); }} onClear={() => { chain().unsetColor().run(); setPopover(null); }} />}
        {popover?.kind === 'highlight' && <Swatches label="Highlight" colors={HIGHLIGHTS} current={state.highlight} onPick={(c) => { chain().setHighlight({ color: c }).run(); setPopover(null); }} onClear={() => { chain().unsetHighlight().run(); setPopover(null); }} />}
      </Popover>

      <MediaPickerDialog
        open={!!picker}
        kind={picker ?? 'image'}
        onClose={() => setPicker(null)}
        onSelect={([asset]) => {
          if (!asset) return;
          if (asset.kind === 'video') chain().insertContent({ type: 'video', attrs: { src: asset.url, assetId: asset.id } }).run();
          else chain().setImage({ src: asset.url, alt: asset.alt || asset.filename, assetId: asset.id } as never).run();
        }}
      />
    </Stack>
  );
}

/** Order- and noise-independent identity of a rich-text value. */
const canon = (value: unknown) => canonicalJson(sanitizeRichText(value) ?? emptyRichText());

export interface RichTextEditorProps {
  value: unknown;
  onChange: (doc: RichTextDoc) => void;
  disabled?: boolean;
  invalid?: boolean;
  config?: RichTextConfig;
  ariaLabel?: string;
}

/**
 * Structured rich-text editor. Content is stored as a document tree (never raw HTML),
 * which the API validates against a whitelist and renders consistently for every consumer.
 */
export function RichTextEditor({ value, onChange, disabled, invalid, config = {}, ariaLabel }: RichTextEditorProps) {
  const extensions = useMemo(() => buildExtensions(config), [config]);
  // Canonical form of the last document seen from either side. Comparing canonical forms
  // means a document that only differs in key order or empty attributes is never reported
  // as an edit — opening an entry must not change it.
  const lastSeen = useRef<string>(canon(value));
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const editor = useEditor({
    extensions,
    content: isRichTextDoc(value) ? value : emptyRichText(),
    editable: !disabled,
    shouldRerenderOnTransaction: false,
    editorProps: { attributes: { role: 'textbox', 'aria-multiline': 'true', 'aria-label': ariaLabel ?? 'Rich text' } },
    onUpdate: ({ editor: e }) => {
      // Report the same sanitised shape the server stores.
      const doc = sanitizeRichText(e.getJSON()) ?? emptyRichText();
      const key = canonicalJson(doc);
      if (key === lastSeen.current) return;
      lastSeen.current = key;
      onChangeRef.current(doc);
    },
  });

  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [editor, disabled]);

  // Adopt outside changes: another entry was loaded, a version was restored, or an undo happened upstream.
  useEffect(() => {
    if (!editor) return;
    const key = canon(value);
    if (key === lastSeen.current) return;
    lastSeen.current = key;
    if (key !== canon(editor.getJSON())) editor.commands.setContent(isRichTextDoc(value) ? value : emptyRichText(), { emitUpdate: false });
  }, [editor, value]);

  return (
    <Box
      sx={{
        border: 1,
        borderColor: invalid ? 'error.main' : 'border.strong',
        borderRadius: '8px',
        overflow: 'hidden',
        bgcolor: disabled ? 'surface.subtle' : 'background.paper',
        transition: 'border-color 120ms, box-shadow 120ms',
        '&:focus-within': { borderColor: invalid ? 'error.main' : 'secondary.main', boxShadow: '0 0 0 3px var(--mui-palette-action-focus)' },
        '& .tiptap': { outline: 'none', minHeight: config.minHeight ?? 180, maxHeight: 640, overflowY: 'auto', px: 4, py: 3.5, ...proseSx },
        '& .tiptap p.is-editor-empty:first-of-type::before': { content: 'attr(data-placeholder)', color: 'text.disabled', float: 'left', height: 0, pointerEvents: 'none' },
        '& .tiptap .ProseMirror-selectednode': { outline: '2px solid', outlineColor: 'secondary.main', outlineOffset: 2, borderRadius: '6px' },
        '& .tiptap .selectedCell': { bgcolor: 'action.selected' },
        '& .tiptap .rt-embed': { position: 'relative', aspectRatio: '16 / 9', my: 3, borderRadius: '8px', overflow: 'hidden', bgcolor: 'surface.sunken', '& iframe': { position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0, pointerEvents: 'none' } },
      }}
    >
      {editor && !disabled && <Toolbar editor={editor} config={config} />}
      <EditorContent editor={editor} />
    </Box>
  );
}
