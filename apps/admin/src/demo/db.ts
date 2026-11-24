/**
 * The demo backend's database: one plain object held in memory and mirrored to IndexedDB,
 * so a guest's changes survive a reload. When IndexedDB is unavailable (private windows,
 * tests) everything still works and simply lasts until the tab closes.
 */
import type { EntryStatus, FieldDef, TokenType } from '@meridian/shared';

export interface DbUser {
  id: string;
  email: string;
  name: string;
  isActive: boolean;
  isSuperAdmin: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface DbRole {
  id: string;
  organizationId: string;
  key: string;
  name: string;
  description: string;
  permissions: string[];
  isSystem: boolean;
  createdAt: string;
}

export interface DbMembership {
  id: string;
  userId: string;
  roleId: string;
  status: 'ACTIVE' | 'SUSPENDED';
  createdAt: string;
}

export interface DbInvitation {
  id: string;
  email: string;
  roleId: string;
  token: string;
  expiresAt: string;
  createdAt: string;
}

export interface DbProject {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  description: string;
  icon: string;
  color: string;
  settings: { previewUrl?: string; siteUrl?: string; corsOrigins?: string[] };
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface DbEnvironment {
  id: string;
  projectId: string;
  key: string;
  name: string;
  position: number;
}

export interface DbLocale {
  id: string;
  projectId: string;
  code: string;
  name: string;
  isDefault: boolean;
  fallbackCode: string | null;
}

export interface TypeOptions {
  localized?: boolean;
  requireApproval?: boolean;
  titleField?: string;
  previewUrl?: string;
}

export interface DbType {
  id: string;
  environmentId: string;
  apiId: string;
  displayName: string;
  singularName: string;
  pluralName: string;
  description: string;
  kind: 'COLLECTION' | 'SINGLE';
  icon: string;
  isSystem: boolean;
  options: TypeOptions;
  schemaVersion: number;
  fields: FieldDef[];
  createdAt: string;
  updatedAt: string;
}

export interface DbComponent {
  id: string;
  environmentId: string;
  apiId: string;
  displayName: string;
  description: string;
  category: string;
  icon: string;
  isBlock: boolean;
  schemaVersion: number;
  fields: FieldDef[];
  createdAt: string;
  updatedAt: string;
}

export interface DbSchemaChange {
  id: string;
  environmentId: string;
  targetKind: string;
  targetId: string;
  targetApiId: string;
  version: number;
  summary: string;
  diff: unknown;
  userId: string | null;
  createdAt: string;
}

export type Json = Record<string, unknown>;

export interface DbEntry {
  id: string;
  environmentId: string;
  contentTypeId: string;
  documentId: string;
  locale: string;
  title: string | null;
  slug: string | null;
  path: string | null;
  parentId: string | null;
  position: number;
  data: Json;
  status: EntryStatus;
  publishedData: Json | null;
  publishedTitle: string | null;
  publishedSlug: string | null;
  publishedPath: string | null;
  publishedVersionId: string | null;
  publishedAt: string | null;
  firstPublishedAt: string | null;
  scheduledPublishAt: string | null;
  scheduledUnpublishAt: string | null;
  lockVersion: number;
  assigneeId: string | null;
  createdById: string | null;
  updatedById: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface DbVersion {
  id: string;
  entryId: string;
  number: number;
  kind: 'SAVE' | 'AUTOSAVE' | 'PUBLISH' | 'RESTORE';
  data: Json;
  title: string | null;
  note: string | null;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DbComment {
  id: string;
  entryId: string;
  userId: string;
  body: string;
  kind: 'comment' | 'changes_requested' | 'approval';
  resolvedAt: string | null;
  createdAt: string;
}

export type MediaKind = 'image' | 'video' | 'document' | 'archive' | 'other';

export interface DbAsset {
  id: string;
  projectId: string;
  folderId: string | null;
  filename: string;
  mimeType: string;
  kind: MediaKind;
  size: number;
  width: number | null;
  height: number | null;
  checksum: string;
  alt: string;
  caption: string;
  tags: string[];
  revision: number;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface DbFolder {
  id: string;
  projectId: string;
  parentId: string | null;
  name: string;
  createdAt: string;
}

export interface DbRelease {
  id: string;
  environmentId: string;
  name: string;
  description: string;
  status: 'OPEN' | 'SCHEDULED' | 'PUBLISHED' | 'FAILED';
  scheduledAt: string | null;
  publishedAt: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DbReleaseItem {
  id: string;
  releaseId: string;
  entryId: string;
  action: 'PUBLISH' | 'UNPUBLISH';
  createdAt: string;
}

export interface DbToken {
  id: string;
  projectId: string;
  environmentId: string;
  name: string;
  description: string;
  type: TokenType;
  prefix: string;
  /** Demo keys are random strings made in this browser and valid only inside it, so keeping the value is harmless. */
  secret: string;
  allowedOrigins: string[];
  rateLimitPerMinute: number;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface DbWebhook {
  id: string;
  environmentId: string;
  name: string;
  url: string;
  events: string[];
  headers: Record<string, string>;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DbDelivery {
  id: string;
  webhookId: string;
  eventId: string;
  event: string;
  payload: Json;
  status: 'PENDING' | 'RETRYING' | 'SUCCESS' | 'FAILED';
  attempts: number;
  responseStatus: number | null;
  responseBody: string | null;
  error: string | null;
  durationMs: number | null;
  nextRetryAt: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface DbAudit {
  id: string;
  organizationId: string;
  projectId: string | null;
  environmentId: string | null;
  actorType: 'user' | 'token' | 'system';
  actorId: string | null;
  actorLabel: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  resourceLabel: string | null;
  before: unknown;
  after: unknown;
  metadata: Json | null;
  ip: string | null;
  createdAt: string;
}

/** Delivery API traffic, one row per day, key and resource. */
export interface DbUsage {
  environmentId: string;
  tokenId: string;
  resource: string;
  day: string;
  requests: number;
  errors: number;
  latencyMsTotal: number;
}

export interface DemoState {
  version: number;
  seededAt: string;
  /** The guest: the organization administrator every request is made as. */
  userId: string;
  organization: { id: string; name: string; slug: string; settings: Json; createdAt: string; updatedAt: string };
  users: DbUser[];
  roles: DbRole[];
  memberships: DbMembership[];
  invitations: DbInvitation[];
  projects: DbProject[];
  environments: DbEnvironment[];
  locales: DbLocale[];
  contentTypes: DbType[];
  components: DbComponent[];
  schemaChanges: DbSchemaChange[];
  entries: DbEntry[];
  versions: DbVersion[];
  comments: DbComment[];
  assets: DbAsset[];
  folders: DbFolder[];
  releases: DbRelease[];
  releaseItems: DbReleaseItem[];
  tokens: DbToken[];
  webhooks: DbWebhook[];
  deliveries: DbDelivery[];
  audit: DbAudit[];
  usage: DbUsage[];
  preferences: Record<string, unknown>;
  previewTokens: Record<string, { environmentId: string; entryId: string; expiresAt: string }>;
}

/** Bump when the stored shape changes; older saved demos are then replaced by a fresh seed. */
export const STATE_VERSION = 1;

export function emptyState(): DemoState {
  return {
    version: STATE_VERSION,
    seededAt: '',
    userId: '',
    organization: { id: '', name: '', slug: '', settings: {}, createdAt: '', updatedAt: '' },
    users: [],
    roles: [],
    memberships: [],
    invitations: [],
    projects: [],
    environments: [],
    locales: [],
    contentTypes: [],
    components: [],
    schemaChanges: [],
    entries: [],
    versions: [],
    comments: [],
    assets: [],
    folders: [],
    releases: [],
    releaseItems: [],
    tokens: [],
    webhooks: [],
    deliveries: [],
    audit: [],
    usage: [],
    preferences: {},
    previewTokens: {},
  };
}

/** The live database. Handlers read and mutate it directly; `replaceState` swaps its contents in place. */
export const db: DemoState = emptyState();

/** File contents by asset id, as data URLs. Kept out of `db` so saving the state never rewrites every file. */
export const files = new Map<string, string>();

export function replaceState(next: DemoState): void {
  for (const key of Object.keys(db) as (keyof DemoState)[]) delete db[key];
  Object.assign(db, next);
}

// ─── Clock ───────────────────────────────────────────────────────────────────

let clockOffset = 0;

/** Current time. The seed shifts it into the past to build believable history. */
export const now = (): Date => new Date(Date.now() + clockOffset);
export const nowIso = (): string => now().toISOString();

/** Moves the clock by a fixed amount until it is set back to 0. Tests use it to let schedules come due. */
export function setClockOffset(ms: number): void {
  clockOffset = ms;
}

export function withClock<T>(at: Date | number, fn: () => T): T {
  const previous = clockOffset;
  clockOffset = (typeof at === 'number' ? at : at.getTime()) - Date.now();
  try {
    return fn();
  } finally {
    clockOffset = previous;
  }
}

// ─── Persistence ─────────────────────────────────────────────────────────────

const DB_NAME = 'meridian-demo';
const STORE = 'kv';
const STATE_KEY = 'state';
const FILE_PREFIX = 'file:';

interface Backing {
  kind: 'indexeddb' | 'memory';
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
  entries(prefix: string): Promise<[string, unknown][]>;
  clear(): Promise<void>;
}

function memoryBacking(): Backing {
  const map = new Map<string, unknown>();
  return {
    kind: 'memory',
    get: async (key) => map.get(key),
    set: async (key, value) => void map.set(key, value),
    remove: async (key) => void map.delete(key),
    entries: async (prefix) => [...map.entries()].filter(([k]) => k.startsWith(prefix)),
    clear: async () => map.clear(),
  };
}

function openIndexedDb(): Promise<Backing | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const request = indexedDB.open(DB_NAME, 1);
      // A browser that never answers (blocked storage) must not hang the app.
      const timer = setTimeout(() => resolve(null), 4000);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onerror = () => {
        clearTimeout(timer);
        resolve(null);
      };
      request.onsuccess = () => {
        clearTimeout(timer);
        const idb = request.result;
        const run = <T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> =>
          new Promise<T>((done, fail) => {
            const tx = idb.transaction(STORE, mode);
            const req = work(tx.objectStore(STORE));
            tx.oncomplete = () => done(req.result);
            tx.onerror = () => fail(tx.error);
            tx.onabort = () => fail(tx.error);
          });
        resolve({
          kind: 'indexeddb',
          get: (key) => run('readonly', (s) => s.get(key)),
          set: (key, value) => run('readwrite', (s) => s.put(value, key)).then(() => undefined),
          remove: (key) => run('readwrite', (s) => s.delete(key)).then(() => undefined),
          entries: (prefix) =>
            new Promise((done, fail) => {
              const out: [string, unknown][] = [];
              const tx = idb.transaction(STORE, 'readonly');
              const cursor = tx.objectStore(STORE).openCursor(IDBKeyRange.bound(prefix, `${prefix}￿`));
              cursor.onsuccess = () => {
                const at = cursor.result;
                if (!at) return;
                out.push([String(at.key), at.value]);
                at.continue();
              };
              tx.oncomplete = () => done(out);
              tx.onerror = () => fail(tx.error);
            }),
          clear: () => run('readwrite', (s) => s.clear()).then(() => undefined),
        });
      };
    } catch {
      resolve(null);
    }
  });
}

let backing: Backing = memoryBacking();

export const persistenceKind = (): Backing['kind'] => backing.kind;

/** Opens storage and loads a saved demo into `db`. Returns false when there is none (or it is outdated). */
export async function loadState(): Promise<boolean> {
  backing = (await openIndexedDb()) ?? backing;
  try {
    const saved = (await backing.get(STATE_KEY)) as DemoState | undefined;
    if (!saved || saved.version !== STATE_VERSION || !saved.userId) return false;
    replaceState(saved);
    files.clear();
    for (const [key, value] of await backing.entries(FILE_PREFIX)) {
      if (typeof value === 'string') files.set(key.slice(FILE_PREFIX.length), value);
    }
    return true;
  } catch {
    // Unreadable storage: carry on in memory rather than fail to start.
    backing = memoryBacking();
    return false;
  }
}

async function guarded(work: () => Promise<void>): Promise<void> {
  try {
    await work();
  } catch {
    // Quota exceeded or storage revoked: the session keeps working from memory.
  }
}

/** File writes started by the request being handled; `saveState` waits for them. */
const pending: Promise<void>[] = [];

export async function saveState(): Promise<void> {
  await Promise.all(pending.splice(0));
  await guarded(() => backing.set(STATE_KEY, db));
}

export function putFile(assetId: string, dataUrl: string): void {
  files.set(assetId, dataUrl);
  pending.push(guarded(() => backing.set(FILE_PREFIX + assetId, dataUrl)));
}

export function dropFile(assetId: string): void {
  files.delete(assetId);
  pending.push(guarded(() => backing.remove(FILE_PREFIX + assetId)));
}

export async function clearStorage(): Promise<void> {
  await Promise.all(pending.splice(0));
  files.clear();
  await guarded(() => backing.clear());
}
