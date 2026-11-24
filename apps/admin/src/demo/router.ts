/** A very small `METHOD + path pattern → handler` router. Static segments win over `:params`. */
import type { Ctx } from './context';

export type Handler = (c: Ctx) => unknown;

interface Route {
  method: string;
  segments: string[];
  handler: Handler;
}

const split = (path: string) => path.split('/').filter(Boolean);

export class Router {
  private readonly routes: Route[] = [];

  on(method: string, pattern: string, handler: Handler): this {
    this.routes.push({ method, segments: split(pattern), handler });
    return this;
  }

  get = (pattern: string, handler: Handler) => this.on('GET', pattern, handler);
  post = (pattern: string, handler: Handler) => this.on('POST', pattern, handler);
  put = (pattern: string, handler: Handler) => this.on('PUT', pattern, handler);
  patch = (pattern: string, handler: Handler) => this.on('PATCH', pattern, handler);
  delete = (pattern: string, handler: Handler) => this.on('DELETE', pattern, handler);

  match(method: string, path: string): { handler: Handler; params: Record<string, string> } | null {
    const parts = split(path).map((p) => {
      try {
        return decodeURIComponent(p);
      } catch {
        return p;
      }
    });
    let best: { route: Route; params: Record<string, string>; score: number } | null = null;
    for (const route of this.routes) {
      if (route.method !== method || route.segments.length !== parts.length) continue;
      const params: Record<string, string> = {};
      let score = 0;
      const fits = route.segments.every((segment, i) => {
        if (segment.startsWith(':')) {
          params[segment.slice(1)] = parts[i];
          return true;
        }
        // Earlier static segments weigh more, so `/content-types` beats `/:type`.
        score += 2 ** (route.segments.length - i);
        return segment === parts[i];
      });
      if (fits && (!best || score > best.score)) best = { route, params, score };
    }
    return best ? { handler: best.route.handler, params: best.params } : null;
  }
}
