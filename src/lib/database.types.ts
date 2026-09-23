// Generated from the live schema through Supabase MCP.
// Regenerate after every migration; CI also checks against an isolated database.
// Do not hand-edit schema definitions.
//
// Project: qusjbpknlduuklnfciws
// Schema: public
// Application narrowing lives in db.ts.
//
// Generated 2026-09-20.
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      ai_budgets: {
        Row: {
          input_per_million: number | null
          max_concurrent: number
          model: string | null
          monthly_usd: number
          output_per_million: number | null
          pricing_verified_at: string | null
          service: string
        }
        Insert: {
          input_per_million?: number | null
          max_concurrent: number
          model?: string | null
          monthly_usd: number
          output_per_million?: number | null
          pricing_verified_at?: string | null
          service: string
        }
        Update: {
          input_per_million?: number | null
          max_concurrent?: number
          model?: string | null
          monthly_usd?: number
          output_per_million?: number | null
          pricing_verified_at?: string | null
          service?: string
        }
        Relationships: []
      }
      ai_months: {
        Row: {
          charged_usd: number
          month: string
          opening_verified_at: string | null
          service: string
        }
        Insert: {
          charged_usd?: number
          month: string
          opening_verified_at?: string | null
          service: string
        }
        Update: {
          charged_usd?: number
          month?: string
          opening_verified_at?: string | null
          service?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_months_service_fkey"
            columns: ["service"]
            isOneToOne: false
            referencedRelation: "ai_budgets"
            referencedColumns: ["service"]
          },
        ]
      }
      ai_reservations: {
        Row: {
          charged_usd: number
          created_at: string
          id: string
          input_rate: number
          lease_until: string
          month: string
          output_rate: number
          service: string
          settled: boolean
        }
        Insert: {
          charged_usd: number
          created_at?: string
          id?: string
          input_rate: number
          lease_until?: string
          month: string
          output_rate: number
          service: string
          settled?: boolean
        }
        Update: {
          charged_usd?: number
          created_at?: string
          id?: string
          input_rate?: number
          lease_until?: string
          month?: string
          output_rate?: number
          service?: string
          settled?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "ai_reservations_service_month_fkey"
            columns: ["service", "month"]
            isOneToOne: false
            referencedRelation: "ai_months"
            referencedColumns: ["service", "month"]
          },
        ]
      }
      article_content: {
        Row: {
          byline: string | null
          content: string
          fetched_at: string
          site_name: string | null
          title: string
          url: string
        }
        Insert: {
          byline?: string | null
          content: string
          fetched_at?: string
          site_name?: string | null
          title?: string
          url: string
        }
        Update: {
          byline?: string | null
          content?: string
          fetched_at?: string
          site_name?: string | null
          title?: string
          url?: string
        }
        Relationships: []
      }
      article_embeddings: {
        Row: {
          article_id: string
          created_at: string
          embedding: string
          model: string
        }
        Insert: {
          article_id: string
          created_at?: string
          embedding: string
          model: string
        }
        Update: {
          article_id?: string
          created_at?: string
          embedding?: string
          model?: string
        }
        Relationships: [
          {
            foreignKeyName: "article_embeddings_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: true
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
        ]
      }
      article_translations: {
        Row: {
          content: string
          created_at: string
          input_hash: string
          target_lang: string
          title: string
        }
        Insert: {
          content: string
          created_at?: string
          input_hash: string
          target_lang?: string
          title: string
        }
        Update: {
          content?: string
          created_at?: string
          input_hash?: string
          target_lang?: string
          title?: string
        }
        Relationships: []
      }
      articles: {
        Row: {
          actors: string[] | null
          body_hash: string | null
          claim: number | null
          feed_url: string
          fetched_at: string
          guid: string
          id: string
          image_fetched_at: string | null
          image_height: number | null
          image_hash: string | null
          image_url: string | null
          image_verdict: string | null
          image_width: number | null
          jev_relevant: number | null
          opinion: number | null
          published_at: string | null
          severity: number | null
          signals_at: string | null
          source_affiliation: string | null
          source_id: string | null
          source_lang: string
          source_name: string
          source_region: string
          story_id: string | null
          summary: string | null
          title: string
          topic: string | null
          unverified: number | null
          url: string
        }
        Insert: {
          actors?: string[] | null
          body_hash?: string | null
          claim?: number | null
          feed_url: string
          fetched_at?: string
          guid: string
          id?: string
          image_fetched_at?: string | null
          image_height?: number | null
          image_hash?: string | null
          image_url?: string | null
          image_verdict?: string | null
          image_width?: number | null
          jev_relevant?: number | null
          opinion?: number | null
          published_at?: string | null
          severity?: number | null
          signals_at?: string | null
          source_affiliation?: string | null
          source_id?: string | null
          source_lang?: string
          source_name: string
          source_region: string
          story_id?: string | null
          summary?: string | null
          title: string
          topic?: string | null
          unverified?: number | null
          url: string
        }
        Update: {
          actors?: string[] | null
          body_hash?: string | null
          claim?: number | null
          feed_url?: string
          fetched_at?: string
          guid?: string
          id?: string
          image_fetched_at?: string | null
          image_height?: number | null
          image_hash?: string | null
          image_url?: string | null
          image_verdict?: string | null
          image_width?: number | null
          jev_relevant?: number | null
          opinion?: number | null
          published_at?: string | null
          severity?: number | null
          signals_at?: string | null
          source_affiliation?: string | null
          source_id?: string | null
          source_lang?: string
          source_name?: string
          source_region?: string
          story_id?: string | null
          summary?: string | null
          title?: string
          topic?: string | null
          unverified?: number | null
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "articles_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "sources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "articles_story_id_fkey"
            columns: ["story_id"]
            isOneToOne: false
            referencedRelation: "stories"
            referencedColumns: ["id"]
          },
        ]
      }
      classified_rejects: {
        Row: {
          guid: string
          lang: string | null
          reason: string
          rejected_at: string
          source_id: string | null
          title: string | null
        }
        Insert: {
          guid: string
          lang?: string | null
          reason?: string
          rejected_at?: string
          source_id?: string | null
          title?: string | null
        }
        Update: {
          guid?: string
          lang?: string | null
          reason?: string
          rejected_at?: string
          source_id?: string | null
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "classified_rejects_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "sources"
            referencedColumns: ["id"]
          },
        ]
      }
      ops_events: {
        Row: {
          details: Json
          name: string
          occurred_at: string
        }
        Insert: {
          details?: Json
          name: string
          occurred_at?: string
        }
        Update: {
          details?: Json
          name?: string
          occurred_at?: string
        }
        Relationships: []
      }
      pipeline_runs: {
        Row: {
          error: string | null
          finished_at: string
          id: number
          started_at: string
          stats: Json | null
        }
        Insert: {
          error?: string | null
          finished_at?: string
          id?: never
          started_at: string
          stats?: Json | null
        }
        Update: {
          error?: string | null
          finished_at?: string
          id?: never
          started_at?: string
          stats?: Json | null
        }
        Relationships: []
      }
      rate_limits: {
        Row: {
          count: number
          fn: string
          ip: string
          window_start: string
        }
        Insert: {
          count?: number
          fn: string
          ip: string
          window_start: string
        }
        Update: {
          count?: number
          fn?: string
          ip?: string
          window_start?: string
        }
        Relationships: []
      }
      sources: {
        Row: {
          affiliation: string | null
          consecutive_failures: number
          enabled: boolean
          id: string
          lang: string
          last_error: string | null
          last_error_kind: string | null
          last_ok_at: string | null
          last_via: string | null
          name: string
          region: string
          updated_at: string
          url: string
        }
        Insert: {
          affiliation?: string | null
          consecutive_failures?: number
          enabled?: boolean
          id?: string
          lang: string
          last_error?: string | null
          last_error_kind?: string | null
          last_ok_at?: string | null
          last_via?: string | null
          name: string
          region: string
          updated_at?: string
          url: string
        }
        Update: {
          affiliation?: string | null
          consecutive_failures?: number
          enabled?: boolean
          id?: string
          lang?: string
          last_error?: string | null
          last_error_kind?: string | null
          last_ok_at?: string | null
          last_via?: string | null
          name?: string
          region?: string
          updated_at?: string
          url?: string
        }
        Relationships: []
      }
      stories: {
        Row: {
          article_count: number
          created_at: string
          id: string
          last_article_at: string
          region_count: number
          rep_article_id: string | null
          source_count: number
        }
        Insert: {
          article_count?: number
          created_at?: string
          id?: string
          last_article_at?: string
          region_count?: number
          rep_article_id?: string | null
          source_count?: number
        }
        Update: {
          article_count?: number
          created_at?: string
          id?: string
          last_article_at?: string
          region_count?: number
          rep_article_id?: string | null
          source_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "stories_rep_article_id_fkey"
            columns: ["rep_article_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
        ]
      }
      trending: {
        Row: {
          article_id: string
          rank: number
          selected_at: string
          story_id: string | null
        }
        Insert: {
          article_id: string
          rank: number
          selected_at?: string
          story_id?: string | null
        }
        Update: {
          article_id?: string
          rank?: number
          selected_at?: string
          story_id?: string | null
        }
        Relationships: []
      }
      trending_log: {
        Row: {
          id: number
          logged_at: string
          picks: Json
        }
        Insert: {
          id?: never
          logged_at?: string
          picks: Json
        }
        Update: {
          id?: never
          logged_at?: string
          picks?: Json
        }
        Relationships: []
      }
      verdicts: {
        Row: {
          created_at: string
          decision: string
          guid: string
          id: number
          judge: string
          lang: string | null
          model: string | null
          p: number | null
          source_id: string | null
          threshold: number | null
        }
        Insert: {
          created_at?: string
          decision: string
          guid: string
          id?: never
          judge: string
          lang?: string | null
          model?: string | null
          p?: number | null
          source_id?: string | null
          threshold?: number | null
        }
        Update: {
          created_at?: string
          decision?: string
          guid?: string
          id?: never
          judge?: string
          lang?: string | null
          model?: string | null
          p?: number | null
          source_id?: string | null
          threshold?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "verdicts_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "sources"
            referencedColumns: ["id"]
          },
        ]
      }
      visitor_reports: {
        Row: {
          article_id: string | null
          category: string
          created_at: string
          email: string | null
          fingerprint: string
          id: string
          message: string
          status: string
        }
        Insert: {
          article_id?: string | null
          category: string
          created_at?: string
          email?: string | null
          fingerprint: string
          id?: string
          message: string
          status?: string
        }
        Update: {
          article_id?: string | null
          category?: string
          created_at?: string
          email?: string | null
          fingerprint?: string
          id?: string
          message?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "visitor_reports_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      verdict_daily: {
        Row: {
          accepted: number | null
          borderline: number | null
          day: string | null
          judge: string | null
          mean_p: number | null
          n: number | null
          would_accept_at_040: number | null
          would_accept_at_060: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      actor_daily: {
        Args: { p_days?: number }
        Returns: {
          actor: string
          day: string
          major: number
          stories: number
        }[]
      }
      apply_article_signals: { Args: { p_items: Json }; Returns: number }
      assign_story_by_embedding: {
        Args: {
          p_items: Json
          p_model: string
          p_threshold: number
          p_window_hours: number
        }
        Returns: {
          r_article_id: string
          r_is_new: boolean
          r_story_id: string
        }[]
      }
      check_rate_limit: {
        Args: { p_fn: string; p_ip: string; p_limit: number }
        Returns: boolean
      }
      detach_from_story: { Args: { p_ids: string[] }; Returns: number }
      existing_guids: {
        Args: { check_guids: string[] }
        Returns: {
          guid: string
        }[]
      }
      merge_stories: {
        Args: { p_from: string; p_into: string }
        Returns: number
      }
      nearest_story_candidates: {
        Args: { p_items: Json; p_window_hours: number }
        Returns: {
          r_article_id: string
          r_rep_title: string
          r_sim: number
          r_story_id: string
        }[]
      }
      ops_health: { Args: never; Returns: Json }
      pipeline_status: { Args: never; Returns: string }
      purge_irrelevant_articles: { Args: { p_ids: string[] }; Returns: number }
      record_source_health: {
        Args: { p_disable_after: number; p_results: Json }
        Returns: {
          disabled: boolean
          source_id: string
          source_name: string
        }[]
      }
      reelect_story_reps: { Args: { p_story_ids: string[] }; Returns: number }
      replace_trending: {
        Args: { p_log_picks: Json; p_rows: Json }
        Returns: undefined
      }
      reserve_ai: {
        Args: {
          p_input_tokens: number
          p_model: string
          p_output_tokens: number
          p_service: string
        }
        Returns: Json
      }
      run_private_retention: { Args: never; Returns: undefined }
      run_retention: { Args: never; Returns: string }
      settle_ai: {
        Args: {
          p_id: string
          p_input_tokens?: number
          p_output_tokens?: number
        }
        Returns: undefined
      }
      source_yield: {
        Args: { p_days: number; p_max_pct: number; p_min_items: number }
        Returns: {
          r_accepted: number
          r_name: string
          r_pct: number
          r_rejected: number
        }[]
      }
      story_join_sims: {
        Args: { p_below: number; p_since: string }
        Returns: {
          r_article_id: string
          r_rep_title: string
          r_sim: number
          r_title: string
        }[]
      }
      story_merge_candidates: {
        Args: { p_hours: number; p_limit: number; p_min_sim: number }
        Returns: {
          r_a: string
          r_a_count: number
          r_a_title: string
          r_b: string
          r_b_count: number
          r_b_title: string
          r_sim: number
        }[]
      }
      submit_report: {
        Args: {
          p_article: string
          p_category: string
          p_email: string
          p_fingerprint: string
          p_message: string
        }
        Returns: boolean
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
