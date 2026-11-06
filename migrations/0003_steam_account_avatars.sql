-- Cached Steam profile avatar for each account. avatar_hash is the 40-char hex
-- digest Steam uses in avatar URLs (https://avatars.steamstatic.com/<hash>_full.jpg).
-- It is public profile data, not a secret. avatar_checked_at is NULL until the
-- first lookup; the account list fills those in, the daily cron refreshes the rest.
ALTER TABLE steam_accounts ADD COLUMN avatar_hash TEXT;
ALTER TABLE steam_accounts ADD COLUMN avatar_checked_at TEXT;
