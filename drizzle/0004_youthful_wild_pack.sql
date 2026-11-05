CREATE TABLE `aiMemories` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`content` text NOT NULL,
	`source` varchar(64) NOT NULL DEFAULT 'user-approved',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `aiMemories_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `aiMemories_user_idx` ON `aiMemories` (`userId`);