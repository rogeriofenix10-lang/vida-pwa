ALTER TABLE `aiMemories`
  ADD COLUMN `category` varchar(32) NOT NULL DEFAULT 'fact',
  ADD COLUMN `importance` int NOT NULL DEFAULT 1,
  ADD COLUMN `archived` boolean NOT NULL DEFAULT false,
  ADD COLUMN `lastAccessedAt` timestamp NULL;
CREATE INDEX `aiMemories_user_archived_idx` ON `aiMemories` (`userId`,`archived`);
CREATE INDEX `aiMemories_category_idx` ON `aiMemories` (`category`);
