import { useEffect, useMemo, useState } from 'react';
import { html } from '@codemirror/lang-html';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import CodeMirror, { EditorView } from '@uiw/react-codemirror';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import Box from '@mui/material/Box';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import { useColorScheme } from '@mui/material/styles';
import { FONT_MONO } from '@/theme/theme';

const LANGUAGES = {
  json: () => json(),
  javascript: () => javascript(),
  typescript: () => javascript({ typescript: true }),
  jsx: () => javascript({ jsx: true }),
  tsx: () => javascript({ jsx: true, typescript: true }),
  html: () => html(),
  markdown: () => markdown(),
} as const;

export type CodeLanguage = keyof typeof LANGUAGES | 'text' | 'graphql' | 'css' | 'bash';

function useDark() {
  const { mode, systemMode } = useColorScheme();
  return (mode === 'system' ? systemMode : mode) === 'dark';
}

export interface CodeEditorProps {
  value: string;
  onChange?: (value: string) => void;
  language?: CodeLanguage | string;
  readOnly?: boolean;
  minHeight?: number;
  maxHeight?: number;
  invalid?: boolean;
  placeholder?: string;
  ariaLabel?: string;
}

/** CodeMirror wrapped to match the form controls: same border, radius, focus ring and typography. */
export function CodeEditor({ value, onChange, language = 'text', readOnly, minHeight = 120, maxHeight = 420, invalid, placeholder, ariaLabel }: CodeEditorProps) {
  const dark = useDark();
  const extensions = useMemo(() => {
    const factory = LANGUAGES[language as keyof typeof LANGUAGES];
    return [
      ...(factory ? [factory()] : []),
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({ 'aria-label': ariaLabel ?? 'Code editor' }),
      EditorView.theme({
        '&': { fontSize: '12.5px', backgroundColor: 'transparent' },
        '.cm-content': { fontFamily: FONT_MONO, padding: '8px 0' },
        '.cm-gutters': { backgroundColor: 'transparent', border: 'none', color: 'var(--mui-palette-text-disabled)' },
        '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'transparent' },
        '&.cm-focused': { outline: 'none' },
        '.cm-scroller': { fontFamily: FONT_MONO, lineHeight: '1.6' },
      }),
    ];
  }, [language, ariaLabel]);

  return (
    <Box
      sx={{
        border: 1,
        borderColor: invalid ? 'error.main' : 'border.strong',
        borderRadius: '7px',
        overflow: 'hidden',
        bgcolor: readOnly ? 'surface.subtle' : 'background.paper',
        transition: 'border-color 120ms, box-shadow 120ms',
        '&:focus-within': { borderColor: invalid ? 'error.main' : 'secondary.main', boxShadow: '0 0 0 3px var(--mui-palette-action-focus)' },
      }}
    >
      <CodeMirror
        value={value}
        onChange={onChange}
        extensions={extensions}
        theme={dark ? 'dark' : 'light'}
        editable={!readOnly}
        readOnly={readOnly}
        minHeight={`${minHeight}px`}
        maxHeight={`${maxHeight}px`}
        placeholder={placeholder}
        basicSetup={{ foldGutter: false, highlightActiveLine: false, highlightActiveLineGutter: false, lineNumbers: true, autocompletion: !readOnly }}
      />
    </Box>
  );
}

/**
 * JSON editor that keeps the user's text while it is invalid and only reports a value
 * upward once it parses, so half-typed JSON never corrupts the form state.
 */
