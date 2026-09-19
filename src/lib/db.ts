// The app's view of the generated schema. Postgres stores region / topic /
// actors as text; the app treats them as closed vocabularies (src/lib/types.ts,
// src/lib/signals.ts). This is the ONE place that narrowing happens — both
// Supabase clients are typed with AppDatabase, so query results arrive already
// narrowed and nothing downstream needs an `as`.
import type { Database } from './database.types'
import type { SourceRegion } from './types'
import type { Actor, Topic } from './signals'

type Override<T, O> = Omit<T, keyof O> & O
type Pub = Database['public']
type Articles = Pub['Tables']['articles']

type ArticleNarrowing = { source_region: SourceRegion; topic: Topic | null; actors: Actor[] | null }

export type AppDatabase = Override<
  Database,
  {
    public: Override<
      Pub,
      {
        Tables: Override<
          Pub['Tables'],
          {
            articles: Override<
              Articles,
              {
                Row: Override<Articles['Row'], ArticleNarrowing>
                Insert: Override<Articles['Insert'], Partial<ArticleNarrowing> & { source_region: SourceRegion }>
                Update: Override<Articles['Update'], Partial<ArticleNarrowing>>
              }
            >
          }
        >
      }
    >
  }
>

export type ArticleRow = AppDatabase['public']['Tables']['articles']['Row']
