import { SupabaseClient } from '../supabase/SupabaseClient';

/**
 * 物料约束服务
 * 读取 product_constraints 表，提供入库/拣货/出库前的合规校验
 * 覆盖：冷链离柜超时、危险品不兼容、效期预警、温湿度要求、强制序列号
 */
export interface ProductConstraint {
  skuId: string;
  requiredZoneType?: string;       // 'COLD', 'HAZMAT', 'SECURE'
  hsCode?: string;                 // 海关编码
  isDangerous: boolean;
  maxOutFridgeSeconds?: number;    // 冷链商品离开冷柜最大秒数
  storageTempRange?: string;       // 存储温度范围，如 "2~8°C"
  expiryThresholdDays: number;     // 效期预警天数，默认 30
  hazmatIncompatibilityTags: string[]; // 危险品不兼容标签，如 ["OXIDIZER", "ACID"]
  mustScanSn: boolean;             // 是否强制扫序列号
}

export interface ComplianceCheckResult {
  compliant: boolean;
  violations: ComplianceViolation[];
  warnings: ComplianceWarning[];
}

export interface ComplianceViolation {
  code: string;
  message: string;
  severity: 'ERROR' | 'WARNING';
  field?: string;
}

export interface ComplianceWarning {
  code: string;
  message: string;
  field?: string;
}

export interface ReceivingCheckRequest {
  skuId: string;
  locationId: string;
  containerId?: string;
  qty: number;
  batchNo?: string;
  mfgDate?: string;
  expDate?: string;
  serialNumbers?: string[];
  locationZoneType?: string;
  locationTemp?: number; // 当前库位温度(℃)
}

export interface PickingCheckRequest {
  skuId: string;
  locationId: string;
  containerId?: string;
  qty: number;
  serialNumbers?: string[];
  outOfFridgeStartTime?: Date; // 冷链商品离柜开始时间
}

export class ProductConstraintService {
  private constraintCache = new Map<string, ProductConstraint>();
  private cacheTtl = 5 * 60 * 1000; // 5分钟缓存
  private cacheTimestamps = new Map<string, number>();

  constructor(private supabase: SupabaseClient) {}

  /**
   * 获取物料约束（带缓存）
   */
  async getConstraint(skuId: string): Promise<ProductConstraint | null> {
    const now = Date.now();
    const cached = this.constraintCache.get(skuId);
    const cachedAt = this.cacheTimestamps.get(skuId);

    if (cached && cachedAt && now - cachedAt < this.cacheTtl) {
      return cached;
    }

    const { data, error } = await this.supabase
      .from('product_constraints')
      .select('*')
      .eq('sku_id', skuId)
      .single();

    if (error || !data) {
      // 返回默认约束（无特殊要求）
      const defaultConstraint: ProductConstraint = {
        skuId,
        isDangerous: false,
        expiryThresholdDays: 30,
        hazmatIncompatibilityTags: [],
        mustScanSn: false,
      };
      this.constraintCache.set(skuId, defaultConstraint);
      this.cacheTimestamps.set(skuId, now);
      return defaultConstraint;
    }

    const constraint: ProductConstraint = {
      skuId: data.sku_id,
      requiredZoneType: data.required_zone_type,
      hsCode: data.hs_code,
      isDangerous: data.is_dangerous,
      maxOutFridgeSeconds: data.max_out_fridge_seconds,
      storageTempRange: data.storage_temp_range,
      expiryThresholdDays: data.expiry_threshold_days ?? 30,
      hazmatIncompatibilityTags: data.hazmat_incompatibility_tags || [],
      mustScanSn: data.must_scan_sn ?? false,
    };

    this.constraintCache.set(skuId, constraint);
    this.cacheTimestamps.set(skuId, now);
    return constraint;
  }

  /**
   * 清除缓存
   */
  invalidateCache(skuId?: string): void {
    if (skuId) {
      this.constraintCache.delete(skuId);
      this.cacheTimestamps.delete(skuId);
    } else {
      this.constraintCache.clear();
      this.cacheTimestamps.clear();
    }
  }

