ALTER TABLE `agentProposals` ADD `intent` varchar(120) NULL;
ALTER TABLE `agentProposals` ADD `confidence` int NULL;
ALTER TABLE `agentProposals` ADD `plan` text NULL;
ALTER TABLE `agentProposals` ADD `modelProvider` varchar(32) NULL;
ALTER TABLE `agentProposals` ADD `modelName` varchar(120) NULL;
ALTER TABLE `agentProposals` ADD `policyReason` varchar(500) NULL;
