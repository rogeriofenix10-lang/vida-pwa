CREATE TABLE `conversations` (
  `id` int AUTO_INCREMENT NOT NULL,
  `userId` int NOT NULL,
  `title` varchar(255),
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `conversations_id` PRIMARY KEY(`id`),
  INDEX `conversations_user_idx` (`userId`)
);
--> statement-breakpoint
CREATE TABLE `conversationMessages` (
  `id` int AUTO_INCREMENT NOT NULL,
  `conversationId` int NOT NULL,
  `role` enum('user','assistant','system') NOT NULL,
  `content` text NOT NULL,
  `metadata` text,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `conversationMessages_id` PRIMARY KEY(`id`),
  INDEX `conversationMessages_conversation_idx` (`conversationId`)
);
--> statement-breakpoint
CREATE TABLE `agentProposals` (
  `id` int AUTO_INCREMENT NOT NULL,
  `userId` int NOT NULL,
  `conversationId` int,
  `type` varchar(64) NOT NULL,
  `payload` text NOT NULL,
  `riskLevel` enum('low','medium','high') NOT NULL DEFAULT 'low',
  `status` enum('pending','approved','executed','rejected','expired') NOT NULL DEFAULT 'pending',
  `confirmationToken` varchar(64) NOT NULL,
  `expiresAt` timestamp NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `confirmedAt` timestamp NULL,
  `executedAt` timestamp NULL,
  CONSTRAINT `agentProposals_id` PRIMARY KEY(`id`),
  CONSTRAINT `agentProposals_confirmationToken_unique` UNIQUE(`confirmationToken`),
  INDEX `agentProposals_user_idx` (`userId`),
  INDEX `agentProposals_status_idx` (`status`),
  INDEX `agentProposals_expiry_idx` (`expiresAt`)
);