export function JsonEditor({
  value,
  onChange,
  readOnly,
  minHeight,
  maxHeight,
  onValidity,
  ariaLabel,
}: {
  value: unknown;
  onChange?: (value: unknown) => void;
  readOnly?: boolean;
  minHeight?: number;
  maxHeight?: number;
  onValidity?: (valid: boolean) => void;
  ariaLabel?: string;
}) {
  const serialized = useMemo(() => (value === undefined || value === null ? '' : JSON.stringify(value, null, 2)), [value]);
  const [text, setText] = useState(serialized);
  const [error, setError] = useState<string | null>(null);

  // Adopt outside changes (loading another entry, restoring a version) unless they equal what is typed.
  useEffect(() => {
    setText((current) => {
      try {
        if (current.trim() && JSON.stringify(JSON.parse(current)) === JSON.stringify(value ?? null)) return current;
      } catch {
        // The local text is mid-edit and invalid; keep it unless the outside value really changed.
        if (error) return current;
      }
      return serialized;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serialized]);

  const handle = (next: string) => {
    setText(next);
    if (!next.trim()) {
      setError(null);
      onValidity?.(true);
      onChange?.(null);
      return;
    }
    try {
      const parsed = JSON.parse(next);
      setError(null);
      onValidity?.(true);
      onChange?.(parsed);
    } catch (err) {
      setError((err as Error).message.replace(/^JSON\.parse: /, ''));
      onValidity?.(false);
    }
  };

  return (
    <Box>
      <CodeEditor value={text} onChange={readOnly ? undefined : handle} language="json" readOnly={readOnly} minHeight={minHeight} maxHeight={maxHeight} invalid={!!error} ariaLabel={ariaLabel} />
      {error && (
        <Typography variant="caption" color="error" role="alert" sx={{ mt: 1, display: 'block' }}>
          Invalid JSON — {error}
        </Typography>
      )}
    </Box>
  );
}

/** Renders Markdown to sanitized HTML. */
export function renderMarkdown(source: string): string {
  return DOMPurify.sanitize(marked.parse(source, { async: false, gfm: true, breaks: true }) as string);
}

export const proseSx = {
  fontSize: '0.875rem',
  lineHeight: 1.65,
  overflowWrap: 'anywhere',
  '& > :first-of-type': { mt: 0 },
  '& > :last-child': { mb: 0 },
  '& h1': { fontSize: '1.5rem', fontWeight: 600, letterSpacing: '-0.02em', mt: 5, mb: 2 },
  '& h2': { fontSize: '1.25rem', fontWeight: 600, letterSpacing: '-0.015em', mt: 5, mb: 2 },
  '& h3': { fontSize: '1.0625rem', fontWeight: 600, mt: 4, mb: 1.5 },
  '& h4, & h5, & h6': { fontSize: '0.9375rem', fontWeight: 600, mt: 4, mb: 1.5 },
  '& p': { my: 2.5 },
  '& ul, & ol': { pl: 6, my: 2.5 },
  '& li > p': { my: 0.5 },
  '& blockquote': { m: 0, my: 3, pl: 4, borderLeft: 3, borderColor: 'border.strong', color: 'text.secondary' },
  '& code': { fontSize: '0.8125rem', px: 1, py: 0.25, borderRadius: '4px', bgcolor: 'surface.sunken' },
  '& pre': { p: 3.5, borderRadius: '8px', bgcolor: 'surface.sunken', overflow: 'auto', '& code': { p: 0, bgcolor: 'transparent' } },
  '& hr': { border: 0, borderTop: 1, borderColor: 'border.subtle', my: 5 },
  '& img, & video': { maxWidth: '100%', height: 'auto', borderRadius: '8px' },
  '& a': { color: 'secondary.main', textDecoration: 'underline' },
  '& table': { borderCollapse: 'collapse', width: '100%', my: 3, tableLayout: 'fixed' },
  '& th, & td': { border: 1, borderColor: 'border.strong', px: 2.5, py: 1.5, textAlign: 'left', verticalAlign: 'top' },
  '& th': { bgcolor: 'surface.subtle', fontWeight: 600 },
  '& mark': { borderRadius: '3px', px: 0.5 },
} as const;

export function MarkdownEditor({ value, onChange, readOnly, invalid }: { value: string; onChange: (value: string) => void; readOnly?: boolean; invalid?: boolean }) {
  const [view, setView] = useState<'write' | 'preview'>('write');
  const rendered = useMemo(() => (view === 'preview' ? renderMarkdown(value) : ''), [value, view]);
  return (
    <Box>
      <ToggleButtonGroup size="small" exclusive value={view} onChange={(_, next) => next && setView(next)} sx={{ mb: 2 }} aria-label="Markdown view">
        <ToggleButton value="write">Write</ToggleButton>
        <ToggleButton value="preview">Preview</ToggleButton>
      </ToggleButtonGroup>
      {view === 'write' ? (
        <CodeEditor value={value} onChange={onChange} language="markdown" readOnly={readOnly} minHeight={180} invalid={invalid} ariaLabel="Markdown" />
      ) : (
        <Box sx={{ border: 1, borderColor: 'border.strong', borderRadius: '7px', p: 4, minHeight: 180, bgcolor: 'background.paper', ...proseSx }}>
          {value.trim() ? <div dangerouslySetInnerHTML={{ __html: rendered }} /> : <Typography color="text.disabled">Nothing to preview yet</Typography>}
        </Box>
      )}
    </Box>
  );
}
