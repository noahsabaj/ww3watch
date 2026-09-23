-- The classification (Jev) allowance goes from $15 to $20 a month.
--
-- Measured 2026-09-23 with every stage working (merges since #149, signals
-- since #162): ~$0.65-0.71 a day, ~$20-22 a month, so the $15 cap would stop
-- judging for the last week of each month ("AI budget unavailable; judgment
-- deferred"). The zero-regression cuts in the same change (trending reuse, no
-- unread topic question, no merge re-asks) bring that to ~$17-18. The cap is
-- the application's own safety limit, not TypeSafe's price; Noah approved $20.
update public.ai_budgets set monthly_usd = 20 where service = 'classification';
