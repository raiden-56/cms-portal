-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "ContentTypeKind" AS ENUM ('COLLECTION', 'SINGLE');

-- CreateEnum
CREATE TYPE "EntryStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'SCHEDULED', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "VersionKind" AS ENUM ('SAVE', 'AUTOSAVE', 'PUBLISH', 'RESTORE');

-- CreateEnum
CREATE TYPE "TokenType" AS ENUM ('READ_ONLY', 'READ_WRITE', 'PREVIEW');

-- CreateEnum
CREATE TYPE "ReleaseStatus" AS ENUM ('OPEN', 'SCHEDULED', 'PUBLISHED', 'FAILED');

-- CreateEnum
CREATE TYPE "ReleaseAction" AS ENUM ('PUBLISH', 'UNPUBLISH');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'RETRYING', 'SUCCESS', 'FAILED');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isSuperAdmin" BOOLEAN NOT NULL DEFAULT false,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userAgent" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoginEvent" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "email" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "reason" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserPreference" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,

    CONSTRAINT "UserPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Organization" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "permissions" TEXT[],
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "roleId" UUID NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invitation" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "roleId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "invitedById" UUID NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "icon" TEXT NOT NULL DEFAULT 'layers',
    "color" TEXT NOT NULL DEFAULT '#1F6F5C',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Environment" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Environment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Locale" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "fallbackCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Locale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentType" (
    "id" UUID NOT NULL,
    "environmentId" UUID NOT NULL,
    "apiId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "singularName" TEXT NOT NULL,
    "pluralName" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "kind" "ContentTypeKind" NOT NULL DEFAULT 'COLLECTION',
    "icon" TEXT NOT NULL DEFAULT 'document',
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "options" JSONB NOT NULL DEFAULT '{}',
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Component" (
    "id" UUID NOT NULL,
    "environmentId" UUID NOT NULL,
    "apiId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL DEFAULT 'General',
    "icon" TEXT NOT NULL DEFAULT 'component',
    "isBlock" BOOLEAN NOT NULL DEFAULT false,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Component_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Field" (
    "id" UUID NOT NULL,
    "contentTypeId" UUID,
    "componentId" UUID,
    "apiId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "unique" BOOLEAN NOT NULL DEFAULT false,
    "localized" BOOLEAN NOT NULL DEFAULT false,
    "config" JSONB NOT NULL DEFAULT '{}',
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Field_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchemaChange" (
    "id" UUID NOT NULL,
    "environmentId" UUID NOT NULL,
    "targetKind" TEXT NOT NULL,
    "targetId" UUID NOT NULL,
    "targetApiId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "summary" TEXT NOT NULL,
    "diff" JSONB NOT NULL,
    "userId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SchemaChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Entry" (
    "id" UUID NOT NULL,
    "environmentId" UUID NOT NULL,
    "contentTypeId" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "locale" TEXT NOT NULL,
    "title" TEXT,
    "slug" TEXT,
    "path" TEXT,
    "parentId" UUID,
    "position" INTEGER NOT NULL DEFAULT 0,
    "data" JSONB NOT NULL,
    "status" "EntryStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedData" JSONB,
    "publishedTitle" TEXT,
    "publishedSlug" TEXT,
    "publishedPath" TEXT,
    "publishedVersionId" UUID,
    "publishedAt" TIMESTAMP(3),
    "firstPublishedAt" TIMESTAMP(3),
    "scheduledPublishAt" TIMESTAMP(3),
    "scheduledUnpublishAt" TIMESTAMP(3),
    "lockVersion" INTEGER NOT NULL DEFAULT 1,
    "assigneeId" UUID,
    "createdById" UUID,
    "updatedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EntryVersion" (
    "id" UUID NOT NULL,
    "entryId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "kind" "VersionKind" NOT NULL,
    "data" JSONB NOT NULL,
    "title" TEXT,
    "note" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EntryVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EntryRelation" (
    "id" UUID NOT NULL,
    "fromEntryId" UUID NOT NULL,
    "field" TEXT NOT NULL,
    "targetDocumentId" UUID NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "EntryRelation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaUsage" (
    "id" UUID NOT NULL,
    "assetId" UUID NOT NULL,
    "entryId" UUID NOT NULL,

    CONSTRAINT "MediaUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Comment" (
    "id" UUID NOT NULL,
    "entryId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'comment',
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Comment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Release" (
    "id" UUID NOT NULL,
    "environmentId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "status" "ReleaseStatus" NOT NULL DEFAULT 'OPEN',
    "scheduledAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Release_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReleaseItem" (
    "id" UUID NOT NULL,
    "releaseId" UUID NOT NULL,
    "entryId" UUID NOT NULL,
    "action" "ReleaseAction" NOT NULL DEFAULT 'PUBLISH',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReleaseItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaFolder" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "parentId" UUID,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MediaFolder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaAsset" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "folderId" UUID,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "storageKey" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "alt" TEXT NOT NULL DEFAULT '',
    "caption" TEXT NOT NULL DEFAULT '',
    "tags" TEXT[],
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiToken" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "environmentId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "type" "TokenType" NOT NULL,
    "prefix" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "allowedOrigins" TEXT[],
    "rateLimitPerMinute" INTEGER NOT NULL DEFAULT 600,
    "expiresAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Webhook" (
    "id" UUID NOT NULL,
    "environmentId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "secretEnc" TEXT NOT NULL,
    "events" TEXT[],
    "headers" JSONB NOT NULL DEFAULT '{}',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Webhook_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookDelivery" (
    "id" UUID NOT NULL,
    "webhookId" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "event" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "responseStatus" INTEGER,
    "responseBody" TEXT,
    "error" TEXT,
    "durationMs" INTEGER,
    "nextRetryAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiUsage" (
    "id" UUID NOT NULL,
    "environmentId" UUID NOT NULL,
    "tokenId" TEXT NOT NULL DEFAULT '',
    "resource" TEXT NOT NULL DEFAULT '',
    "bucket" TIMESTAMP(3) NOT NULL,
    "requests" INTEGER NOT NULL DEFAULT 0,
    "errors" INTEGER NOT NULL DEFAULT 0,
    "latencyMsTotal" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ApiUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "projectId" UUID,
    "environmentId" UUID,
    "actorType" TEXT NOT NULL DEFAULT 'user',
    "actorId" TEXT,
    "actorLabel" TEXT,
    "action" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT,
    "resourceLabel" TEXT,
    "before" JSONB,
    "after" JSONB,
    "metadata" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "LoginEvent_userId_createdAt_idx" ON "LoginEvent"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "LoginEvent_email_createdAt_idx" ON "LoginEvent"("email", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "UserPreference_userId_key_key" ON "UserPreference"("userId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Role_organizationId_key_key" ON "Role"("organizationId", "key");

-- CreateIndex
CREATE INDEX "Membership_userId_idx" ON "Membership"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_organizationId_userId_key" ON "Membership"("organizationId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_tokenHash_key" ON "Invitation"("tokenHash");

-- CreateIndex
CREATE INDEX "Invitation_organizationId_idx" ON "Invitation"("organizationId");

-- CreateIndex
CREATE INDEX "Invitation_email_idx" ON "Invitation"("email");

-- CreateIndex
CREATE INDEX "Project_organizationId_deletedAt_idx" ON "Project"("organizationId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Project_organizationId_slug_key" ON "Project"("organizationId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "Environment_projectId_key_key" ON "Environment"("projectId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "Locale_projectId_code_key" ON "Locale"("projectId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "ContentType_environmentId_apiId_key" ON "ContentType"("environmentId", "apiId");

-- CreateIndex
CREATE UNIQUE INDEX "Component_environmentId_apiId_key" ON "Component"("environmentId", "apiId");

-- CreateIndex
CREATE INDEX "Field_contentTypeId_position_idx" ON "Field"("contentTypeId", "position");

-- CreateIndex
CREATE INDEX "Field_componentId_position_idx" ON "Field"("componentId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "Field_contentTypeId_apiId_key" ON "Field"("contentTypeId", "apiId");

-- CreateIndex
CREATE UNIQUE INDEX "Field_componentId_apiId_key" ON "Field"("componentId", "apiId");

-- CreateIndex
CREATE INDEX "SchemaChange_environmentId_createdAt_idx" ON "SchemaChange"("environmentId", "createdAt");

-- CreateIndex
CREATE INDEX "SchemaChange_targetId_version_idx" ON "SchemaChange"("targetId", "version");

-- CreateIndex
CREATE INDEX "Entry_environmentId_contentTypeId_deletedAt_updatedAt_idx" ON "Entry"("environmentId", "contentTypeId", "deletedAt", "updatedAt");

-- CreateIndex
CREATE INDEX "Entry_environmentId_contentTypeId_publishedAt_idx" ON "Entry"("environmentId", "contentTypeId", "publishedAt");

-- CreateIndex
CREATE INDEX "Entry_environmentId_status_idx" ON "Entry"("environmentId", "status");

-- CreateIndex
CREATE INDEX "Entry_contentTypeId_slug_idx" ON "Entry"("contentTypeId", "slug");

-- CreateIndex
CREATE INDEX "Entry_contentTypeId_publishedSlug_idx" ON "Entry"("contentTypeId", "publishedSlug");

-- CreateIndex
CREATE INDEX "Entry_environmentId_publishedPath_idx" ON "Entry"("environmentId", "publishedPath");

-- CreateIndex
CREATE INDEX "Entry_scheduledPublishAt_idx" ON "Entry"("scheduledPublishAt");

-- CreateIndex
CREATE INDEX "Entry_scheduledUnpublishAt_idx" ON "Entry"("scheduledUnpublishAt");

-- CreateIndex
CREATE INDEX "Entry_parentId_idx" ON "Entry"("parentId");

-- CreateIndex
CREATE INDEX "Entry_data_idx" ON "Entry" USING GIN ("data" jsonb_path_ops);

-- CreateIndex
CREATE INDEX "Entry_publishedData_idx" ON "Entry" USING GIN ("publishedData" jsonb_path_ops);

-- CreateIndex
CREATE UNIQUE INDEX "Entry_documentId_locale_key" ON "Entry"("documentId", "locale");

-- CreateIndex
CREATE INDEX "EntryVersion_entryId_createdAt_idx" ON "EntryVersion"("entryId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EntryVersion_entryId_number_key" ON "EntryVersion"("entryId", "number");

-- CreateIndex
CREATE INDEX "EntryRelation_fromEntryId_idx" ON "EntryRelation"("fromEntryId");

-- CreateIndex
CREATE INDEX "EntryRelation_targetDocumentId_idx" ON "EntryRelation"("targetDocumentId");

-- CreateIndex
CREATE INDEX "MediaUsage_entryId_idx" ON "MediaUsage"("entryId");

-- CreateIndex
CREATE UNIQUE INDEX "MediaUsage_assetId_entryId_key" ON "MediaUsage"("assetId", "entryId");

-- CreateIndex
CREATE INDEX "Comment_entryId_createdAt_idx" ON "Comment"("entryId", "createdAt");

-- CreateIndex
CREATE INDEX "Release_environmentId_status_idx" ON "Release"("environmentId", "status");

-- CreateIndex
CREATE INDEX "Release_scheduledAt_idx" ON "Release"("scheduledAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReleaseItem_releaseId_entryId_key" ON "ReleaseItem"("releaseId", "entryId");

-- CreateIndex
CREATE INDEX "MediaFolder_projectId_parentId_idx" ON "MediaFolder"("projectId", "parentId");

-- CreateIndex
CREATE INDEX "MediaAsset_projectId_deletedAt_createdAt_idx" ON "MediaAsset"("projectId", "deletedAt", "createdAt");

-- CreateIndex
CREATE INDEX "MediaAsset_projectId_checksum_idx" ON "MediaAsset"("projectId", "checksum");

-- CreateIndex
CREATE INDEX "MediaAsset_projectId_folderId_idx" ON "MediaAsset"("projectId", "folderId");

-- CreateIndex
CREATE UNIQUE INDEX "ApiToken_tokenHash_key" ON "ApiToken"("tokenHash");

-- CreateIndex
CREATE INDEX "ApiToken_projectId_idx" ON "ApiToken"("projectId");

-- CreateIndex
CREATE INDEX "ApiToken_environmentId_idx" ON "ApiToken"("environmentId");

-- CreateIndex
CREATE INDEX "Webhook_environmentId_idx" ON "Webhook"("environmentId");

-- CreateIndex
CREATE INDEX "WebhookDelivery_webhookId_createdAt_idx" ON "WebhookDelivery"("webhookId", "createdAt");

-- CreateIndex
CREATE INDEX "WebhookDelivery_status_idx" ON "WebhookDelivery"("status");

-- CreateIndex
CREATE INDEX "ApiUsage_environmentId_bucket_idx" ON "ApiUsage"("environmentId", "bucket");

-- CreateIndex
CREATE UNIQUE INDEX "ApiUsage_environmentId_tokenId_resource_bucket_key" ON "ApiUsage"("environmentId", "tokenId", "resource", "bucket");

-- CreateIndex
CREATE INDEX "AuditLog_organizationId_createdAt_idx" ON "AuditLog"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_projectId_createdAt_idx" ON "AuditLog"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_environmentId_createdAt_idx" ON "AuditLog"("environmentId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_resourceType_resourceId_createdAt_idx" ON "AuditLog"("resourceType", "resourceId", "createdAt");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoginEvent" ADD CONSTRAINT "LoginEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPreference" ADD CONSTRAINT "UserPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Role" ADD CONSTRAINT "Role_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Environment" ADD CONSTRAINT "Environment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Locale" ADD CONSTRAINT "Locale_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentType" ADD CONSTRAINT "ContentType_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "Environment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Component" ADD CONSTRAINT "Component_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "Environment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Field" ADD CONSTRAINT "Field_contentTypeId_fkey" FOREIGN KEY ("contentTypeId") REFERENCES "ContentType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Field" ADD CONSTRAINT "Field_componentId_fkey" FOREIGN KEY ("componentId") REFERENCES "Component"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Entry" ADD CONSTRAINT "Entry_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "Environment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Entry" ADD CONSTRAINT "Entry_contentTypeId_fkey" FOREIGN KEY ("contentTypeId") REFERENCES "ContentType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Entry" ADD CONSTRAINT "Entry_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Entry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntryVersion" ADD CONSTRAINT "EntryVersion_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "Entry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntryRelation" ADD CONSTRAINT "EntryRelation_fromEntryId_fkey" FOREIGN KEY ("fromEntryId") REFERENCES "Entry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaUsage" ADD CONSTRAINT "MediaUsage_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "MediaAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "Entry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Release" ADD CONSTRAINT "Release_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "Environment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReleaseItem" ADD CONSTRAINT "ReleaseItem_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "Release"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReleaseItem" ADD CONSTRAINT "ReleaseItem_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "Entry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaFolder" ADD CONSTRAINT "MediaFolder_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaFolder" ADD CONSTRAINT "MediaFolder_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "MediaFolder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "MediaFolder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiToken" ADD CONSTRAINT "ApiToken_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiToken" ADD CONSTRAINT "ApiToken_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "Environment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Webhook" ADD CONSTRAINT "Webhook_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "Environment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_webhookId_fkey" FOREIGN KEY ("webhookId") REFERENCES "Webhook"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
