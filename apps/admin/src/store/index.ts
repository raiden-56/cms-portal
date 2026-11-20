import { type PayloadAction, configureStore, createSlice } from '@reduxjs/toolkit';
import { type TypedUseSelectorHook, useDispatch, useSelector } from 'react-redux';
import type { AuthPayload } from '@/lib/api';
import type { Membership, User } from '@/lib/types';
import { pageEditorReducer } from '@/features/pages/editor/editorSlice';

// ─── Auth ────────────────────────────────────────────────────────────────────

interface AuthState {
  status: 'restoring' | 'authenticated' | 'anonymous';
  user: User | null;
  memberships: Membership[];
}

const authSlice = createSlice({
  name: 'auth',
  initialState: { status: 'restoring', user: null, memberships: [] } as AuthState,
  reducers: {
    signedIn(state, action: PayloadAction<Pick<AuthPayload, 'user' | 'memberships'>>) {
      state.status = 'authenticated';
      state.user = action.payload.user;
      state.memberships = action.payload.memberships;
    },
    signedOut(state) {
      state.status = 'anonymous';
      state.user = null;
      state.memberships = [];
    },
  },
});

// ─── UI ──────────────────────────────────────────────────────────────────────

export type ToastSeverity = 'success' | 'error' | 'info' | 'warning';
export interface Toast {
  id: number;
  message: string;
  severity: ToastSeverity;
  action?: { label: string; href: string };
}

export type TableDensity = 'compact' | 'comfortable';

interface UiState {
  sidebarCollapsed: boolean;
  mobileNavOpen: boolean;
  commandOpen: boolean;
  tableDensity: TableDensity;
  toasts: Toast[];
}

const read = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
};
export const persist = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be unavailable (private mode); the preference simply does not persist.
  }
};

let toastId = 0;

const uiSlice = createSlice({
  name: 'ui',
  initialState: {
    sidebarCollapsed: read('meridian.sidebarCollapsed', false),
    mobileNavOpen: false,
    commandOpen: false,
    tableDensity: read<TableDensity>('meridian.tableDensity', 'comfortable'),
    toasts: [],
  } as UiState,
  reducers: {
    toggleSidebar(state) {
      state.sidebarCollapsed = !state.sidebarCollapsed;
      persist('meridian.sidebarCollapsed', state.sidebarCollapsed);
    },
    setMobileNav(state, action: PayloadAction<boolean>) {
      state.mobileNavOpen = action.payload;
    },
    setCommandOpen(state, action: PayloadAction<boolean>) {
      state.commandOpen = action.payload;
    },
    setTableDensity(state, action: PayloadAction<TableDensity>) {
      state.tableDensity = action.payload;
      persist('meridian.tableDensity', action.payload);
    },
    pushToast: {
      reducer(state, action: PayloadAction<Toast>) {
        state.toasts = [...state.toasts.slice(-3), action.payload];
      },
      prepare(toast: Omit<Toast, 'id'>) {
        toastId += 1;
        return { payload: { ...toast, id: toastId } };
      },
    },
    dismissToast(state, action: PayloadAction<number>) {
      state.toasts = state.toasts.filter((t) => t.id !== action.payload);
    },
  },
});

export const { signedIn, signedOut } = authSlice.actions;
export const { toggleSidebar, setMobileNav, setCommandOpen, setTableDensity, pushToast, dismissToast } = uiSlice.actions;

export const store = configureStore({
  reducer: { auth: authSlice.reducer, ui: uiSlice.reducer, pageEditor: pageEditorReducer },
  middleware: (getDefault) => getDefault({ serializableCheck: false, immutableCheck: false }),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
export const useAppDispatch: () => AppDispatch = useDispatch;
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;

/** Imperative toast helper for use in event handlers and mutation callbacks. */
export const toast = {
  success: (message: string, action?: Toast['action']) => store.dispatch(pushToast({ message, severity: 'success', action })),
  error: (message: string) => store.dispatch(pushToast({ message, severity: 'error' })),
  info: (message: string) => store.dispatch(pushToast({ message, severity: 'info' })),
  warning: (message: string) => store.dispatch(pushToast({ message, severity: 'warning' })),
};
