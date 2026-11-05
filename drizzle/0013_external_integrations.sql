CREATE TABLE `agentExecutionSteps` (
  `id` int AUTO_INCREMENT NOT NULL,
  `executionId` int NOT NULL,
  `userId` int NOT NULL,
  `stepIndex` int NOT NULL,
  `toolName` varchar(64) NOT NULL,
  `status` enum('running','succeeded','failed') NOT NULL DEFAULT 'running',
  `idempotencyKey` varchar(160) NOT NULL,
  `input` text NOT NULL,
  `output` text,
  `errorCode` varchar(80),
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `finishedAt` timestamp,
  CONSTRAINT `agentExecutionSteps_id` PRIMARY KEY(`id`),
  CONSTRAINT `agentExecutionSteps_idempotencyKey_unique` UNIQUE(`idempotencyKey`)
);
CREATE INDEX `agentExecutionSteps_execution_idx` ON `agentExecutionSteps` (`executionId`);
CREATE INDEX `agentExecutionSteps_user_idx` ON `agentExecutionSteps` (`userId`);
CREATE INDEX `agentExecutionSteps_status_idx` ON `agentExecutionSteps` (`status`);
