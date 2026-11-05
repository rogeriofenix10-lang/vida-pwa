CREATE TABLE `aiProviderKeys` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`provider` enum('chatgpt','gemini','kimi') NOT NULL,
	`encryptedKey` text NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `aiProviderKeys_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `aiProviderKeys_user_idx` ON `aiProviderKeys` (`userId`);--> statement-breakpoint
CREATE INDEX `aiProviderKeys_provider_idx` ON `aiProviderKeys` (`provider`);