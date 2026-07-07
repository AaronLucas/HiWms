// src/models/fulfillment.ts
// Phase A: 履约/发运核心类型定义

// =====================================================================
// 分拣相关
// =====================================================================
export interface SortingChute {
  chute_id: string;
  tenant_id: string;
  chute_code: string;
  chute_name?: string;
  zone_type: 'SORTING' | 'PACKING' | 'LOADING';
  target_type?: 'ORDER' | 'CUSTOMER' | 'REGION' | 'CARRIER';
  target_id?: string;
  priority: number;
  max_capacity: number;
  current_count: number;
  status: 'ACTIVE' | 'FULL' | 'MAINTENANCE' | 'INACTIVE';
  location_ref?: string;
  created_at: string;
  updated_at: string;
}

export interface SortingChuteCreate {
  tenant_id: string;
  chute_code: string;
  chute_name?: string;
  zone_type: 'SORTING' | 'PACKING' | 'LOADING';
  target_type?: 'ORDER' | 'CUSTOMER' | 'REGION' | 'CARRIER';
  target_id?: string;
  priority?: number;
  max_capacity: number;
  location_ref?: string;
}

export interface SortingWave {
  wave_id: string;
  tenant_id: string;
  wave_no: string;
  wave_type: 'SORTING' | 'PACKING' | 'LOADING';
  status: 'PLANNING' | 'ASSIGNING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  source_wave_id?: string;
  strategy_config: Record<string, any>;
  total_tasks: number;
  completed_tasks: number;
  started_at?: string;
  completed_at?: string;
  created_at: string;
  updated_at: string;
}

export interface SortingWaveCreate {
  tenant_id: string;
  wave_no: string;
  wave_type: 'SORTING' | 'PACKING' | 'LOADING';
  source_wave_id?: string;
  strategy_config?: Record<string, any>;
}

export interface SortingTask {
  task_id: string;
  tenant_id: string;
  wave_id: string;
  task_no: string;
  source_container_id?: string;
  sku_id?: string;
  qty: number;
  target_chute_id?: string;
  status: 'PENDING' | 'ASSIGNED' | 'IN_PROGRESS' | 'COMPLETED' | 'EXCEPTION';
  assigned_to?: string;
  pda_summary?: string;
  started_at?: string;
  completed_at?: string;
  exception_reason?: string;
  created_at: string;
  updated_at: string;
}

export interface SortingTaskCreate {
  tenant_id: string;
  wave_id: string;
  task_no: string;
  source_container_id?: string;
  sku_id?: string;
  qty: number;
  target_chute_id?: string;
  status?: 'PENDING' | 'ASSIGNED';
  assigned_to?: string;
}

