import { describe, expect, it, vi } from 'vitest';
import type { BlockNode, PageData } from '@meridian/shared';
import { type PageEditorState, pageEditorActions as a, pageEditorReducer as reduce, selectIsDirty } from './editorSlice';

const block = (id: string, type = 'text', children?: BlockNode[]): BlockNode => ({ id, type, props: { heading: id }, ...(children ? { children } : {}) });
const page = (blocks: BlockNode[] = []): PageData => ({ title: 'Home', slug: '', seo: {}, blocks });

const load = (blocks: BlockNode[] = []): PageEditorState => reduce(undefined, a.loaded({ entryId: 'e1', page: page(blocks), lockVersion: 3 }));
const ids = (state: PageEditorState) => state.page?.blocks.map((b) => b.id);
const dirty = (state: PageEditorState) => selectIsDirty({ pageEditor: state });

describe('page editor state', () => {
  it('loads a page clean, with no history', () => {
    const state = load([block('a')]);
    expect(state.lockVersion).toBe(3);
    expect(state.past).toHaveLength(0);
    expect(dirty(state)).toBe(false);
  });

  it('inserts, selects, duplicates, moves and removes blocks', () => {
    let state = load([block('a'), block('s', 'section', [])]);
    state = reduce(state, a.blockInserted({ block: block('b'), parentId: null, index: 1 }));
    expect(ids(state)).toEqual(['a', 'b', 's']);
    expect(state.selectedId).toBe('b');
    expect(dirty(state)).toBe(true);

    state = reduce(state, a.blockMoved({ id: 'b', parentId: 's', index: 0 }));
    expect(ids(state)).toEqual(['a', 's']);
    expect(state.page?.blocks[1].children?.map((c) => c.id)).toEqual(['b']);

    state = reduce(state, a.blockDuplicated('a'));
    expect(state.page?.blocks).toHaveLength(3);
    expect(state.selectedId).not.toBe('a');
    expect(state.page?.blocks[1].props).toEqual({ heading: 'a' });

    // Removing a nested block moves the selection to its parent.
    state = reduce(state, a.selected('b'));
    state = reduce(state, a.blockRemoved('b'));
    expect(state.selectedId).toBe('s');
  });

  it('ignores a move that would put a block inside itself', () => {
    const state = load([block('s', 'section', [block('c', 'section', [])])]);
    const next = reduce(state, a.blockMoved({ id: 's', parentId: 'c', index: 0 }));
    expect(next.page).toBe(state.page);
    expect(next.past).toHaveLength(0);
  });

  it('undoes and redoes, and clears redo after a new edit', () => {
    let state = load([block('a')]);
    state = reduce(state, a.blockInserted({ block: block('b'), parentId: null, index: 1 }));
    state = reduce(state, a.blockInserted({ block: block('c'), parentId: null, index: 2 }));
    expect(ids(state)).toEqual(['a', 'b', 'c']);

    state = reduce(state, a.undone());
    expect(ids(state)).toEqual(['a', 'b']);
    // The selected block no longer exists after undo, so the selection is cleared.
    expect(state.selectedId).toBeNull();
    state = reduce(state, a.undone());
    expect(ids(state)).toEqual(['a']);
    expect(dirty(state)).toBe(false);
    state = reduce(state, a.undone());
    expect(ids(state)).toEqual(['a']);

    state = reduce(state, a.redone());
    expect(ids(state)).toEqual(['a', 'b']);
    state = reduce(state, a.blockRemoved('a'));
    expect(state.future).toHaveLength(0);
    expect(reduce(state, a.redone()).page).toBe(state.page);
  });

  it('folds rapid typing in one block into a single undo step', () => {
    vi.useFakeTimers();
    try {
      let state = load([block('a'), block('b')]);
      for (const heading of ['H', 'He', 'Hel']) {
        state = reduce(state, a.blockPropsChanged({ id: 'a', props: { heading } }));
        vi.advanceTimersByTime(100);
      }
      expect(state.past).toHaveLength(1);
      // A pause, or an edit elsewhere, starts a new step.
      vi.advanceTimersByTime(2000);
      state = reduce(state, a.blockPropsChanged({ id: 'a', props: { heading: 'Hello' } }));
      state = reduce(state, a.blockPropsChanged({ id: 'b', props: { heading: 'B' } }));
      expect(state.past).toHaveLength(3);

      state = reduce(state, a.undone());
      state = reduce(state, a.undone());
      state = reduce(state, a.undone());
      expect(state.page?.blocks[0].props.heading).toBe('a');
    } finally {
      vi.useRealTimers();
    }
  });

  it('removes the style object when it becomes empty', () => {
    let state = load([block('a')]);
    state = reduce(state, a.blockStyleChanged({ id: 'a', style: { align: 'center' } }));
    expect(state.page?.blocks[0].style).toEqual({ align: 'center' });
    state = reduce(state, a.blockStyleChanged({ id: 'a', style: {} }));
    expect(state.page?.blocks[0]).not.toHaveProperty('style');
  });

  it('tracks what the server has confirmed, keeping edits made during a save', () => {
    let state = load([block('a')]);
    state = reduce(state, a.metaChanged({ title: 'Homepage' }));
    const sent = JSON.stringify(state.page);
    // The editor keeps typing while the save request is in flight.
    state = reduce(state, a.seoChanged({ title: 'SEO title' }));
    state = reduce(state, a.saved({ snapshot: sent, lockVersion: 4 }));
    expect(state.lockVersion).toBe(4);
    expect(state.page?.seo.title).toBe('SEO title');
    expect(dirty(state)).toBe(true);
    state = reduce(state, a.saved({ snapshot: JSON.stringify(state.page), lockVersion: 5 }));
    expect(dirty(state)).toBe(false);
  });

  it('keeps history when the same page is reloaded, and resets for another page', () => {
    let state = load([block('a')]);
    state = reduce(state, a.blockInserted({ block: block('b'), parentId: null, index: 1 }));
    state = reduce(state, a.loaded({ entryId: 'e1', page: state.page as PageData, lockVersion: 4 }));
    expect(state.past).toHaveLength(1);
    state = reduce(state, a.loaded({ entryId: 'e2', page: page(), lockVersion: 1 }));
    expect(state.past).toHaveLength(0);
    expect(state.selectedId).toBeNull();
    expect(reduce(state, a.closed()).page).toBeNull();
  });
});
