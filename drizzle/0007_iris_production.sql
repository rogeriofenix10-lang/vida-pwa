ALTER TABLE `radarItems` ADD `dueAt` timestamp NULL;
ALTER TABLE `radarItems` ADD `reminderAt` timestamp NULL;
ALTER TABLE `radarItems` ADD `timezone` varchar(64) NOT NULL DEFAULT 'America/Sao_Paulo';
ALTER TABLE `radarItems` ADD `confirmationToken` varchar(64) NULL;
ALTER TABLE `radarItems` ADD `lastNotifiedAt` timestamp NULL;
CREATE UNIQUE INDEX `radarItems_confirmationToken_unique` ON `radarItems` (`confirmationToken`);
