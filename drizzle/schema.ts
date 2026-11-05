import { boolean, int, index, mysqlEnum, mysqlTable, text, timestamp, varchar, unique } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  aiProvider: mysqlEnum("aiProvider", ["manus", "chatgpt", "gemini", "kimi"]).default("manus").notNull(),
  externalAiConsent: boolean("externalAiConsent").default(false).notNull(),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export const radarItems = mysqlTable("radarItems", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  label: varchar("label", { length: 255 }).notNull(),
  detail: text("detail").notNull(),
  dateLabel: varchar("dateLabel", { length: 64 }).notNull(),
  priority: mysqlEnum("priority", ["urgente", "importante", "atencao", "normal", "informacao"]).default("normal").notNull(),
  action: varchar("action", { length: 255 }).notNull(),
  dueAt: timestamp("dueAt"),
  reminderAt: timestamp("reminderAt"),
  timezone: varchar("timezone", { length: 64 }).default("America/Sao_Paulo").notNull(),
  confirmationToken: varchar("confirmationToken", { length: 64 }).unique(),
  lastNotifiedAt: timestamp("lastNotifiedAt"),
  status: mysqlEnum("status", ["pending", "completed", "snoozed"]).default("pending").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({ userIdx: index("radarItems_user_idx").on(table.userId) }));

