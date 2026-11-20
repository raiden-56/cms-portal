import { createContext, useContext } from 'react';
import type { BlockDefinition, FieldDef } from '@meridian/shared';
import type { ComponentInfo } from '@/features/fields/FieldForm';
import type { MediaAsset } from '@/lib/types';
import type { DropTarget } from './dnd';
import type { Device } from './editorSlice';

/** Things that stay the same while editing: the block catalogue and the editing commands. */
export interface EditorStatic {
  registry: Record<string, BlockDefinition>;
  components: Record<string, ComponentInfo>;
  componentFields: Record<string, FieldDef[]>;
  /** apiIds of the content types that exist in this environment. */
  typeIds: Set<string>;
  envBase: string;
  envId: string;
  readOnly: boolean;
  select: (id: string | null) => void;
  remove: (id: string) => void;
  duplicate: (id: string) => void;
  /** Moves a block one step among its siblings. */
  moveBy: (id: string, delta: -1 | 1) => void;
}

/** Things that change constantly: selection, drag state, the device being previewed. */
export interface EditorLive {
  selectedId: string | null;
  dropTarget: DropTarget | null;
  /** Block being dragged, if the drag started from a block (not the palette). */
  draggingId: string | null;
  dragging: boolean;
  device: Device;
  assets: Map<string, MediaAsset>;
  pagePath: string;
  pageTitle: string;
  /** Blocks with unresolved publish problems. */
  issueIds: Set<string>;
}

export const EditorStaticContext = createContext<EditorStatic | null>(null);
export const EditorLiveContext = createContext<EditorLive | null>(null);

export function useEditorStatic(): EditorStatic {
  const ctx = useContext(EditorStaticContext);
  if (!ctx) throw new Error('Editor context is missing');
  return ctx;
}

export function useEditorLive(): EditorLive {
  const ctx = useContext(EditorLiveContext);
  if (!ctx) throw new Error('Editor context is missing');
  return ctx;
}

export const DEVICE_LABELS: Record<Device, string> = { desktop: 'Desktop', tablet: 'Tablet', mobile: 'Mobile' };
