CREATE TABLE `alerts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`isin` text,
	`kind` text NOT NULL,
	`tripwire_id` text,
	`event_key` text,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`fired_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`delivered_via_json` text DEFAULT '{}' NOT NULL,
	`read_at` integer
);
--> statement-breakpoint
CREATE INDEX `alerts_user_fired_idx` ON `alerts` (`user_id`,`fired_at`);--> statement-breakpoint
CREATE INDEX `alerts_event_key_idx` ON `alerts` (`event_key`);--> statement-breakpoint
CREATE TABLE `announcements` (
	`id` text PRIMARY KEY NOT NULL,
	`isin` text NOT NULL,
	`symbol` text NOT NULL,
	`exchange` text DEFAULT 'NSE' NOT NULL,
	`desc` text DEFAULT '' NOT NULL,
	`subject` text DEFAULT '' NOT NULL,
	`text` text DEFAULT '' NOT NULL,
	`attachment_url` text,
	`attachment_size` integer,
	`has_xbrl` integer DEFAULT false NOT NULL,
	`filed_at` integer NOT NULL,
	`filed_at_ist` text NOT NULL,
	`category` text DEFAULT 'unclassified' NOT NULL,
	`subcategory` text,
	`classified_by` text,
	`priority` integer DEFAULT 0 NOT NULL,
	`tier` integer DEFAULT 3 NOT NULL,
	`event_key` text,
	`voice_summary` text,
	`voice_url` text,
	`raw_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `announcements_isin_filed_at_idx` ON `announcements` (`isin`,`filed_at`);--> statement-breakpoint
CREATE INDEX `announcements_filed_at_idx` ON `announcements` (`filed_at`);--> statement-breakpoint
CREATE INDEX `announcements_event_key_idx` ON `announcements` (`event_key`);--> statement-breakpoint
CREATE TABLE `companies` (
	`isin` text PRIMARY KEY NOT NULL,
	`nse_symbol` text NOT NULL,
	`bse_code` text,
	`name` text NOT NULL,
	`sector` text,
	`industry` text,
	`aliases_json` text DEFAULT '[]' NOT NULL,
	`screener_slug` text,
	`in_portfolio` integer DEFAULT false NOT NULL,
	`is_adhoc` integer DEFAULT false NOT NULL,
	`added_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `companies_nse_symbol_uq` ON `companies` (`nse_symbol`);--> statement-breakpoint
CREATE TABLE `documents` (
	`id` text PRIMARY KEY NOT NULL,
	`isin` text NOT NULL,
	`kind` text NOT NULL,
	`period` text,
	`url` text NOT NULL,
	`sha256` text,
	`pages` integer,
	`text_ref` text,
	`announcement_id` text,
	`fetched_at` integer,
	`text_status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `documents_url_uq` ON `documents` (`url`);--> statement-breakpoint
CREATE INDEX `documents_isin_kind_idx` ON `documents` (`isin`,`kind`);--> statement-breakpoint
CREATE TABLE `events` (
	`event_key` text PRIMARY KEY NOT NULL,
	`isin` text NOT NULL,
	`category` text NOT NULL,
	`first_at` integer NOT NULL,
	`last_at` integer NOT NULL,
	`tier` integer DEFAULT 3 NOT NULL,
	`card_type` text DEFAULT 'routine' NOT NULL,
	`card_json` text DEFAULT '{}' NOT NULL,
	`announcement_ids_json` text DEFAULT '[]' NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `events_isin_last_at_idx` ON `events` (`isin`,`last_at`);--> statement-breakpoint
CREATE INDEX `events_last_at_idx` ON `events` (`last_at`);--> statement-breakpoint
CREATE TABLE `facts` (
	`id` text PRIMARY KEY NOT NULL,
	`isin` text NOT NULL,
	`doc_id` text,
	`page` integer,
	`kind` text NOT NULL,
	`text` text NOT NULL,
	`value_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `facts_isin_idx` ON `facts` (`isin`);--> statement-breakpoint
CREATE INDEX `facts_doc_idx` ON `facts` (`doc_id`);--> statement-breakpoint
CREATE TABLE `guidance` (
	`id` text PRIMARY KEY NOT NULL,
	`isin` text NOT NULL,
	`doc_id` text NOT NULL,
	`speaker` text,
	`role` text,
	`page` integer,
	`quote` text NOT NULL,
	`metric` text NOT NULL,
	`direction` text,
	`low` real,
	`high` real,
	`unit` text,
	`horizon` text,
	`status` text DEFAULT 'open' NOT NULL,
	`settled_by_quarter` text,
	`verdict` text,
	`evidence_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `guidance_isin_status_idx` ON `guidance` (`isin`,`status`);--> statement-breakpoint
CREATE INDEX `guidance_doc_idx` ON `guidance` (`doc_id`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`isin` text,
	`step` text DEFAULT 'queued' NOT NULL,
	`state` text DEFAULT 'queued' NOT NULL,
	`log_json` text DEFAULT '[]' NOT NULL,
	`error` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `jobs_kind_state_idx` ON `jobs` (`kind`,`state`);--> statement-breakpoint
CREATE INDEX `jobs_isin_idx` ON `jobs` (`isin`);--> statement-breakpoint
CREATE TABLE `llm_cache` (
	`key` text PRIMARY KEY NOT NULL,
	`task` text NOT NULL,
	`model` text NOT NULL,
	`prompt_version` text NOT NULL,
	`response_json` text NOT NULL,
	`tokens_in` integer DEFAULT 0 NOT NULL,
	`tokens_out` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `llm_cache_task_idx` ON `llm_cache` (`task`);--> statement-breakpoint
CREATE TABLE `llm_ledger` (
	`model` text NOT NULL,
	`date_pt` text NOT NULL,
	`requests` integer DEFAULT 0 NOT NULL,
	`tokens_in` integer DEFAULT 0 NOT NULL,
	`tokens_out` integer DEFAULT 0 NOT NULL,
	`tokens_thought` integer DEFAULT 0 NOT NULL,
	`errors` integer DEFAULT 0 NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`model`, `date_pt`)
);
--> statement-breakpoint
CREATE TABLE `prices` (
	`isin` text NOT NULL,
	`date` text NOT NULL,
	`open` real,
	`high` real,
	`low` real,
	`close` real,
	`prev_close` real,
	`volume` integer,
	`turnover` real,
	`trades` integer,
	`session_type` text DEFAULT 'normal' NOT NULL,
	`source` text DEFAULT 'nse_bhav' NOT NULL,
	PRIMARY KEY(`isin`, `date`)
);
--> statement-breakpoint
CREATE INDEX `prices_isin_date_idx` ON `prices` (`isin`,`date`);--> statement-breakpoint
CREATE INDEX `prices_date_idx` ON `prices` (`date`);--> statement-breakpoint
CREATE TABLE `research_sections` (
	`isin` text NOT NULL,
	`section` text NOT NULL,
	`model` text,
	`prompt_version` text,
	`json` text DEFAULT '{}' NOT NULL,
	`fact_ids_json` text DEFAULT '[]' NOT NULL,
	`generated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`isin`, `section`)
);
--> statement-breakpoint
CREATE TABLE `results_quarters` (
	`isin` text NOT NULL,
	`period_end` text NOT NULL,
	`basis` text NOT NULL,
	`source` text NOT NULL,
	`audited` integer,
	`revenue` real,
	`other_income` real,
	`finance_costs` real,
	`dna` real,
	`pbeit` real,
	`exceptional` real,
	`pbt` real,
	`tax` real,
	`pat` real,
	`pat_cont` real,
	`eps` real,
	`checks_json` text DEFAULT '{}' NOT NULL,
	`source_url` text,
	`filed_at` integer,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`isin`, `period_end`, `basis`)
);
--> statement-breakpoint
CREATE INDEX `results_isin_period_idx` ON `results_quarters` (`isin`,`period_end`);--> statement-breakpoint
CREATE TABLE `tripwires` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`isin` text,
	`rule_json` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `tripwires_user_idx` ON `tripwires` (`user_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`portfolio_isins_json` text DEFAULT '[]' NOT NULL,
	`prefs_json` text DEFAULT '{}' NOT NULL,
	`push_subscriptions_json` text DEFAULT '[]' NOT NULL,
	`telegram_chat_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`last_seen_at` integer
);
