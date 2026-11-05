CREATE TABLE IF NOT EXISTS `integrationActionApprovals` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `userId` int NOT NULL,
  `provider` varchar(64) NOT NULL,
  `action` varchar(80) NOT NULL,
  `capability` varchar(80) NOT NULL,
  `payloadHash` varchar(64) NOT NULL,
  `status` enum('pending','approved','consumed','expired','cancelled') NOT NULL DEFAULT 'pending',
  `expiresAt` timestamp NOT NULL,
  `approvedAt` timestamp NULL,
  `consumedAt` timestamp NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY `integrationActionApprovals_user_idx` (`userId`),
  KEY `integrationActionApprovals_status_idx` (`status`,`expiresAt`),
  KEY `integrationActionApprovals_lookup_idx` (`userId`,`provider`,`action`,`payloadHash`)
);
