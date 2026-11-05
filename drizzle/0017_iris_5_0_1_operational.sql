CREATE INDEX IF NOT EXISTS `integrationJobs_lock_idx` ON `integrationJobs` (`status`,`lockedUntil`);
CREATE INDEX IF NOT EXISTS `integrationEvents_dedupe_idx` ON `integrationEvents` (`provider`,`fingerprint`);
CREATE INDEX IF NOT EXISTS `integrationActionAudits_status_idx` ON `integrationActionAudits` (`status`,`createdAt`);
CREATE INDEX IF NOT EXISTS `oauthRefreshLocks_provider_idx` ON `oauthRefreshLocks` (`provider`,`lockedUntil`);