export const pushSubscriptions = mysqlTable("pushSubscriptions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  endpoint: varchar("endpoint", { length: 2048 }).notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({ userIdx: index("pushSubscriptions_user_idx").on(table.userId) }));

export const aiMemories = mysqlTable("aiMemories", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  content: text("content").notNull(),
  source: varchar("source", { length: 64 }).default("user-approved").notNull(),
  category: varchar("category", { length: 32 }).default("fact").notNull(),
  importance: int("importance").default(1).notNull(),
  archived: boolean("archived").default(false).notNull(),
  lastAccessedAt: timestamp("lastAccessedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({ userIdx: index("aiMemories_user_idx").on(table.userId) }));

export const storageFiles = mysqlTable("storageFiles", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  storageKey: varchar("storageKey", { length: 512 }).notNull().unique(),
  originalName: varchar("originalName", { length: 180 }).notNull(),
  mimeType: varchar("mimeType", { length: 120 }).notNull(),
  sizeBytes: int("sizeBytes").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({ userIdx: index("storageFiles_user_idx").on(table.userId) }));

export const sessions = mysqlTable("sessions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  tokenHash: varchar("tokenHash", { length: 64 }).notNull().unique(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  revokedAt: timestamp("revokedAt"),
  lastUsedAt: timestamp("lastUsedAt"),
  userAgent: varchar("userAgent", { length: 512 }),
  ipAddress: varchar("ipAddress", { length: 64 }),
}, (table) => ({ userIdx: index("sessions_user_idx").on(table.userId), expiryIdx: index("sessions_expiry_idx").on(table.expiresAt) }));


export const conversations = mysqlTable("conversations", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  title: varchar("title", { length: 255 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({ userIdx: index("conversations_user_idx").on(table.userId) }));

export const conversationMessages = mysqlTable("conversationMessages", {
  id: int("id").autoincrement().primaryKey(),
  conversationId: int("conversationId").notNull(),
  role: mysqlEnum("role", ["user", "assistant", "system"]).notNull(),
  content: text("content").notNull(),
  metadata: text("metadata"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({ conversationIdx: index("conversationMessages_conversation_idx").on(table.conversationId) }));

export const agentProposals = mysqlTable("agentProposals", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  conversationId: int("conversationId"),
  type: varchar("type", { length: 64 }).notNull(),
  toolName: varchar("toolName", { length: 64 }),
  requiredScopes: text("requiredScopes"),
  intent: varchar("intent", { length: 120 }),
  confidence: int("confidence"),
  plan: text("plan"),
  modelProvider: varchar("modelProvider", { length: 32 }),
  modelName: varchar("modelName", { length: 120 }),
  policyReason: varchar("policyReason", { length: 500 }),
  payload: text("payload").notNull(),
  riskLevel: mysqlEnum("riskLevel", ["low", "medium", "high"]).default("low").notNull(),
  status: mysqlEnum("status", ["pending", "approved", "executing", "executed", "rejected", "expired"]).default("pending").notNull(),
  confirmationToken: varchar("confirmationToken", { length: 64 }).notNull().unique(),
  expiresAt: timestamp("expiresAt").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  confirmedAt: timestamp("confirmedAt"),
  executedAt: timestamp("executedAt"),
}, (table) => ({ userIdx: index("agentProposals_user_idx").on(table.userId), statusIdx: index("agentProposals_status_idx").on(table.status), expiryIdx: index("agentProposals_expiry_idx").on(table.expiresAt) }));

export const aiProviderKeys = mysqlTable("aiProviderKeys", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  provider: mysqlEnum("provider", ["chatgpt", "gemini", "kimi"]).notNull(),
  encryptedKey: text("encryptedKey").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({ userIdx: index("aiProviderKeys_user_idx").on(table.userId), providerIdx: index("aiProviderKeys_provider_idx").on(table.provider) }));


export const agentExecutions = mysqlTable("agentExecutions", {
  id: int("id").autoincrement().primaryKey(),
  proposalId: int("proposalId").notNull(),
  userId: int("userId").notNull(),
  toolName: varchar("toolName", { length: 64 }).notNull(),
  status: mysqlEnum("status", ["running", "succeeded", "failed"]).default("running").notNull(),
  input: text("input").notNull(),
  output: text("output"),
  errorCode: varchar("errorCode", { length: 80 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  finishedAt: timestamp("finishedAt"),
}, (table) => ({
  proposalIdx: index("agentExecutions_proposal_idx").on(table.proposalId),
  userIdx: index("agentExecutions_user_idx").on(table.userId),
  statusIdx: index("agentExecutions_status_idx").on(table.status),
}));

export const agentExecutionSteps = mysqlTable("agentExecutionSteps", {
  id: int("id").autoincrement().primaryKey(),
  executionId: int("executionId").notNull(),
  userId: int("userId").notNull(),
  stepIndex: int("stepIndex").notNull(),
  toolName: varchar("toolName", { length: 64 }).notNull(),
  status: mysqlEnum("status", ["running", "succeeded", "failed"]).default("running").notNull(),
  idempotencyKey: varchar("idempotencyKey", { length: 160 }).notNull().unique(),
  input: text("input").notNull(),
  output: text("output"),
  errorCode: varchar("errorCode", { length: 80 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  finishedAt: timestamp("finishedAt"),
}, (table) => ({ executionIdx: index("agentExecutionSteps_execution_idx").on(table.executionId), userIdx: index("agentExecutionSteps_user_idx").on(table.userId), statusIdx: index("agentExecutionSteps_status_idx").on(table.status) }));

export const agentAuditLogs = mysqlTable("agentAuditLogs", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  proposalId: int("proposalId"),
  executionId: int("executionId"),
  event: varchar("event", { length: 64 }).notNull(),
  toolName: varchar("toolName", { length: 64 }),
  details: text("details"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  userIdx: index("agentAuditLogs_user_idx").on(table.userId),
  proposalIdx: index("agentAuditLogs_proposal_idx").on(table.proposalId),
  createdIdx: index("agentAuditLogs_created_idx").on(table.createdAt),
}));


export const integrationActionApprovals = mysqlTable("integrationActionApprovals", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  provider: varchar("provider", { length: 64 }).notNull(),
  action: varchar("action", { length: 80 }).notNull(),
  capability: varchar("capability", { length: 80 }).notNull(),
  payloadHash: varchar("payloadHash", { length: 64 }).notNull(),
  status: mysqlEnum("status", ["pending", "approved", "consumed", "expired", "cancelled"]).default("pending").notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  approvedAt: timestamp("approvedAt"),
  consumedAt: timestamp("consumedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  userIdx: index("integrationActionApprovals_user_idx").on(table.userId),
  statusIdx: index("integrationActionApprovals_status_idx").on(table.status, table.expiresAt),
  lookupIdx: index("integrationActionApprovals_lookup_idx").on(table.userId, table.provider, table.action, table.payloadHash),
}));


export const integrations = mysqlTable("integrations", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  provider: varchar("provider", { length: 64 }).notNull(),
  label: varchar("label", { length: 120 }).notNull(),
  status: mysqlEnum("status", ["active", "disabled", "error"]).default("active").notNull(),
  encryptedConfig: text("encryptedConfig").notNull(),
  capabilities: text("capabilities").notNull(),
  lastUsedAt: timestamp("lastUsedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({ userIdx: index("integrations_user_idx").on(table.userId), providerIdx: index("integrations_provider_idx").on(table.provider) }));

export const workflows = mysqlTable("workflows", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  name: varchar("name", { length: 180 }).notNull(),
  description: text("description"),
  status: mysqlEnum("status", ["active", "paused", "archived"]).default("active").notNull(),
  definition: text("definition").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({ userIdx: index("workflows_user_idx").on(table.userId), statusIdx: index("workflows_status_idx").on(table.status) }));

export const workflowRuns = mysqlTable("workflowRuns", {
  id: int("id").autoincrement().primaryKey(),
  workflowId: int("workflowId").notNull(),
  userId: int("userId").notNull(),
  status: mysqlEnum("status", ["running", "succeeded", "failed", "cancelled"]).default("running").notNull(),
  input: text("input"),
  output: text("output"),
  errorCode: varchar("errorCode", { length: 80 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  finishedAt: timestamp("finishedAt"),
}, (table) => ({ workflowIdx: index("workflowRuns_workflow_idx").on(table.workflowId), userIdx: index("workflowRuns_user_idx").on(table.userId), statusIdx: index("workflowRuns_status_idx").on(table.status) }));

export const workflowSteps = mysqlTable("workflowSteps", {
  id: int("id").autoincrement().primaryKey(),
  runId: int("runId").notNull(),
  userId: int("userId").notNull(),
  stepIndex: int("stepIndex").notNull(),
  toolName: varchar("toolName", { length: 64 }).notNull(),
  status: mysqlEnum("status", ["pending", "running", "succeeded", "failed", "skipped"]).default("pending").notNull(),
  idempotencyKey: varchar("idempotencyKey", { length: 180 }).notNull().unique(),
  input: text("input").notNull(),
  output: text("output"),
  errorCode: varchar("errorCode", { length: 80 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  finishedAt: timestamp("finishedAt"),
}, (table) => ({ runIdx: index("workflowSteps_run_idx").on(table.runId), userIdx: index("workflowSteps_user_idx").on(table.userId), statusIdx: index("workflowSteps_status_idx").on(table.status) }));


export const agentAutonomySettings = mysqlTable("agentAutonomySettings", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().unique(),
  enabled: boolean("enabled").default(false).notNull(),
  allowedScopes: text("allowedScopes").notNull(),
  maxSteps: int("maxSteps").default(5).notNull(),
  requireConfirmationAbove: mysqlEnum("requireConfirmationAbove", ["low", "medium", "high"]).default("medium").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});


export const integrationOAuthStates = mysqlTable("integrationOAuthStates", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  provider: varchar("provider", { length: 64 }).notNull(),
  state: varchar("state", { length: 180 }).notNull().unique(),
  codeVerifier: varchar("codeVerifier", { length: 256 }).notNull(),
  redirectUri: varchar("redirectUri", { length: 1000 }).notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({ userIdx: index("integrationOAuthStates_user_idx").on(table.userId), expiresIdx: index("integrationOAuthStates_expires_idx").on(table.expiresAt) }));

export const workflowSchedules = mysqlTable("workflowSchedules", {
  id: int("id").autoincrement().primaryKey(),
  workflowId: int("workflowId").notNull(),
  userId: int("userId").notNull(),
  cron: varchar("cron", { length: 120 }).notNull(),
  timezone: varchar("timezone", { length: 64 }).default("America/Sao_Paulo").notNull(),
  enabled: boolean("enabled").default(true).notNull(),
  nextRunAt: timestamp("nextRunAt"),
  lastRunAt: timestamp("lastRunAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lockedUntil: timestamp("lockedUntil"),
}, (table) => ({ userIdx: index("workflowSchedules_user_idx").on(table.userId), workflowIdx: index("workflowSchedules_workflow_idx").on(table.workflowId), nextRunIdx: index("workflowSchedules_next_run_idx").on(table.nextRunAt) }));

export const agentControlSettings = mysqlTable("agentControlSettings", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().unique(),
  killSwitch: boolean("killSwitch").default(false).notNull(),
  dailyRunLimit: int("dailyRunLimit").default(100).notNull(),
  dailyHighRiskLimit: int("dailyHighRiskLimit").default(10).notNull(),
  maxWorkflowRuntimeSeconds: int("maxWorkflowRuntimeSeconds").default(120).notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const agentUsageDaily = mysqlTable("agentUsageDaily", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  usageDate: varchar("usageDate", { length: 10 }).notNull(),
  runs: int("runs").default(0).notNull(),
  highRiskRuns: int("highRiskRuns").default(0).notNull(),
  estimatedTokens: int("estimatedTokens").default(0).notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({ userDateUnique: unique("agentUsageDaily_user_date_unique").on(table.userId, table.usageDate), userDateIdx: index("agentUsageDaily_user_date_idx").on(table.userId, table.usageDate) }));

export const agentEvents = mysqlTable("agentEvents", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  eventType: varchar("eventType", { length: 80 }).notNull(),
  severity: mysqlEnum("severity", ["info", "warning", "error", "critical"]).default("info").notNull(),
  correlationId: varchar("correlationId", { length: 180 }),
  metadata: text("metadata"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({ userIdx: index("agentEvents_user_idx").on(table.userId), createdIdx: index("agentEvents_created_idx").on(table.createdAt), correlationIdx: index("agentEvents_correlation_idx").on(table.correlationId) }));


export const voiceProfiles = mysqlTable("voiceProfiles", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().unique(),
  enabled: boolean("enabled").default(false).notNull(),
  wakeWord: varchar("wakeWord", { length: 32 }).default("iris").notNull(),
  language: varchar("language", { length: 16 }).default("pt-BR").notNull(),
  voiceIdentityEnabled: boolean("voiceIdentityEnabled").default(true).notNull(),
  unknownVoicePolicy: mysqlEnum("unknownVoicePolicy", ["limited", "deny_sensitive", "deny_all"]).default("deny_sensitive").notNull(),
  trustedDeviceRequired: boolean("trustedDeviceRequired").default(true).notNull(),
  biometricProvider: varchar("biometricProvider", { length: 64 }),
  enrolledAt: timestamp("enrolledAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({ userIdx: index("voiceProfiles_user_idx").on(table.userId) }));


export const integrationJobs = mysqlTable("integrationJobs", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  provider: varchar("provider", { length: 64 }).notNull(),
  action: varchar("action", { length: 80 }).notNull(),
  status: mysqlEnum("status", ["pending", "running", "succeeded", "failed", "dead"]).default("pending").notNull(),
  payload: text("payload").notNull(),
  result: text("result"),
  errorCode: varchar("errorCode", { length: 80 }),
  attempts: int("attempts").default(0).notNull(),
  maxAttempts: int("maxAttempts").default(5).notNull(),
  availableAt: timestamp("availableAt").defaultNow().notNull(),
  lockedUntil: timestamp("lockedUntil"),
  idempotencyKey: varchar("idempotencyKey", { length: 180 }).notNull().unique(),
  correlationId: varchar("correlationId", { length: 180 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  readyIdx: index("integrationJobs_ready_idx").on(table.status, table.availableAt),
  providerIdx: index("integrationJobs_provider_idx").on(table.provider, table.status),
  userIdx: index("integrationJobs_user_idx").on(table.userId),
  correlationIdx: index("integrationJobs_correlation_idx").on(table.correlationId),
}));

export const integrationEvents = mysqlTable("integrationEvents", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId"),
  provider: varchar("provider", { length: 64 }).notNull(),
  eventType: varchar("eventType", { length: 120 }).notNull(),
  fingerprint: varchar("fingerprint", { length: 128 }).notNull().unique(),
  payload: text("payload").notNull(),
  status: mysqlEnum("status", ["received", "processing", "processed", "failed", "ignored"]).default("received").notNull(),
  errorCode: varchar("errorCode", { length: 80 }),
  receivedAt: timestamp("receivedAt").defaultNow().notNull(),
  processedAt: timestamp("processedAt"),
}, (table) => ({
  providerStatusIdx: index("integrationEvents_provider_status_idx").on(table.provider, table.status),
  receivedIdx: index("integrationEvents_received_idx").on(table.receivedAt),
}));

export const integrationActionAudits = mysqlTable("integrationActionAudits", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  provider: varchar("provider", { length: 64 }).notNull(),
  action: varchar("action", { length: 80 }).notNull(),
  capability: varchar("capability", { length: 80 }),
  status: mysqlEnum("status", ["requested", "confirmed", "succeeded", "failed", "replayed"]).notNull(),
  requestId: varchar("requestId", { length: 180 }),
  correlationId: varchar("correlationId", { length: 180 }),
  idempotencyKey: varchar("idempotencyKey", { length: 180 }),
  errorCode: varchar("errorCode", { length: 80 }),
  metadata: text("metadata"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  userIdx: index("integrationActionAudits_user_idx").on(table.userId),
  providerIdx: index("integrationActionAudits_provider_idx").on(table.provider, table.createdAt),
  requestIdx: index("integrationActionAudits_request_idx").on(table.requestId),
}));

export const oauthRefreshLocks = mysqlTable("oauthRefreshLocks", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  provider: varchar("provider", { length: 64 }).notNull(),
  lockedUntil: timestamp("lockedUntil").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  providerUserUnique: unique("oauthRefreshLocks_user_provider_unique").on(table.userId, table.provider),
  expiryIdx: index("oauthRefreshLocks_expiry_idx").on(table.lockedUntil),
}));

export const healthExams = mysqlTable("healthExams", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  fileName: varchar("fileName", { length: 255 }).notNull(),
  fileFormat: mysqlEnum("fileFormat", ["pdf", "jpg", "jpeg", "png"]).notNull(),
  mimeType: varchar("mimeType", { length: 120 }).notNull(),
  sizeBytes: int("sizeBytes").notNull(),
  storageKey: varchar("storageKey", { length: 512 }),
  fileUrl: text("fileUrl"),
  examDate: varchar("examDate", { length: 64 }),
  laboratory: varchar("laboratory", { length: 180 }),
  doctorName: varchar("doctorName", { length: 180 }),
  summaryNote: text("summaryNote"),
  extractedMarkersCount: int("extractedMarkersCount").default(0).notNull(),
  status: mysqlEnum("status", ["armazenado", "em_leitura", "processado", "erro"]).default("processado").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  userIdx: index("healthExams_user_idx").on(table.userId),
}));

export const healthMarkers = mysqlTable("healthMarkers", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  examId: int("examId"),
  category: varchar("category", { length: 64 }).notNull(),
  markerName: varchar("markerName", { length: 180 }).notNull(),
  examDate: varchar("examDate", { length: 64 }).notNull(),
  result: varchar("result", { length: 120 }).notNull(),
  numericValue: varchar("numericValue", { length: 64 }),
  unit: varchar("unit", { length: 64 }).notNull(),
  referenceRange: varchar("referenceRange", { length: 180 }),
  status: mysqlEnum("status", ["normal", "alterado", "indeterminado"]).default("normal").notNull(),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  userIdx: index("healthMarkers_user_idx").on(table.userId),
  examIdx: index("healthMarkers_exam_idx").on(table.examId),
  categoryIdx: index("healthMarkers_user_category_idx").on(table.userId, table.category),
}));

export const healthMedications = mysqlTable("healthMedications", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  name: varchar("name", { length: 180 }).notNull(),
  dosage: varchar("dosage", { length: 120 }).notNull(),
  frequency: varchar("frequency", { length: 120 }).notNull(),
  type: mysqlEnum("type", ["medicamento", "suplemento"]).default("medicamento").notNull(),
  active: boolean("active").default(true).notNull(),
  startDate: varchar("startDate", { length: 64 }),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  userIdx: index("healthMedications_user_idx").on(table.userId),
}));

export const healthMeasurements = mysqlTable("healthMeasurements", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  type: varchar("type", { length: 64 }).notNull(),
  value: varchar("value", { length: 64 }).notNull(),
  unit: varchar("unit", { length: 32 }).notNull(),
  measuredAt: varchar("measuredAt", { length: 64 }).notNull(),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  userIdx: index("healthMeasurements_user_idx").on(table.userId),
}));

export const healthAudits = mysqlTable("healthAudits", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  action: varchar("action", { length: 80 }).notNull(),
  resource: varchar("resource", { length: 180 }),
  details: text("details"),
  alteredData: boolean("alteredData").default(false).notNull(),
  sharedData: boolean("sharedData").default(false).notNull(),
  authorizationGranted: boolean("authorizationGranted").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  userIdx: index("healthAudits_user_idx").on(table.userId),
}));

