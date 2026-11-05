CREATE TABLE IF NOT EXISTS `healthExams` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `userId` int NOT NULL,
  `fileName` varchar(255) NOT NULL,
  `fileFormat` enum('pdf','jpg','jpeg','png') NOT NULL,
  `mimeType` varchar(120) NOT NULL,
  `sizeBytes` int NOT NULL,
  `storageKey` varchar(512) NULL,
  `fileUrl` text NULL,
  `examDate` varchar(64) NULL,
  `laboratory` varchar(180) NULL,
  `doctorName` varchar(180) NULL,
  `summaryNote` text NULL,
  `extractedMarkersCount` int NOT NULL DEFAULT 0,
  `status` enum('armazenado','em_leitura','processado','erro') NOT NULL DEFAULT 'processado',
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY `healthExams_user_idx` (`userId`)
);

CREATE TABLE IF NOT EXISTS `healthMarkers` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `userId` int NOT NULL,
  `examId` int NULL,
  `category` varchar(64) NOT NULL,
  `markerName` varchar(180) NOT NULL,
  `examDate` varchar(64) NOT NULL,
  `result` varchar(120) NOT NULL,
  `numericValue` varchar(64) NULL,
  `unit` varchar(64) NOT NULL,
  `referenceRange` varchar(180) NULL,
  `status` enum('normal','alterado','indeterminado') NOT NULL DEFAULT 'normal',
  `notes` text NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY `healthMarkers_user_idx` (`userId`),
  KEY `healthMarkers_exam_idx` (`examId`),
  KEY `healthMarkers_user_category_idx` (`userId`, `category`)
);

CREATE TABLE IF NOT EXISTS `healthMedications` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `userId` int NOT NULL,
  `name` varchar(180) NOT NULL,
  `dosage` varchar(120) NOT NULL,
  `frequency` varchar(120) NOT NULL,
  `type` enum('medicamento','suplemento') NOT NULL DEFAULT 'medicamento',
  `active` boolean NOT NULL DEFAULT true,
  `startDate` varchar(64) NULL,
  `notes` text NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY `healthMedications_user_idx` (`userId`)
);

CREATE TABLE IF NOT EXISTS `healthMeasurements` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `userId` int NOT NULL,
  `type` varchar(64) NOT NULL,
  `value` varchar(64) NOT NULL,
  `unit` varchar(32) NOT NULL,
  `measuredAt` varchar(64) NOT NULL,
  `notes` text NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY `healthMeasurements_user_idx` (`userId`)
);

CREATE TABLE IF NOT EXISTS `healthAudits` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `userId` int NOT NULL,
  `action` varchar(80) NOT NULL,
  `resource` varchar(180) NULL,
  `details` text NULL,
  `alteredData` boolean NOT NULL DEFAULT false,
  `sharedData` boolean NOT NULL DEFAULT false,
  `authorizationGranted` boolean NOT NULL DEFAULT true,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY `healthAudits_user_idx` (`userId`)
);
