CREATE TABLE `storageFiles` (
  `id` int AUTO_INCREMENT NOT NULL,
  `userId` int NOT NULL,
  `storageKey` varchar(512) NOT NULL,
  `originalName` varchar(180) NOT NULL,
  `mimeType` varchar(120) NOT NULL,
  `sizeBytes` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `storageFiles_id` PRIMARY KEY(`id`),
  CONSTRAINT `storageFiles_storageKey_unique` UNIQUE(`storageKey`),
  INDEX `storageFiles_user_idx` (`userId`)
);
--> statement-breakpoint
CREATE TABLE `sessions` (
  `id` int AUTO_INCREMENT NOT NULL,
  `userId` int NOT NULL,
  `tokenHash` varchar(64) NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `expiresAt` timestamp NOT NULL,
  `revokedAt` timestamp NULL,
  `lastUsedAt` timestamp NULL,
  `userAgent` varchar(512) NULL,
  `ipAddress` varchar(64) NULL,
  CONSTRAINT `sessions_id` PRIMARY KEY(`id`),
  CONSTRAINT `sessions_tokenHash_unique` UNIQUE(`tokenHash`),
  INDEX `sessions_user_idx` (`userId`),
  INDEX `sessions_expiry_idx` (`expiresAt`)
);
