CREATE TABLE `integrations` (
  `id` int AUTO_INCREMENT NOT NULL,
  `userId` int NOT NULL,
  `provider` varchar(64) NOT NULL,
  `label` varchar(120) NOT NULL,
  `status` enum('active','disabled','error') NOT NULL DEFAULT 'active',
  `encryptedConfig` text NOT NULL,
  `capabilities` text NOT NULL,
  `lastUsedAt` timestamp,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `integrations_id` PRIMARY KEY(`id`)
);
CREATE INDEX `integrations_user_idx` ON `integrations` (`userId`);
CREATE INDEX `integrations_provider_idx` ON `integrations` (`provider`);
CREATE TABLE `workflows` (
  `id` int AUTO_INCREMENT NOT NULL,
  `userId` int NOT NULL,
  `name` varchar(180) NOT NULL,
  `description` text,
  `status` enum('active','paused','archived') NOT NULL DEFAULT 'active',
  `definition` text NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `workflows_id` PRIMARY KEY(`id`)
);
CREATE INDEX `workflows_user_idx` ON `workflows` (`userId`);
CREATE INDEX `workflows_status_idx` ON `workflows` (`status`);
CREATE TABLE `workflowRuns` (
  `id` int AUTO_INCREMENT NOT NULL,
  `workflowId` int NOT NULL,
  `userId` int NOT NULL,
  `status` enum('running','succeeded','failed','cancelled') NOT NULL DEFAULT 'running',
  `input` text,
  `output` text,
  `errorCode` varchar(80),
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `finishedAt` timestamp,
  CONSTRAINT `workflowRuns_id` PRIMARY KEY(`id`)
);
CREATE INDEX `workflowRuns_workflow_idx` ON `workflowRuns` (`workflowId`);
CREATE INDEX `workflowRuns_user_idx` ON `workflowRuns` (`userId`);
CREATE INDEX `workflowRuns_status_idx` ON `workflowRuns` (`status`);
CREATE TABLE `workflowSteps` (
  `id` int AUTO_INCREMENT NOT NULL,
  `runId` int NOT NULL,
  `userId` int NOT NULL,
  `stepIndex` int NOT NULL,
  `toolName` varchar(64) NOT NULL,
  `status` enum('pending','running','succeeded','failed','skipped') NOT NULL DEFAULT 'pending',
  `idempotencyKey` varchar(180) NOT NULL,
  `input` text NOT NULL,
  `output` text,
  `errorCode` varchar(80),
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `finishedAt` timestamp,
  CONSTRAINT `workflowSteps_id` PRIMARY KEY(`id`),
  CONSTRAINT `workflowSteps_idempotencyKey_unique` UNIQUE(`idempotencyKey`)
);
CREATE INDEX `workflowSteps_run_idx` ON `workflowSteps` (`runId`);
CREATE INDEX `workflowSteps_user_idx` ON `workflowSteps` (`userId`);
CREATE INDEX `workflowSteps_status_idx` ON `workflowSteps` (`status`);
CREATE TABLE `agentAutonomySettings` (
  `id` int AUTO_INCREMENT NOT NULL,
  `userId` int NOT NULL,
  `enabled` boolean NOT NULL DEFAULT false,
  `allowedScopes` text NOT NULL,
  `maxSteps` int NOT NULL DEFAULT 5,
  `requireConfirmationAbove` enum('low','medium','high') NOT NULL DEFAULT 'medium',
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `agentAutonomySettings_id` PRIMARY KEY(`id`),
  CONSTRAINT `agentAutonomySettings_userId_unique` UNIQUE(`userId`)
);
