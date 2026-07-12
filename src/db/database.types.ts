export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
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
      deck: {
        Row: {
          created_at: string
          id: number
          name: string
          public_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: never
          name: string
          public_id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: never
          name?: string
          public_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      flashcard: {
        Row: {
          back: string
          created_at: string
          deck_id: number
          front: string
          generation_id: number | null
          id: number
          public_id: string
          source_id: number
          state_id: number
          updated_at: string
        }
        Insert: {
          back: string
          created_at?: string
          deck_id: number
          front: string
          generation_id?: number | null
          id?: never
          public_id?: string
          source_id: number
          state_id: number
          updated_at?: string
        }
        Update: {
          back?: string
          created_at?: string
          deck_id?: number
          front?: string
          generation_id?: number | null
          id?: never
          public_id?: string
          source_id?: number
          state_id?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "flashcard_deck_id_fkey"
            columns: ["deck_id"]
            isOneToOne: false
            referencedRelation: "deck"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flashcard_generation_id_fkey"
            columns: ["generation_id"]
            isOneToOne: false
            referencedRelation: "generation_session"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flashcard_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "flashcard_source"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flashcard_state_id_fkey"
            columns: ["state_id"]
            isOneToOne: false
            referencedRelation: "flashcard_state"
            referencedColumns: ["id"]
          },
        ]
      }
      flashcard_source: {
        Row: {
          code: string
          id: number
        }
        Insert: {
          code: string
          id: number
        }
        Update: {
          code?: string
          id?: number
        }
        Relationships: []
      }
      flashcard_state: {
        Row: {
          code: string
          id: number
        }
        Insert: {
          code: string
          id: number
        }
        Update: {
          code?: string
          id?: number
        }
        Relationships: []
      }
      generation_session: {
        Row: {
          created_at: string
          error_message: string | null
          generated_count: number
          id: number
          language: string
          model: string
          public_id: string
          request_payload: Json | null
          requested_count: number
          response_payload: Json | null
          saved_count: number
          source_text: string
          status: string
          user_id: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          generated_count: number
          id?: never
          language: string
          model: string
          public_id?: string
          request_payload?: Json | null
          requested_count: number
          response_payload?: Json | null
          saved_count: number
          source_text: string
          status: string
          user_id: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          generated_count?: number
          id?: never
          language?: string
          model?: string
          public_id?: string
          request_payload?: Json | null
          requested_count?: number
          response_payload?: Json | null
          saved_count?: number
          source_text?: string
          status?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
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

