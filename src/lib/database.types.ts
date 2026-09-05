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
      actual_events: {
        Row: {
          created_at: string
          event_type: Database["public"]["Enums"]["actual_event_type"]
          id: string
          notes: string | null
          reason_code: string | null
          task_id: string
          timestamp: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          event_type: Database["public"]["Enums"]["actual_event_type"]
          id?: string
          notes?: string | null
          reason_code?: string | null
          task_id: string
          timestamp?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          event_type?: Database["public"]["Enums"]["actual_event_type"]
          id?: string
          notes?: string | null
          reason_code?: string | null
          task_id?: string
          timestamp?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "actual_events_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "planner_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "actual_events_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_email: string | null
          actor_id: string | null
          created_at: string
          details: Json | null
          id: number
          target_id: string | null
          target_type: string
          workspace_id: string | null
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_id?: string | null
          created_at?: string
          details?: Json | null
          id?: never
          target_id?: string | null
          target_type: string
          workspace_id?: string | null
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_id?: string | null
          created_at?: string
          details?: Json | null
          id?: never
          target_id?: string | null
          target_type?: string
          workspace_id?: string | null
        }
        Relationships: []
      }
      custom_columns: {
        Row: {
          applies_to: Database["public"]["Enums"]["custom_column_scope"]
          created_at: string
          default_value: Json | null
          description: string | null
          formula: string | null
          id: string
          key: string
          locked: boolean
          name: string
          options: string[]
          precision: number | null
          product_id: string | null
          required: boolean
          scenario_id: string | null
          type: Database["public"]["Enums"]["custom_column_type"]
          unit: string | null
          updated_at: string
          visible: boolean
        }
        Insert: {
          applies_to?: Database["public"]["Enums"]["custom_column_scope"]
          created_at?: string
          default_value?: Json | null
          description?: string | null
          formula?: string | null
          id?: string
          key: string
          locked?: boolean
          name: string
          options?: string[]
          precision?: number | null
          product_id?: string | null
          required?: boolean
          scenario_id?: string | null
          type?: Database["public"]["Enums"]["custom_column_type"]
          unit?: string | null
          updated_at?: string
          visible?: boolean
        }
        Update: {
          applies_to?: Database["public"]["Enums"]["custom_column_scope"]
          created_at?: string
          default_value?: Json | null
          description?: string | null
          formula?: string | null
          id?: string
          key?: string
          locked?: boolean
          name?: string
          options?: string[]
          precision?: number | null
          product_id?: string | null
          required?: boolean
          scenario_id?: string | null
          type?: Database["public"]["Enums"]["custom_column_type"]
          unit?: string | null
          updated_at?: string
          visible?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "custom_columns_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custom_columns_scenario_id_fkey"
            columns: ["scenario_id"]
            isOneToOne: false
            referencedRelation: "scenarios"
            referencedColumns: ["id"]
          },
        ]
      }
      department_members: {
        Row: {
          department_id: string
          dept_role: Database["public"]["Enums"]["department_sop_role"]
          granted_by: string | null
          position_title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          department_id: string
          dept_role?: Database["public"]["Enums"]["department_sop_role"]
          granted_by?: string | null
          position_title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          department_id?: string
          dept_role?: Database["public"]["Enums"]["department_sop_role"]
          granted_by?: string | null
          position_title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "department_members_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      departments: {
        Row: {
          code: string
          created_at: string
          created_by: string | null
          id: string
          is_quality_gate: boolean
          name: string
          sop_target: number
          updated_at: string
          updated_by: string | null
          workspace_id: string
        }
        Insert: {
          code: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_quality_gate?: boolean
          name: string
          sop_target?: number
          updated_at?: string
          updated_by?: string | null
          workspace_id: string
        }
        Update: {
          code?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_quality_gate?: boolean
          name?: string
          sop_target?: number
          updated_at?: string
          updated_by?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "departments_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      doc_number_counter: {
        Row: {
          department_id: string
          doc_type: string
          next_seq: number
          workspace_id: string
        }
        Insert: {
          department_id: string
          doc_type: string
          next_seq?: number
          workspace_id: string
        }
        Update: {
          department_id?: string
          doc_type?: string
          next_seq?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "doc_number_counter_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      document_type_codes: {
        Row: {
          active: boolean
          code: string
          created_at: string
          id: string
          name: string
          product_id: string | null
          project_id: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          id?: string
          name: string
          product_id?: string | null
          project_id?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          id?: string
          name?: string
          product_id?: string | null
          project_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_type_codes_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_type_codes_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      email_deliveries: {
        Row: {
          created_at: string
          event_type: string
          id: number
          occurred_at: string
          payload: Json
          recipient_email: string | null
          resend_message_id: string | null
          webhook_event_id: string
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: never
          occurred_at: string
          payload?: Json
          recipient_email?: string | null
          resend_message_id?: string | null
          webhook_event_id: string
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: never
          occurred_at?: string
          payload?: Json
          recipient_email?: string | null
          resend_message_id?: string | null
          webhook_event_id?: string
        }
        Relationships: []
      }
      email_suppressions: {
        Row: {
          created_at: string
          email: string
          reason: string
          source_message_id: string | null
        }
        Insert: {
          created_at?: string
          email: string
          reason: string
          source_message_id?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          reason?: string
          source_message_id?: string | null
        }
        Relationships: []
      }
      manufacturing_components: {
        Row: {
          active: boolean
          code: string
          created_at: string
          description: string | null
          id: string
          name: string
          scenario_id: string
          sequence: number
          updated_at: string
          zone_id: string | null
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          description?: string | null
          id?: string
          name: string
          scenario_id: string
          sequence?: number
          updated_at?: string
          zone_id?: string | null
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          scenario_id?: string
          sequence?: number
          updated_at?: string
          zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "manufacturing_components_scenario_id_fkey"
            columns: ["scenario_id"]
            isOneToOne: false
            referencedRelation: "scenarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manufacturing_components_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "zones"
            referencedColumns: ["id"]
          },
        ]
      }
      manufacturing_steps: {
        Row: {
          created_at: string
          dependency_ids: string[]
          duration_minutes: number
          id: string
          instruction: string
          name: string
          quality_check: string | null
          sequence: number
          task_id: string
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          dependency_ids?: string[]
          duration_minutes?: number
          id?: string
          instruction?: string
          name?: string
          quality_check?: string | null
          sequence: number
          task_id: string
          updated_at?: string
          version?: number
        }
        Update: {
          created_at?: string
          dependency_ids?: string[]
          duration_minutes?: number
          id?: string
          instruction?: string
          name?: string
          quality_check?: string | null
          sequence?: number
          task_id?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "manufacturing_steps_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "planner_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manufacturing_steps_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_digests: {
        Row: {
          attempts: number
          content: Json | null
          created_at: string
          id: number
          kind: string
          last_attempt_at: string | null
          last_error: string | null
          period_key: string
          recipient_id: string
          resend_message_id: string | null
          sent_at: string | null
          skipped_reason: string | null
          workspace_id: string
        }
        Insert: {
          attempts?: number
          content?: Json | null
          created_at?: string
          id?: never
          kind: string
          last_attempt_at?: string | null
          last_error?: string | null
          period_key: string
          recipient_id: string
          resend_message_id?: string | null
          sent_at?: string | null
          skipped_reason?: string | null
          workspace_id: string
        }
        Update: {
          attempts?: number
          content?: Json | null
          created_at?: string
          id?: never
          kind?: string
          last_attempt_at?: string | null
          last_error?: string | null
          period_key?: string
          recipient_id?: string
          resend_message_id?: string | null
          sent_at?: string | null
          skipped_reason?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_digests_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_drain_runs: {
        Row: {
          caller: string
          finished_at: string
          healthy: boolean
          id: number
          problems: string[]
          report: Json
          started_at: string
        }
        Insert: {
          caller: string
          finished_at?: string
          healthy: boolean
          id?: never
          problems?: string[]
          report?: Json
          started_at: string
        }
        Update: {
          caller?: string
          finished_at?: string
          healthy?: boolean
          id?: never
          problems?: string[]
          report?: Json
          started_at?: string
        }
        Relationships: []
      }
      notification_preferences: {
        Row: {
          channel: string
          kind: string
          mode: string
          updated_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          channel: string
          kind: string
          mode: string
          updated_at?: string
          user_id: string
          workspace_id?: string
        }
        Update: {
          channel?: string
          kind?: string
          mode?: string
          updated_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          body: string
          created_at: string
          delivered_channels: Json
          entity_id: string | null
          entity_type: string | null
          id: number
          kind: string
          link: string | null
          read_at: string | null
          recipient_id: string
          source: string
          source_ledger_id: number | null
          title: string
          workspace_id: string | null
        }
        Insert: {
          body?: string
          created_at?: string
          delivered_channels?: Json
          entity_id?: string | null
          entity_type?: string | null
          id?: never
          kind: string
          link?: string | null
          read_at?: string | null
          recipient_id: string
          source: string
          source_ledger_id?: number | null
          title: string
          workspace_id?: string | null
        }
        Update: {
          body?: string
          created_at?: string
          delivered_channels?: Json
          entity_id?: string | null
          entity_type?: string | null
          id?: never
          kind?: string
          link?: string | null
          read_at?: string | null
          recipient_id?: string
          source?: string
          source_ledger_id?: number | null
          title?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notifications_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      org_tool_access: {
        Row: {
          created_at: string
          granted_by: string | null
          level: Database["public"]["Enums"]["access_level"]
          updated_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          granted_by?: string | null
          level?: Database["public"]["Enums"]["access_level"]
          updated_at?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          granted_by?: string | null
          level?: Database["public"]["Enums"]["access_level"]
          updated_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_tool_access_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      part_references: {
        Row: {
          created_at: string
          description: string | null
          disposition: string | null
          id: string
          part_number: string
          quantity: number | null
          task_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          disposition?: string | null
          id?: string
          part_number: string
          quantity?: number | null
          task_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          disposition?: string | null
          id?: string
          part_number?: string
          quantity?: number | null
          task_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "part_references_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "planner_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "part_references_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      planning_item_master: {
        Row: {
          description: string
          item_no: string
          updated_at: string
          vendor_no: string | null
          workspace_id: string
        }
        Insert: {
          description?: string
          item_no: string
          updated_at?: string
          vendor_no?: string | null
          workspace_id: string
        }
        Update: {
          description?: string
          item_no?: string
          updated_at?: string
          vendor_no?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "planning_item_master_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_admins: {
        Row: {
          created_at: string
          email: string
        }
        Insert: {
          created_at?: string
          email: string
        }
        Update: {
          created_at?: string
          email?: string
        }
        Relationships: []
      }
      products: {
        Row: {
          active_takt_minutes: number
          available_work_days_per_month: number
          break_minutes: number
          calculated_takt_minutes: number
          created_at: string
          custom_fields: Json
          demand_period: Database["public"]["Enums"]["demand_period"]
          demand_quantity: number
          description: string | null
          family: string | null
          gross_available_minutes: number
          id: string
          lunch_minutes: number
          manual_takt_minutes: number | null
          meeting_minutes: number
          monthly_available_minutes: number
          name: string
          net_available_minutes: number
          owner_id: string | null
          owner_name: string
          planned_downtime_minutes: number
          product_code: string | null
          project_id: string | null
          revision: string
          sku: string | null
          status: Database["public"]["Enums"]["product_status"]
          target_man_hours: number
          updated_at: string
          weekly_available_minutes: number
          work_days_per_week: number
          work_weeks_per_month: number
        }
        Insert: {
          active_takt_minutes?: number
          available_work_days_per_month?: number
          break_minutes?: number
          calculated_takt_minutes?: number
          created_at?: string
          custom_fields?: Json
          demand_period?: Database["public"]["Enums"]["demand_period"]
          demand_quantity?: number
          description?: string | null
          family?: string | null
          gross_available_minutes?: number
          id?: string
          lunch_minutes?: number
          manual_takt_minutes?: number | null
          meeting_minutes?: number
          monthly_available_minutes?: number
          name: string
          net_available_minutes?: number
          owner_id?: string | null
          owner_name?: string
          planned_downtime_minutes?: number
          product_code?: string | null
          project_id?: string | null
          revision?: string
          sku?: string | null
          status?: Database["public"]["Enums"]["product_status"]
          target_man_hours?: number
          updated_at?: string
          weekly_available_minutes?: number
          work_days_per_week?: number
          work_weeks_per_month?: number
        }
        Update: {
          active_takt_minutes?: number
          available_work_days_per_month?: number
          break_minutes?: number
          calculated_takt_minutes?: number
          created_at?: string
          custom_fields?: Json
          demand_period?: Database["public"]["Enums"]["demand_period"]
          demand_quantity?: number
          description?: string | null
          family?: string | null
          gross_available_minutes?: number
          id?: string
          lunch_minutes?: number
          manual_takt_minutes?: number | null
          meeting_minutes?: number
          monthly_available_minutes?: number
          name?: string
          net_available_minutes?: number
          owner_id?: string | null
          owner_name?: string
          planned_downtime_minutes?: number
          product_code?: string | null
          project_id?: string | null
          revision?: string
          sku?: string | null
          status?: Database["public"]["Enums"]["product_status"]
          target_man_hours?: number
          updated_at?: string
          weekly_available_minutes?: number
          work_days_per_week?: number
          work_weeks_per_month?: number
        }
        Relationships: [
          {
            foreignKeyName: "products_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      project_access: {
        Row: {
          created_at: string
          granted_by: string | null
          level: Database["public"]["Enums"]["access_level"]
          project_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          granted_by?: string | null
          level?: Database["public"]["Enums"]["access_level"]
          project_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          granted_by?: string | null
          level?: Database["public"]["Enums"]["access_level"]
          project_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_access_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          name: string
          status: Database["public"]["Enums"]["project_status"]
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name: string
          status?: Database["public"]["Enums"]["project_status"]
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name?: string
          status?: Database["public"]["Enums"]["project_status"]
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          p256dh: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          p256dh: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          p256dh?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      sales_order_lines: {
        Row: {
          acc_sku: string
          assembly_order_no: string
          created_at: string
          customer_raw: string
          fg_sku: string
          flags: Json
          id: string
          import_id: string
          model_raw: string
          sales_order_id: string | null
          source_row_no: number
          status: string
          trailer_letter: string
          updated_at: string
          work_order_id: string | null
          workspace_id: string
        }
        Insert: {
          acc_sku?: string
          assembly_order_no?: string
          created_at?: string
          customer_raw?: string
          fg_sku?: string
          flags?: Json
          id?: string
          import_id: string
          model_raw?: string
          sales_order_id?: string | null
          source_row_no: number
          status?: string
          trailer_letter?: string
          updated_at?: string
          work_order_id?: string | null
          workspace_id: string
        }
        Update: {
          acc_sku?: string
          assembly_order_no?: string
          created_at?: string
          customer_raw?: string
          fg_sku?: string
          flags?: Json
          id?: string
          import_id?: string
          model_raw?: string
          sales_order_id?: string | null
          source_row_no?: number
          status?: string
          trailer_letter?: string
          updated_at?: string
          work_order_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_order_lines_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "schedule_imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_order_lines_sales_order_id_fkey"
            columns: ["sales_order_id"]
            isOneToOne: false
            referencedRelation: "sales_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_order_lines_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "work_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_order_lines_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_orders: {
        Row: {
          created_at: string
          customer: string
          id: string
          so_no: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          customer?: string
          id?: string
          so_no: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          customer?: string
          id?: string
          so_no?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_orders_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      scenarios: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
          notes: string | null
          product_id: string
          status: Database["public"]["Enums"]["scenario_status"]
          target_output: number
          target_output_period: string
          type: Database["public"]["Enums"]["scenario_type"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
          notes?: string | null
          product_id: string
          status?: Database["public"]["Enums"]["scenario_status"]
          target_output?: number
          target_output_period?: string
          type?: Database["public"]["Enums"]["scenario_type"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          notes?: string | null
          product_id?: string
          status?: Database["public"]["Enums"]["scenario_status"]
          target_output?: number
          target_output_period?: string
          type?: Database["public"]["Enums"]["scenario_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "scenarios_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      schedule_imports: {
        Row: {
          file_name: string
          first_row_no: number
          id: string
          imported_at: string
          imported_by: string | null
          last_row_no: number
          row_count: number
          sheet_name: string
          workspace_id: string
        }
        Insert: {
          file_name?: string
          first_row_no?: number
          id?: string
          imported_at?: string
          imported_by?: string | null
          last_row_no?: number
          row_count?: number
          sheet_name?: string
          workspace_id: string
        }
        Update: {
          file_name?: string
          first_row_no?: number
          id?: string
          imported_at?: string
          imported_by?: string | null
          last_row_no?: number
          row_count?: number
          sheet_name?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "schedule_imports_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      sop_annex_files: {
        Row: {
          annex_id: string
          content_type: string
          created_at: string
          id: string
          original_name: string
          size_bytes: number
          sop_id: string
          storage_path: string
          updated_at: string
          uploaded_by: string
          workspace_id: string
        }
        Insert: {
          annex_id: string
          content_type: string
          created_at?: string
          id?: string
          original_name: string
          size_bytes: number
          sop_id: string
          storage_path: string
          updated_at?: string
          uploaded_by: string
          workspace_id: string
        }
        Update: {
          annex_id?: string
          content_type?: string
          created_at?: string
          id?: string
          original_name?: string
          size_bytes?: number
          sop_id?: string
          storage_path?: string
          updated_at?: string
          uploaded_by?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sop_annex_files_sop_id_fkey"
            columns: ["sop_id"]
            isOneToOne: false
            referencedRelation: "sops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sop_annex_files_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      sop_change_log: {
        Row: {
          created_at: string
          created_by: string | null
          from_version: string
          id: string
          reason: string
          requires_retraining: boolean
          revision_id: string | null
          significance: string | null
          sop_id: string
          to_version: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          from_version: string
          id?: string
          reason: string
          requires_retraining?: boolean
          revision_id?: string | null
          significance?: string | null
          sop_id: string
          to_version: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          from_version?: string
          id?: string
          reason?: string
          requires_retraining?: boolean
          revision_id?: string | null
          significance?: string | null
          sop_id?: string
          to_version?: string
        }
        Relationships: [
          {
            foreignKeyName: "sop_change_log_revision_id_fkey"
            columns: ["revision_id"]
            isOneToOne: false
            referencedRelation: "sop_revisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sop_change_log_sop_id_fkey"
            columns: ["sop_id"]
            isOneToOne: false
            referencedRelation: "sops"
            referencedColumns: ["id"]
          },
        ]
      }
      sop_event_log: {
        Row: {
          actor_id: string | null
          actor_name: string
          created_at: string
          details: Json
          event_type: string
          id: number
          review_cycle: number
          sop_id: string
          workspace_id: string
        }
        Insert: {
          actor_id?: string | null
          actor_name?: string
          created_at?: string
          details?: Json
          event_type: string
          id?: never
          review_cycle: number
          sop_id: string
          workspace_id: string
        }
        Update: {
          actor_id?: string | null
          actor_name?: string
          created_at?: string
          details?: Json
          event_type?: string
          id?: never
          review_cycle?: number
          sop_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sop_event_log_sop_id_fkey"
            columns: ["sop_id"]
            isOneToOne: false
            referencedRelation: "sops"
            referencedColumns: ["id"]
          },
        ]
      }
      sop_extraction_requests: {
        Row: {
          created_at: string
          id: number
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: never
          user_id: string
        }
        Update: {
          created_at?: string
          id?: never
          user_id?: string
        }
        Relationships: []
      }
      sop_job_titles: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          name: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sop_job_titles_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      sop_notifications: {
        Row: {
          attempts: number
          content: Json | null
          created_at: string
          event_id: number | null
          id: number
          kind: string
          last_attempt_at: string | null
          last_error: string | null
          recipient_id: string
          reminder_index: number
          resend_message_id: string | null
          review_cycle: number
          sent_at: string | null
          skipped_reason: string | null
          sop_id: string
        }
        Insert: {
          attempts?: number
          content?: Json | null
          created_at?: string
          event_id?: number | null
          id?: never
          kind: string
          last_attempt_at?: string | null
          last_error?: string | null
          recipient_id: string
          reminder_index?: number
          resend_message_id?: string | null
          review_cycle?: number
          sent_at?: string | null
          skipped_reason?: string | null
          sop_id: string
        }
        Update: {
          attempts?: number
          content?: Json | null
          created_at?: string
          event_id?: number | null
          id?: never
          kind?: string
          last_attempt_at?: string | null
          last_error?: string | null
          recipient_id?: string
          reminder_index?: number
          resend_message_id?: string | null
          review_cycle?: number
          sent_at?: string | null
          skipped_reason?: string | null
          sop_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sop_notifications_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "sop_event_log"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sop_notifications_sop_id_fkey"
            columns: ["sop_id"]
            isOneToOne: false
            referencedRelation: "sops"
            referencedColumns: ["id"]
          },
        ]
      }
      sop_rasic_roles: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          name: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sop_rasic_roles_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      sop_review_annotations: {
        Row: {
          author_name: string
          body: string
          category: string
          created_at: string
          created_by: string
          id: string
          page_number: number | null
          resolved_at: string | null
          resolved_by: string | null
          review_cycle: number
          sop_id: string
          x_percent: number | null
          y_percent: number | null
        }
        Insert: {
          author_name?: string
          body: string
          category?: string
          created_at?: string
          created_by: string
          id?: string
          page_number?: number | null
          resolved_at?: string | null
          resolved_by?: string | null
          review_cycle: number
          sop_id: string
          x_percent?: number | null
          y_percent?: number | null
        }
        Update: {
          author_name?: string
          body?: string
          category?: string
          created_at?: string
          created_by?: string
          id?: string
          page_number?: number | null
          resolved_at?: string | null
          resolved_by?: string | null
          review_cycle?: number
          sop_id?: string
          x_percent?: number | null
          y_percent?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "sop_review_annotations_sop_id_fkey"
            columns: ["sop_id"]
            isOneToOne: false
            referencedRelation: "sops"
            referencedColumns: ["id"]
          },
        ]
      }
      sop_review_seats: {
        Row: {
          created_by: string | null
          department_id: string
          rasic: Database["public"]["Enums"]["sop_rasic"]
          signer_id: string | null
          sop_id: string
          updated_at: string
        }
        Insert: {
          created_by?: string | null
          department_id: string
          rasic: Database["public"]["Enums"]["sop_rasic"]
          signer_id?: string | null
          sop_id: string
          updated_at?: string
        }
        Update: {
          created_by?: string | null
          department_id?: string
          rasic?: Database["public"]["Enums"]["sop_rasic"]
          signer_id?: string | null
          sop_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sop_review_seats_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sop_review_seats_sop_id_fkey"
            columns: ["sop_id"]
            isOneToOne: false
            referencedRelation: "sops"
            referencedColumns: ["id"]
          },
        ]
      }
      sop_review_submissions: {
        Row: {
          content_hash: string
          id: string
          no_changes: boolean
          review_cycle: number
          reviewer_id: string
          reviewer_name: string
          sop_id: string
          submitted_at: string
        }
        Insert: {
          content_hash?: string
          id?: string
          no_changes: boolean
          review_cycle: number
          reviewer_id: string
          reviewer_name?: string
          sop_id: string
          submitted_at?: string
        }
        Update: {
          content_hash?: string
          id?: string
          no_changes?: boolean
          review_cycle?: number
          reviewer_id?: string
          reviewer_name?: string
          sop_id?: string
          submitted_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sop_review_submissions_sop_id_fkey"
            columns: ["sop_id"]
            isOneToOne: false
            referencedRelation: "sops"
            referencedColumns: ["id"]
          },
        ]
      }
      sop_revisions: {
        Row: {
          content_hash: string
          created_at: string
          created_by: string | null
          document: Json
          id: string
          roster: Json | null
          sop_id: string
          version_label: string
          workspace_id: string
        }
        Insert: {
          content_hash: string
          created_at?: string
          created_by?: string | null
          document: Json
          id?: string
          roster?: Json | null
          sop_id: string
          version_label: string
          workspace_id: string
        }
        Update: {
          content_hash?: string
          created_at?: string
          created_by?: string | null
          document?: Json
          id?: string
          roster?: Json | null
          sop_id?: string
          version_label?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sop_revisions_sop_id_fkey"
            columns: ["sop_id"]
            isOneToOne: false
            referencedRelation: "sops"
            referencedColumns: ["id"]
          },
        ]
      }
      sop_signatures: {
        Row: {
          auth_method: string | null
          id: string
          meaning: string
          re_authenticated: boolean
          rejected_reason: string | null
          resolves_signature_id: string | null
          review_cycle: number
          revision_id: string | null
          seat_department_id: string | null
          signature_strokes: Json | null
          signed_at: string
          signed_content_hash: string
          signer_id: string
          signer_printed_name: string
          sop_id: string
        }
        Insert: {
          auth_method?: string | null
          id?: string
          meaning: string
          re_authenticated?: boolean
          rejected_reason?: string | null
          resolves_signature_id?: string | null
          review_cycle?: number
          revision_id?: string | null
          seat_department_id?: string | null
          signature_strokes?: Json | null
          signed_at?: string
          signed_content_hash: string
          signer_id: string
          signer_printed_name?: string
          sop_id: string
        }
        Update: {
          auth_method?: string | null
          id?: string
          meaning?: string
          re_authenticated?: boolean
          rejected_reason?: string | null
          resolves_signature_id?: string | null
          review_cycle?: number
          revision_id?: string | null
          seat_department_id?: string | null
          signature_strokes?: Json | null
          signed_at?: string
          signed_content_hash?: string
          signer_id?: string
          signer_printed_name?: string
          sop_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sop_signatures_resolves_signature_id_fkey"
            columns: ["resolves_signature_id"]
            isOneToOne: false
            referencedRelation: "sop_signatures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sop_signatures_revision_id_fkey"
            columns: ["revision_id"]
            isOneToOne: false
            referencedRelation: "sop_revisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sop_signatures_seat_department_id_fkey"
            columns: ["seat_department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sop_signatures_sop_id_fkey"
            columns: ["sop_id"]
            isOneToOne: false
            referencedRelation: "sops"
            referencedColumns: ["id"]
          },
        ]
      }
      sops: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          change_significance: string | null
          content_hash: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          department_id: string | null
          doc_type: string
          document: Json
          effective_date: string | null
          effective_revision_id: string | null
          final_approval_content_hash: string | null
          final_approval_requested_at: string | null
          final_approval_requested_by: string | null
          id: string
          major_version: number | null
          minor_version: number | null
          next_review_date: string | null
          rejected_by: string | null
          rejected_reason: string | null
          requires_retraining: boolean
          review_cycle: number
          review_interval_months: number
          revision_reason: string | null
          self_review_test: boolean
          seq_int: number | null
          sop_number: string | null
          source: string | null
          status: string
          submitted_by: string | null
          title: string | null
          updated_at: string
          updated_by: string | null
          version: string | null
          workspace_id: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          change_significance?: string | null
          content_hash?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          department_id?: string | null
          doc_type?: string
          document: Json
          effective_date?: string | null
          effective_revision_id?: string | null
          final_approval_content_hash?: string | null
          final_approval_requested_at?: string | null
          final_approval_requested_by?: string | null
          id: string
          major_version?: number | null
          minor_version?: number | null
          next_review_date?: string | null
          rejected_by?: string | null
          rejected_reason?: string | null
          requires_retraining?: boolean
          review_cycle?: number
          review_interval_months?: number
          revision_reason?: string | null
          self_review_test?: boolean
          seq_int?: number | null
          sop_number?: string | null
          source?: string | null
          status?: string
          submitted_by?: string | null
          title?: string | null
          updated_at?: string
          updated_by?: string | null
          version?: string | null
          workspace_id: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          change_significance?: string | null
          content_hash?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          department_id?: string | null
          doc_type?: string
          document?: Json
          effective_date?: string | null
          effective_revision_id?: string | null
          final_approval_content_hash?: string | null
          final_approval_requested_at?: string | null
          final_approval_requested_by?: string | null
          id?: string
          major_version?: number | null
          minor_version?: number | null
          next_review_date?: string | null
          rejected_by?: string | null
          rejected_reason?: string | null
          requires_retraining?: boolean
          review_cycle?: number
          review_interval_months?: number
          revision_reason?: string | null
          self_review_test?: boolean
          seq_int?: number | null
          sop_number?: string | null
          source?: string | null
          status?: string
          submitted_by?: string | null
          title?: string | null
          updated_at?: string
          updated_by?: string | null
          version?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sops_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sops_effective_revision_id_fkey"
            columns: ["effective_revision_id"]
            isOneToOne: false
            referencedRelation: "sop_revisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sops_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      space_access: {
        Row: {
          created_at: string
          granted_by: string | null
          space: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          granted_by?: string | null
          space: string
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          granted_by?: string | null
          space?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "space_access_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      stations: {
        Row: {
          actual_cycle_minutes: number | null
          actual_man_hours: number | null
          actual_operators: number | null
          area: string | null
          bottleneck_flag: boolean
          created_at: string
          description: string | null
          equipment_required: string[]
          id: string
          name: string
          owner_id: string | null
          owner_name: string
          planned_cycle_minutes: number
          planned_man_hours: number
          planned_operators: number
          qc_notes: string | null
          safety_notes: string | null
          scenario_id: string
          sequence: number
          takt_status: Database["public"]["Enums"]["takt_status"]
          tools_required: string[]
          updated_at: string
          wip_limit: number | null
        }
        Insert: {
          actual_cycle_minutes?: number | null
          actual_man_hours?: number | null
          actual_operators?: number | null
          area?: string | null
          bottleneck_flag?: boolean
          created_at?: string
          description?: string | null
          equipment_required?: string[]
          id?: string
          name: string
          owner_id?: string | null
          owner_name?: string
          planned_cycle_minutes?: number
          planned_man_hours?: number
          planned_operators?: number
          qc_notes?: string | null
          safety_notes?: string | null
          scenario_id: string
          sequence: number
          takt_status?: Database["public"]["Enums"]["takt_status"]
          tools_required?: string[]
          updated_at?: string
          wip_limit?: number | null
        }
        Update: {
          actual_cycle_minutes?: number | null
          actual_man_hours?: number | null
          actual_operators?: number | null
          area?: string | null
          bottleneck_flag?: boolean
          created_at?: string
          description?: string | null
          equipment_required?: string[]
          id?: string
          name?: string
          owner_id?: string | null
          owner_name?: string
          planned_cycle_minutes?: number
          planned_man_hours?: number
          planned_operators?: number
          qc_notes?: string | null
          safety_notes?: string | null
          scenario_id?: string
          sequence?: number
          takt_status?: Database["public"]["Enums"]["takt_status"]
          tools_required?: string[]
          updated_at?: string
          wip_limit?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "stations_scenario_id_fkey"
            columns: ["scenario_id"]
            isOneToOne: false
            referencedRelation: "scenarios"
            referencedColumns: ["id"]
          },
        ]
      }
      step_exploded_views: {
        Row: {
          caption: string | null
          captured_at: string
          components: string[] | null
          config_name: string | null
          created_at: string
          deleted_at: string | null
          file_name: string
          frame_number: number | null
          height: number | null
          id: string
          mime_type: string | null
          public_url: string
          size_bytes: number | null
          solidworks_file_path: string | null
          step_id: string | null
          storage_path: string
          task_id: string
          thumbnail_storage_path: string | null
          thumbnail_url: string | null
          updated_at: string
          uploaded_by: string | null
          width: number | null
        }
        Insert: {
          caption?: string | null
          captured_at?: string
          components?: string[] | null
          config_name?: string | null
          created_at?: string
          deleted_at?: string | null
          file_name?: string
          frame_number?: number | null
          height?: number | null
          id?: string
          mime_type?: string | null
          public_url: string
          size_bytes?: number | null
          solidworks_file_path?: string | null
          step_id?: string | null
          storage_path: string
          task_id: string
          thumbnail_storage_path?: string | null
          thumbnail_url?: string | null
          updated_at?: string
          uploaded_by?: string | null
          width?: number | null
        }
        Update: {
          caption?: string | null
          captured_at?: string
          components?: string[] | null
          config_name?: string | null
          created_at?: string
          deleted_at?: string | null
          file_name?: string
          frame_number?: number | null
          height?: number | null
          id?: string
          mime_type?: string | null
          public_url?: string
          size_bytes?: number | null
          solidworks_file_path?: string | null
          step_id?: string | null
          storage_path?: string
          task_id?: string
          thumbnail_storage_path?: string | null
          thumbnail_url?: string | null
          updated_at?: string
          uploaded_by?: string | null
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "step_exploded_views_step_id_fkey"
            columns: ["step_id"]
            isOneToOne: false
            referencedRelation: "manufacturing_steps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "step_exploded_views_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "planner_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "step_exploded_views_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      step_photos: {
        Row: {
          caption: string | null
          captured_at: string
          created_at: string
          deleted_at: string | null
          file_name: string
          height: number | null
          id: string
          mime_type: string | null
          public_url: string
          size_bytes: number | null
          step_id: string
          storage_path: string
          task_id: string
          thumbnail_storage_path: string | null
          thumbnail_url: string | null
          updated_at: string
          uploaded_by: string | null
          width: number | null
        }
        Insert: {
          caption?: string | null
          captured_at?: string
          created_at?: string
          deleted_at?: string | null
          file_name?: string
          height?: number | null
          id?: string
          mime_type?: string | null
          public_url: string
          size_bytes?: number | null
          step_id: string
          storage_path: string
          task_id: string
          thumbnail_storage_path?: string | null
          thumbnail_url?: string | null
          updated_at?: string
          uploaded_by?: string | null
          width?: number | null
        }
        Update: {
          caption?: string | null
          captured_at?: string
          created_at?: string
          deleted_at?: string | null
          file_name?: string
          height?: number | null
          id?: string
          mime_type?: string | null
          public_url?: string
          size_bytes?: number | null
          step_id?: string
          storage_path?: string
          task_id?: string
          thumbnail_storage_path?: string | null
          thumbnail_url?: string | null
          updated_at?: string
          uploaded_by?: string | null
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "step_photos_step_id_fkey"
            columns: ["step_id"]
            isOneToOne: false
            referencedRelation: "manufacturing_steps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "step_photos_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "planner_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "step_photos_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      step_tools: {
        Row: {
          created_at: string
          id: string
          sequence: number
          step_id: string
          task_id: string
          tool_name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          sequence?: number
          step_id: string
          task_id: string
          tool_name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          sequence?: number
          step_id?: string
          task_id?: string
          tool_name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "step_tools_step_id_fkey"
            columns: ["step_id"]
            isOneToOne: false
            referencedRelation: "manufacturing_steps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "step_tools_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "planner_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "step_tools_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_dependencies: {
        Row: {
          constraint_type: Database["public"]["Enums"]["constraint_type"] | null
          created_at: string
          id: string
          lag_minutes: number
          predecessor_task_id: string
          successor_task_id: string
          type: Database["public"]["Enums"]["dependency_type"]
        }
        Insert: {
          constraint_type?:
            | Database["public"]["Enums"]["constraint_type"]
            | null
          created_at?: string
          id?: string
          lag_minutes?: number
          predecessor_task_id: string
          successor_task_id: string
          type?: Database["public"]["Enums"]["dependency_type"]
        }
        Update: {
          constraint_type?:
            | Database["public"]["Enums"]["constraint_type"]
            | null
          created_at?: string
          id?: string
          lag_minutes?: number
          predecessor_task_id?: string
          successor_task_id?: string
          type?: Database["public"]["Enums"]["dependency_type"]
        }
        Relationships: [
          {
            foreignKeyName: "task_dependencies_predecessor_task_id_fkey"
            columns: ["predecessor_task_id"]
            isOneToOne: false
            referencedRelation: "planner_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_dependencies_predecessor_task_id_fkey"
            columns: ["predecessor_task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_dependencies_successor_task_id_fkey"
            columns: ["successor_task_id"]
            isOneToOne: false
            referencedRelation: "planner_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_dependencies_successor_task_id_fkey"
            columns: ["successor_task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_videos: {
        Row: {
          caption: string | null
          captured_at: string
          created_at: string
          deleted_at: string | null
          duration_seconds: number | null
          file_name: string
          height: number | null
          id: string
          mime_type: string | null
          public_url: string
          size_bytes: number | null
          solidworks_file_path: string | null
          storage_path: string
          task_id: string
          thumbnail_storage_path: string | null
          thumbnail_url: string | null
          updated_at: string
          uploaded_by: string | null
          width: number | null
        }
        Insert: {
          caption?: string | null
          captured_at?: string
          created_at?: string
          deleted_at?: string | null
          duration_seconds?: number | null
          file_name?: string
          height?: number | null
          id?: string
          mime_type?: string | null
          public_url: string
          size_bytes?: number | null
          solidworks_file_path?: string | null
          storage_path: string
          task_id: string
          thumbnail_storage_path?: string | null
          thumbnail_url?: string | null
          updated_at?: string
          uploaded_by?: string | null
          width?: number | null
        }
        Update: {
          caption?: string | null
          captured_at?: string
          created_at?: string
          deleted_at?: string | null
          duration_seconds?: number | null
          file_name?: string
          height?: number | null
          id?: string
          mime_type?: string | null
          public_url?: string
          size_bytes?: number | null
          solidworks_file_path?: string | null
          storage_path?: string
          task_id?: string
          thumbnail_storage_path?: string | null
          thumbnail_url?: string | null
          updated_at?: string
          uploaded_by?: string | null
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "task_videos_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "planner_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_videos_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          actual_duration_minutes: number | null
          actual_finish: string | null
          actual_man_hours: number | null
          actual_operators: number | null
          actual_start: string | null
          bottleneck_flag: boolean
          code_generated_at: string | null
          code_locked: boolean
          component_id: string | null
          created_at: string
          critical_path: boolean
          custom_fields: Json
          description: string | null
          drawing_link: string | null
          equipment_required: string[]
          id: string
          manufacturing_code: string | null
          material_kit: string | null
          name: string
          notes: string | null
          owner_id: string | null
          owner_name: string | null
          parent_task_id: string | null
          percent_complete: number
          planned_duration_minutes: number
          planned_finish: string
          planned_man_hours: number
          planned_operators: number
          planned_start: string
          qc_checklist: string | null
          quality_gate: boolean
          rework_risk: Database["public"]["Enums"]["rework_risk"] | null
          role: string | null
          row_type: Database["public"]["Enums"]["row_type"]
          safety_notes: string | null
          scenario_id: string
          skill_level: Database["public"]["Enums"]["skill_level"] | null
          sop_id: string | null
          sop_link: string | null
          station_id: string | null
          status: Database["public"]["Enums"]["task_status"]
          task_number: number | null
          tools_required: string[]
          traveler_signoff_required: boolean
          updated_at: string
          version: number
          wbs: string
          work_instruction_link: string | null
          zone_id: string | null
        }
        Insert: {
          actual_duration_minutes?: number | null
          actual_finish?: string | null
          actual_man_hours?: number | null
          actual_operators?: number | null
          actual_start?: string | null
          bottleneck_flag?: boolean
          code_generated_at?: string | null
          code_locked?: boolean
          component_id?: string | null
          created_at?: string
          critical_path?: boolean
          custom_fields?: Json
          description?: string | null
          drawing_link?: string | null
          equipment_required?: string[]
          id?: string
          manufacturing_code?: string | null
          material_kit?: string | null
          name?: string
          notes?: string | null
          owner_id?: string | null
          owner_name?: string | null
          parent_task_id?: string | null
          percent_complete?: number
          planned_duration_minutes?: number
          planned_finish: string
          planned_man_hours?: number
          planned_operators?: number
          planned_start: string
          qc_checklist?: string | null
          quality_gate?: boolean
          rework_risk?: Database["public"]["Enums"]["rework_risk"] | null
          role?: string | null
          row_type?: Database["public"]["Enums"]["row_type"]
          safety_notes?: string | null
          scenario_id: string
          skill_level?: Database["public"]["Enums"]["skill_level"] | null
          sop_id?: string | null
          sop_link?: string | null
          station_id?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          task_number?: number | null
          tools_required?: string[]
          traveler_signoff_required?: boolean
          updated_at?: string
          version?: number
          wbs: string
          work_instruction_link?: string | null
          zone_id?: string | null
        }
        Update: {
          actual_duration_minutes?: number | null
          actual_finish?: string | null
          actual_man_hours?: number | null
          actual_operators?: number | null
          actual_start?: string | null
          bottleneck_flag?: boolean
          code_generated_at?: string | null
          code_locked?: boolean
          component_id?: string | null
          created_at?: string
          critical_path?: boolean
          custom_fields?: Json
          description?: string | null
          drawing_link?: string | null
          equipment_required?: string[]
          id?: string
          manufacturing_code?: string | null
          material_kit?: string | null
          name?: string
          notes?: string | null
          owner_id?: string | null
          owner_name?: string | null
          parent_task_id?: string | null
          percent_complete?: number
          planned_duration_minutes?: number
          planned_finish?: string
          planned_man_hours?: number
          planned_operators?: number
          planned_start?: string
          qc_checklist?: string | null
          quality_gate?: boolean
          rework_risk?: Database["public"]["Enums"]["rework_risk"] | null
          role?: string | null
          row_type?: Database["public"]["Enums"]["row_type"]
          safety_notes?: string | null
          scenario_id?: string
          skill_level?: Database["public"]["Enums"]["skill_level"] | null
          sop_id?: string | null
          sop_link?: string | null
          station_id?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          task_number?: number | null
          tools_required?: string[]
          traveler_signoff_required?: boolean
          updated_at?: string
          version?: number
          wbs?: string
          work_instruction_link?: string | null
          zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tasks_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "manufacturing_components"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_parent_task_id_fkey"
            columns: ["parent_task_id"]
            isOneToOne: false
            referencedRelation: "planner_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_parent_task_id_fkey"
            columns: ["parent_task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_scenario_id_fkey"
            columns: ["scenario_id"]
            isOneToOne: false
            referencedRelation: "scenarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_sop_id_fkey"
            columns: ["sop_id"]
            isOneToOne: false
            referencedRelation: "sops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_station_id_fkey"
            columns: ["station_id"]
            isOneToOne: false
            referencedRelation: "stations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "zones"
            referencedColumns: ["id"]
          },
        ]
      }
      tool_library: {
        Row: {
          category: string | null
          created_at: string
          id: string
          image_url: string | null
          project_id: string
          storage_path: string | null
          tool_name: string
          updated_at: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          id?: string
          image_url?: string | null
          project_id: string
          storage_path?: string | null
          tool_name: string
          updated_at?: string
        }
        Update: {
          category?: string | null
          created_at?: string
          id?: string
          image_url?: string | null
          project_id?: string
          storage_path?: string | null
          tool_name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tool_library_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      transactional_emails: {
        Row: {
          created_at: string
          error: string | null
          id: number
          kind: string
          recipient_email: string
          recipient_id: string | null
          resend_message_id: string | null
          status: string
          workspace_id: string | null
        }
        Insert: {
          created_at?: string
          error?: string | null
          id?: never
          kind: string
          recipient_email: string
          recipient_id?: string | null
          resend_message_id?: string | null
          status: string
          workspace_id?: string | null
        }
        Update: {
          created_at?: string
          error?: string | null
          id?: never
          kind?: string
          recipient_email?: string
          recipient_id?: string | null
          resend_message_id?: string | null
          status?: string
          workspace_id?: string | null
        }
        Relationships: []
      }
      trailer_configs: {
        Row: {
          created_at: string
          created_by: string | null
          letter: string
          name: string
          trailer_template_id: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          letter: string
          name?: string
          trailer_template_id?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          letter?: string
          name?: string
          trailer_template_id?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trailer_configs_trailer_template_id_fkey"
            columns: ["trailer_template_id"]
            isOneToOne: false
            referencedRelation: "work_order_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trailer_configs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      user_signature_profiles: {
        Row: {
          created_at: string
          signature_strokes: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          signature_strokes: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          signature_strokes?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      work_order_lines: {
        Row: {
          assembly_order_no: string
          build_qty: number
          created_at: string
          description: string
          fulfillment: string
          id: string
          item_no: string
          position: number
          pull_from_ref: string
          shipped_qty: number | null
          updated_at: string
          work_order_id: string
          workspace_id: string
        }
        Insert: {
          assembly_order_no?: string
          build_qty?: number
          created_at?: string
          description?: string
          fulfillment?: string
          id?: string
          item_no: string
          position?: number
          pull_from_ref?: string
          shipped_qty?: number | null
          updated_at?: string
          work_order_id: string
          workspace_id: string
        }
        Update: {
          assembly_order_no?: string
          build_qty?: number
          created_at?: string
          description?: string
          fulfillment?: string
          id?: string
          item_no?: string
          position?: number
          pull_from_ref?: string
          shipped_qty?: number | null
          updated_at?: string
          work_order_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_order_lines_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "work_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_order_lines_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      work_order_template_lines: {
        Row: {
          build_qty: number
          created_at: string
          description: string
          id: string
          item_no: string
          position: number
          template_id: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          build_qty?: number
          created_at?: string
          description?: string
          id?: string
          item_no: string
          position?: number
          template_id: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          build_qty?: number
          created_at?: string
          description?: string
          id?: string
          item_no?: string
          position?: number
          template_id?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_order_template_lines_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "work_order_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_order_template_lines_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      work_order_templates: {
        Row: {
          created_at: string
          created_by: string | null
          customer: string
          default_trailer_letter: string
          id: string
          model: string
          name: string
          notes_default: string
          order_type: string
          pm_template_id: string | null
          retired_at: string | null
          sku: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          customer?: string
          default_trailer_letter?: string
          id?: string
          model?: string
          name: string
          notes_default?: string
          order_type?: string
          pm_template_id?: string | null
          retired_at?: string | null
          sku?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          customer?: string
          default_trailer_letter?: string
          id?: string
          model?: string
          name?: string
          notes_default?: string
          order_type?: string
          pm_template_id?: string | null
          retired_at?: string | null
          sku?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_order_templates_pm_template_id_fkey"
            columns: ["pm_template_id"]
            isOneToOne: false
            referencedRelation: "work_order_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_order_templates_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      work_orders: {
        Row: {
          cancelled_at: string | null
          created_at: string
          created_by: string | null
          customer: string
          draft_no: string
          id: string
          main_order_id: string | null
          model: string
          notes: string
          order_date: string
          order_no: string | null
          order_type: string
          production_started_at: string | null
          released_at: string | null
          sales_order_line_id: string | null
          sales_order_no: string
          set_no: string
          shipped_at: string | null
          status: string
          template_id: string | null
          trailer_letter: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          cancelled_at?: string | null
          created_at?: string
          created_by?: string | null
          customer?: string
          draft_no?: string
          id?: string
          main_order_id?: string | null
          model?: string
          notes?: string
          order_date?: string
          order_no?: string | null
          order_type?: string
          production_started_at?: string | null
          released_at?: string | null
          sales_order_line_id?: string | null
          sales_order_no?: string
          set_no?: string
          shipped_at?: string | null
          status?: string
          template_id?: string | null
          trailer_letter?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          cancelled_at?: string | null
          created_at?: string
          created_by?: string | null
          customer?: string
          draft_no?: string
          id?: string
          main_order_id?: string | null
          model?: string
          notes?: string
          order_date?: string
          order_no?: string | null
          order_type?: string
          production_started_at?: string | null
          released_at?: string | null
          sales_order_line_id?: string | null
          sales_order_no?: string
          set_no?: string
          shipped_at?: string | null
          status?: string
          template_id?: string | null
          trailer_letter?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_orders_main_order_id_fkey"
            columns: ["main_order_id"]
            isOneToOne: false
            referencedRelation: "work_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_orders_sales_order_line_id_fkey"
            columns: ["sales_order_line_id"]
            isOneToOne: false
            referencedRelation: "sales_order_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_orders_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "work_order_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_orders_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_access_grants: {
        Row: {
          access_package: string
          created_at: string
          department_access: Json
          email: string
          expires_at: string
          granted_by: string | null
          modules: string[] | null
          planning_access: boolean
          project_access: Json
          quality_access: Database["public"]["Enums"]["access_level"]
          redeemed_at: string | null
          redeemed_by: string | null
          role: Database["public"]["Enums"]["workspace_role"]
          updated_at: string
          workspace_id: string
        }
        Insert: {
          access_package?: string
          created_at?: string
          department_access?: Json
          email: string
          expires_at?: string
          granted_by?: string | null
          modules?: string[] | null
          planning_access?: boolean
          project_access?: Json
          quality_access?: Database["public"]["Enums"]["access_level"]
          redeemed_at?: string | null
          redeemed_by?: string | null
          role?: Database["public"]["Enums"]["workspace_role"]
          updated_at?: string
          workspace_id: string
        }
        Update: {
          access_package?: string
          created_at?: string
          department_access?: Json
          email?: string
          expires_at?: string
          granted_by?: string | null
          modules?: string[] | null
          planning_access?: boolean
          project_access?: Json
          quality_access?: Database["public"]["Enums"]["access_level"]
          redeemed_at?: string | null
          redeemed_by?: string | null
          role?: Database["public"]["Enums"]["workspace_role"]
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_access_grants_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_auto_join_domains: {
        Row: {
          created_at: string
          domain: string
          role: Database["public"]["Enums"]["workspace_role"]
          workspace_id: string
        }
        Insert: {
          created_at?: string
          domain: string
          role?: Database["public"]["Enums"]["workspace_role"]
          workspace_id: string
        }
        Update: {
          created_at?: string
          domain?: string
          role?: Database["public"]["Enums"]["workspace_role"]
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_auto_join_domains_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_integrations: {
        Row: {
          config: Json
          enabled: boolean
          kind: string
          updated_at: string
          updated_by: string | null
          workspace_id: string
        }
        Insert: {
          config?: Json
          enabled?: boolean
          kind: string
          updated_at?: string
          updated_by?: string | null
          workspace_id: string
        }
        Update: {
          config?: Json
          enabled?: boolean
          kind?: string
          updated_at?: string
          updated_by?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_integrations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_members: {
        Row: {
          created_at: string
          modules: string[] | null
          role: Database["public"]["Enums"]["workspace_role"]
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          modules?: string[] | null
          role?: Database["public"]["Enums"]["workspace_role"]
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          modules?: string[] | null
          role?: Database["public"]["Enums"]["workspace_role"]
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_members_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_notifications: {
        Row: {
          attempts: number
          content: Json | null
          created_at: string
          event_id: number
          id: number
          kind: string
          last_attempt_at: string | null
          last_error: string | null
          recipient_id: string
          resend_message_id: string | null
          sent_at: string | null
          skipped_reason: string | null
          workspace_id: string
        }
        Insert: {
          attempts?: number
          content?: Json | null
          created_at?: string
          event_id: number
          id?: never
          kind: string
          last_attempt_at?: string | null
          last_error?: string | null
          recipient_id: string
          resend_message_id?: string | null
          sent_at?: string | null
          skipped_reason?: string | null
          workspace_id: string
        }
        Update: {
          attempts?: number
          content?: Json | null
          created_at?: string
          event_id?: number
          id?: never
          kind?: string
          last_attempt_at?: string | null
          last_error?: string | null
          recipient_id?: string
          resend_message_id?: string | null
          sent_at?: string | null
          skipped_reason?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_notifications_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "audit_log"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_notifications_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_revocations: {
        Row: {
          created_at: string
          email: string
          revoked_by: string | null
          workspace_id: string
        }
        Insert: {
          created_at?: string
          email: string
          revoked_by?: string | null
          workspace_id: string
        }
        Update: {
          created_at?: string
          email?: string
          revoked_by?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_revocations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          created_at: string
          id: string
          name: string
          owner_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          owner_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          owner_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      zones: {
        Row: {
          code: string | null
          color: string
          created_at: string
          description: string | null
          id: string
          name: string
          scenario_id: string
          sequence: number
          updated_at: string
        }
        Insert: {
          code?: string | null
          color?: string
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          scenario_id: string
          sequence: number
          updated_at?: string
        }
        Update: {
          code?: string | null
          color?: string
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          scenario_id?: string
          sequence?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "zones_scenario_id_fkey"
            columns: ["scenario_id"]
            isOneToOne: false
            referencedRelation: "scenarios"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      planner_tasks: {
        Row: {
          actual_duration_minutes: number | null
          actual_finish: string | null
          actual_man_hours: number | null
          actual_operators: number | null
          actual_start: string | null
          bottleneck_flag: boolean | null
          created_at: string | null
          critical_path: boolean | null
          custom_fields: Json | null
          dependency_ids: string[] | null
          description: string | null
          drawing_link: string | null
          equipment_required: string[] | null
          id: string | null
          manufacturing_steps: Json | null
          material_kit: string | null
          name: string | null
          notes: string | null
          owner_id: string | null
          owner_name: string | null
          parent_task_id: string | null
          part_references: Json | null
          percent_complete: number | null
          planned_duration_minutes: number | null
          planned_finish: string | null
          planned_man_hours: number | null
          planned_operators: number | null
          planned_start: string | null
          qc_checklist: string | null
          quality_gate: boolean | null
          rework_risk: Database["public"]["Enums"]["rework_risk"] | null
          role: string | null
          row_type: Database["public"]["Enums"]["row_type"] | null
          safety_notes: string | null
          scenario_id: string | null
          skill_level: Database["public"]["Enums"]["skill_level"] | null
          sop_link: string | null
          station_id: string | null
          status: Database["public"]["Enums"]["task_status"] | null
          tools_required: string[] | null
          traveler_signoff_required: boolean | null
          updated_at: string | null
          wbs: string | null
          work_instruction_link: string | null
          zone_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tasks_parent_task_id_fkey"
            columns: ["parent_task_id"]
            isOneToOne: false
            referencedRelation: "planner_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_parent_task_id_fkey"
            columns: ["parent_task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_scenario_id_fkey"
            columns: ["scenario_id"]
            isOneToOne: false
            referencedRelation: "scenarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_station_id_fkey"
            columns: ["station_id"]
            isOneToOne: false
            referencedRelation: "stations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "zones"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      append_sop_event: {
        Args: { p_details?: Json; p_event_type: string; p_sop: string }
        Returns: undefined
      }
      approve_work_order_set: {
        Args: { p_main_id: string; p_workspace_id: string }
        Returns: {
          order_no: string
          pm_order_no: string
          set_no: string
        }[]
      }
      can_edit_sop_content: { Args: { p_sop: string }; Returns: boolean }
      can_edit_sop_roster: { Args: { p_sop: string }; Returns: boolean }
      can_read_sop: { Args: { p_sop: string }; Returns: boolean }
      can_view_member_profile: {
        Args: { target_user_id: string }
        Returns: boolean
      }
      close_moot_objections: { Args: { p_sop: string }; Returns: undefined }
      create_project_with_starter_plan: {
        Args: { p_name: string; p_workspace_id: string }
        Returns: string
      }
      custom_column_project_id: {
        Args: { target_product_id: string; target_scenario_id: string }
        Returns: string
      }
      custom_column_workspace_id: {
        Args: { target_product_id: string; target_scenario_id: string }
        Returns: string
      }
      delete_scenario: { Args: { p_scenario_id: string }; Returns: undefined }
      department_has_members: { Args: { dept_id: string }; Returns: boolean }
      document_type_code_project_id: {
        Args: { target_product_id: string; target_project_id: string }
        Returns: string
      }
      duplicate_scenario: {
        Args: { p_new_name: string; p_source_scenario_id: string }
        Returns: string
      }
      enable_sop_self_review_test: { Args: { p_sop: string }; Returns: boolean }
      has_department_role: {
        Args: {
          dept_id: string
          roles: Database["public"]["Enums"]["department_sop_role"][]
        }
        Returns: boolean
      }
      has_org_tool_access: {
        Args: {
          min_level: Database["public"]["Enums"]["access_level"]
          target_workspace_id: string
        }
        Returns: boolean
      }
      has_project_access: {
        Args: {
          min_level: Database["public"]["Enums"]["access_level"]
          target_project_id: string
        }
        Returns: boolean
      }
      has_space_access: {
        Args: { target_space: string; target_workspace_id: string }
        Returns: boolean
      }
      has_workspace_role: {
        Args: {
          allowed_roles: Database["public"]["Enums"]["workspace_role"][]
          target_workspace_id: string
        }
        Returns: boolean
      }
      holds_sop_seat: { Args: { p_sop: string }; Returns: boolean }
      is_department_member: {
        Args: { dept_id: string; p_user?: string }
        Returns: boolean
      }
      is_quality_approver: {
        Args: { p_user?: string; p_workspace: string }
        Returns: boolean
      }
      is_super_admin: { Args: never; Returns: boolean }
      mark_all_notifications_read: {
        Args: { p_workspace?: string }
        Returns: number
      }
      mark_notifications_read: {
        Args: { p_ids: number[] }
        Returns: number
      }
      mint_sop_number_internal: {
        Args: { p_department: string; p_doc_type: string; p_workspace: string }
        Returns: string
      }
      next_sop_number: {
        Args: { p_department: string; p_doc_type: string; p_workspace: string }
        Returns: string
      }
      product_project_id: {
        Args: { target_product_id: string }
        Returns: string
      }
      product_workspace_id: {
        Args: { target_product_id: string }
        Returns: string
      }
      project_workspace: {
        Args: { target_project_id: string }
        Returns: string
      }
      project_workspace_id: {
        Args: { target_project_id: string }
        Returns: string
      }
      reassign_sop_seat: {
        Args: { p_department: string; p_new_signer: string; p_sop: string }
        Returns: undefined
      }
      redeem_workspace_access_grants: { Args: never; Returns: number }
      remove_workspace_member: {
        Args: { target_user_id: string; target_workspace_id: string }
        Returns: undefined
      }
      reorder_manufacturing_steps: {
        Args: { p_step_ids: string[]; p_task_id: string }
        Returns: undefined
      }
      replace_task_children: {
        Args: {
          p_actual_events: Json
          p_dependencies: Json
          p_parts: Json
          p_steps: Json
          p_task_ids: string[]
        }
        Returns: undefined
      }
      request_sop_final_approval: {
        Args: { p_sop: string }
        Returns: undefined
      }
      resolve_sop_review_annotation: {
        Args: { p_annotation: string; p_resolved?: boolean }
        Returns: undefined
      }
      scenario_project_id: {
        Args: { target_scenario_id: string }
        Returns: string
      }
      scenario_workspace_id: {
        Args: { target_scenario_id: string }
        Returns: string
      }
      sign_sop: {
        Args: {
          p_expected_cycle?: number
          p_expected_hash?: string
          p_meaning: string
          p_reason?: string
          p_resolves?: string
          p_seat_department?: string
          p_sop: string
        }
        Returns: string
      }
      snapshot_sop_revision: {
        Args: { p_document?: Json; p_sop: string }
        Returns: string
      }
      sop_author_display_name: { Args: { p_sop: string }; Returns: string }
      sop_doc_hash: { Args: { doc: Json }; Returns: string }
      sop_has_open_objection: { Args: { p_sop: string }; Returns: boolean }
      sop_quorum_met: { Args: { p_sop: string }; Returns: boolean }
      sop_self_review_test_active: { Args: { p_sop: string }; Returns: boolean }
      sop_workspace_id: { Args: { p_sop: string }; Returns: string }
      submit_sop_review: {
        Args: { p_no_changes: boolean; p_sop: string }
        Returns: string
      }
      task_project_id: { Args: { target_task_id: string }; Returns: string }
      task_workspace_id: { Args: { target_task_id: string }; Returns: string }
      workspace_has_members: {
        Args: { target_workspace_id: string }
        Returns: boolean
      }
    }
    Enums: {
      access_level: "none" | "view" | "edit"
      actual_event_type:
        | "start"
        | "pause"
        | "resume"
        | "complete"
        | "blocked"
        | "unblocked"
        | "qc_hold"
        | "rework"
        | "note"
      constraint_type:
        | "safety"
        | "quality"
        | "material"
        | "tooling"
        | "labor"
        | "engineering"
        | "traveler"
      custom_column_scope: "product" | "scenario" | "station" | "task" | "all"
      custom_column_type:
        | "text"
        | "long_text"
        | "number"
        | "currency"
        | "percent"
        | "duration"
        | "date"
        | "datetime"
        | "checkbox"
        | "select"
        | "multi_select"
        | "person"
        | "formula"
        | "url"
        | "file"
        | "relation"
        | "rollup"
        | "status"
        | "rating"
        | "risk_score"
      demand_period: "shift" | "day" | "week" | "month" | "custom" | "year"
      department_sop_role: "author" | "reviewer" | "approver"
      dependency_type:
        | "finish_to_start"
        | "start_to_start"
        | "finish_to_finish"
        | "start_to_finish"
      product_status: "draft" | "review" | "approved" | "released" | "obsolete"
      project_status: "active" | "archived"
      rework_risk: "low" | "medium" | "high"
      row_type:
        | "task"
        | "milestone"
        | "inspection"
        | "material_gate"
        | "hold"
        | "rework"
        | "buffer"
      scenario_status: "draft" | "baseline" | "released" | "archived"
      scenario_type:
        | "current_state"
        | "future_state"
        | "prototype"
        | "production"
        | "what_if"
      skill_level: "apprentice" | "trained" | "certified" | "expert"
      sop_rasic:
        | "responsible"
        | "accountable"
        | "support"
        | "consulted"
        | "informed"
      takt_status: "green" | "yellow" | "red" | "missing"
      task_status:
        | "not_started"
        | "ready"
        | "in_progress"
        | "complete"
        | "blocked"
        | "hold"
        | "qc_hold"
        | "rework"
      workspace_role: "owner" | "admin" | "editor" | "viewer"
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
  public: {
    Enums: {
      access_level: ["none", "view", "edit"],
      actual_event_type: [
        "start",
        "pause",
        "resume",
        "complete",
        "blocked",
        "unblocked",
        "qc_hold",
        "rework",
        "note",
      ],
      constraint_type: [
        "safety",
        "quality",
        "material",
        "tooling",
        "labor",
        "engineering",
        "traveler",
      ],
      custom_column_scope: ["product", "scenario", "station", "task", "all"],
      custom_column_type: [
        "text",
        "long_text",
        "number",
        "currency",
        "percent",
        "duration",
        "date",
        "datetime",
        "checkbox",
        "select",
        "multi_select",
        "person",
        "formula",
        "url",
        "file",
        "relation",
        "rollup",
        "status",
        "rating",
        "risk_score",
      ],
      demand_period: ["shift", "day", "week", "month", "custom", "year"],
      department_sop_role: ["author", "reviewer", "approver"],
      dependency_type: [
        "finish_to_start",
        "start_to_start",
        "finish_to_finish",
        "start_to_finish",
      ],
      product_status: ["draft", "review", "approved", "released", "obsolete"],
      project_status: ["active", "archived"],
      rework_risk: ["low", "medium", "high"],
      row_type: [
        "task",
        "milestone",
        "inspection",
        "material_gate",
        "hold",
        "rework",
        "buffer",
      ],
      scenario_status: ["draft", "baseline", "released", "archived"],
      scenario_type: [
        "current_state",
        "future_state",
        "prototype",
        "production",
        "what_if",
      ],
      skill_level: ["apprentice", "trained", "certified", "expert"],
      sop_rasic: [
        "responsible",
        "accountable",
        "support",
        "consulted",
        "informed",
      ],
      takt_status: ["green", "yellow", "red", "missing"],
      task_status: [
        "not_started",
        "ready",
        "in_progress",
        "complete",
        "blocked",
        "hold",
        "qc_hold",
        "rework",
      ],
      workspace_role: ["owner", "admin", "editor", "viewer"],
    },
  },
} as const
