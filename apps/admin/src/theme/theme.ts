import { alpha, createTheme } from '@mui/material/styles';

/**
 * Meridian design language: graphite and warm neutrals, one restrained emerald accent,
 * hairline borders instead of heavy shadows, and dense but calm typography.
 *
 * `primary` is the graphite used for primary actions; `secondary` is the emerald accent
 * used for selection, focus and links.
 */

export const FONT_SANS = '"Geist Variable", "Geist", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
export const FONT_MONO = '"Geist Mono Variable", "Geist Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace';

declare module '@mui/material/styles' {
  interface Palette {
    surface: { subtle: string; sunken: string; raised: string; inverse: string };
    border: { subtle: string; strong: string };
  }
  interface PaletteOptions {
    surface?: { subtle: string; sunken: string; raised: string; inverse: string };
    border?: { subtle: string; strong: string };
  }
}

const light = {
  mode: 'light' as const,
  primary: { main: '#1F1F1D', light: '#3A3A37', dark: '#111110', contrastText: '#FFFFFF' },
  secondary: { main: '#1F6F5C', light: '#2E8A73', dark: '#175746', contrastText: '#FFFFFF' },
  success: { main: '#2F7D5B', light: '#E6F2EC', dark: '#1F5C42', contrastText: '#FFFFFF' },
  warning: { main: '#B4721A', light: '#FBF1DF', dark: '#8A5510', contrastText: '#FFFFFF' },
  error: { main: '#B4443C', light: '#FAEBE9', dark: '#8E332D', contrastText: '#FFFFFF' },
  info: { main: '#4A6B85', light: '#E9EFF4', dark: '#35506A', contrastText: '#FFFFFF' },
  background: { default: '#F7F7F5', paper: '#FFFFFF' },
  text: { primary: '#1C1C1A', secondary: '#5E5C56', disabled: '#A3A098' },
  divider: '#E8E6E1',
  surface: { subtle: '#FAFAF8', sunken: '#F2F1EE', raised: '#FFFFFF', inverse: '#1F1F1D' },
  border: { subtle: '#E8E6E1', strong: '#D5D2CB' },
  action: { hover: 'rgba(28,28,26,0.045)', selected: 'rgba(31,111,92,0.09)', focus: 'rgba(31,111,92,0.16)', disabledBackground: 'rgba(28,28,26,0.06)' },
};

const dark = {
  mode: 'dark' as const,
  primary: { main: '#EDEDEA', light: '#FFFFFF', dark: '#CFCFCB', contrastText: '#161615' },
  secondary: { main: '#52B89E', light: '#74CDB5', dark: '#3A9A82', contrastText: '#0E1F1A' },
  success: { main: '#5DB58E', light: '#1B2D25', dark: '#3F9470', contrastText: '#0E1F1A' },
  warning: { main: '#D9A04A', light: '#2E2618', dark: '#B5822F', contrastText: '#1F1808' },
  error: { main: '#DB7A72', light: '#33201E', dark: '#B85D55', contrastText: '#240F0D' },
  info: { main: '#84A6C2', light: '#1D2730', dark: '#6489A6', contrastText: '#0F1A22' },
  background: { default: '#121211', paper: '#1A1A18' },
  text: { primary: '#EDEDEA', secondary: '#A7A59E', disabled: '#6B6963' },
  divider: '#2B2B28',
  surface: { subtle: '#1E1E1C', sunken: '#151514', raised: '#222220', inverse: '#EDEDEA' },
  border: { subtle: '#2B2B28', strong: '#3B3B37' },
  action: { hover: 'rgba(237,237,234,0.06)', selected: 'rgba(82,184,158,0.14)', focus: 'rgba(82,184,158,0.22)', disabledBackground: 'rgba(237,237,234,0.08)' },
};

