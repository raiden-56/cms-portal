import { type PayloadAction, createSlice, current } from '@reduxjs/toolkit';
import {
  type BlockNode,
  type BlockStyle,
  type PageData,
  type SeoData,
  duplicateBlock,
  findBlock,
  findParentId,
  insertBlock,
  moveBlock,
  removeBlock,
  updateBlock,
} from '@meridian/shared';

export type Device = 'desktop' | 'tablet' | 'mobile';

export interface PageEditorState {
  entryId: string | null;
  page: PageData | null;
  /** Serialized copy of what the server last confirmed, for dirty detection. */
  savedSnapshot: string;
  lockVersion: number;
  past: PageData[];
  future: PageData[];
  selectedId: string | null;
  device: Device;
  /** Identity and time of the last edit, used to fold rapid typing into one undo step. */
  lastEdit: { key: string; at: number } | null;
}

const initialState: PageEditorState = {
  entryId: null,
  page: null,
  savedSnapshot: '',
  lockVersion: 1,
  past: [],
  future: [],
  selectedId: null,
  device: 'desktop',
  lastEdit: null,
};

const HISTORY_LIMIT = 100;
const COALESCE_MS = 900;

/** Records the current page as an undo step, unless this edit continues the previous one. */
function checkpoint(state: PageEditorState, key?: string) {
  if (!state.page) return;
  const now = Date.now();
  const continues = key && state.lastEdit?.key === key && now - state.lastEdit.at < COALESCE_MS;
  if (!continues) {
    state.past = [...state.past.slice(-(HISTORY_LIMIT - 1)), state.page];
  }
  state.future = [];
  state.lastEdit = key ? { key, at: now } : null;
}

const slice = createSlice({
  name: 'pageEditor',
  initialState,
  reducers: {
    loaded(state, action: PayloadAction<{ entryId: string; page: PageData; lockVersion: number }>) {
      const { entryId, page, lockVersion } = action.payload;
      const sameEntry = state.entryId === entryId;
      state.entryId = entryId;
      state.page = page;
      state.savedSnapshot = JSON.stringify(page);
      state.lockVersion = lockVersion;
      state.lastEdit = null;
      if (!sameEntry) {
        state.past = [];
        state.future = [];
        state.selectedId = null;
      } else if (state.selectedId && !findBlock(page.blocks, state.selectedId)) {
        state.selectedId = null;
      }
    },
    /** The server accepted a save. Local edits made while the request was in flight are kept. */
    saved(state, action: PayloadAction<{ snapshot: string; lockVersion: number }>) {
      state.savedSnapshot = action.payload.snapshot;
      state.lockVersion = action.payload.lockVersion;
    },
    closed() {
      return initialState;
    },
    selected(state, action: PayloadAction<string | null>) {
      state.selectedId = action.payload;
    },
    deviceChanged(state, action: PayloadAction<Device>) {
      state.device = action.payload;
    },
    blockInserted(state, action: PayloadAction<{ block: BlockNode; parentId: string | null; index: number }>) {
      if (!state.page) return;
      checkpoint(state);
      const { block, parentId, index } = action.payload;
      state.page = { ...state.page, blocks: insertBlock(state.page.blocks, block, parentId, index) };
      state.selectedId = block.id;
    },
    blockRemoved(state, action: PayloadAction<string>) {
      if (!state.page) return;
      checkpoint(state);
      const parentId = findParentId(state.page.blocks, action.payload) ?? null;
      state.page = { ...state.page, blocks: removeBlock(state.page.blocks, action.payload) };
      if (state.selectedId && !findBlock(state.page.blocks, state.selectedId)) state.selectedId = parentId;
    },
    blockDuplicated(state, action: PayloadAction<string>) {
      if (!state.page) return;
      checkpoint(state);
      // `current` unwraps the draft so the copy is made from plain data.
      const result = duplicateBlock(current(state.page).blocks, action.payload);
      state.page = { ...state.page, blocks: result.blocks };
      if (result.newId) state.selectedId = result.newId;
    },
    blockMoved(state, action: PayloadAction<{ id: string; parentId: string | null; index: number }>) {
      if (!state.page) return;
      const next = moveBlock(state.page.blocks, action.payload.id, action.payload.parentId, action.payload.index);
      if (next === state.page.blocks) return;
      checkpoint(state);
      state.page = { ...state.page, blocks: next };
    },
    blockPropsChanged(state, action: PayloadAction<{ id: string; props: Record<string, unknown> }>) {
      if (!state.page) return;
      checkpoint(state, `props:${action.payload.id}`);
      state.page = { ...state.page, blocks: updateBlock(state.page.blocks, action.payload.id, (b) => ({ ...b, props: action.payload.props })) };
    },
    blockStyleChanged(state, action: PayloadAction<{ id: string; style: BlockStyle | undefined }>) {
      if (!state.page) return;
      checkpoint(state, `style:${action.payload.id}`);
      state.page = {
        ...state.page,
        blocks: updateBlock(state.page.blocks, action.payload.id, (b) => {
          const { style: _style, ...rest } = b;
          return action.payload.style && Object.keys(action.payload.style).length ? { ...rest, style: action.payload.style } : rest;
        }),
      };
    },
    metaChanged(state, action: PayloadAction<Partial<Pick<PageData, 'title' | 'slug' | 'description' | 'template' | 'category'>>>) {
      if (!state.page) return;
      checkpoint(state, `meta:${Object.keys(action.payload).join(',')}`);
      state.page = { ...state.page, ...action.payload };
    },
    seoChanged(state, action: PayloadAction<SeoData>) {
      if (!state.page) return;
      checkpoint(state, 'seo');
      state.page = { ...state.page, seo: action.payload };
    },
    undone(state) {
      const previous = state.past[state.past.length - 1];
      if (!previous || !state.page) return;
      state.future = [state.page, ...state.future].slice(0, HISTORY_LIMIT);
      state.past = state.past.slice(0, -1);
      state.page = previous;
      state.lastEdit = null;
      if (state.selectedId && !findBlock(previous.blocks, state.selectedId)) state.selectedId = null;
    },
    redone(state) {
      const next = state.future[0];
      if (!next || !state.page) return;
      state.past = [...state.past, state.page].slice(-HISTORY_LIMIT);
      state.future = state.future.slice(1);
      state.page = next;
      state.lastEdit = null;
      if (state.selectedId && !findBlock(next.blocks, state.selectedId)) state.selectedId = null;
    },
  },
});

export const pageEditorActions = slice.actions;
export const pageEditorReducer = slice.reducer;

export const selectIsDirty = (state: { pageEditor: PageEditorState }) =>
  !!state.pageEditor.page && JSON.stringify(state.pageEditor.page) !== state.pageEditor.savedSnapshot;
