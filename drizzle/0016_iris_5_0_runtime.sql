CREATE TABLE IF NOT EXISTS `integrationJobs` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `userId` int NOT NULL,
  `provider` varchar(64) NOT NULL,
  `action` varchar(80) NOT NULL,
  `status` enum('pending','running','succeeded','failed','dead') NOT NULL DEFAULT 'pending',
  `payload` text NOT NULL,
  `result` text,
  `errorCode` varchar(80),
  `attempts` int NOT NULL DEFAULT 0,
  `maxAttempts` int NOT NULL DEFAULT 5,
  `availableAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `lockedUntil` timestamp NULL,
  `idempotencyKey` varchar(180) NOT NULL UNIQUE,
  `correlationId` varchar(180),
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY `integrationJobs_ready_idx` (`status`,`availableAt`),
  KEY `integrationJobs_provider_idx` (`provider`,`status`),
  KEY `integrationJobs_user_idx` (`userId`),
  KEY `integrationJobs_correlation_idx` (`correlationId`)
);

CREATE TABLE IF NOT EXISTS `integrationEvents` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `userId` int NULL,
  `provider` varchar(64) NOT NULL,
  `eventType` varchar(120) NOT NULL,
  `fingerprint` varchar(128) NOT NULL UNIQUE,
  `payload` text NOT NULL,
  `status` enum('received','processing','processed','failed','ignored') NOT NULL DEFAULT 'received',
  `errorCode` varchar(80),
  `receivedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `processedAt` timestamp NULL,
  KEY `integrationEvents_provider_status_idx` (`provider`,`status`),
  KEY `integrationEvents_received_idx` (`receivedAt`)
);

CREATE TABLE IF NOT EXISTS `integrationActionAudits` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `userId` int NOT NULL,
  `provider` varchar(64) NOT NULL,
  `action` varchar(80) NOT NULL,
  `capability` varchar(80),
  `status` enum('requested','confirmed','succeeded','failed','replayed') NOT NULL,
  `requestId` varchar(180),
  `correlationId` varchar(180),
  `idempotencyKey` varchar(180),
  `errorCode` varchar(80),
  `metadata` text,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY `integrationActionAudits_user_idx` (`userId`),
  KEY `integrationActionAudits_provider_idx` (`provider`,`createdAt`),
  KEY `integrationActionAudits_request_idx` (`requestId`)
);

CREATE TABLE IF NOT EXISTS `oauthRefreshLocks` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `userId` int NOT NULL,
  `provider` varchar(64) NOT NULL,
  `lockedUntil` timestamp NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `oauthRefreshLocks_user_provider_unique` (`userId`,`provider`),
  KEY `oauthRefreshLocks_expiry_idx` (`lockedUntil`)
);
