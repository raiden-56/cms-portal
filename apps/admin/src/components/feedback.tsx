import { type ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import CheckCircleOutlined from '@mui/icons-material/CheckCircleOutlined';
import CloseOutlined from '@mui/icons-material/CloseOutlined';
import ErrorOutlineOutlined from '@mui/icons-material/ErrorOutlineOutlined';
import InfoOutlined from '@mui/icons-material/InfoOutlined';
import WarningAmberOutlined from '@mui/icons-material/WarningAmberOutlined';
import { errorMessage } from '@/lib/api';
import { type Toast, dismissToast, useAppDispatch, useAppSelector } from '@/store';

// ─── Confirmation ────────────────────────────────────────────────────────────

export interface ConfirmOptions {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  /** When set, the user must type this text to enable the confirm button. */
  typeToConfirm?: string;
  /** Runs when confirmed. The dialog shows progress and any error, and stays open if it throws. */
  onConfirm?: () => Promise<unknown> | unknown;
}

type Ask = (options: ConfirmOptions) => Promise<boolean>;
const ConfirmContext = createContext<Ask>(() => Promise.resolve(false));

/**
 * Promise-based confirmation:
 *   const confirm = useConfirm();
 *   if (await confirm({ title: 'Delete entry?', destructive: true, onConfirm: () => api.delete(...) })) { … }
 */
export const useConfirm = () => useContext(ConfirmContext);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resolver = useRef<((value: boolean) => void) | null>(null);

  const ask = useCallback<Ask>((next) => {
    setOptions(next);
    setTyped('');
    setError(null);
    setBusy(false);
    setOpen(true);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const close = (result: boolean) => {
    if (busy) return;
    setOpen(false);
    resolver.current?.(result);
    resolver.current = null;
  };

  const confirm = async () => {
    if (!options) return;
    if (options.onConfirm) {
      setBusy(true);
      setError(null);
      try {
        await options.onConfirm();
      } catch (err) {
        setBusy(false);
        setError(errorMessage(err));
        return;
      }
      setBusy(false);
    }
    setOpen(false);
    resolver.current?.(true);
    resolver.current = null;
  };

  const blocked = !!options?.typeToConfirm && typed.trim() !== options.typeToConfirm;

  return (
    <ConfirmContext.Provider value={ask}>
      {children}
      <Dialog open={open} onClose={() => close(false)} maxWidth="xs" aria-labelledby="confirm-title">
        <DialogTitle id="confirm-title">{options?.title}</DialogTitle>
        <DialogContent>
          {options?.message && (
            <Typography variant="body1" color="text.secondary" component="div">
              {options.message}
            </Typography>
          )}
          {options?.typeToConfirm && (
            <TextField
              sx={{ mt: 4 }}
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              label={`Type “${options.typeToConfirm}” to confirm`}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !blocked) void confirm();
              }}
            />
          )}
          {error && (
            <Typography variant="body2" color="error" role="alert" sx={{ mt: 3 }}>
              {error}
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => close(false)} disabled={busy}>
            {options?.cancelLabel ?? 'Cancel'}
          </Button>
          <Button variant="contained" color={options?.destructive ? 'error' : 'primary'} onClick={() => void confirm()} disabled={blocked} loading={busy} autoFocus={!options?.typeToConfirm}>
            {options?.confirmLabel ?? 'Confirm'}
          </Button>
        </DialogActions>
      </Dialog>
    </ConfirmContext.Provider>
  );
}

// ─── Toasts ──────────────────────────────────────────────────────────────────

const TOAST_ICON = {
  success: <CheckCircleOutlined sx={{ color: 'success.main' }} />,
  error: <ErrorOutlineOutlined sx={{ color: 'error.main' }} />,
  warning: <WarningAmberOutlined sx={{ color: 'warning.main' }} />,
  info: <InfoOutlined sx={{ color: 'info.main' }} />,
};

function ToastItem({ toast, onNavigate }: { toast: Toast; onNavigate: (href: string) => void }) {
  const dispatch = useAppDispatch();
  const reduce = useReducedMotion();
  useEffect(() => {
    // Errors stay longer: people need time to read what went wrong.
    const id = setTimeout(() => dispatch(dismissToast(toast.id)), toast.severity === 'error' ? 8000 : 4200);
    return () => clearTimeout(id);
  }, [dispatch, toast.id, toast.severity]);

  return (
    <Box
      component={motion.div}
      layout={!reduce}
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={reduce ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.98 }}
      transition={{ duration: 0.16 }}
      role={toast.severity === 'error' ? 'alert' : 'status'}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 2.5,
        minWidth: 280,
        maxWidth: 440,
        pl: 3.5,
        pr: 1.5,
        py: 2.5,
        borderRadius: '10px',
        bgcolor: 'background.paper',
        border: 1,
        borderColor: 'border.strong',
        boxShadow: '0 10px 30px rgba(17,17,16,0.14)',
        '& > svg': { fontSize: 18, flexShrink: 0 },
      }}
    >
      {TOAST_ICON[toast.severity]}
      <Typography variant="body2" sx={{ flex: 1, fontWeight: 500 }}>
        {toast.message}
      </Typography>
      {toast.action && (
        // A plain link: toasts render outside the router, so router components cannot be used here.
        <Button
          size="small"
          component="a"
          href={toast.action.href}
          onClick={(event: React.MouseEvent) => {
            const href = toast.action?.href;
            dispatch(dismissToast(toast.id));
            // Leave modified clicks (new tab, new window) to the browser.
            if (!href || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
            event.preventDefault();
            onNavigate(href);
          }}
        >
          {toast.action.label}
        </Button>
      )}
      <IconButton size="small" aria-label="Dismiss" onClick={() => dispatch(dismissToast(toast.id))}>
        <CloseOutlined sx={{ fontSize: 15 }} />
      </IconButton>
    </Box>
  );
}

/**
 * Rendered next to the router rather than inside it, so messages survive route changes and route
 * errors. `onNavigate` performs in-app navigation for a toast's action link.
 */
export function Toaster({ onNavigate }: { onNavigate: (href: string) => void }) {
  const toasts = useAppSelector((s) => s.ui.toasts);
  const region = useRef<HTMLDivElement>(null);

  // An open dialog or drawer marks everything else on the page as hidden from assistive technology.
  // Status messages still have to be announced while one is open (saving in a drawer, for example),
  // so this region sits directly under <body> and opts out of being hidden.
  useEffect(() => {
    const el = region.current;
    if (!el) return;
    const reveal = () => {
      if (el.hasAttribute('aria-hidden')) el.removeAttribute('aria-hidden');
    };
    reveal();
    const observer = new MutationObserver(reveal);
    observer.observe(el, { attributes: true, attributeFilter: ['aria-hidden'] });
    return () => observer.disconnect();
  }, []);

  return createPortal(
    <Box
      ref={region}
      aria-live="polite"
      sx={{ position: 'fixed', zIndex: 2000, bottom: 20, right: 20, left: { xs: 20, sm: 'auto' }, display: 'flex', flexDirection: 'column', alignItems: { xs: 'stretch', sm: 'flex-end' }, gap: 2, pointerEvents: 'none', '& > *': { pointerEvents: 'auto' } }}
    >
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onNavigate={onNavigate} />
        ))}
      </AnimatePresence>
    </Box>,
    document.body,
  );
}
