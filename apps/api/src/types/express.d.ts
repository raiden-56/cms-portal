import type { ApiToken } from '@prisma/client';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  isSuperAdmin: boolean;
  sessionId: string;
}

export interface TenantContext {
  organizationId: string;
  organizationSlug: string;
  roleKey: string;
  permissions: Set<string>;
  project?: { id: string; slug: string; name: string; settings: Record<string, unknown> };
  environment?: { id: string; key: string; name: string; projectId: string };
}

/** Resolved scope of a delivery API token. */
export interface TokenContext {
  token: ApiToken;
  organizationId: string;
  organizationSlug: string;
  project: { id: string; slug: string; name: string };
  environment: { id: string; key: string; name: string };
  defaultLocale: string;
  locales: { code: string; isDefault: boolean; fallbackCode: string | null }[];
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId: string;
      user?: AuthUser;
      tenant?: TenantContext;
      apiToken?: TokenContext;
    }
  }
}

export {};
