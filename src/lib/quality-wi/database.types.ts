// Generated from the isolated WI database. Only additive WI objects are included;
// the published base Database type is unchanged until production schema approval.
import type { Database, Json } from "@/lib/database.types";
export type QualityWiDatabase = {
  public: Omit<Database["public"], "Tables" | "Functions"> & {
    Tables: Database["public"]["Tables"] & {
      quality_wi_operations: {
        Row: {
          actor_id: string;
          id: string;
          request: NonNullable<Json>;
          result: NonNullable<Json>;
          wi_id: string;
        };
        Insert: {
          actor_id: string;
          id: string;
          request: NonNullable<Json>;
          result: NonNullable<Json>;
          wi_id: string;
        };
        Update: {
          actor_id?: string;
          id?: string;
          request?: NonNullable<Json>;
          result?: NonNullable<Json>;
          wi_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "quality_wi_operations_wi_id_fkey";
            columns: ["wi_id"];
            isOneToOne: false;
            referencedRelation: "quality_work_instructions";
            referencedColumns: ["id"];
          },
        ];
      };
      quality_wi_revisions: {
        Row: {
          change_description: string;
          id: string;
          published_at: string;
          published_by: string;
          revision_index: number;
          snapshot: NonNullable<Json>;
          wi_id: string;
        };
        Insert: {
          change_description: string;
          id: string;
          published_at?: string;
          published_by: string;
          revision_index: number;
          snapshot: NonNullable<Json>;
          wi_id: string;
        };
        Update: {
          change_description?: string;
          id?: string;
          published_at?: string;
          published_by?: string;
          revision_index?: number;
          snapshot?: NonNullable<Json>;
          wi_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "quality_wi_revisions_wi_id_fkey";
            columns: ["wi_id"];
            isOneToOne: false;
            referencedRelation: "quality_work_instructions";
            referencedColumns: ["id"];
          },
        ];
      };
      quality_wi_steps: {
        Row: {
          id: string;
          image: Json | null;
          instruction: string;
          position: number;
          removed_at: string | null;
          title: string;
          wi_id: string;
        };
        Insert: {
          id: string;
          image?: Json | null;
          instruction?: string;
          position: number;
          removed_at?: string | null;
          title?: string;
          wi_id: string;
        };
        Update: {
          id?: string;
          image?: Json | null;
          instruction?: string;
          position?: number;
          removed_at?: string | null;
          title?: string;
          wi_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "quality_wi_steps_wi_id_fkey";
            columns: ["wi_id"];
            isOneToOne: false;
            referencedRelation: "quality_work_instructions";
            referencedColumns: ["id"];
          },
        ];
      };
      quality_work_instructions: {
        Row: {
          created_at: string;
          created_by: string;
          department_id: string;
          document_number: string | null;
          has_changes: boolean;
          id: string;
          published_revision_id: string | null;
          purpose: string;
          responsibilities: string;
          title: string;
          updated_at: string;
          version: number;
          workspace_id: string;
        };
        Insert: {
          created_at?: string;
          created_by: string;
          department_id: string;
          document_number?: string | null;
          has_changes?: boolean;
          id: string;
          published_revision_id?: string | null;
          purpose?: string;
          responsibilities?: string;
          title?: string;
          updated_at?: string;
          version?: number;
          workspace_id: string;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          department_id?: string;
          document_number?: string | null;
          has_changes?: boolean;
          id?: string;
          published_revision_id?: string | null;
          purpose?: string;
          responsibilities?: string;
          title?: string;
          updated_at?: string;
          version?: number;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "quality_work_instructions_department_id_fkey";
            columns: ["department_id"];
            isOneToOne: false;
            referencedRelation: "departments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "quality_work_instructions_published_revision_id_fkey";
            columns: ["published_revision_id"];
            isOneToOne: false;
            referencedRelation: "quality_wi_revisions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "quality_work_instructions_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Functions: Database["public"]["Functions"] & {
      can_edit_quality_wi_department: {
        Args: { p_department: string };
        Returns: boolean;
      };
      can_read_quality_wi: { Args: { p_id: string }; Returns: boolean };
      create_quality_wi: {
        Args: {
          p_actor: string;
          p_department: string;
          p_id: string;
          p_workspace: string;
        };
        Returns: Json;
      };
      edit_quality_wi: {
        Args: {
          p_actor: string;
          p_expected_version: number;
          p_id: string;
          p_kind: string;
          p_operation: string;
          p_payload: Json;
        };
        Returns: Json;
      };
      load_quality_wi_document: {
        Args: { p_id: string; p_workspace: string };
        Returns: Json;
      };
      publish_quality_wi: {
        Args: {
          p_actor: string;
          p_description: string;
          p_expected_version: number;
          p_id: string;
          p_operation: string;
        };
        Returns: Json;
      };
      quality_wi_storage_access: {
        Args: { p_edit: boolean; p_name: string };
        Returns: boolean;
      };
    };
  };
};
