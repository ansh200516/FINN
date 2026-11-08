CREATE TABLE `document_meta` (
	`doc_id` text PRIMARY KEY NOT NULL,
	`source` text DEFAULT 'nse' NOT NULL,
	`published_at` integer,
	`title` text,
	`text_quality` text DEFAULT 'ok' NOT NULL,
	`chars` integer DEFAULT 0 NOT NULL,
	`low_text_pages` integer DEFAULT 0 NOT NULL,
	`spreads` integer DEFAULT false NOT NULL,
	`bytes` integer,
	`structure_json` text DEFAULT '{}' NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `document_pages` (
	`doc_id` text NOT NULL,
	`page` integer NOT NULL,
	`text` text DEFAULT '' NOT NULL,
	`chars` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`doc_id`, `page`)
);
--> statement-breakpoint
CREATE INDEX `document_pages_doc_idx` ON `document_pages` (`doc_id`);