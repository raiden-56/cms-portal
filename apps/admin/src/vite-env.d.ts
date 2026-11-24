/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the Meridian API (no trailing slash). Defaults to http://localhost:4000. */
  readonly VITE_API_URL?: string;
  /**
   * Set to 'true' for a build with no server (static hosting such as GitHub Pages): the app
   * opens straight in guest mode and runs against demo data kept in the browser.
   */
  readonly VITE_DEMO_ONLY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module '@fontsource-variable/geist';
declare module '@fontsource-variable/geist-mono';
