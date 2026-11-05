ALTER TABLE `agentProposals` MODIFY COLUMN `status` enum('pending','approved','executing','executed','rejected','expired') NOT NULL DEFAULT 'pending';
--> statement-breakpoint
ALTER TABLE `agentProposals` ADD `toolName` varchar(64) NULL;
--> statement-breakpoint
CREATE TABLE `agentExecutions` (
  `id` int AUTO_INCREMENT NOT NULL,
  `proposalId` int NOT NULL,
  `userId` int NOT NULL,
  `toolName` varchar(64) NOT NULL,
  `status` enum('running','succeeded','failed') NOT NULL DEFAULT 'running',
  `input` text NOT NULL,
  `output` text,
  `errorCode` varchar(80),
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `finishedAt` timestamp NULL,
  CONSTRAINT `agentExecutions_id` PRIMARY KEY(`id`),
  INDEX `agentExecutions_proposal_idx` (`proposalId`),
  INDEX `agentExecutions_user_idx` (`userId`),
  INDEX `agentExecutions_status_idx` (`status`)
);
--> statement-breakpoint
CREATE TABLE `agentAuditLogs` (
  `id` int AUTO_INCREMENT NOT NULL,
  `userId` int NOT NULL,
  `proposalId` int,
  `executionId` int,
  `event` varchar(64) NOT NULL,
  `toolName` varchar(64),
  `details` text,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `agentAuditLogs_id` PRIMARY KEY(`id`),
  INDEX `agentAuditLogs_user_idx` (`userId`),
  INDEX `agentAuditLogs_proposal_idx` (`proposalId`),
  INDEX `agentAuditLogs_created_idx` (`createdAt`)
);
