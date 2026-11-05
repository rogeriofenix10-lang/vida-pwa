-- IRIS 3.1 canonical reconciliation migration.
-- This migration is idempotent for the supplemental 1.9-3.1 schema additions.

CREATE TABLE IF NOT EXISTS `integrationOAuthStates` (
  `id` INT AUTO_INCREMENT PRIMARY KEY, `userId` INT NOT NULL, `provider` VARCHAR(64) NOT NULL,
  `state` VARCHAR(180) NOT NULL UNIQUE, `codeVerifier` VARCHAR(256) NOT NULL, `redirectUri` VARCHAR(1000) NOT NULL,
  `expiresAt` TIMESTAMP NOT NULL, `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX `integrationOAuthStates_user_idx` (`userId`), INDEX `integrationOAuthStates_expires_idx` (`expiresAt`)
);

CREATE TABLE IF NOT EXISTS `workflowSchedules` (
  `id` INT AUTO_INCREMENT PRIMARY KEY, `workflowId` INT NOT NULL, `userId` INT NOT NULL, `cron` VARCHAR(120) NOT NULL,
  `timezone` VARCHAR(64) NOT NULL DEFAULT 'America/Sao_Paulo', `enabled` BOOLEAN NOT NULL DEFAULT TRUE,
  `nextRunAt` TIMESTAMP NULL, `lastRunAt` TIMESTAMP NULL, `lockedUntil` TIMESTAMP NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `workflowSchedules_user_idx` (`userId`), INDEX `workflowSchedules_workflow_idx` (`workflowId`), INDEX `workflowSchedules_next_run_idx` (`nextRunAt`)
);

ALTER TABLE `workflowSchedules` ADD COLUMN IF NOT EXISTS `lockedUntil` TIMESTAMP NULL;

CREATE TABLE IF NOT EXISTS `agentControlSettings` (
  `id` INT AUTO_INCREMENT PRIMARY KEY, `userId` INT NOT NULL UNIQUE, `killSwitch` BOOLEAN NOT NULL DEFAULT FALSE,
  `dailyRunLimit` INT NOT NULL DEFAULT 100, `dailyHighRiskLimit` INT NOT NULL DEFAULT 10, `maxWorkflowRuntimeSeconds` INT NOT NULL DEFAULT 120,
  `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS `agentUsageDaily` (
  `id` INT AUTO_INCREMENT PRIMARY KEY, `userId` INT NOT NULL, `usageDate` VARCHAR(10) NOT NULL, `runs` INT NOT NULL DEFAULT 0,
  `highRiskRuns` INT NOT NULL DEFAULT 0, `estimatedTokens` INT NOT NULL DEFAULT 0, `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `agentUsageDaily_user_date_unique` (`userId`,`usageDate`), INDEX `agentUsageDaily_user_date_idx` (`userId`,`usageDate`)
);
CREATE TABLE IF NOT EXISTS `agentEvents` (
  `id` INT AUTO_INCREMENT PRIMARY KEY, `userId` INT NOT NULL, `eventType` VARCHAR(80) NOT NULL,
  `severity` ENUM('info','warning','error','critical') NOT NULL DEFAULT 'info', `correlationId` VARCHAR(180), `metadata` TEXT,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, INDEX `agentEvents_user_idx` (`userId`), INDEX `agentEvents_created_idx` (`createdAt`), INDEX `agentEvents_correlation_idx` (`correlationId`)
);

CREATE TABLE IF NOT EXISTS `voiceProfiles` (
  `id` INT AUTO_INCREMENT PRIMARY KEY, `userId` INT NOT NULL UNIQUE, `enabled` BOOLEAN NOT NULL DEFAULT FALSE,
  `wakeWord` VARCHAR(32) NOT NULL DEFAULT 'iris', `language` VARCHAR(16) NOT NULL DEFAULT 'pt-BR', `voiceIdentityEnabled` BOOLEAN NOT NULL DEFAULT TRUE,
  `unknownVoicePolicy` ENUM('limited','deny_sensitive','deny_all') NOT NULL DEFAULT 'deny_sensitive', `trustedDeviceRequired` BOOLEAN NOT NULL DEFAULT TRUE,
  `biometricProvider` VARCHAR(64), `enrolledAt` TIMESTAMP NULL, `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, INDEX `voiceProfiles_user_idx` (`userId`)
);

-- Memory intelligence columns may already exist in installations that used the earlier supplemental migrations.
ALTER TABLE `aiMemories` ADD COLUMN IF NOT EXISTS `category` VARCHAR(32) NOT NULL DEFAULT 'fact';
ALTER TABLE `aiMemories` ADD COLUMN IF NOT EXISTS `importance` INT NOT NULL DEFAULT 1;
ALTER TABLE `aiMemories` ADD COLUMN IF NOT EXISTS `archived` BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE `aiMemories` ADD COLUMN IF NOT EXISTS `lastAccessedAt` TIMESTAMP NULL;

-- IRIS 3.2 connector OAuth uses the existing integrationOAuthStates table.
-- No new credential columns are required: provider tokens remain encrypted in integrations.encryptedConfig.
