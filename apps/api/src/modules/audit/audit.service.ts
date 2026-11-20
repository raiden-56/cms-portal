import type { Request } from 'express';
import { Prisma } from '@prisma/client';
import { clientIp } from '../../lib/http';
import { logger, prisma } from '../../lib/infra';

export interface AuditInput {
  organizationId: string;
  projectId?: string | null;
  environmentId?: string | null;
  actorType?: 'user' | 'token' | 'system';
  actorId?: string | null;
  actorLabel?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  resourceLabel?: string | null;
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown>;
  ip?: string | null;
}

const json = (value: unknown) => (value === undefined || value === null ? Prisma.JsonNull : (value as Prisma.InputJsonValue));

/**
 * Appends to the audit trail. Auditing must never break the action being audited,
 * so failures are logged rather than thrown.
 */
export async function writeAudit(input: AuditInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        organizationId: input.organizationId,
        projectId: input.projectId ?? null,
        environmentId: input.environmentId ?? null,
        actorType: input.actorType ?? 'user',
        actorId: input.actorId ?? null,
        actorLabel: input.actorLabel ?? null,
        action: input.action,
        resourceType: input.resourceType,
        resourceId: input.resourceId ?? null,
        resourceLabel: input.resourceLabel ?? null,
        before: json(input.before),
        after: json(input.after),
        metadata: json(input.metadata),
        ip: input.ip ?? null,
      },
    });
  } catch (err) {
    logger.error({ err: (err as Error).message, action: input.action }, 'failed to write audit log');
  }
}

type RequestAudit = Omit<AuditInput, 'organizationId' | 'actorType' | 'actorId' | 'actorLabel' | 'ip'> & { organizationId?: string };

/** Audit entry attributed to the authenticated user and the tenant scope of the request. */
export function audit(req: Request, input: RequestAudit): Promise<void> {
  const organizationId = input.organizationId ?? req.tenant?.organizationId;
  if (!organizationId) return Promise.resolve();
  return writeAudit({
    ...input,
    organizationId,
    projectId: input.projectId ?? req.tenant?.project?.id,
    environmentId: input.environmentId ?? req.tenant?.environment?.id,
    actorType: 'user',
    actorId: req.user?.id,
    actorLabel: req.user?.name,
    ip: clientIp(req),
  });
}
