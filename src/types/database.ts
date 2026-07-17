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
      barcode_mappings: {
        Row: {
          barcode: string
          created_at: string | null
          id: string
          target_id: string | null
          target_subtype: string | null
          target_table: string | null
          target_type: string | null
          tenant_id: string | null
          updated_at: string | null
        }
        Insert: {
          barcode: string
          created_at?: string | null
          id?: string
          target_id?: string | null
          target_subtype?: string | null
          target_table?: string | null
          target_type?: string | null
          tenant_id?: string | null
          updated_at?: string | null
        }
        Update: {
          barcode?: string
          created_at?: string | null
          id?: string
          target_id?: string | null
          target_subtype?: string | null
          target_table?: string | null
          target_type?: string | null
          tenant_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "barcode_mappings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_rule_tiers: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          max_charge: number | null
          max_days: number | null
          min_charge: number | null
          min_days: number
          rate: number
          rule_id: string | null
          tier_sequence: number | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          max_charge?: number | null
          max_days?: number | null
          min_charge?: number | null
          min_days: number
          rate: number
          rule_id?: string | null
          tier_sequence?: number | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          max_charge?: number | null
          max_days?: number | null
          min_charge?: number | null
          min_days?: number
          rate?: number
          rule_id?: string | null
          tier_sequence?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "billing_rule_tiers_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "billing_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_rules: {
        Row: {
          created_at: string | null
          currency: string | null
          effective_from: string
          effective_to: string | null
          id: string
          is_default: boolean | null
          rule_name: string
          tenant_id: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          currency?: string | null
          effective_from?: string
          effective_to?: string | null
          id?: string
          is_default?: boolean | null
          rule_name: string
          tenant_id?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          currency?: string | null
          effective_from?: string
          effective_to?: string | null
          id?: string
          is_default?: boolean | null
          rule_name?: string
          tenant_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "billing_rules_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_transactions: {
        Row: {
          amount: number | null
          calculation_basis: string | null
          created_at: string | null
          currency: string | null
          fee_type: string | null
          inv_id: string | null
          order_id: string | null
          status: string | null
          tenant_id: string | null
          trans_id: string
          updated_at: string | null
        }
        Insert: {
          amount?: number | null
          calculation_basis?: string | null
          created_at?: string | null
          currency?: string | null
          fee_type?: string | null
          inv_id?: string | null
          order_id?: string | null
          status?: string | null
          tenant_id?: string | null
          trans_id?: string
          updated_at?: string | null
        }
        Update: {
          amount?: number | null
          calculation_basis?: string | null
          created_at?: string | null
          currency?: string | null
          fee_type?: string | null
          inv_id?: string | null
          order_id?: string | null
          status?: string | null
          tenant_id?: string | null
          trans_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "billing_transactions_inv_id_fkey"
            columns: ["inv_id"]
            isOneToOne: false
            referencedRelation: "inventory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_transactions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_transactions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      consumable_usages: {
        Row: {
          id: string
          item_code: string | null
          item_type: string
          metadata: Json | null
          packing_task_id: string | null
          qty: number
          recorded_by: string | null
          tenant_id: string | null
          total_cost: number | null
          unit_cost: number | null
          updated_at: string | null
          used_at: string | null
        }
        Insert: {
          id?: string
          item_code?: string | null
          item_type: string
          metadata?: Json | null
          packing_task_id?: string | null
          qty: number
          recorded_by?: string | null
          tenant_id?: string | null
          total_cost?: number | null
          unit_cost?: number | null
          updated_at?: string | null
          used_at?: string | null
        }
        Update: {
          id?: string
          item_code?: string | null
          item_type?: string
          metadata?: Json | null
          packing_task_id?: string | null
          qty?: number
          recorded_by?: string | null
          tenant_id?: string | null
          total_cost?: number | null
          unit_cost?: number | null
          updated_at?: string | null
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "consumable_usages_packing_task_id_fkey"
            columns: ["packing_task_id"]
            isOneToOne: false
            referencedRelation: "packing_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consumable_usages_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consumable_usages_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      containers: {
        Row: {
          container_type: string | null
          created_at: string | null
          current_location_id: string | null
          id: string
          is_sealed: boolean | null
          last_opened_at: string | null
          lpn_code: string
          lpn_source: string
          parent_container_id: string | null
          status: string | null
          updated_at: string | null
        }
        Insert: {
          container_type?: string | null
          created_at?: string | null
          current_location_id?: string | null
          id?: string
          is_sealed?: boolean | null
          last_opened_at?: string | null
          lpn_code: string
          lpn_source?: string
          parent_container_id?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          container_type?: string | null
          created_at?: string | null
          current_location_id?: string | null
          id?: string
          is_sealed?: boolean | null
          last_opened_at?: string | null
          lpn_code?: string
          lpn_source?: string
          parent_container_id?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "containers_current_location_id_fkey"
            columns: ["current_location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "containers_current_location_id_fkey"
            columns: ["current_location_id"]
            isOneToOne: false
            referencedRelation: "v_replenishment_needs"
            referencedColumns: ["loc_id"]
          },
          {
            foreignKeyName: "containers_parent_container_id_fkey"
            columns: ["parent_container_id"]
            isOneToOne: false
            referencedRelation: "containers"
            referencedColumns: ["id"]
          },
        ]
      }
      cross_dock_jobs: {
        Row: {
          assigned_user_id: string | null
          created_at: string | null
          device_id: string | null
          fallback_reason: string | null
          id: string
          inbound_receipt_id: string | null
          matched_at: string | null
          matched_qty: number | null
          metadata: Json | null
          outbound_order_id: string | null
          qty: number
          shipped_at: string | null
          sku_id: string | null
          staging_loc_id: string | null
          status: string | null
          tenant_id: string | null
          timeout_at: string | null
          updated_at: string | null
        }
        Insert: {
          assigned_user_id?: string | null
          created_at?: string | null
          device_id?: string | null
          fallback_reason?: string | null
          id?: string
          inbound_receipt_id?: string | null
          matched_at?: string | null
          matched_qty?: number | null
          metadata?: Json | null
          outbound_order_id?: string | null
          qty: number
          shipped_at?: string | null
          sku_id?: string | null
          staging_loc_id?: string | null
          status?: string | null
          tenant_id?: string | null
          timeout_at?: string | null
          updated_at?: string | null
        }
        Update: {
          assigned_user_id?: string | null
          created_at?: string | null
          device_id?: string | null
          fallback_reason?: string | null
          id?: string
          inbound_receipt_id?: string | null
          matched_at?: string | null
          matched_qty?: number | null
          metadata?: Json | null
          outbound_order_id?: string | null
          qty?: number
          shipped_at?: string | null
          sku_id?: string | null
          staging_loc_id?: string | null
          status?: string | null
          tenant_id?: string | null
          timeout_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cross_dock_jobs_assigned_user_id_fkey"
            columns: ["assigned_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cross_dock_jobs_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cross_dock_jobs_inbound_receipt_id_fkey"
            columns: ["inbound_receipt_id"]
            isOneToOne: false
            referencedRelation: "inbound_receipts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cross_dock_jobs_outbound_order_id_fkey"
            columns: ["outbound_order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cross_dock_jobs_sku_id_fkey"
            columns: ["sku_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cross_dock_jobs_staging_loc_id_fkey"
            columns: ["staging_loc_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cross_dock_jobs_staging_loc_id_fkey"
            columns: ["staging_loc_id"]
            isOneToOne: false
            referencedRelation: "v_replenishment_needs"
            referencedColumns: ["loc_id"]
          },
          {
            foreignKeyName: "cross_dock_jobs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      device_sync_state: {
        Row: {
          device_id: string
          last_applied_seq: number
          last_pull_at: string | null
          last_push_at: string | null
          last_seen_online_at: string | null
          tenant_id: string | null
          updated_at: string | null
        }
        Insert: {
          device_id: string
          last_applied_seq?: number
          last_pull_at?: string | null
          last_push_at?: string | null
          last_seen_online_at?: string | null
          tenant_id?: string | null
          updated_at?: string | null
        }
        Update: {
          device_id?: string
          last_applied_seq?: number
          last_pull_at?: string | null
          last_push_at?: string | null
          last_seen_online_at?: string | null
          tenant_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "device_sync_state_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: true
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "device_sync_state_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      devices: {
        Row: {
          created_at: string | null
          device_code: string
          device_type: string
          id: string
          is_active: boolean | null
          tenant_id: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          device_code: string
          device_type: string
          id?: string
          is_active?: boolean | null
          tenant_id?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          device_code?: string
          device_type?: string
          id?: string
          is_active?: boolean | null
          tenant_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "devices_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      exception_events: {
        Row: {
          actor_user_id: string | null
          created_at: string | null
          event_type: string
          exception_id: string | null
          from_status: string | null
          id: number
          metadata: Json | null
          note: string | null
          tenant_id: string | null
          to_status: string | null
        }
        Insert: {
          actor_user_id?: string | null
          created_at?: string | null
          event_type: string
          exception_id?: string | null
          from_status?: string | null
          id?: number
          metadata?: Json | null
          note?: string | null
          tenant_id?: string | null
          to_status?: string | null
        }
        Update: {
          actor_user_id?: string | null
          created_at?: string | null
          event_type?: string
          exception_id?: string | null
          from_status?: string | null
          id?: number
          metadata?: Json | null
          note?: string | null
          tenant_id?: string | null
          to_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "exception_events_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exception_events_exception_id_fkey"
            columns: ["exception_id"]
            isOneToOne: false
            referencedRelation: "exceptions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exception_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      exception_type_catalog: {
        Row: {
          code: string
          created_at: string | null
          default_severity: string
          description: string | null
          domain: string
          id: string
          is_active: boolean | null
          required_permission_action: string | null
          required_permission_resource: string | null
          tenant_id: string | null
          updated_at: string | null
        }
        Insert: {
          code: string
          created_at?: string | null
          default_severity?: string
          description?: string | null
          domain: string
          id?: string
          is_active?: boolean | null
          required_permission_action?: string | null
          required_permission_resource?: string | null
          tenant_id?: string | null
          updated_at?: string | null
        }
        Update: {
          code?: string
          created_at?: string | null
          default_severity?: string
          description?: string | null
          domain?: string
          id?: string
          is_active?: boolean | null
          required_permission_action?: string | null
          required_permission_resource?: string | null
          tenant_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "exception_type_catalog_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      exceptions: {
        Row: {
          assigned_to: string | null
          created_at: string | null
          details: Json | null
          domain: string
          exception_type: string
          id: string
          raised_by: string | null
          resolution_action: string | null
          resolution_notes: string | null
          resolved_at: string | null
          resolved_by: string | null
          severity: string
          source_id: string | null
          source_table: string | null
          status: string
          tenant_id: string | null
          title: string | null
          updated_at: string | null
        }
        Insert: {
          assigned_to?: string | null
          created_at?: string | null
          details?: Json | null
          domain: string
          exception_type: string
          id?: string
          raised_by?: string | null
          resolution_action?: string | null
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity: string
          source_id?: string | null
          source_table?: string | null
          status?: string
          tenant_id?: string | null
          title?: string | null
          updated_at?: string | null
        }
        Update: {
          assigned_to?: string | null
          created_at?: string | null
          details?: Json | null
          domain?: string
          exception_type?: string
          id?: string
          raised_by?: string | null
          resolution_action?: string | null
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          source_id?: string | null
          source_table?: string | null
          status?: string
          tenant_id?: string | null
          title?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "exceptions_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exceptions_raised_by_fkey"
            columns: ["raised_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exceptions_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exceptions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      inbound_receipts: {
        Row: {
          created_at: string | null
          expected_at: string | null
          id: string
          metadata: Json | null
          receipt_no: string
          received_at: string | null
          status: string | null
          supplier_name: string | null
          tenant_id: string | null
          updated_at: string | null
          wave_id: string | null
        }
        Insert: {
          created_at?: string | null
          expected_at?: string | null
          id?: string
          metadata?: Json | null
          receipt_no: string
          received_at?: string | null
          status?: string | null
          supplier_name?: string | null
          tenant_id?: string | null
          updated_at?: string | null
          wave_id?: string | null
        }
        Update: {
          created_at?: string | null
          expected_at?: string | null
          id?: string
          metadata?: Json | null
          receipt_no?: string
          received_at?: string | null
          status?: string | null
          supplier_name?: string | null
          tenant_id?: string | null
          updated_at?: string | null
          wave_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inbound_receipts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbound_receipts_wave_id_fkey"
            columns: ["wave_id"]
            isOneToOne: false
            referencedRelation: "v_fulfillment_chain_progress"
            referencedColumns: ["wave_id"]
          },
          {
            foreignKeyName: "inbound_receipts_wave_id_fkey"
            columns: ["wave_id"]
            isOneToOne: false
            referencedRelation: "waves"
            referencedColumns: ["id"]
          },
        ]
      }
      inspection_items: {
        Row: {
          actual_value: Json | null
          check_type: string
          checked_at: string | null
          checked_by: string | null
          expected_value: Json | null
          id: string
          inspection_id: string | null
          metadata: Json | null
          notes: string | null
          passed: boolean | null
          photos: string[] | null
          tenant_id: string | null
          tolerance_pct: number | null
          updated_at: string | null
        }
        Insert: {
          actual_value?: Json | null
          check_type: string
          checked_at?: string | null
          checked_by?: string | null
          expected_value?: Json | null
          id?: string
          inspection_id?: string | null
          metadata?: Json | null
          notes?: string | null
          passed?: boolean | null
          photos?: string[] | null
          tenant_id?: string | null
          tolerance_pct?: number | null
          updated_at?: string | null
        }
        Update: {
          actual_value?: Json | null
          check_type?: string
          checked_at?: string | null
          checked_by?: string | null
          expected_value?: Json | null
          id?: string
          inspection_id?: string | null
          metadata?: Json | null
          notes?: string | null
          passed?: boolean | null
          photos?: string[] | null
          tenant_id?: string | null
          tolerance_pct?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inspection_items_checked_by_fkey"
            columns: ["checked_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspection_items_inspection_id_fkey"
            columns: ["inspection_id"]
            isOneToOne: false
            referencedRelation: "quality_inspections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspection_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory: {
        Row: {
          batch_no: string | null
          container_id: string | null
          created_at: string | null
          exp_date: string | null
          id: string
          location_id: string | null
          mfg_date: string | null
          picking_priority: number | null
          product_id: string | null
          quantity: number
          tenant_id: string | null
          updated_at: string | null
          version: number | null
        }
        Insert: {
          batch_no?: string | null
          container_id?: string | null
          created_at?: string | null
          exp_date?: string | null
          id?: string
          location_id?: string | null
          mfg_date?: string | null
          picking_priority?: number | null
          product_id?: string | null
          quantity?: number
          tenant_id?: string | null
          updated_at?: string | null
          version?: number | null
        }
        Update: {
          batch_no?: string | null
          container_id?: string | null
          created_at?: string | null
          exp_date?: string | null
          id?: string
          location_id?: string | null
          mfg_date?: string | null
          picking_priority?: number | null
          product_id?: string | null
          quantity?: number
          tenant_id?: string | null
          updated_at?: string | null
          version?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_container_id_fkey"
            columns: ["container_id"]
            isOneToOne: false
            referencedRelation: "containers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "v_replenishment_needs"
            referencedColumns: ["loc_id"]
          },
          {
            foreignKeyName: "inventory_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_count_policies: {
        Row: {
          created_at: string | null
          id: string
          product_id: string | null
          tenant_id: string | null
          tolerance_qty: number
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          product_id?: string | null
          tenant_id?: string | null
          tolerance_qty?: number
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          product_id?: string | null
          tenant_id?: string | null
          tolerance_qty?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_count_policies_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_count_policies_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_history: {
        Row: {
          after_qty: number
          before_qty: number
          change_qty: number
          change_reason: string | null
          change_type: string
          changed_at: string | null
          hist_id: number
          inv_id: string | null
        }
        Insert: {
          after_qty: number
          before_qty: number
          change_qty: number
          change_reason?: string | null
          change_type: string
          changed_at?: string | null
          hist_id?: number
          inv_id?: string | null
        }
        Update: {
          after_qty?: number
          before_qty?: number
          change_qty?: number
          change_reason?: string | null
          change_type?: string
          changed_at?: string | null
          hist_id?: number
          inv_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_history_inv_id_fkey"
            columns: ["inv_id"]
            isOneToOne: false
            referencedRelation: "inventory"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_locks: {
        Row: {
          created_at: string | null
          expires_at: string | null
          id: string
          inventory_id: string | null
          is_active: boolean | null
          lock_type: string | null
          locked_by: string | null
          reason: string | null
          target_id: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          expires_at?: string | null
          id?: string
          inventory_id?: string | null
          is_active?: boolean | null
          lock_type?: string | null
          locked_by?: string | null
          reason?: string | null
          target_id?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          expires_at?: string | null
          id?: string
          inventory_id?: string | null
          is_active?: boolean | null
          lock_type?: string | null
          locked_by?: string | null
          reason?: string | null
          target_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_locks_inventory_id_fkey"
            columns: ["inventory_id"]
            isOneToOne: false
            referencedRelation: "inventory"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_reservations: {
        Row: {
          created_at: string | null
          expires_at: string | null
          id: string
          inventory_id: string | null
          order_id: string | null
          reserved_qty: number | null
          status: string | null
          updated_at: string | null
          work_order_id: string | null
        }
        Insert: {
          created_at?: string | null
          expires_at?: string | null
          id?: string
          inventory_id?: string | null
          order_id?: string | null
          reserved_qty?: number | null
          status?: string | null
          updated_at?: string | null
          work_order_id?: string | null
        }
        Update: {
          created_at?: string | null
          expires_at?: string | null
          id?: string
          inventory_id?: string | null
          order_id?: string | null
          reserved_qty?: number | null
          status?: string | null
          updated_at?: string | null
          work_order_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_reservations_inventory_id_fkey"
            columns: ["inventory_id"]
            isOneToOne: false
            referencedRelation: "inventory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_reservations_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_reservations_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "work_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      label_templates: {
        Row: {
          carrier: string
          created_at: string | null
          fields_mapping: Json | null
          format: string | null
          id: string
          is_active: boolean | null
          is_default: boolean | null
          metadata: Json | null
          paper_size: Json | null
          template_content: string
          template_name: string
          tenant_id: string | null
          updated_at: string | null
          version: number | null
        }
        Insert: {
          carrier: string
          created_at?: string | null
          fields_mapping?: Json | null
          format?: string | null
          id?: string
          is_active?: boolean | null
          is_default?: boolean | null
          metadata?: Json | null
          paper_size?: Json | null
          template_content: string
          template_name: string
          tenant_id?: string | null
          updated_at?: string | null
          version?: number | null
        }
        Update: {
          carrier?: string
          created_at?: string | null
          fields_mapping?: Json | null
          format?: string | null
          id?: string
          is_active?: boolean | null
          is_default?: boolean | null
          metadata?: Json | null
          paper_size?: Json | null
          template_content?: string
          template_name?: string
          tenant_id?: string | null
          updated_at?: string | null
          version?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "label_templates_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      loading_tasks: {
        Row: {
          actual_volume: number | null
          actual_weight: number | null
          compartment_id: string | null
          completed_at: string | null
          created_at: string | null
          departed_at: string | null
          device_id: string | null
          exception_reason: string | null
          id: string
          load_sequence: number | null
          loader_id: string | null
          metadata: Json | null
          order_ids: string[] | null
          planned_volume: number | null
          planned_weight: number | null
          seal_number: string | null
          started_at: string | null
          status: string | null
          tenant_id: string | null
          updated_at: string | null
          vehicle_id: string | null
          wave_id: string | null
        }
        Insert: {
          actual_volume?: number | null
          actual_weight?: number | null
          compartment_id?: string | null
          completed_at?: string | null
          created_at?: string | null
          departed_at?: string | null
          device_id?: string | null
          exception_reason?: string | null
          id?: string
          load_sequence?: number | null
          loader_id?: string | null
          metadata?: Json | null
          order_ids?: string[] | null
          planned_volume?: number | null
          planned_weight?: number | null
          seal_number?: string | null
          started_at?: string | null
          status?: string | null
          tenant_id?: string | null
          updated_at?: string | null
          vehicle_id?: string | null
          wave_id?: string | null
        }
        Update: {
          actual_volume?: number | null
          actual_weight?: number | null
          compartment_id?: string | null
          completed_at?: string | null
          created_at?: string | null
          departed_at?: string | null
          device_id?: string | null
          exception_reason?: string | null
          id?: string
          load_sequence?: number | null
          loader_id?: string | null
          metadata?: Json | null
          order_ids?: string[] | null
          planned_volume?: number | null
          planned_weight?: number | null
          seal_number?: string | null
          started_at?: string | null
          status?: string | null
          tenant_id?: string | null
          updated_at?: string | null
          vehicle_id?: string | null
          wave_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "loading_tasks_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loading_tasks_loader_id_fkey"
            columns: ["loader_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loading_tasks_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loading_tasks_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loading_tasks_wave_id_fkey"
            columns: ["wave_id"]
            isOneToOne: false
            referencedRelation: "v_fulfillment_chain_progress"
            referencedColumns: ["wave_id"]
          },
          {
            foreignKeyName: "loading_tasks_wave_id_fkey"
            columns: ["wave_id"]
            isOneToOne: false
            referencedRelation: "waves"
            referencedColumns: ["id"]
          },
        ]
      }
      locations: {
        Row: {
          code: string
          created_at: string | null
          force_unique_tracking: boolean
          id: string
          is_active: boolean | null
          is_frozen: boolean | null
          max_volume_capacity: number | null
          max_weight_capacity: number | null
          picking_max_qty: number | null
          picking_threshold_pct: number | null
          tenant_id: string | null
          travel_sequence: number | null
          updated_at: string | null
          zone_abc_type: string | null
          zone_type: string | null
        }
        Insert: {
          code: string
          created_at?: string | null
          force_unique_tracking?: boolean
          id?: string
          is_active?: boolean | null
          is_frozen?: boolean | null
          max_volume_capacity?: number | null
          max_weight_capacity?: number | null
          picking_max_qty?: number | null
          picking_threshold_pct?: number | null
          tenant_id?: string | null
          travel_sequence?: number | null
          updated_at?: string | null
          zone_abc_type?: string | null
          zone_type?: string | null
        }
        Update: {
          code?: string
          created_at?: string | null
          force_unique_tracking?: boolean
          id?: string
          is_active?: boolean | null
          is_frozen?: boolean | null
          max_volume_capacity?: number | null
          max_weight_capacity?: number | null
          picking_max_qty?: number | null
          picking_threshold_pct?: number | null
          tenant_id?: string | null
          travel_sequence?: number | null
          updated_at?: string | null
          zone_abc_type?: string | null
          zone_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "locations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      order_lines: {
        Row: {
          created_at: string | null
          id: string
          order_id: string | null
          product_id: string | null
          qty: number
          status: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          order_id?: string | null
          product_id?: string | null
          qty: number
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          order_id?: string | null
          product_id?: string | null
          qty?: number
          status?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_lines_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          created_at: string | null
          cutoff_time: string | null
          external_order_id: string
          id: string
          order_type: string
          platform_priority: number | null
          status: string | null
          tenant_id: string | null
          tracking_no: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          cutoff_time?: string | null
          external_order_id: string
          id?: string
          order_type: string
          platform_priority?: number | null
          status?: string | null
          tenant_id?: string | null
          tracking_no?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          cutoff_time?: string | null
          external_order_id?: string
          id?: string
          order_type?: string
          platform_priority?: number | null
          status?: string | null
          tenant_id?: string | null
          tracking_no?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      package_specs: {
        Row: {
          box_code: string | null
          box_type: string
          created_at: string | null
          dims: Json
          dunnage_type: string | null
          id: string
          is_active: boolean | null
          is_default: boolean | null
          label_position: Json | null
          max_qty: number
          max_weight: number | null
          metadata: Json | null
          priority: number | null
          seal_type: string | null
          sku_id: string | null
          tenant_id: string | null
          updated_at: string | null
          weight: number | null
        }
        Insert: {
          box_code?: string | null
          box_type: string
          created_at?: string | null
          dims: Json
          dunnage_type?: string | null
          id?: string
          is_active?: boolean | null
          is_default?: boolean | null
          label_position?: Json | null
          max_qty: number
          max_weight?: number | null
          metadata?: Json | null
          priority?: number | null
          seal_type?: string | null
          sku_id?: string | null
          tenant_id?: string | null
          updated_at?: string | null
          weight?: number | null
        }
        Update: {
          box_code?: string | null
          box_type?: string
          created_at?: string | null
          dims?: Json
          dunnage_type?: string | null
          id?: string
          is_active?: boolean | null
          is_default?: boolean | null
          label_position?: Json | null
          max_qty?: number
          max_weight?: number | null
          metadata?: Json | null
          priority?: number | null
          seal_type?: string | null
          sku_id?: string | null
          tenant_id?: string | null
          updated_at?: string | null
          weight?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "package_specs_sku_id_fkey"
            columns: ["sku_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "package_specs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      packing_task_items: {
        Row: {
          container_id: string | null
          created_at: string | null
          id: string
          order_line_id: string | null
          packing_task_id: string | null
          product_id: string | null
          qty: number
          tenant_id: string | null
          updated_at: string | null
        }
        Insert: {
          container_id?: string | null
          created_at?: string | null
          id?: string
          order_line_id?: string | null
          packing_task_id?: string | null
          product_id?: string | null
          qty: number
          tenant_id?: string | null
          updated_at?: string | null
        }
        Update: {
          container_id?: string | null
          created_at?: string | null
          id?: string
          order_line_id?: string | null
          packing_task_id?: string | null
          product_id?: string | null
          qty?: number
          tenant_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "packing_task_items_container_id_fkey"
            columns: ["container_id"]
            isOneToOne: false
            referencedRelation: "containers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "packing_task_items_order_line_id_fkey"
            columns: ["order_line_id"]
            isOneToOne: false
            referencedRelation: "order_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "packing_task_items_packing_task_id_fkey"
            columns: ["packing_task_id"]
            isOneToOne: false
            referencedRelation: "packing_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "packing_task_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "packing_task_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      packing_tasks: {
        Row: {
          boxes_packed: number | null
          carrier: string | null
          completed_at: string | null
          created_at: string | null
          device_id: string | null
          exception_reason: string | null
          id: string
          labels_printed: number | null
          metadata: Json | null
          order_id: string | null
          package_spec_id: string | null
          packer_id: string | null
          started_at: string | null
          status: string | null
          tenant_id: string | null
          total_boxes: number | null
          total_volume: number | null
          total_weight: number | null
          tracking_numbers: string[] | null
          updated_at: string | null
          wave_id: string | null
        }
        Insert: {
          boxes_packed?: number | null
          carrier?: string | null
          completed_at?: string | null
          created_at?: string | null
          device_id?: string | null
          exception_reason?: string | null
          id?: string
          labels_printed?: number | null
          metadata?: Json | null
          order_id?: string | null
          package_spec_id?: string | null
          packer_id?: string | null
          started_at?: string | null
          status?: string | null
          tenant_id?: string | null
          total_boxes?: number | null
          total_volume?: number | null
          total_weight?: number | null
          tracking_numbers?: string[] | null
          updated_at?: string | null
          wave_id?: string | null
        }
        Update: {
          boxes_packed?: number | null
          carrier?: string | null
          completed_at?: string | null
          created_at?: string | null
          device_id?: string | null
          exception_reason?: string | null
          id?: string
          labels_printed?: number | null
          metadata?: Json | null
          order_id?: string | null
          package_spec_id?: string | null
          packer_id?: string | null
          started_at?: string | null
          status?: string | null
          tenant_id?: string | null
          total_boxes?: number | null
          total_volume?: number | null
          total_weight?: number | null
          tracking_numbers?: string[] | null
          updated_at?: string | null
          wave_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "packing_tasks_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "packing_tasks_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "packing_tasks_package_spec_id_fkey"
            columns: ["package_spec_id"]
            isOneToOne: false
            referencedRelation: "package_specs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "packing_tasks_packer_id_fkey"
            columns: ["packer_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "packing_tasks_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "packing_tasks_wave_id_fkey"
            columns: ["wave_id"]
            isOneToOne: false
            referencedRelation: "v_fulfillment_chain_progress"
            referencedColumns: ["wave_id"]
          },
          {
            foreignKeyName: "packing_tasks_wave_id_fkey"
            columns: ["wave_id"]
            isOneToOne: false
            referencedRelation: "waves"
            referencedColumns: ["id"]
          },
        ]
      }
      permissions: {
        Row: {
          action: string
          created_at: string | null
          description: string | null
          id: string
          resource: string
        }
        Insert: {
          action: string
          created_at?: string | null
          description?: string | null
          id?: string
          resource: string
        }
        Update: {
          action?: string
          created_at?: string | null
          description?: string | null
          id?: string
          resource?: string
        }
        Relationships: []
      }
      product_constraints: {
        Row: {
          expiry_threshold_days: number | null
          hazmat_incompatibility_tags: string[] | null
          hs_code: string | null
          is_dangerous: boolean | null
          max_out_fridge_seconds: number | null
          must_scan_sn: boolean | null
          product_id: string
          required_zone_type: string | null
          requires_unique_tracking: boolean | null
          storage_temp_range: string | null
          updated_at: string | null
        }
        Insert: {
          expiry_threshold_days?: number | null
          hazmat_incompatibility_tags?: string[] | null
          hs_code?: string | null
          is_dangerous?: boolean | null
          max_out_fridge_seconds?: number | null
          must_scan_sn?: boolean | null
          product_id: string
          required_zone_type?: string | null
          requires_unique_tracking?: boolean | null
          storage_temp_range?: string | null
          updated_at?: string | null
        }
        Update: {
          expiry_threshold_days?: number | null
          hazmat_incompatibility_tags?: string[] | null
          hs_code?: string | null
          is_dangerous?: boolean | null
          max_out_fridge_seconds?: number | null
          must_scan_sn?: boolean | null
          product_id?: string
          required_zone_type?: string | null
          requires_unique_tracking?: boolean | null
          storage_temp_range?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_constraints_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: true
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          abc_class: string | null
          created_at: string | null
          id: string
          is_serial_required: boolean | null
          name: string
          sku: string
          tenant_id: string | null
          unit_volume: number | null
          unit_weight: number | null
          updated_at: string | null
        }
        Insert: {
          abc_class?: string | null
          created_at?: string | null
          id?: string
          is_serial_required?: boolean | null
          name: string
          sku: string
          tenant_id?: string | null
          unit_volume?: number | null
          unit_weight?: number | null
          updated_at?: string | null
        }
        Update: {
          abc_class?: string | null
          created_at?: string | null
          id?: string
          is_serial_required?: boolean | null
          name?: string
          sku?: string
          tenant_id?: string | null
          unit_volume?: number | null
          unit_weight?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "products_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      quality_inspections: {
        Row: {
          completed_at: string | null
          created_at: string | null
          device_id: string | null
          discrepancy_details: Json | null
          id: string
          inspection_no: string
          inspector_id: string | null
          metadata: Json | null
          notes: string | null
          order_id: string | null
          photos: string[] | null
          result: string | null
          sku_id: string | null
          started_at: string | null
          status: string | null
          tenant_id: string | null
          updated_at: string | null
          wave_id: string | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string | null
          device_id?: string | null
          discrepancy_details?: Json | null
          id?: string
          inspection_no: string
          inspector_id?: string | null
          metadata?: Json | null
          notes?: string | null
          order_id?: string | null
          photos?: string[] | null
          result?: string | null
          sku_id?: string | null
          started_at?: string | null
          status?: string | null
          tenant_id?: string | null
          updated_at?: string | null
          wave_id?: string | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string | null
          device_id?: string | null
          discrepancy_details?: Json | null
          id?: string
          inspection_no?: string
          inspector_id?: string | null
          metadata?: Json | null
          notes?: string | null
          order_id?: string | null
          photos?: string[] | null
          result?: string | null
          sku_id?: string | null
          started_at?: string | null
          status?: string | null
          tenant_id?: string | null
          updated_at?: string | null
          wave_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quality_inspections_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quality_inspections_inspector_id_fkey"
            columns: ["inspector_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quality_inspections_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quality_inspections_sku_id_fkey"
            columns: ["sku_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quality_inspections_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quality_inspections_wave_id_fkey"
            columns: ["wave_id"]
            isOneToOne: false
            referencedRelation: "v_fulfillment_chain_progress"
            referencedColumns: ["wave_id"]
          },
          {
            foreignKeyName: "quality_inspections_wave_id_fkey"
            columns: ["wave_id"]
            isOneToOne: false
            referencedRelation: "waves"
            referencedColumns: ["id"]
          },
        ]
      }
      role_permissions: {
        Row: {
          created_at: string | null
          permission_id: string
          role_id: string
        }
        Insert: {
          created_at?: string | null
          permission_id: string
          role_id: string
        }
        Update: {
          created_at?: string | null
          permission_id?: string
          role_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_permission_id_fkey"
            columns: ["permission_id"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "role_permissions_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      roles: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          name: string
          tenant_id: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          name: string
          tenant_id?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          name?: string
          tenant_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "roles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      shipping_documents: {
        Row: {
          content: Json
          doc_number: string
          doc_type: string
          file_url: string | null
          id: string
          issued_at: string | null
          issued_by: string | null
          loading_task_id: string | null
          metadata: Json | null
          status: string | null
          tenant_id: string | null
          updated_at: string | null
        }
        Insert: {
          content: Json
          doc_number: string
          doc_type: string
          file_url?: string | null
          id?: string
          issued_at?: string | null
          issued_by?: string | null
          loading_task_id?: string | null
          metadata?: Json | null
          status?: string | null
          tenant_id?: string | null
          updated_at?: string | null
        }
        Update: {
          content?: Json
          doc_number?: string
          doc_type?: string
          file_url?: string | null
          id?: string
          issued_at?: string | null
          issued_by?: string | null
          loading_task_id?: string | null
          metadata?: Json | null
          status?: string | null
          tenant_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shipping_documents_issued_by_fkey"
            columns: ["issued_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipping_documents_loading_task_id_fkey"
            columns: ["loading_task_id"]
            isOneToOne: false
            referencedRelation: "loading_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipping_documents_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      sorting_chutes: {
        Row: {
          capacity: number | null
          chute_code: string
          conveyor_id: string | null
          created_at: string | null
          current_qty: number | null
          id: string
          metadata: Json | null
          sort_sequence: number | null
          station_id: string | null
          status: string | null
          target_id: string | null
          target_type: string
          tenant_id: string | null
          updated_at: string | null
          wave_id: string | null
        }
        Insert: {
          capacity?: number | null
          chute_code: string
          conveyor_id?: string | null
          created_at?: string | null
          current_qty?: number | null
          id?: string
          metadata?: Json | null
          sort_sequence?: number | null
          station_id?: string | null
          status?: string | null
          target_id?: string | null
          target_type: string
          tenant_id?: string | null
          updated_at?: string | null
          wave_id?: string | null
        }
        Update: {
          capacity?: number | null
          chute_code?: string
          conveyor_id?: string | null
          created_at?: string | null
          current_qty?: number | null
          id?: string
          metadata?: Json | null
          sort_sequence?: number | null
          station_id?: string | null
          status?: string | null
          target_id?: string | null
          target_type?: string
          tenant_id?: string | null
          updated_at?: string | null
          wave_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sorting_chutes_conveyor_id_fkey"
            columns: ["conveyor_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sorting_chutes_station_id_fkey"
            columns: ["station_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sorting_chutes_station_id_fkey"
            columns: ["station_id"]
            isOneToOne: false
            referencedRelation: "v_replenishment_needs"
            referencedColumns: ["loc_id"]
          },
          {
            foreignKeyName: "sorting_chutes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sorting_chutes_wave_id_fkey"
            columns: ["wave_id"]
            isOneToOne: false
            referencedRelation: "v_fulfillment_chain_progress"
            referencedColumns: ["wave_id"]
          },
          {
            foreignKeyName: "sorting_chutes_wave_id_fkey"
            columns: ["wave_id"]
            isOneToOne: false
            referencedRelation: "waves"
            referencedColumns: ["id"]
          },
        ]
      }
      sorting_tasks: {
        Row: {
          assigned_user_id: string | null
          chute_id: string | null
          completed_at: string | null
          created_at: string | null
          device_id: string | null
          exception_reason: string | null
          from_loc_id: string | null
          id: string
          metadata: Json | null
          order_id: string | null
          priority: number | null
          qty: number
          serial_numbers: string[] | null
          sku_id: string | null
          sorted_qty: number | null
          started_at: string | null
          status: string | null
          tenant_id: string | null
          updated_at: string | null
          wave_id: string | null
        }
        Insert: {
          assigned_user_id?: string | null
          chute_id?: string | null
          completed_at?: string | null
          created_at?: string | null
          device_id?: string | null
          exception_reason?: string | null
          from_loc_id?: string | null
          id?: string
          metadata?: Json | null
          order_id?: string | null
          priority?: number | null
          qty: number
          serial_numbers?: string[] | null
          sku_id?: string | null
          sorted_qty?: number | null
          started_at?: string | null
          status?: string | null
          tenant_id?: string | null
          updated_at?: string | null
          wave_id?: string | null
        }
        Update: {
          assigned_user_id?: string | null
          chute_id?: string | null
          completed_at?: string | null
          created_at?: string | null
          device_id?: string | null
          exception_reason?: string | null
          from_loc_id?: string | null
          id?: string
          metadata?: Json | null
          order_id?: string | null
          priority?: number | null
          qty?: number
          serial_numbers?: string[] | null
          sku_id?: string | null
          sorted_qty?: number | null
          started_at?: string | null
          status?: string | null
          tenant_id?: string | null
          updated_at?: string | null
          wave_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sorting_tasks_assigned_user_id_fkey"
            columns: ["assigned_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sorting_tasks_chute_id_fkey"
            columns: ["chute_id"]
            isOneToOne: false
            referencedRelation: "sorting_chutes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sorting_tasks_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sorting_tasks_from_loc_id_fkey"
            columns: ["from_loc_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sorting_tasks_from_loc_id_fkey"
            columns: ["from_loc_id"]
            isOneToOne: false
            referencedRelation: "v_replenishment_needs"
            referencedColumns: ["loc_id"]
          },
          {
            foreignKeyName: "sorting_tasks_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sorting_tasks_sku_id_fkey"
            columns: ["sku_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sorting_tasks_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sorting_tasks_wave_id_fkey"
            columns: ["wave_id"]
            isOneToOne: false
            referencedRelation: "v_fulfillment_chain_progress"
            referencedColumns: ["wave_id"]
          },
          {
            foreignKeyName: "sorting_tasks_wave_id_fkey"
            columns: ["wave_id"]
            isOneToOne: false
            referencedRelation: "waves"
            referencedColumns: ["id"]
          },
        ]
      }
      sorting_waves: {
        Row: {
          completed_at: string | null
          completed_tasks: number | null
          created_at: string | null
          id: string
          metadata: Json | null
          sorted_qty: number | null
          started_at: string | null
          status: string | null
          strategy_config: Json | null
          tenant_id: string | null
          total_qty: number | null
          total_tasks: number | null
          updated_at: string | null
          wave_id: string | null
        }
        Insert: {
          completed_at?: string | null
          completed_tasks?: number | null
          created_at?: string | null
          id?: string
          metadata?: Json | null
          sorted_qty?: number | null
          started_at?: string | null
          status?: string | null
          strategy_config?: Json | null
          tenant_id?: string | null
          total_qty?: number | null
          total_tasks?: number | null
          updated_at?: string | null
          wave_id?: string | null
        }
        Update: {
          completed_at?: string | null
          completed_tasks?: number | null
          created_at?: string | null
          id?: string
          metadata?: Json | null
          sorted_qty?: number | null
          started_at?: string | null
          status?: string | null
          strategy_config?: Json | null
          tenant_id?: string | null
          total_qty?: number | null
          total_tasks?: number | null
          updated_at?: string | null
          wave_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sorting_waves_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sorting_waves_wave_id_fkey"
            columns: ["wave_id"]
            isOneToOne: false
            referencedRelation: "v_fulfillment_chain_progress"
            referencedColumns: ["wave_id"]
          },
          {
            foreignKeyName: "sorting_waves_wave_id_fkey"
            columns: ["wave_id"]
            isOneToOne: false
            referencedRelation: "waves"
            referencedColumns: ["id"]
          },
        ]
      }
      sync_events: {
        Row: {
          action_type: string
          applied_at: string | null
          captured_at: string
          device_id: string | null
          device_seq: number
          id: string
          operator_user_id: string | null
          payload: Json
          received_at: string | null
          status: string
          tenant_id: string | null
        }
        Insert: {
          action_type: string
          applied_at?: string | null
          captured_at: string
          device_id?: string | null
          device_seq: number
          id: string
          operator_user_id?: string | null
          payload: Json
          received_at?: string | null
          status?: string
          tenant_id?: string | null
        }
        Update: {
          action_type?: string
          applied_at?: string | null
          captured_at?: string
          device_id?: string | null
          device_seq?: number
          id?: string
          operator_user_id?: string | null
          payload?: Json
          received_at?: string | null
          status?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sync_events_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sync_events_operator_user_id_fkey"
            columns: ["operator_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sync_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      sync_policies: {
        Row: {
          created_at: string | null
          id: string
          max_offline_duration_seconds: number | null
          offline_mode: string
          priority: number
          task_type: string | null
          tenant_id: string | null
          updated_at: string | null
          zone_type: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          max_offline_duration_seconds?: number | null
          offline_mode?: string
          priority?: number
          task_type?: string | null
          tenant_id?: string | null
          updated_at?: string | null
          zone_type?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          max_offline_duration_seconds?: number | null
          offline_mode?: string
          priority?: number
          task_type?: string | null
          tenant_id?: string | null
          updated_at?: string | null
          zone_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sync_policies_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      task_claims: {
        Row: {
          claimed_at: string | null
          claimed_by_device_id: string | null
          claimed_by_user_id: string | null
          created_at: string | null
          expires_at: string
          id: string
          released_at: string | null
          status: string
          tenant_id: string | null
          updated_at: string | null
          work_order_id: string | null
        }
        Insert: {
          claimed_at?: string | null
          claimed_by_device_id?: string | null
          claimed_by_user_id?: string | null
          created_at?: string | null
          expires_at: string
          id?: string
          released_at?: string | null
          status?: string
          tenant_id?: string | null
          updated_at?: string | null
          work_order_id?: string | null
        }
        Update: {
          claimed_at?: string | null
          claimed_by_device_id?: string | null
          claimed_by_user_id?: string | null
          created_at?: string | null
          expires_at?: string
          id?: string
          released_at?: string | null
          status?: string
          tenant_id?: string | null
          updated_at?: string | null
          work_order_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "task_claims_claimed_by_device_id_fkey"
            columns: ["claimed_by_device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_claims_claimed_by_user_id_fkey"
            columns: ["claimed_by_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_claims_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_claims_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "work_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_tracking_policies: {
        Row: {
          abc_class: string
          created_at: string | null
          id: string
          requires_unique_tracking: boolean
          tenant_id: string | null
          updated_at: string | null
        }
        Insert: {
          abc_class: string
          created_at?: string | null
          id?: string
          requires_unique_tracking: boolean
          tenant_id?: string | null
          updated_at?: string | null
        }
        Update: {
          abc_class?: string
          created_at?: string | null
          id?: string
          requires_unique_tracking?: boolean
          tenant_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tenant_tracking_policies_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          billing_strategy: Json | null
          contact_info: Json | null
          created_at: string | null
          id: string
          is_active: boolean | null
          name: string
          updated_at: string | null
        }
        Insert: {
          billing_strategy?: Json | null
          contact_info?: Json | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          updated_at?: string | null
        }
        Update: {
          billing_strategy?: Json | null
          contact_info?: Json | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string | null
          role_id: string
          scope: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          role_id: string
          scope?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          role_id?: string
          scope?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_roles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          created_at: string | null
          id: string
          is_active: boolean | null
          is_system_user: boolean | null
          password_hash: string
          role: string | null
          tenant_id: string | null
          updated_at: string | null
          username: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          is_system_user?: boolean | null
          password_hash: string
          role?: string | null
          tenant_id?: string | null
          updated_at?: string | null
          username: string
        }
        Update: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          is_system_user?: boolean | null
          password_hash?: string
          role?: string | null
          tenant_id?: string | null
          updated_at?: string | null
          username?: string
        }
        Relationships: [
          {
            foreignKeyName: "users_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      vas_bom_items: {
        Row: {
          bom_id: string | null
          id: string
          input_product_id: string | null
          required_qty: number | null
          updated_at: string | null
        }
        Insert: {
          bom_id?: string | null
          id?: string
          input_product_id?: string | null
          required_qty?: number | null
          updated_at?: string | null
        }
        Update: {
          bom_id?: string | null
          id?: string
          input_product_id?: string | null
          required_qty?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vas_bom_items_bom_id_fkey"
            columns: ["bom_id"]
            isOneToOne: false
            referencedRelation: "vas_boms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vas_bom_items_input_product_id_fkey"
            columns: ["input_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      vas_boms: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          output_product_id: string | null
          process_type: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          output_product_id?: string | null
          process_type?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          output_product_id?: string | null
          process_type?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vas_boms_output_product_id_fkey"
            columns: ["output_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicles: {
        Row: {
          compartments: Json | null
          created_at: string | null
          current_location_id: string | null
          driver_name: string | null
          driver_phone: string | null
          gps_device_id: string | null
          id: string
          license_plate: string | null
          max_volume: number
          max_weight: number
          metadata: Json | null
          status: string | null
          tenant_id: string | null
          type: string
          updated_at: string | null
          vehicle_no: string
        }
        Insert: {
          compartments?: Json | null
          created_at?: string | null
          current_location_id?: string | null
          driver_name?: string | null
          driver_phone?: string | null
          gps_device_id?: string | null
          id?: string
          license_plate?: string | null
          max_volume: number
          max_weight: number
          metadata?: Json | null
          status?: string | null
          tenant_id?: string | null
          type: string
          updated_at?: string | null
          vehicle_no: string
        }
        Update: {
          compartments?: Json | null
          created_at?: string | null
          current_location_id?: string | null
          driver_name?: string | null
          driver_phone?: string | null
          gps_device_id?: string | null
          id?: string
          license_plate?: string | null
          max_volume?: number
          max_weight?: number
          metadata?: Json | null
          status?: string | null
          tenant_id?: string | null
          type?: string
          updated_at?: string | null
          vehicle_no?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehicles_current_location_id_fkey"
            columns: ["current_location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicles_current_location_id_fkey"
            columns: ["current_location_id"]
            isOneToOne: false
            referencedRelation: "v_replenishment_needs"
            referencedColumns: ["loc_id"]
          },
          {
            foreignKeyName: "vehicles_gps_device_id_fkey"
            columns: ["gps_device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      verification_rules: {
        Row: {
          auto_pass_threshold: number | null
          auto_reject_threshold: number | null
          created_at: string | null
          dim_tolerance_pct: number | null
          effective_from: string
          effective_to: string | null
          id: string
          is_active: boolean | null
          metadata: Json | null
          photo_angles: string[] | null
          photo_required: boolean | null
          required_checks: string[] | null
          sku_id: string | null
          tenant_id: string | null
          updated_at: string | null
          version: number | null
          weight_max: number | null
          weight_min: number | null
        }
        Insert: {
          auto_pass_threshold?: number | null
          auto_reject_threshold?: number | null
          created_at?: string | null
          dim_tolerance_pct?: number | null
          effective_from?: string
          effective_to?: string | null
          id?: string
          is_active?: boolean | null
          metadata?: Json | null
          photo_angles?: string[] | null
          photo_required?: boolean | null
          required_checks?: string[] | null
          sku_id?: string | null
          tenant_id?: string | null
          updated_at?: string | null
          version?: number | null
          weight_max?: number | null
          weight_min?: number | null
        }
        Update: {
          auto_pass_threshold?: number | null
          auto_reject_threshold?: number | null
          created_at?: string | null
          dim_tolerance_pct?: number | null
          effective_from?: string
          effective_to?: string | null
          id?: string
          is_active?: boolean | null
          metadata?: Json | null
          photo_angles?: string[] | null
          photo_required?: boolean | null
          required_checks?: string[] | null
          sku_id?: string | null
          tenant_id?: string | null
          updated_at?: string | null
          version?: number | null
          weight_max?: number | null
          weight_min?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "verification_rules_sku_id_fkey"
            columns: ["sku_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "verification_rules_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      wave_order_mapping: {
        Row: {
          id: string
          order_id: string | null
          wave_id: string | null
        }
        Insert: {
          id?: string
          order_id?: string | null
          wave_id?: string | null
        }
        Update: {
          id?: string
          order_id?: string | null
          wave_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wave_order_mapping_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wave_order_mapping_wave_id_fkey"
            columns: ["wave_id"]
            isOneToOne: false
            referencedRelation: "v_fulfillment_chain_progress"
            referencedColumns: ["wave_id"]
          },
          {
            foreignKeyName: "wave_order_mapping_wave_id_fkey"
            columns: ["wave_id"]
            isOneToOne: false
            referencedRelation: "waves"
            referencedColumns: ["id"]
          },
        ]
      }
      waves: {
        Row: {
          created_at: string | null
          id: string
          status: string | null
          strategy_type: string | null
          tenant_id: string | null
          updated_at: string | null
          wave_no: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          status?: string | null
          strategy_type?: string | null
          tenant_id?: string | null
          updated_at?: string | null
          wave_no: string
        }
        Update: {
          created_at?: string | null
          id?: string
          status?: string | null
          strategy_type?: string | null
          tenant_id?: string | null
          updated_at?: string | null
          wave_no?: string
        }
        Relationships: [
          {
            foreignKeyName: "waves_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      wo_action_logs: {
        Row: {
          action_type: string
          captured_data: Json | null
          end_at: string | null
          from_loc_id: string | null
          log_id: number
          qty_acted: number | null
          sku_id: string | null
          start_at: string | null
          to_loc_id: string | null
          wo_id: string | null
        }
        Insert: {
          action_type: string
          captured_data?: Json | null
          end_at?: string | null
          from_loc_id?: string | null
          log_id?: number
          qty_acted?: number | null
          sku_id?: string | null
          start_at?: string | null
          to_loc_id?: string | null
          wo_id?: string | null
        }
        Update: {
          action_type?: string
          captured_data?: Json | null
          end_at?: string | null
          from_loc_id?: string | null
          log_id?: number
          qty_acted?: number | null
          sku_id?: string | null
          start_at?: string | null
          to_loc_id?: string | null
          wo_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wo_action_logs_from_loc_id_fkey"
            columns: ["from_loc_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wo_action_logs_from_loc_id_fkey"
            columns: ["from_loc_id"]
            isOneToOne: false
            referencedRelation: "v_replenishment_needs"
            referencedColumns: ["loc_id"]
          },
          {
            foreignKeyName: "wo_action_logs_sku_id_fkey"
            columns: ["sku_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wo_action_logs_to_loc_id_fkey"
            columns: ["to_loc_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wo_action_logs_to_loc_id_fkey"
            columns: ["to_loc_id"]
            isOneToOne: false
            referencedRelation: "v_replenishment_needs"
            referencedColumns: ["loc_id"]
          },
          {
            foreignKeyName: "wo_action_logs_wo_id_fkey"
            columns: ["wo_id"]
            isOneToOne: false
            referencedRelation: "work_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      work_orders: {
        Row: {
          accepted_at: string | null
          assigned_user_id: string | null
          completed_at: string | null
          created_at: string | null
          device_id: string | null
          expected_duration_seconds: number | null
          id: string
          parent_wo_id: string | null
          pda_summary: string | null
          related_order_id: string | null
          status: string | null
          task_type: string | null
          tenant_id: string | null
          updated_at: string | null
          wave_id: string | null
        }
        Insert: {
          accepted_at?: string | null
          assigned_user_id?: string | null
          completed_at?: string | null
          created_at?: string | null
          device_id?: string | null
          expected_duration_seconds?: number | null
          id?: string
          parent_wo_id?: string | null
          pda_summary?: string | null
          related_order_id?: string | null
          status?: string | null
          task_type?: string | null
          tenant_id?: string | null
          updated_at?: string | null
          wave_id?: string | null
        }
        Update: {
          accepted_at?: string | null
          assigned_user_id?: string | null
          completed_at?: string | null
          created_at?: string | null
          device_id?: string | null
          expected_duration_seconds?: number | null
          id?: string
          parent_wo_id?: string | null
          pda_summary?: string | null
          related_order_id?: string | null
          status?: string | null
          task_type?: string | null
          tenant_id?: string | null
          updated_at?: string | null
          wave_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "work_orders_assigned_user_id_fkey"
            columns: ["assigned_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_orders_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_orders_parent_wo_id_fkey"
            columns: ["parent_wo_id"]
            isOneToOne: false
            referencedRelation: "work_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_orders_related_order_id_fkey"
            columns: ["related_order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_orders_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_orders_wave_id_fkey"
            columns: ["wave_id"]
            isOneToOne: false
            referencedRelation: "v_fulfillment_chain_progress"
            referencedColumns: ["wave_id"]
          },
          {
            foreignKeyName: "work_orders_wave_id_fkey"
            columns: ["wave_id"]
            isOneToOne: false
            referencedRelation: "waves"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      v_boss_management_cockpit: {
        Row: {
          avg_response_seconds: number | null
          exception_rate: number | null
          order_count: number | null
          pph: number | null
          task_type: string | null
          tenant_name: string | null
        }
        Relationships: []
      }
      v_cross_dock_efficiency: {
        Row: {
          avg_lead_time_minutes: number | null
          fallback_jobs: number | null
          ship_rate_pct: number | null
          shipped_jobs: number | null
          tenant_id: string | null
          tenant_name: string | null
          timeout_jobs: number | null
          total_jobs: number | null
        }
        Relationships: [
          {
            foreignKeyName: "cross_dock_jobs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      v_fulfillment_chain_progress: {
        Row: {
          cross_dock_shipped: number | null
          cross_dock_total: number | null
          load_completed_tasks: number | null
          load_total_tasks: number | null
          pack_boxes_packed: number | null
          pack_completed_tasks: number | null
          pack_total_tasks: number | null
          pick_completed_tasks: number | null
          pick_total_tasks: number | null
          sort_completed_tasks: number | null
          sort_sorted_qty: number | null
          sort_total_qty: number | null
          sort_total_tasks: number | null
          strategy_type: string | null
          tenant_id: string | null
          verify_completed: number | null
          verify_passed: number | null
          verify_total: number | null
          wave_id: string | null
          wave_no: string | null
          wave_status: string | null
        }
        Insert: {
          cross_dock_shipped?: never
          cross_dock_total?: never
          load_completed_tasks?: never
          load_total_tasks?: never
          pack_boxes_packed?: never
          pack_completed_tasks?: never
          pack_total_tasks?: never
          pick_completed_tasks?: never
          pick_total_tasks?: never
          sort_completed_tasks?: never
          sort_sorted_qty?: never
          sort_total_qty?: never
          sort_total_tasks?: never
          strategy_type?: string | null
          tenant_id?: string | null
          verify_completed?: never
          verify_passed?: never
          verify_total?: never
          wave_id?: string | null
          wave_no?: string | null
          wave_status?: string | null
        }
        Update: {
          cross_dock_shipped?: never
          cross_dock_total?: never
          load_completed_tasks?: never
          load_total_tasks?: never
          pack_boxes_packed?: never
          pack_completed_tasks?: never
          pack_total_tasks?: never
          pick_completed_tasks?: never
          pick_total_tasks?: never
          sort_completed_tasks?: never
          sort_sorted_qty?: never
          sort_total_qty?: never
          sort_total_tasks?: never
          strategy_type?: string | null
          tenant_id?: string | null
          verify_completed?: never
          verify_passed?: never
          verify_total?: never
          wave_id?: string | null
          wave_no?: string | null
          wave_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "waves_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      v_inventory_aging: {
        Row: {
          age_days: number | null
          aging_status: string | null
          batch_no: string | null
          exp_date: string | null
          location_code: string | null
          mfg_date: string | null
          product_name: string | null
          quantity: number | null
          sku: string | null
        }
        Relationships: []
      }
      v_loading_utilization: {
        Row: {
          actual_volume: number | null
          actual_weight: number | null
          max_volume: number | null
          max_weight: number | null
          planned_volume: number | null
          planned_weight: number | null
          status: string | null
          type: string | null
          vehicle_id: string | null
          vehicle_no: string | null
          volume_utilization_pct: number | null
          weight_utilization_pct: number | null
        }
        Relationships: [
          {
            foreignKeyName: "loading_tasks_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      v_packing_efficiency: {
        Row: {
          avg_duration_minutes: number | null
          completed_tasks: number | null
          packer_id: string | null
          packer_name: string | null
          total_boxes: number | null
          total_labels: number | null
          total_tasks: number | null
          total_weight_kg: number | null
        }
        Relationships: [
          {
            foreignKeyName: "packing_tasks_packer_id_fkey"
            columns: ["packer_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      v_replenishment_needs: {
        Row: {
          current_qty: number | null
          fill_rate_pct: number | null
          loc_code: string | null
          loc_id: string | null
          picking_max_qty: number | null
          sku_code: string | null
          sku_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_product_id_fkey"
            columns: ["sku_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      v_sorting_efficiency: {
        Row: {
          completed_tasks: number | null
          duration_minutes: number | null
          qty_completion_pct: number | null
          sort_qty_per_hour: number | null
          sorted_qty: number | null
          sorting_wave_id: string | null
          status: string | null
          task_completion_pct: number | null
          total_qty: number | null
          total_tasks: number | null
          wave_id: string | null
        }
        Insert: {
          completed_tasks?: number | null
          duration_minutes?: never
          qty_completion_pct?: never
          sort_qty_per_hour?: never
          sorted_qty?: number | null
          sorting_wave_id?: string | null
          status?: string | null
          task_completion_pct?: never
          total_qty?: number | null
          total_tasks?: number | null
          wave_id?: string | null
        }
        Update: {
          completed_tasks?: number | null
          duration_minutes?: never
          qty_completion_pct?: never
          sort_qty_per_hour?: never
          sorted_qty?: number | null
          sorting_wave_id?: string | null
          status?: string | null
          task_completion_pct?: never
          total_qty?: number | null
          total_tasks?: number | null
          wave_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sorting_waves_wave_id_fkey"
            columns: ["wave_id"]
            isOneToOne: false
            referencedRelation: "v_fulfillment_chain_progress"
            referencedColumns: ["wave_id"]
          },
          {
            foreignKeyName: "sorting_waves_wave_id_fkey"
            columns: ["wave_id"]
            isOneToOne: false
            referencedRelation: "waves"
            referencedColumns: ["id"]
          },
        ]
      }
      v_turnover_rate: {
        Row: {
          avg_inventory_qty: number | null
          movement_count: number | null
          product_name: string | null
          sku: string | null
          total_outbound_qty: number | null
          turnover_ratio: number | null
        }
        Relationships: []
      }
      v_verification_pass_rate: {
        Row: {
          pass_rate_pct: number | null
          passed_count: number | null
          product_name: string | null
          quarantine_count: number | null
          rejected_count: number | null
          rework_count: number | null
          sku_code: string | null
          sku_id: string | null
          total_inspections: number | null
        }
        Relationships: [
          {
            foreignKeyName: "quality_inspections_sku_id_fkey"
            columns: ["sku_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      adjust_inventory: {
        Args: {
          p_quantity: number
          p_reason: string
          p_sku: string
          p_tenant_id: string
        }
        Returns: {
          id: string
          quantity: number
        }[]
      }
      check_user_permission: {
        Args: {
          p_action: string
          p_resource: string
          p_scope?: string
          p_user_id: string
        }
        Returns: {
          has_permission: boolean
        }[]
      }
      fn_adjust_inventory_at_location: {
        Args: {
          p_batch_no?: string
          p_container_id?: string
          p_delta: number
          p_exp_date?: string
          p_location_id: string
          p_mfg_date?: string
          p_product_id: string
          p_tenant_id: string
        }
        Returns: {
          id: string
          quantity: number
        }[]
      }
      fn_allocate_chute: {
        Args: { p_sku_id: string; p_wave_id: string }
        Returns: {
          allocated_qty: number
          chute_code: string
          chute_id: string
        }[]
      }
      fn_apply_count_action: { Args: { p_event_id: string }; Returns: string }
      fn_apply_pack_action: { Args: { p_event_id: string }; Returns: string }
      fn_apply_pick_action: { Args: { p_event_id: string }; Returns: string }
      fn_apply_putaway_action: { Args: { p_event_id: string }; Returns: string }
      fn_apply_sync_event: { Args: { p_event_id: string }; Returns: string }
      fn_claim_task: {
        Args: {
          p_device_id: string
          p_lease_seconds?: number
          p_user_id: string
          p_work_order_id: string
        }
        Returns: {
          claim_id: string
          message: string
          success: boolean
        }[]
      }
      fn_confirm_inventory_recount: {
        Args: { p_exception_id: string; p_resolution_details: Json }
        Returns: undefined
      }
      fn_confirm_label_applied: {
        Args: {
          p_exception_id: string
          p_resolver_user_id: string
          p_scanned_lpn_code: string
        }
        Returns: boolean
      }
      fn_cross_dock_timeout_sweep: { Args: never; Returns: number }
      fn_current_tenant_id: { Args: never; Returns: string }
      fn_expire_task_claims: { Args: never; Returns: number }
      fn_generate_internal_lpn: {
        Args: { p_actor_user_id: string; p_exception_id: string }
        Returns: string
      }
      fn_get_active_billing_rule: {
        Args: { p_tenant_id: string }
        Returns: {
          currency: string
          rule_id: string
          rule_name: string
          source: string
        }[]
      }
      fn_get_count_tolerance: {
        Args: { p_product_id: string; p_tenant_id: string }
        Returns: number
      }
      fn_get_sync_policy: {
        Args: {
          p_task_type?: string
          p_tenant_id: string
          p_zone_type?: string
        }
        Returns: {
          max_offline_duration_seconds: number
          offline_mode: string
        }[]
      }
      fn_get_tenant_abc_tracking_default: {
        Args: { p_abc_class: string; p_tenant_id: string }
        Returns: boolean
      }
      fn_identify_unidentified_goods: {
        Args: {
          p_confirmed_product_id: string
          p_exception_id: string
          p_resolver_user_id: string
        }
        Returns: boolean
      }
      fn_logic_resolve_blackbox_box: {
        Args: {
          p_batch: string
          p_lpn_code: string
          p_qty: number
          p_sku_id: string
        }
        Returns: undefined
      }
      fn_logic_stock_allocation: {
        Args: { p_needed_qty: number; p_order_id: string; p_sku_id: string }
        Returns: {
          alloc_qty: number
          source_lpn: string
        }[]
      }
      fn_match_cross_dock: {
        Args: { p_qty?: number; p_receipt_id: string; p_sku_id: string }
        Returns: {
          job_id: string
          matched_qty: number
          outbound_order_id: string
          staging_loc_id: string
        }[]
      }
      fn_purge_old_action_logs: {
        Args: { p_days?: number }
        Returns: {
          purged_inventory_history: number
          purged_wo_logs: number
        }[]
      }
      fn_raise_exception: {
        Args: {
          p_details?: Json
          p_exception_type: string
          p_raised_by?: string
          p_source_id: string
          p_source_table: string
          p_tenant_id: string
          p_title: string
        }
        Returns: string
      }
      fn_receive_unidentified_goods: {
        Args: {
          p_actor_user_id?: string
          p_location_id: string
          p_note: string
          p_qty: number
          p_tenant_id: string
        }
        Returns: string
      }
      fn_reconcile_location_count: {
        Args: {
          p_diff: number
          p_location_id: string
          p_product_id: string
          p_tenant_id: string
        }
        Returns: {
          id: string
          quantity: number
        }[]
      }
      fn_release_task_claim: { Args: { p_claim_id: string }; Returns: boolean }
      fn_requires_unique_tracking: {
        Args: {
          p_location_id: string
          p_product_id: string
          p_tenant_id: string
        }
        Returns: boolean
      }
      fn_resolve_exception: {
        Args: {
          p_exception_id: string
          p_new_status: string
          p_resolution_action?: string
          p_resolution_details?: Json
          p_resolution_notes?: string
          p_resolver_user_id: string
        }
        Returns: boolean
      }
      fn_verify_weight: {
        Args: { p_actual_weight: number; p_sku_id: string }
        Returns: {
          expected_max: number
          expected_min: number
          passed: boolean
          rule_id: string
          tolerance_pct: number
        }[]
      }
      sync_inventory_from_source: {
        Args: { p_tenant_id: string }
        Returns: {
          synced_count: number
        }[]
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
    Enums: {},
  },
} as const
