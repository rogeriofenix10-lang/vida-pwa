CREATE TABLE IF NOT EXISTS `voiceProfiles` (
  `id` int AUTO_INCREMENT NOT NULL,
  `userId` int NOT NULL,
  `enabled` boolean NOT NULL DEFAULT false,
  `wakeWord` varchar(32) NOT NULL DEFAULT 'iris',
  `language` varchar(16) NOT NULL DEFAULT 'pt-BR',
  `voiceIdentityEnabled` boolean NOT NULL DEFAULT true,
  `unknownVoicePolicy` enum('limited','deny_sensitive','deny_all') NOT NULL DEFAULT 'deny_sensitive',
  `trustedDeviceRequired` boolean NOT NULL DEFAULT true,
  `biometricProvider` varchar(64),
  `enrolledAt` timestamp NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `voiceProfiles_id` PRIMARY KEY(`id`),
  CONSTRAINT `voiceProfiles_userId_unique` UNIQUE(`userId`)
);
CREATE INDEX `voiceProfiles_user_idx` ON `voiceProfiles` (`userId`);
