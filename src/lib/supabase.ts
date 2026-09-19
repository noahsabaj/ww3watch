// src/lib/supabase.ts
import { createClient } from '@supabase/supabase-js'
import type { AppDatabase } from './db'
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public'

export const supabase = createClient<AppDatabase>(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY)
