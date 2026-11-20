/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the Meridian API (no trailing slash). Defaults to http://localhost:4000. */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module '@fontsource-variable/geist';
declare module '@fontsource-variable/geist-mono';
