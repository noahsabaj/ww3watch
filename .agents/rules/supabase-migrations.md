---
description: Guidelines for Supabase database migrations, CLI push, and connection fallback
always_on: true
---

# Supabase Migration & Database Guidelines

1. **Migration Filename Invariants**:
   - Always name migration files with unique 14-digit timestamps (`YYYYMMDDHHMMSS_description.sql`) or distinct integer prefixes.
   - Never create multiple migration files sharing the same prefix before the first underscore (e.g. avoid multiple `YYYYMMDD_*.sql` files), as Supabase CLI uses the prefix as the unique primary key in `supabase_migrations.schema_migrations`.

2. **Supabase Config (`config.toml`)**:
   - Ensure `[db.migrations] enabled = true` is set when using `supabase db push` or `supabase migration list`.

3. **Remote Deployment & CLI Fallbacks**:
   - If `supabase db push` fails with `permission denied to alter role cli_login_postgres` during management API role creation, use direct password authentication (`supabase db push -p <password>`) or direct Postgres client connection (`postgres://postgres:[password]@db.<ref>.supabase.co:5432/postgres`).