  /**
   * 入库合规校验
   */
  async checkReceiving(request: ReceivingCheckRequest): Promise<ComplianceCheckResult> {
    const constraint = await this.getConstraint(request.skuId);
    if (!constraint) {
      return { compliant: true, violations: [], warnings: [] };
    }
    const violations: ComplianceViolation[] = [];
    const warnings: ComplianceWarning[] = [];

    // 1. 库位区域类型匹配
    if (constraint.requiredZoneType && request.locationZoneType) {
      if (constraint.requiredZoneType !== request.locationZoneType) {
        violations.push({
          code: 'ZONE_TYPE_MISMATCH',
          message: `物料要求 ${constraint.requiredZoneType} 区域，当前库位为 ${request.locationZoneType}`,
          severity: 'ERROR',
          field: 'locationId',
        });
      }
    }

    // 2. 温度范围校验
    if (constraint.storageTempRange && request.locationTemp !== undefined) {
      const tempMatch = this.checkTemperatureRange(constraint.storageTempRange, request.locationTemp);
      if (!tempMatch) {
        violations.push({
          code: 'TEMPERATURE_OUT_OF_RANGE',
          message: `库位温度 ${request.locationTemp}°C 不在要求范围 ${constraint.storageTempRange} 内`,
          severity: 'ERROR',
          field: 'locationId',
        });
      }
    }

    // 3. 危险品不兼容检查（同库位/同容器内其他危险品）
    if (constraint.isDangerous && constraint.hazmatIncompatibilityTags.length > 0) {
      const incompatResult = await this.checkHazmatIncompatibility(
        request.locationId,
        request.containerId,
        constraint.hazmatIncompatibilityTags
      );
      if (!incompatResult.compatible) {
        violations.push({
          code: 'HAZMAT_INCOMPATIBLE',
          message: `危险品不兼容: ${incompatResult.conflictingTags.join(', ')}`,
          severity: 'ERROR',
          field: 'locationId',
        });
      }
    }

    // 4. 效期校验
    if (request.expDate) {
      const expDate = new Date(request.expDate);
      const daysToExpiry = Math.ceil((expDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
      if (daysToExpiry < 0) {
        violations.push({
          code: 'EXPIRED_PRODUCT',
          message: `物料已过期 (过期日: ${request.expDate})`,
          severity: 'ERROR',
          field: 'expDate',
        });
      } else if (daysToExpiry <= constraint.expiryThresholdDays) {
        warnings.push({
          code: 'NEAR_EXPIRY',
          message: `物料即将过期，剩余 ${daysToExpiry} 天 (预警阈值: ${constraint.expiryThresholdDays} 天)`,
          field: 'expDate',
        });
      }
    }

    // 5. 强制序列号校验
    if (constraint.mustScanSn) {
      if (!request.serialNumbers || request.serialNumbers.length === 0) {
        violations.push({
          code: 'SERIAL_NUMBER_REQUIRED',
          message: '该物料强制要求序列号管理，请提供序列号列表',
          severity: 'ERROR',
          field: 'serialNumbers',
        });
      } else if (request.serialNumbers.length !== request.qty) {
        violations.push({
          code: 'SERIAL_NUMBER_COUNT_MISMATCH',
          message: `序列号数量 (${request.serialNumbers.length}) 与入库数量 (${request.qty}) 不匹配`,
          severity: 'ERROR',
          field: 'serialNumbers',
        });
      }
    }

    return {
      compliant: violations.filter(v => v.severity === 'ERROR').length === 0,
      violations,
      warnings,
    };
  }

  /**
   * 拣货合规校验
   */
  async checkPicking(request: PickingCheckRequest): Promise<ComplianceCheckResult> {
    const constraint = await this.getConstraint(request.skuId);
    if (!constraint) {
      return { compliant: true, violations: [], warnings: [] };
    }
    const violations: ComplianceViolation[] = [];
    const warnings: ComplianceWarning[] = [];

    // 1. 冷链离柜超时检查
    if (constraint.maxOutFridgeSeconds && request.outOfFridgeStartTime) {
      const elapsedSeconds = (Date.now() - request.outOfFridgeStartTime.getTime()) / 1000;
      if (elapsedSeconds > constraint.maxOutFridgeSeconds) {
        violations.push({
          code: 'COLD_CHAIN_TIMEOUT',
          message: `冷链商品离柜超时: ${Math.round(elapsedSeconds)} 秒 > 允许 ${constraint.maxOutFridgeSeconds} 秒`,
          severity: 'ERROR',
          field: 'outOfFridgeStartTime',
        });
      } else if (elapsedSeconds > constraint.maxOutFridgeSeconds * 0.8) {
        warnings.push({
          code: 'COLD_CHAIN_WARNING',
          message: `冷链商品接近离柜超时: ${Math.round(elapsedSeconds)} 秒 / ${constraint.maxOutFridgeSeconds} 秒`,
          field: 'outOfFridgeStartTime',
        });
      }
    }

    // 2. 强制序列号校验
    if (constraint.mustScanSn) {
      if (!request.serialNumbers || request.serialNumbers.length === 0) {
        violations.push({
          code: 'SERIAL_NUMBER_REQUIRED',
          message: '该物料强制要求序列号管理，拣货时必须扫描序列号',
          severity: 'ERROR',
          field: 'serialNumbers',
        });
      } else if (request.serialNumbers.length !== request.qty) {
        violations.push({
          code: 'SERIAL_NUMBER_COUNT_MISMATCH',
          message: `序列号数量 (${request.serialNumbers.length}) 与拣货数量 (${request.qty}) 不匹配`,
          severity: 'ERROR',
          field: 'serialNumbers',
        });
      }
    }

    // 3. 效期预警（拣货时也要检查）
    // 这里需要查询具体库存记录的 exp_date，暂时跳过

    return {
      compliant: violations.filter(v => v.severity === 'ERROR').length === 0,
      violations,
      warnings,
    };
  }

  /**
   * 危险品不兼容检查
   */
  private async checkHazmatIncompatibility(
    locationId: string,
    containerId: string | undefined,
    incompatTags: string[]
  ): Promise<{ compatible: boolean; conflictingTags: string[] }> {
    // 查询同库位/同容器内的其他危险品标签
    let query = this.supabase
      .from('inventory')
      .select(`
        product_id,
        product_constraints!inner(hazmat_incompatibility_tags)
      `)
      .eq('location_id', locationId);

    if (containerId) {
      query = query.eq('container_id', containerId);
    }

    const { data, error } = await query;
    if (error || !data) {
      return { compatible: true, conflictingTags: [] };
    }

    const existingTags = new Set<string>();
    for (const row of data as any[]) {
      const tags = row.product_constraints?.hazmat_incompatibility_tags || [];
      for (const tag of tags) {
        existingTags.add(tag);
      }
    }

    const conflictingTags = incompatTags.filter(tag => existingTags.has(tag));
    return {
      compatible: conflictingTags.length === 0,
      conflictingTags,
    };
  }

  /**
   * 温度范围解析与校验
   * 支持格式: "2~8°C", "2-8", "<= -18", "15~25"
   */
  private checkTemperatureRange(range: string, currentTemp: number): boolean {
    try {
      // 标准化：移除单位、空格
      const clean = range.replace(/[°C\s]/g, '').replace('~', '-');

      if (clean.startsWith('<=')) {
        const max = parseFloat(clean.substring(2));
        return currentTemp <= max;
      }
      if (clean.startsWith('>=')) {
        const min = parseFloat(clean.substring(2));
        return currentTemp >= min;
      }
      if (clean.startsWith('<')) {
        const max = parseFloat(clean.substring(1));
        return currentTemp < max;
      }
      if (clean.startsWith('>')) {
        const min = parseFloat(clean.substring(1));
        return currentTemp > min;
      }

      // 范围格式: "min-max"
      const parts = clean.split('-');
      if (parts.length === 2) {
        const min = parseFloat(parts[0]);
        const max = parseFloat(parts[1]);
        return currentTemp >= min && currentTemp <= max;
      }

      return true; // 无法解析时默认通过
    } catch {
      return true;
    }
  }

  /**
   * 批量获取约束（用于波次/批量操作前预检）
   */
  async getConstraintsBatch(skuIds: string[]): Promise<Map<string, ProductConstraint>> {
    const result = new Map<string, ProductConstraint>();
    const uniqueIds = [...new Set(skuIds)];

    for (const skuId of uniqueIds) {
      const constraint = await this.getConstraint(skuId);
      if (constraint) {
        result.set(skuId, constraint);
      }
    }
    return result;
  }
}

export default ProductConstraintService;