// =====================================================================
// 验货/质检
// =====================================================================
export interface VerificationRule {
  rule_id: string;
  tenant_id: string;
  rule_code: string;
  rule_name: string;
  applies_to: {
    sku_ids?: string[];
    categories?: string[];
    suppliers?: string[];
  };
  check_type: 'APPEARANCE' | 'QUANTITY' | 'SPEC' | 'EXPIRY' | 'SN';
  severity: 'ERROR' | 'WARNING' | 'INFO';
  auto_disposition: 'HOLD' | 'REJECT' | 'REWORK' | 'ACCEPT';
  tolerance: Record<string, number>;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface VerificationRuleCreate {
  tenant_id: string;
  rule_code: string;
  rule_name: string;
  applies_to: {
    sku_ids?: string[];
    categories?: string[];
    suppliers?: string[];
  };
  check_type: 'APPEARANCE' | 'QUANTITY' | 'SPEC' | 'EXPIRY' | 'SN';
  severity: 'ERROR' | 'WARNING' | 'INFO';
  auto_disposition: 'HOLD' | 'REJECT' | 'REWORK' | 'ACCEPT';
  tolerance: Record<string, number>;
  is_active?: boolean;
}

export interface QualityInspection {
  inspection_id: string;
  tenant_id: string;
  inspection_no: string;
  inspection_type: 'RECEIVING' | 'SHIPPING' | 'INTERNAL' | 'RETURN';
  source_ref_type?: 'ORDER' | 'RECEIPT' | 'RETURN' | 'INVENTORY';
  source_ref_id?: string;
  sku_id?: string;
  lot_no?: string;
  qty_inspected: number;
  qty_passed: number;
  qty_failed: number;
  status: 'PENDING' | 'IN_PROGRESS' | 'PASSED' | 'FAILED' | 'REWORK';
  inspector_id?: string;
  started_at?: string;
  completed_at?: string;
  created_at: string;
  updated_at: string;
}

export interface QualityInspectionCreate {
  tenant_id: string;
  inspection_type: 'RECEIVING' | 'SHIPPING' | 'INTERNAL' | 'RETURN';
  source_ref_type?: 'ORDER' | 'RECEIPT' | 'RETURN' | 'INVENTORY';
  source_ref_id?: string;
  sku_id?: string;
  lot_no?: string;
  qty_inspected: number;
}

export interface InspectionItem {
  item_id: string;
  inspection_id: string;
  rule_id?: string;
  check_item: string;
  expected_value?: string;
  actual_value?: string;
  result: 'PASS' | 'FAIL' | 'WARNING' | 'PENDING';
  remark?: string;
  created_at: string;
}

export interface InspectionItemCreate {
  inspection_id: string;
  rule_id?: string;
  check_item: string;
  expected_value?: string;
  result?: 'PASS' | 'FAIL' | 'WARNING' | 'PENDING';
  remark?: string;
}

// =====================================================================
// 打包/封箱
// =====================================================================
export interface PackageSpec {
  spec_id: string;
  tenant_id: string;
  spec_code: string;
  spec_name: string;
  outer_length?: number;
  outer_width?: number;
  outer_height?: number;
  max_weight?: number;
  max_volume?: number;
  material?: string;
  max_items: number;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface PackageSpecCreate {
  tenant_id: string;
  spec_code: string;
  spec_name: string;
  outer_length?: number;
  outer_width?: number;
  outer_height?: number;
  max_weight?: number;
  max_volume?: number;
  material?: string;
  max_items?: number;
  is_default?: boolean;
}

export interface LabelTemplate {
  template_id: string;
  tenant_id: string;
  template_code: string;
  template_name?: string;
  label_type: 'SHIPPING' | 'BOX' | 'PALLET' | 'SN';
  template_content: Record<string, any>;
  print_format: 'ZPL' | 'PDF' | 'HTML';
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface LabelTemplateCreate {
  tenant_id: string;
  template_code: string;
  template_name?: string;
  label_type: 'SHIPPING' | 'BOX' | 'PALLET' | 'SN';
  template_content: Record<string, any>;
  print_format?: 'ZPL' | 'PDF' | 'HTML';
}

export interface PackingTask {
  task_id: string;
  tenant_id: string;
  order_id?: string;
  wave_id?: string;
  container_id?: string;
  spec_id?: string;
  template_id?: string;
  status: 'PENDING' | 'PACKING' | 'WEIGHED' | 'LABELED' | 'SEALED' | 'COMPLETED';
  assigned_to?: string;
  packed_items: PackedItem[];
  actual_weight?: number;
  actual_volume?: number;
  tracking_no?: string;
  label_printed_at?: string;
  sealed_at?: string;
  completed_at?: string;
  created_at: string;
  updated_at: string;
}

export interface PackingTaskCreate {
  tenant_id: string;
  order_id?: string;
  wave_id?: string;
  container_id?: string;
  spec_id?: string;
  template_id?: string;
}

export interface PackedItem {
  sku_id: string;
  qty: number;
  serial_numbers?: string[];
  batch_no?: string;
}

export interface PackedItemInput {
  sku_id: string;
  qty: number;
  serial_numbers?: string[];
  batch_no?: string;
}

export interface ConsumableUsage {
  usage_id: string;
  tenant_id: string;
  packing_task_id?: string;
  sku_id?: string;
  qty_used: number;
  unit_cost?: number;
  used_at: string;
}

// =====================================================================
// 装车/发运
// =====================================================================
export interface Vehicle {
  vehicle_id: string;
  tenant_id: string;
  vehicle_code: string;
  vehicle_name?: string;
  vehicle_type: 'TRUCK' | 'VAN' | 'CONTAINER' | 'RAIL';
  max_weight?: number;
  max_volume?: number;
  max_pallets?: number;
  license_plate?: string;
  driver_id?: string;
  carrier_id?: string;
  status: 'AVAILABLE' | 'LOADING' | 'IN_TRANSIT' | 'MAINTENANCE';
  gps_device_id?: string;
  created_at: string;
  updated_at: string;
}

export interface VehicleCreate {
  tenant_id: string;
  vehicle_code: string;
  vehicle_name?: string;
  vehicle_type: 'TRUCK' | 'VAN' | 'CONTAINER' | 'RAIL';
  max_weight?: number;
  max_volume?: number;
  max_pallets?: number;
  license_plate?: string;
  driver_id?: string;
  carrier_id?: string;
  gps_device_id?: string;
}

export interface LoadingTask {
  task_id: string;
  tenant_id: string;
  vehicle_id?: string;
  wave_id?: string;
  status: 'PLANNING' | 'LOADING' | 'LOADED' | 'SEALED' | 'DEPARTED' | 'ARRIVED';
  load_sequence: number;
  planned_weight?: number;
  planned_volume?: number;
  actual_weight?: number;
  actual_volume?: number;
  loader_id?: string;
  started_at?: string;
  completed_at?: string;
  sealed_at?: string;
  departed_at?: string;
  arrived_at?: string;
  seal_no?: string;
  created_at: string;
  updated_at: string;
}

export interface LoadingTaskCreate {
  tenant_id: string;
  vehicle_id?: string;
  wave_id?: string;
  status?: 'PLANNING' | 'LOADING' | 'LOADED' | 'SEALED' | 'DEPARTED' | 'ARRIVED';
  load_sequence?: number;
  planned_weight?: number;
  planned_volume?: number;
  loader_id?: string;
}

export interface ShippingDocument {
  doc_id: string;
  tenant_id: string;
  loading_task_id?: string;
  doc_type: 'BOL' | 'POD' | 'MANIFEST' | 'CUSTOMS';
  doc_no: string;
  doc_content?: Record<string, any>;
  generated_at: string;
  printed_at?: string;
  signed_at?: string;
  signer_id?: string;
}

export interface ShippingDocumentCreate {
  tenant_id: string;
  loading_task_id?: string;
  doc_type: 'BOL' | 'POD' | 'MANIFEST' | 'CUSTOMS';
  doc_no?: string;
  doc_content?: Record<string, any>;
  signed_at?: string;
  signer_id?: string;
}

// =====================================================================
// 关联/关联表类型
// =====================================================================
export interface ContainerSortingTarget {
  container_id: string;
  chute_id: string;
  priority: number;
}

export interface PackingSource {
  packing_task_id: string;
  source_type: 'SORTING_TASK' | 'ORDER_LINE' | 'INVENTORY';
  source_id: string;
  qty: number;
}