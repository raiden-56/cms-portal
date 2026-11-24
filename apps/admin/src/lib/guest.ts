/**
 * Guest mode switch.
 *
 * In guest mode the admin talks to a demo backend that lives entirely in the browser
 * (src/demo) instead of the Meridian API, so it works on a static host with no server.
 * This file is the only guest-mode code in the main bundle; the backend itself is loaded
 * on demand, so signed-in users never download it.
 */

/** A build with no server at all (static hosting): the app is always in guest mode. */
export const DEMO_ONLY = import.meta.env.VITE_DEMO_ONLY === 'true';

const STORAGE_KEY = 'meridian.guest';

function remembered(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

let active = DEMO_ONLY || remembered();

export const isGuestMode = (): boolean => active;

/** Remembered in localStorage so a reload stays in guest mode. A demo-only build cannot leave it. */
export function setGuestMode(on: boolean): void {
  active = DEMO_ONLY || on;
  try {
    if (on) localStorage.setItem(STORAGE_KEY, '1');
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage can be unavailable (private mode); guest mode then lasts until the tab closes.
  }
}

type DemoModule = typeof import('@/demo');
let demo: Promise<DemoModule> | null = null;

export function loadDemo(): Promise<DemoModule> {
  if (!demo) {
    demo = import('@/demo').catch((err) => {
      // Let the next call try again instead of caching a failed chunk load.
      demo = null;
      throw err;
    });
  }
  return demo;
}

/** Path inside the app, valid when the admin is served from a sub-path. */
export function appUrl(path: string): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  return `${window.location.origin}${base}/${path.replace(/^\/+/, '')}`;
}
