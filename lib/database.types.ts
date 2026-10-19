// Supabase schema types for the migrations in supabase/migrations/.
// Same shape as `supabase gen types typescript --local`. Regenerate with:
//   supabase gen types typescript --local > lib/database.types.ts

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
    PostgrestVersion: "13.0.5"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      action_items: {
        Row: {
          action: string | null
          area: string | null
          code: string
          due_date: string | null
          due_rule: string | null
          evidence: string | null
          kind: string | null
          kps_notes: string | null
          pic: string | null
          progress: number
          report_group: string
          schedule: string | null
          sort_order: number | null
          status: string
          target: string | null
          updated_at: string
          updated_by_link: string | null
          updated_on: string | null
        }
        Insert: {
          action?: string | null
          area?: string | null
          code: string
          due_date?: string | null
          due_rule?: string | null
          evidence?: string | null
          kind?: string | null
          kps_notes?: string | null
          pic?: string | null
          progress?: number
          report_group: string
          schedule?: string | null
          sort_order?: number | null
          status?: string
          target?: string | null
          updated_at?: string
          updated_by_link?: string | null
          updated_on?: string | null
        }
        Update: {
          action?: string | null
          area?: string | null
          code?: string
          due_date?: string | null
          due_rule?: string | null
          evidence?: string | null
          kind?: string | null
          kps_notes?: string | null
          pic?: string | null
          progress?: number
          report_group?: string
          schedule?: string | null
          sort_order?: number | null
          status?: string
          target?: string | null
          updated_at?: string
          updated_by_link?: string | null
          updated_on?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "action_items_updated_by_link_fkey"
            columns: ["updated_by_link"]
            isOneToOne: false
            referencedRelation: "share_links"
            referencedColumns: ["id"]
          },
        ]
      }
      admins: {
        Row: {
          created_at: string
          email: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          email?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "admins_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      bmi_checks: {
        Row: {
          check_date: string | null
          height_cm: number
          id: number
          period: number
          staff_code: string
          updated_at: string
          updated_by_link: string | null
          updated_by_user: string | null
          weight_kg: number
        }
        Insert: {
          check_date?: string | null
          height_cm: number
          id?: number
          period: number
          staff_code: string
          updated_at?: string
          updated_by_link?: string | null
          updated_by_user?: string | null
          weight_kg: number
        }
        Update: {
          check_date?: string | null
          height_cm?: number
          id?: number
          period?: number
          staff_code?: string
          updated_at?: string
          updated_by_link?: string | null
          updated_by_user?: string | null
          weight_kg?: number
        }
        Relationships: [
          {
            foreignKeyName: "bmi_checks_staff_code_fkey"
            columns: ["staff_code"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "bmi_checks_updated_by_link_fkey"
            columns: ["updated_by_link"]
            isOneToOne: false
            referencedRelation: "share_links"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bmi_checks_updated_by_user_fkey"
            columns: ["updated_by_user"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      pd_action_plans: {
        Row: {
          action: string
          archived_at: string | null
          area: string
          created_at: string
          done_on: string | null
          due_date: string | null
          evidence: string | null
          id: number
          item_no: string | null
          notes: string | null
          pic: string | null
          progress: number
          report_group: string
          sort_order: number | null
          status: string
          target: string | null
          updated_at: string
          updated_by_link: string | null
        }
        Insert: {
          action: string
          archived_at?: string | null
          area: string
          created_at?: string
          done_on?: string | null
          due_date?: string | null
          evidence?: string | null
          id?: number
          item_no?: string | null
          notes?: string | null
          pic?: string | null
          progress?: number
          report_group: string
          sort_order?: number | null
          status?: string
          target?: string | null
          updated_at?: string
          updated_by_link?: string | null
        }
        Update: {
          action?: string
          archived_at?: string | null
          area?: string
          created_at?: string
          done_on?: string | null
          due_date?: string | null
          evidence?: string | null
          id?: number
          item_no?: string | null
          notes?: string | null
          pic?: string | null
          progress?: number
          report_group?: string
          sort_order?: number | null
          status?: string
          target?: string | null
          updated_at?: string
          updated_by_link?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pd_action_plans_area_fkey"
            columns: ["area"]
            isOneToOne: false
            referencedRelation: "pd_areas"
            referencedColumns: ["name"]
          },
          {
            foreignKeyName: "pd_action_plans_updated_by_link_fkey"
            columns: ["updated_by_link"]
            isOneToOne: false
            referencedRelation: "pd_share_links"
            referencedColumns: ["id"]
          },
        ]
      }
      pd_areas: {
        Row: {
          name: string
          sort: number
        }
        Insert: {
          name: string
          sort?: number
        }
        Update: {
          name?: string
          sort?: number
        }
        Relationships: []
      }
      pd_bmi_checks: {
        Row: {
          check_date: string | null
          height_cm: number
          id: number
          period: number
          staff_code: string
          updated_at: string
          updated_by_link: string | null
          updated_by_user: string | null
          weight_kg: number
        }
        Insert: {
          check_date?: string | null
          height_cm: number
          id?: number
          period: number
          staff_code: string
          updated_at?: string
          updated_by_link?: string | null
          updated_by_user?: string | null
          weight_kg: number
        }
        Update: {
          check_date?: string | null
          height_cm?: number
          id?: number
          period?: number
          staff_code?: string
          updated_at?: string
          updated_by_link?: string | null
          updated_by_user?: string | null
          weight_kg?: number
        }
        Relationships: [
          {
            foreignKeyName: "pd_bmi_checks_staff_code_fkey"
            columns: ["staff_code"]
            isOneToOne: false
            referencedRelation: "pd_staff"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "pd_bmi_checks_updated_by_link_fkey"
            columns: ["updated_by_link"]
            isOneToOne: false
            referencedRelation: "pd_share_links"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pd_bmi_checks_updated_by_user_fkey"
            columns: ["updated_by_user"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      pd_monthly_reports: {
        Row: {
          active_staff: number | null
          complaints: number | null
          compliant_staff: number | null
          due_on: string | null
          notes: string | null
          period: string
          received_on: string | null
          report_group: string
          responded: string | null
          satisfaction: number | null
          updated_at: string
          updated_by_link: string | null
        }
        Insert: {
          active_staff?: number | null
          complaints?: number | null
          compliant_staff?: number | null
          due_on?: string | null
          notes?: string | null
          period: string
          received_on?: string | null
          report_group: string
          responded?: string | null
          satisfaction?: number | null
          updated_at?: string
          updated_by_link?: string | null
        }
        Update: {
          active_staff?: number | null
          complaints?: number | null
          compliant_staff?: number | null
          due_on?: string | null
          notes?: string | null
          period?: string
          received_on?: string | null
          report_group?: string
          responded?: string | null
          satisfaction?: number | null
          updated_at?: string
          updated_by_link?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pd_monthly_reports_updated_by_link_fkey"
            columns: ["updated_by_link"]
            isOneToOne: false
            referencedRelation: "pd_share_links"
            referencedColumns: ["id"]
          },
        ]
      }
      pd_replacements: {
        Row: {
          basis: string | null
          category: string | null
          director_approval: string | null
          id: number
          name: string
          notes: string | null
          post_test: number | null
          practice: number | null
          replacement_name: string | null
          report_group: string | null
          selected_on: string | null
          sort_order: number | null
          staff_code: string | null
          started_on: string | null
          training_due: string | null
          updated_at: string
          updated_by_link: string | null
          withdraw_due: string | null
          withdraw_status: string | null
          withdrawn_on: string | null
        }
        Insert: {
          basis?: string | null
          category?: string | null
          director_approval?: string | null
          id?: number
          name: string
          notes?: string | null
          post_test?: number | null
          practice?: number | null
          replacement_name?: string | null
          report_group?: string | null
          selected_on?: string | null
          sort_order?: number | null
          staff_code?: string | null
          started_on?: string | null
          training_due?: string | null
          updated_at?: string
          updated_by_link?: string | null
          withdraw_due?: string | null
          withdraw_status?: string | null
          withdrawn_on?: string | null
        }
        Update: {
          basis?: string | null
          category?: string | null
          director_approval?: string | null
          id?: number
          name?: string
          notes?: string | null
          post_test?: number | null
          practice?: number | null
          replacement_name?: string | null
          report_group?: string | null
          selected_on?: string | null
          sort_order?: number | null
          staff_code?: string | null
          started_on?: string | null
          training_due?: string | null
          updated_at?: string
          updated_by_link?: string | null
          withdraw_due?: string | null
          withdraw_status?: string | null
          withdrawn_on?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pd_replacements_staff_code_fkey"
            columns: ["staff_code"]
            isOneToOne: false
            referencedRelation: "pd_staff"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "pd_replacements_updated_by_link_fkey"
            columns: ["updated_by_link"]
            isOneToOne: false
            referencedRelation: "pd_share_links"
            referencedColumns: ["id"]
          },
        ]
      }
      pd_settings: {
        Row: {
          bmi_first_check: string
          bmi_interval_days: number
          bmi_normal_max: number
          bmi_overweight_max: number
          bmi_periods: number
          bmi_underweight_below: number
          id: number
          min_height_female: number | null
          min_height_male: number | null
          updated_at: string
        }
        Insert: {
          bmi_first_check: string
          bmi_interval_days: number
          bmi_normal_max: number
          bmi_overweight_max: number
          bmi_periods: number
          bmi_underweight_below: number
          id?: number
          min_height_female?: number | null
          min_height_male?: number | null
          updated_at?: string
        }
        Update: {
          bmi_first_check?: string
          bmi_interval_days?: number
          bmi_normal_max?: number
          bmi_overweight_max?: number
          bmi_periods?: number
          bmi_underweight_below?: number
          id?: number
          min_height_female?: number | null
          min_height_male?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      pd_share_links: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          label: string | null
          last_used_at: string | null
          revoked_at: string | null
          scope: string
          token: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          label?: string | null
          last_used_at?: string | null
          revoked_at?: string | null
          scope: string
          token?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          label?: string | null
          last_used_at?: string | null
          revoked_at?: string | null
          scope?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "pd_share_links_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      pd_staff: {
        Row: {
          bmi_note: string | null
          coaching_items: string | null
          code: string
          created_at: string
          extra_action: string | null
          extra_due: string | null
          extra_status: string | null
          final_decision: string | null
          gender: string | null
          initial_coaching: string | null
          initial_practice: number | null
          main_action: string | null
          main_due: string | null
          main_status: string | null
          name: string
          nipp: string | null
          pic: string | null
          progress_notes: string | null
          proposal: string | null
          reassess_practice: number | null
          reassessed_on: string | null
          recoaching: string | null
          report_group: string | null
          sort_order: number | null
          station: string
          updated_at: string
          updated_by_link: string | null
        }
        Insert: {
          bmi_note?: string | null
          coaching_items?: string | null
          code: string
          created_at?: string
          extra_action?: string | null
          extra_due?: string | null
          extra_status?: string | null
          final_decision?: string | null
          gender?: string | null
          initial_coaching?: string | null
          initial_practice?: number | null
          main_action?: string | null
          main_due?: string | null
          main_status?: string | null
          name: string
          nipp?: string | null
          pic?: string | null
          progress_notes?: string | null
          proposal?: string | null
          reassess_practice?: number | null
          reassessed_on?: string | null
          recoaching?: string | null
          report_group?: string | null
          sort_order?: number | null
          station: string
          updated_at?: string
          updated_by_link?: string | null
        }
        Update: {
          bmi_note?: string | null
          coaching_items?: string | null
          code?: string
          created_at?: string
          extra_action?: string | null
          extra_due?: string | null
          extra_status?: string | null
          final_decision?: string | null
          gender?: string | null
          initial_coaching?: string | null
          initial_practice?: number | null
          main_action?: string | null
          main_due?: string | null
          main_status?: string | null
          name?: string
          nipp?: string | null
          pic?: string | null
          progress_notes?: string | null
          proposal?: string | null
          reassess_practice?: number | null
          reassessed_on?: string | null
          recoaching?: string | null
          report_group?: string | null
          sort_order?: number | null
          station?: string
          updated_at?: string
          updated_by_link?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pd_staff_station_fkey"
            columns: ["station"]
            isOneToOne: false
            referencedRelation: "stations"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "pd_staff_updated_by_link_fkey"
            columns: ["updated_by_link"]
            isOneToOne: false
            referencedRelation: "pd_share_links"
            referencedColumns: ["id"]
          },
        ]
      }
      pd_sync_conflicts: {
        Row: {
          baseline: Json | null
          column_name: string | null
          created_at: string
          db_value: Json | null
          id: number
          resolution: string | null
          resolved_at: string | null
          resolved_by: string | null
          row_key: string | null
          sheet_value: Json | null
          table_name: string
        }
        Insert: {
          baseline?: Json | null
          column_name?: string | null
          created_at?: string
          db_value?: Json | null
          id?: number
          resolution?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          row_key?: string | null
          sheet_value?: Json | null
          table_name: string
        }
        Update: {
          baseline?: Json | null
          column_name?: string | null
          created_at?: string
          db_value?: Json | null
          id?: number
          resolution?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          row_key?: string | null
          sheet_value?: Json | null
          table_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "pd_sync_conflicts_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      pd_sync_state: {
        Row: {
          baseline: Json
          failures: number
          id: boolean
          initialized: boolean
          last_error: string | null
          last_ping_at: string | null
          last_success_at: string | null
          lease_token: string | null
          lease_until: string | null
        }
        Insert: {
          baseline?: Json
          failures?: number
          id?: boolean
          initialized?: boolean
          last_error?: string | null
          last_ping_at?: string | null
          last_success_at?: string | null
          lease_token?: string | null
          lease_until?: string | null
        }
        Update: {
          baseline?: Json
          failures?: number
          id?: boolean
          initialized?: boolean
          last_error?: string | null
          last_ping_at?: string | null
          last_success_at?: string | null
          lease_token?: string | null
          lease_until?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          branch_code: string
          created_at: string
          decided_at: string | null
          decided_by: string | null
          email: string
          full_name: string
          id: string
          status: Database["public"]["Enums"]["account_status"]
        }
        Insert: {
          branch_code: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          email: string
          full_name?: string
          id: string
          status?: Database["public"]["Enums"]["account_status"]
        }
        Update: {
          branch_code?: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          email?: string
          full_name?: string
          id?: string
          status?: Database["public"]["Enums"]["account_status"]
        }
        Relationships: [
          {
            foreignKeyName: "profiles_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      replacements: {
        Row: {
          effective_on: string | null
          id: number
          notes: string | null
          post_test: number | null
          practice_avg: number | null
          reason: string | null
          replaced_name: string
          replacement_name: string | null
          report_group: string | null
          reported: string | null
          sort_order: number | null
          staff_code: string | null
          station: string | null
          training_on: string | null
          updated_at: string
          updated_by_link: string | null
          withdrawn_on: string | null
        }
        Insert: {
          effective_on?: string | null
          id?: number
          notes?: string | null
          post_test?: number | null
          practice_avg?: number | null
          reason?: string | null
          replaced_name: string
          replacement_name?: string | null
          report_group?: string | null
          reported?: string | null
          sort_order?: number | null
          staff_code?: string | null
          station?: string | null
          training_on?: string | null
          updated_at?: string
          updated_by_link?: string | null
          withdrawn_on?: string | null
        }
        Update: {
          effective_on?: string | null
          id?: number
          notes?: string | null
          post_test?: number | null
          practice_avg?: number | null
          reason?: string | null
          replaced_name?: string
          replacement_name?: string | null
          report_group?: string | null
          reported?: string | null
          sort_order?: number | null
          staff_code?: string | null
          station?: string | null
          training_on?: string | null
          updated_at?: string
          updated_by_link?: string | null
          withdrawn_on?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "replacements_staff_code_fkey"
            columns: ["staff_code"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "replacements_station_fkey"
            columns: ["station"]
            isOneToOne: false
            referencedRelation: "stations"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "replacements_updated_by_link_fkey"
            columns: ["updated_by_link"]
            isOneToOne: false
            referencedRelation: "share_links"
            referencedColumns: ["id"]
          },
        ]
      }
      settings: {
        Row: {
          bmi_first_check: string
          bmi_interval_days: number
          bmi_normal_max: number
          bmi_overweight_max: number
          bmi_periods: number
          bmi_underweight_below: number
          id: number
          improve_avg_min: number
          min_height_female: number | null
          min_height_male: number | null
          pass_avg_min: number
          posttest_min: number
          replacement_deadline: string
          updated_at: string
          week1_start: string
          weeks: number
        }
        Insert: {
          bmi_first_check: string
          bmi_interval_days: number
          bmi_normal_max: number
          bmi_overweight_max: number
          bmi_periods: number
          bmi_underweight_below: number
          id?: number
          improve_avg_min: number
          min_height_female?: number | null
          min_height_male?: number | null
          pass_avg_min: number
          posttest_min: number
          replacement_deadline: string
          updated_at?: string
          week1_start: string
          weeks: number
        }
        Update: {
          bmi_first_check?: string
          bmi_interval_days?: number
          bmi_normal_max?: number
          bmi_overweight_max?: number
          bmi_periods?: number
          bmi_underweight_below?: number
          id?: number
          improve_avg_min?: number
          min_height_female?: number | null
          min_height_male?: number | null
          pass_avg_min?: number
          posttest_min?: number
          replacement_deadline?: string
          updated_at?: string
          week1_start?: string
          weeks?: number
        }
        Relationships: []
      }
      share_links: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          label: string | null
          last_used_at: string | null
          revoked_at: string | null
          scope: string
          token: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          label?: string | null
          last_used_at?: string | null
          revoked_at?: string | null
          scope: string
          token?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          label?: string | null
          last_used_at?: string | null
          revoked_at?: string | null
          scope?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "share_links_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      staff: {
        Row: {
          assignment_status: string
          bmi_note: string | null
          code: string
          created_at: string
          gender: string | null
          name: string
          nipp: string | null
          notes: string | null
          post_test: number | null
          pre_test: number | null
          report_conclusion: string | null
          score_a: number | null
          score_b: number | null
          score_c: number | null
          score_d: number | null
          score_e: number | null
          score_f: number | null
          sort_order: number | null
          station: string
          updated_at: string
          updated_by_link: string | null
        }
        Insert: {
          assignment_status?: string
          bmi_note?: string | null
          code: string
          created_at?: string
          gender?: string | null
          name: string
          nipp?: string | null
          notes?: string | null
          post_test?: number | null
          pre_test?: number | null
          report_conclusion?: string | null
          score_a?: number | null
          score_b?: number | null
          score_c?: number | null
          score_d?: number | null
          score_e?: number | null
          score_f?: number | null
          sort_order?: number | null
          station: string
          updated_at?: string
          updated_by_link?: string | null
        }
        Update: {
          assignment_status?: string
          bmi_note?: string | null
          code?: string
          created_at?: string
          gender?: string | null
          name?: string
          nipp?: string | null
          notes?: string | null
          post_test?: number | null
          pre_test?: number | null
          report_conclusion?: string | null
          score_a?: number | null
          score_b?: number | null
          score_c?: number | null
          score_d?: number | null
          score_e?: number | null
          score_f?: number | null
          sort_order?: number | null
          station?: string
          updated_at?: string
          updated_by_link?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "staff_station_fkey"
            columns: ["station"]
            isOneToOne: false
            referencedRelation: "stations"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "staff_updated_by_link_fkey"
            columns: ["updated_by_link"]
            isOneToOne: false
            referencedRelation: "share_links"
            referencedColumns: ["id"]
          },
        ]
      }
      stations: {
        Row: {
          code: string
          report_group: string
          sort: number
        }
        Insert: {
          code: string
          report_group: string
          sort: number
        }
        Update: {
          code?: string
          report_group?: string
          sort?: number
        }
        Relationships: []
      }
      sync_conflicts: {
        Row: {
          baseline: Json | null
          column_name: string | null
          created_at: string
          db_value: Json | null
          id: number
          resolution: string | null
          resolved_at: string | null
          resolved_by: string | null
          row_key: string | null
          sheet_value: Json | null
          table_name: string
        }
        Insert: {
          baseline?: Json | null
          column_name?: string | null
          created_at?: string
          db_value?: Json | null
          id?: number
          resolution?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          row_key?: string | null
          sheet_value?: Json | null
          table_name: string
        }
        Update: {
          baseline?: Json | null
          column_name?: string | null
          created_at?: string
          db_value?: Json | null
          id?: number
          resolution?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          row_key?: string | null
          sheet_value?: Json | null
          table_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "sync_conflicts_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      sync_state: {
        Row: {
          baseline: Json
          failures: number
          id: boolean
          initialized: boolean
          last_error: string | null
          last_ping_at: string | null
          last_success_at: string | null
          lease_token: string | null
          lease_until: string | null
        }
        Insert: {
          baseline?: Json
          failures?: number
          id?: boolean
          initialized?: boolean
          last_error?: string | null
          last_ping_at?: string | null
          last_success_at?: string | null
          lease_token?: string | null
          lease_until?: string | null
        }
        Update: {
          baseline?: Json
          failures?: number
          id?: boolean
          initialized?: boolean
          last_error?: string | null
          last_ping_at?: string | null
          last_success_at?: string | null
          lease_token?: string | null
          lease_until?: string | null
        }
        Relationships: []
      }
      weekly_reports: {
        Row: {
          findings: string | null
          scope: string
          updated_at: string
          updated_by_link: string | null
          week: number
        }
        Insert: {
          findings?: string | null
          scope: string
          updated_at?: string
          updated_by_link?: string | null
          week: number
        }
        Update: {
          findings?: string | null
          scope?: string
          updated_at?: string
          updated_by_link?: string | null
          week?: number
        }
        Relationships: [
          {
            foreignKeyName: "weekly_reports_updated_by_link_fkey"
            columns: ["updated_by_link"]
            isOneToOne: false
            referencedRelation: "share_links"
            referencedColumns: ["id"]
          },
        ]
      }
      weekly_scores: {
        Row: {
          coaching_notes: string | null
          id: number
          observer: string | null
          score_a: number | null
          score_b: number | null
          score_c: number | null
          score_d: number | null
          score_e: number | null
          score_f: number | null
          staff_code: string
          updated_at: string
          updated_by: string | null
          updated_by_link: string | null
          week: number
        }
        Insert: {
          coaching_notes?: string | null
          id?: number
          observer?: string | null
          score_a?: number | null
          score_b?: number | null
          score_c?: number | null
          score_d?: number | null
          score_e?: number | null
          score_f?: number | null
          staff_code: string
          updated_at?: string
          updated_by?: string | null
          updated_by_link?: string | null
          week: number
        }
        Update: {
          coaching_notes?: string | null
          id?: number
          observer?: string | null
          score_a?: number | null
          score_b?: number | null
          score_c?: number | null
          score_d?: number | null
          score_e?: number | null
          score_f?: number | null
          staff_code?: string
          updated_at?: string
          updated_by?: string | null
          updated_by_link?: string | null
          week?: number
        }
        Relationships: [
          {
            foreignKeyName: "weekly_scores_staff_code_fkey"
            columns: ["staff_code"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "weekly_scores_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weekly_scores_updated_by_link_fkey"
            columns: ["updated_by_link"]
            isOneToOne: false
            referencedRelation: "share_links"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_delete_account: { Args: { p_user_id: string }; Returns: undefined }
      is_admin: { Args: never; Returns: boolean }
      pd_share_archive_action_plan: {
        Args: {
          p_id: number
          p_token: string
        }
        Returns: Json
      }
      pd_share_delete_monthly_report: {
        Args: {
          p_period: string
          p_report_group: string
          p_token: string
        }
        Returns: Json
      }
      pd_share_delete_replacement: {
        Args: {
          p_id: number
          p_token: string
        }
        Returns: Json
      }
      pd_share_delete_staff: {
        Args: {
          p_code: string
          p_token: string
        }
        Returns: Json
      }
      pd_share_open: { Args: { p_token: string }; Returns: Json }
      pd_share_restore_action_plan: {
        Args: {
          p_id: number
          p_token: string
        }
        Returns: Json
      }
      pd_share_save_action_plan: {
        Args: {
          p_id: number
          p_patch: Json
          p_token: string
        }
        Returns: Json
      }
      pd_share_save_check: {
        Args: {
          p_check_date: string
          p_height_cm: number
          p_period: number
          p_staff_code: string
          p_token: string
          p_weight_kg: number
        }
        Returns: Json
      }
      pd_share_save_monthly_report: {
        Args: {
          p_patch: Json
          p_period: string
          p_report_group: string
          p_token: string
        }
        Returns: Json
      }
      pd_share_save_replacement: {
        Args: {
          p_id: number
          p_patch: Json
          p_token: string
        }
        Returns: Json
      }
      pd_share_save_staff: {
        Args: {
          p_code: string
          p_patch: Json
          p_token: string
        }
        Returns: Json
      }
      pd_sync_claim_lease: { Args: { p_ttl_seconds: number }; Returns: string }
      pd_sync_release_lease: {
        Args: {
          p_baseline?: Json
          p_error?: string
          p_token: string
        }
        Returns: boolean
      }
      registration_branches: { Args: never; Returns: string[] }
      share_delete_replacement: {
        Args: {
          p_id: number
          p_token: string
        }
        Returns: Json
      }
      share_kps_save_staff_baseline: {
        Args: {
          p_code: string
          p_post_test: number
          p_pre_test: number
          p_report_conclusion: string
          p_score_a: number
          p_score_b: number
          p_score_c: number
          p_score_d: number
          p_score_e: number
          p_score_f: number
          p_token: string
        }
        Returns: Json
      }
      share_kps_update_action_item: {
        Args: {
          p_action: string
          p_area: string
          p_code: string
          p_due_date: string
          p_due_rule: string
          p_kind: string
          p_kps_notes: string
          p_pic: string
          p_schedule: string
          p_target: string
          p_token: string
        }
        Returns: Json
      }
      share_open: { Args: { p_token: string }; Returns: Json }
      share_save_check: {
        Args: {
          p_check_date: string
          p_height_cm: number
          p_period: number
          p_staff_code: string
          p_token: string
          p_weight_kg: number
        }
        Returns: Json
      }
      share_save_profile: {
        Args: {
          p_bmi_note: string
          p_gender: string
          p_staff_code: string
          p_token: string
        }
        Returns: Json
      }
      share_save_replacement: {
        Args: {
          p_effective_on: string
          p_id: number
          p_notes: string
          p_post_test: number
          p_practice_avg: number
          p_reason: string
          p_replaced_name: string
          p_replacement_name: string
          p_report_group: string
          p_reported: string
          p_staff_code: string
          p_station: string
          p_token: string
          p_training_on: string
          p_withdrawn_on: string
        }
        Returns: Json
      }
      share_save_staff: {
        Args: {
          p_assignment_status: string
          p_code: string
          p_gender: string
          p_name: string
          p_nipp: string
          p_notes: string
          p_station: string
          p_token: string
        }
        Returns: Json
      }
      share_save_weekly_report: {
        Args: {
          p_findings: string
          p_token: string
          p_week: number
        }
        Returns: Json
      }
      share_save_weekly_score: {
        Args: {
          p_coaching_notes: string
          p_observer: string
          p_score_a: number
          p_score_b: number
          p_score_c: number
          p_score_d: number
          p_score_e: number
          p_score_f: number
          p_staff_code: string
          p_token: string
          p_week: number
        }
        Returns: Json
      }
      share_update_action_item: {
        Args: {
          p_code: string
          p_evidence: string
          p_progress: number
          p_status: string
          p_token: string
          p_updated_on: string
        }
        Returns: Json
      }
      sync_claim_lease: { Args: { p_ttl_seconds: number }; Returns: string }
      sync_release_lease: {
        Args: {
          p_baseline?: Json
          p_error?: string
          p_token: string
        }
        Returns: boolean
      }
    }
    Enums: {
      account_status: "pending" | "active" | "inactive"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