export const theme = createTheme({
  cssVariables: { colorSchemeSelector: 'data-color-scheme' },
  colorSchemes: { light: { palette: light }, dark: { palette: dark } },
  shape: { borderRadius: 8 },
  spacing: 4,
  typography: {
    fontFamily: FONT_SANS,
    fontSize: 13,
    htmlFontSize: 16,
    fontWeightMedium: 500,
    fontWeightBold: 600,
    h1: { fontSize: '1.75rem', fontWeight: 600, letterSpacing: '-0.022em', lineHeight: 1.2 },
    h2: { fontSize: '1.375rem', fontWeight: 600, letterSpacing: '-0.018em', lineHeight: 1.25 },
    h3: { fontSize: '1.125rem', fontWeight: 600, letterSpacing: '-0.012em', lineHeight: 1.3 },
    h4: { fontSize: '1rem', fontWeight: 600, letterSpacing: '-0.008em', lineHeight: 1.35 },
    h5: { fontSize: '0.875rem', fontWeight: 600, lineHeight: 1.4 },
    h6: { fontSize: '0.8125rem', fontWeight: 600, lineHeight: 1.4 },
    subtitle1: { fontSize: '0.875rem', fontWeight: 500, lineHeight: 1.45 },
    subtitle2: { fontSize: '0.8125rem', fontWeight: 500, lineHeight: 1.45 },
    body1: { fontSize: '0.875rem', lineHeight: 1.55 },
    body2: { fontSize: '0.8125rem', lineHeight: 1.5 },
    caption: { fontSize: '0.75rem', lineHeight: 1.4 },
    overline: { fontSize: '0.6875rem', fontWeight: 600, letterSpacing: '0.06em', lineHeight: 1.4, textTransform: 'uppercase' },
    button: { fontSize: '0.8125rem', fontWeight: 500, textTransform: 'none', letterSpacing: 0 },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: (t) => ({
        ':root': { colorScheme: 'light dark' },
        html: { height: '100%' },
        body: { height: '100%', backgroundColor: t.vars.palette.background.default, fontFeatureSettings: '"cv11", "ss01"', WebkitFontSmoothing: 'antialiased' },
        '#root': { height: '100%' },
        '::selection': { backgroundColor: t.vars.palette.action.focus },
        '*': { scrollbarWidth: 'thin', scrollbarColor: `${t.vars.palette.border.strong} transparent` },
        'code, pre, kbd': { fontFamily: FONT_MONO },
        a: { color: t.vars.palette.secondary.main, textDecoration: 'none' },
        'a:hover': { textDecoration: 'underline' },
        ':focus-visible': { outline: `2px solid ${t.vars.palette.secondary.main}`, outlineOffset: 2 },
        '@media (prefers-reduced-motion: reduce)': {
          '*, *::before, *::after': { animationDuration: '0.001ms !important', animationIterationCount: '1 !important', transitionDuration: '0.001ms !important', scrollBehavior: 'auto !important' },
        },
      }),
    },
    MuiButtonBase: { defaultProps: { disableRipple: true } },
    MuiButton: {
      defaultProps: { disableElevation: true, size: 'medium' },
      styleOverrides: {
        root: ({ theme: t }) => ({ borderRadius: 7, paddingInline: 12, minHeight: 32, gap: 2, whiteSpace: 'nowrap', transition: t.transitions.create(['background-color', 'border-color', 'color', 'box-shadow'], { duration: 120 }) }),
        sizeSmall: { minHeight: 28, paddingInline: 10, fontSize: '0.75rem' },
        sizeLarge: { minHeight: 38, paddingInline: 16, fontSize: '0.875rem' },
        outlined: ({ theme: t }) => ({ borderColor: t.vars.palette.border.strong, color: t.vars.palette.text.primary, backgroundColor: t.vars.palette.background.paper, '&:hover': { borderColor: t.vars.palette.text.secondary, backgroundColor: t.vars.palette.action.hover } }),
        text: ({ theme: t }) => ({ color: t.vars.palette.text.primary, '&:hover': { backgroundColor: t.vars.palette.action.hover } }),
        startIcon: { marginRight: 4, '& > *:nth-of-type(1)': { fontSize: 16 } },
        endIcon: { marginLeft: 4, '& > *:nth-of-type(1)': { fontSize: 16 } },
      },
    },
    MuiIconButton: {
      defaultProps: { size: 'small' },
      styleOverrides: {
        root: ({ theme: t }) => ({ borderRadius: 7, color: t.vars.palette.text.secondary, '&:hover': { backgroundColor: t.vars.palette.action.hover, color: t.vars.palette.text.primary } }),
        sizeSmall: { padding: 6, '& svg': { fontSize: 18 } },
      },
    },
    MuiPaper: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: ({ theme: t }) => ({ backgroundImage: 'none', border: `1px solid ${t.vars.palette.border.subtle}` }),
        elevation8: ({ theme: t }) => ({ boxShadow: t.palette.mode === 'dark' ? '0 12px 32px rgba(0,0,0,0.5)' : '0 10px 30px rgba(28,28,26,0.10), 0 2px 6px rgba(28,28,26,0.05)' }),
      },
    },
    MuiCard: { styleOverrides: { root: { borderRadius: 10 } } },
    MuiAppBar: { styleOverrides: { root: { border: 'none' } } },
    MuiPopover: { defaultProps: { elevation: 8 } },
    MuiMenu: {
      defaultProps: { elevation: 8 },
      styleOverrides: { paper: { borderRadius: 9, marginTop: 4, minWidth: 180 }, list: { padding: 4 } },
    },
    MuiMenuItem: {
      styleOverrides: {
        root: ({ theme: t }) => ({ borderRadius: 6, minHeight: 32, fontSize: '0.8125rem', gap: 8, paddingInline: 8, '&.Mui-selected': { backgroundColor: t.vars.palette.action.selected } }),
      },
    },
    MuiListItemIcon: { styleOverrides: { root: { minWidth: 28, color: 'inherit', '& svg': { fontSize: 17 } } } },
    MuiListItemButton: {
      styleOverrides: {
        root: ({ theme: t }) => ({ borderRadius: 7, '&.Mui-selected': { backgroundColor: t.vars.palette.action.selected, '&:hover': { backgroundColor: t.vars.palette.action.selected } } }),
      },
    },
    MuiDialog: {
      defaultProps: { fullWidth: true, maxWidth: 'sm' },
      styleOverrides: { paper: ({ theme: t }) => ({ borderRadius: 12, boxShadow: t.palette.mode === 'dark' ? '0 24px 64px rgba(0,0,0,0.6)' : '0 24px 64px rgba(28,28,26,0.18)' }) },
    },
    MuiDialogTitle: { styleOverrides: { root: { fontSize: '1rem', fontWeight: 600, padding: '18px 22px 6px' } } },
    MuiDialogContent: { styleOverrides: { root: { padding: '10px 22px 18px' } } },
    MuiDialogActions: { styleOverrides: { root: ({ theme: t }) => ({ padding: '12px 22px', borderTop: `1px solid ${t.vars.palette.border.subtle}`, gap: 4 }) } },
    MuiBackdrop: { styleOverrides: { root: { backgroundColor: 'rgba(17,17,16,0.42)' }, invisible: { backgroundColor: 'transparent' } } },
    MuiDrawer: { styleOverrides: { paper: { borderTop: 'none', borderBottom: 'none', borderRadius: 0 } } },
    MuiTextField: { defaultProps: { size: 'small', variant: 'outlined', fullWidth: true } },
    MuiFormControl: { defaultProps: { size: 'small' } },
    MuiSelect: { defaultProps: { size: 'small' } },
    MuiInputLabel: { styleOverrides: { root: { fontSize: '0.8125rem' } } },
    MuiOutlinedInput: {
      styleOverrides: {
        root: ({ theme: t }) => ({
          borderRadius: 7,
          fontSize: '0.8125rem',
          backgroundColor: t.vars.palette.background.paper,
          '& .MuiOutlinedInput-notchedOutline': { borderColor: t.vars.palette.border.strong, transition: 'border-color 120ms' },
          '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: t.vars.palette.text.disabled },
          '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: t.vars.palette.secondary.main, borderWidth: 1, boxShadow: `0 0 0 3px ${t.vars.palette.action.focus}` },
          '&.Mui-disabled': { backgroundColor: t.vars.palette.surface.sunken },
        }),
        inputSizeSmall: { paddingBlock: 7.5 },
      },
    },
    MuiFormHelperText: { styleOverrides: { root: { marginInline: 2, fontSize: '0.75rem' } } },
    MuiChip: {
      defaultProps: { size: 'small' },
      styleOverrides: {
        root: { borderRadius: 6, fontWeight: 500, fontSize: '0.75rem' },
        sizeSmall: { height: 22 },
        outlined: ({ theme: t }) => ({ borderColor: t.vars.palette.border.strong }),
      },
    },
    MuiTooltip: {
      defaultProps: { arrow: false, enterDelay: 400, disableInteractive: true },
      styleOverrides: {
        tooltip: ({ theme: t }) => ({ backgroundColor: t.vars.palette.surface.inverse, color: t.vars.palette.background.paper, fontSize: '0.75rem', fontWeight: 500, borderRadius: 6, padding: '5px 8px' }),
      },
    },
    MuiTabs: {
      styleOverrides: {
        root: ({ theme: t }) => ({ minHeight: 38, borderBottom: `1px solid ${t.vars.palette.border.subtle}` }),
        indicator: ({ theme: t }) => ({ height: 2, backgroundColor: t.vars.palette.text.primary }),
      },
    },
    MuiTab: {
      styleOverrides: {
        root: ({ theme: t }) => ({ minHeight: 38, minWidth: 0, paddingInline: 12, fontSize: '0.8125rem', fontWeight: 500, color: t.vars.palette.text.secondary, '&.Mui-selected': { color: t.vars.palette.text.primary } }),
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: ({ theme: t }) => ({ borderBottomColor: t.vars.palette.border.subtle, fontSize: '0.8125rem', paddingBlock: 9, paddingInline: 12 }),
        head: ({ theme: t }) => ({ fontSize: '0.75rem', fontWeight: 500, color: t.vars.palette.text.secondary, backgroundColor: t.vars.palette.surface.subtle, whiteSpace: 'nowrap', paddingBlock: 8 }),
        sizeSmall: { paddingBlock: 6 },
      },
    },
    MuiTableRow: { styleOverrides: { root: ({ theme: t }) => ({ '&.MuiTableRow-hover:hover': { backgroundColor: t.vars.palette.action.hover }, '&:last-child td': { borderBottom: 0 } }) } },
    MuiSwitch: {
      defaultProps: { size: 'small' },
      styleOverrides: {
        root: { width: 34, height: 20, padding: 0, marginInline: 6 },
        switchBase: ({ theme: t }) => ({
          padding: 2,
          '&.Mui-checked': { transform: 'translateX(14px)', color: '#fff', '& + .MuiSwitch-track': { backgroundColor: t.vars.palette.secondary.main, opacity: 1 } },
        }),
        thumb: { width: 16, height: 16, boxShadow: '0 1px 2px rgba(0,0,0,0.25)' },
        track: ({ theme: t }) => ({ borderRadius: 10, backgroundColor: t.vars.palette.border.strong, opacity: 1 }),
      },
    },
    MuiCheckbox: { defaultProps: { size: 'small', color: 'secondary' } },
    MuiRadio: { defaultProps: { size: 'small', color: 'secondary' } },
    MuiLinearProgress: { styleOverrides: { root: ({ theme: t }) => ({ borderRadius: 4, height: 4, backgroundColor: t.vars.palette.surface.sunken }) } },
    MuiSkeleton: { defaultProps: { animation: 'wave' }, styleOverrides: { root: ({ theme: t }) => ({ backgroundColor: t.vars.palette.surface.sunken, borderRadius: 6 }) } },
    MuiAlert: {
      styleOverrides: {
        root: { borderRadius: 8, fontSize: '0.8125rem', alignItems: 'center', paddingBlock: 2 },
        standardError: ({ theme: t }) => ({ backgroundColor: t.vars.palette.error.light, color: t.vars.palette.error.dark, border: `1px solid ${alpha(t.palette.error.main, 0.25)}` }),
        standardWarning: ({ theme: t }) => ({ backgroundColor: t.vars.palette.warning.light, color: t.vars.palette.warning.dark, border: `1px solid ${alpha(t.palette.warning.main, 0.25)}` }),
        standardSuccess: ({ theme: t }) => ({ backgroundColor: t.vars.palette.success.light, color: t.vars.palette.success.dark, border: `1px solid ${alpha(t.palette.success.main, 0.25)}` }),
        standardInfo: ({ theme: t }) => ({ backgroundColor: t.vars.palette.info.light, color: t.vars.palette.info.dark, border: `1px solid ${alpha(t.palette.info.main, 0.25)}` }),
      },
    },
    MuiToggleButton: {
      styleOverrides: {
        root: ({ theme: t }) => ({ textTransform: 'none', fontSize: '0.75rem', paddingBlock: 4, paddingInline: 10, borderColor: t.vars.palette.border.strong, color: t.vars.palette.text.secondary, '&.Mui-selected': { backgroundColor: t.vars.palette.action.selected, color: t.vars.palette.text.primary } }),
      },
    },
    MuiAccordion: { defaultProps: { disableGutters: true, elevation: 0 }, styleOverrides: { root: { '&::before': { display: 'none' } } } },
    MuiBreadcrumbs: { styleOverrides: { separator: { marginInline: 6 } } },
    MuiDivider: { styleOverrides: { root: ({ theme: t }) => ({ borderColor: t.vars.palette.border.subtle }) } },
    MuiLink: { defaultProps: { underline: 'hover', color: 'secondary' } },
    MuiAutocomplete: { defaultProps: { size: 'small' }, styleOverrides: { paper: { borderRadius: 9 }, option: { fontSize: '0.8125rem', minHeight: 32 } } },
  },
});
