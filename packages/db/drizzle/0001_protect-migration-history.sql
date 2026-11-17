SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
SET LOCAL statement_timeout = '30s';
--> statement-breakpoint
ALTER TABLE public.__btc_lightning_pay_migrations ENABLE ROW LEVEL SECURITY;
