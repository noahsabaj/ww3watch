-- Both columns have defaults and no NULL has ever been written (0 of 20,353 rows
-- in prod), but the schema allowed them — so the generated types said
-- `string | null` and every consumer had to pretend otherwise. Make the schema
-- say what is true.
alter table public.articles alter column fetched_at set not null;
alter table public.articles alter column source_lang set not null;
