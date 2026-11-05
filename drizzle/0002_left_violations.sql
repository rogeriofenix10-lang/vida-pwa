CREATE TABLE `pushSubscriptions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`endpoint` text NOT NULL,
	`p256dh` text NOT NULL,
	`auth` text NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `pushSubscriptions_id` PRIMARY KEY(`id`),
	CONSTRAINT `pushSubscriptions_endpoint_unique` UNIQUE(`endpoint`)
);
--> statement-breakpoint
CREATE TABLE `radarItems` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`label` varchar(255) NOT NULL,
	`detail` text NOT NULL,
	`dateLabel` varchar(64) NOT NULL,
	`priority` enum('urgente','importante','atencao','normal','informacao') NOT NULL DEFAULT 'normal',
	`action` varchar(255) NOT NULL,
	`status` enum('pending','completed','snoozed') NOT NULL DEFAULT 'pending',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `radarItems_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `pushSubscriptions_user_idx` ON `pushSubscriptions` (`userId`);--> statement-breakpoint
CREATE INDEX `radarItems_user_idx` ON `radarItems` (`userId`);