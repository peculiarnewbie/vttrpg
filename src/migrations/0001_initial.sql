CREATE TABLE `users` (
  `id` text PRIMARY KEY NOT NULL,
  `kind` text NOT NULL,
  `display_name` text NOT NULL,
  `email` text,
  `username` text,
  `google_sub` text,
  `avatar_url` text,
  `password_hash` text,
  `password_salt` text,
  `created_by` text,
  `created_at` text NOT NULL
);

CREATE UNIQUE INDEX `users_email_uniq` ON `users` (`email`) WHERE `email` IS NOT NULL;
CREATE UNIQUE INDEX `users_username_uniq` ON `users` (`username`) WHERE `username` IS NOT NULL;

CREATE TABLE `worlds` (
  `id` text PRIMARY KEY NOT NULL,
  `owner_user_id` text NOT NULL,
  `name` text NOT NULL,
  `slug` text NOT NULL,
  `do_name` text NOT NULL,
  `r2_prefix` text NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);

CREATE UNIQUE INDEX `worlds_slug_uniq` ON `worlds` (`slug`);
CREATE INDEX `worlds_owner_idx` ON `worlds` (`owner_user_id`);

CREATE TABLE `world_members` (
  `id` text PRIMARY KEY NOT NULL,
  `world_id` text NOT NULL,
  `user_id` text,
  `display_name` text NOT NULL,
  `role` text NOT NULL,
  `kind` text NOT NULL,
  `email` text,
  `username` text,
  `character_id` text,
  `created_at` text NOT NULL
);

CREATE INDEX `world_members_world_idx` ON `world_members` (`world_id`);
CREATE INDEX `world_members_user_idx` ON `world_members` (`user_id`);
CREATE INDEX `world_members_email_idx` ON `world_members` (`email`);

CREATE TABLE `sessions` (
  `token` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `created_at` text NOT NULL,
  `expires_at` text NOT NULL
);

CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);
