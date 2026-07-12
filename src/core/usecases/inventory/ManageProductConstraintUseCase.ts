/**
 * 管理物料约束用例
 * 替代 ProductConstraintService，使用 Repository Port
 */
import { IProductConstraintRepository } from '@core/ports/db/IProductConstraintRepository';
import { IProductRepository } from '@core/ports/db/IProductRepository';

export type RequiredZoneType = 'COLD' | 'HAZMAT' | 'SECURE' | 'STANDARD';

export interface ProductConstraint {
  skuId: string;
  requiredZoneType?: RequiredZoneType;
  hsCode?: string;
  isDangerous: boolean;
  maxOutFridgeSeconds?: number;
  storageTempRange?: string;
  expiryThresholdDays: number;
  hazmatIncompatibilityTags: string[];
  mustScanSn: boolean;
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
  locationTemp?: number;
}

export interface PickingCheckRequest {
  skuId: string;
  locationId: string;
  containerId?: string;
  qty: number;
  serialNumbers?: string[];
  outOfFridgeStartTime?: Date;
}

export class ManageProductConstraintUseCase {
  private constraintCache = new Map<string, { constraint: ProductConstraint; cachedAt: number }>();
  private cacheTtl = 5 * 60 * 1000; // 5分钟

  constructor(
    private constraintRepo: IProductConstraintRepository,
    private productRepo: IProductRepository
  ) {}

  /**
   * 获取物料约束（带缓存）
   */
  async getConstraint(skuId: string): Promise<ProductConstraint | null> {
    const now = Date.now();
    const cached = this.constraintCache.get(skuId);

    if (cached && now - cached.cachedAt < this.cacheTtl) {
      return cached.constraint;
    }

    const row = await this.constraintRepo.findBySku(skuId);
    if (!row) {
      // 返回默认约束
      const defaultConstraint: ProductConstraint = {
        skuId,
        isDangerous: false,
        expiryThresholdDays: 30,
        hazmatIncompatibilityTags: [],
        mustScanSn: false,
      };
      this.constraintCache.set(skuId, { constraint: defaultConstraint, cachedAt: now });
      return defaultConstraint;
    }

    const constraint: ProductConstraint = {
      skuId: row.sku_id,
      requiredZoneType: row.required_zone_type,
      hsCode: row.hs_code,
      isDangerous: row.is_dangerous,
      maxOutFridgeSeconds: row.max_out_fridge_seconds,
      storageTempRange: row.storage_temp_range,
      expiryThresholdDays: row.expiry_threshold_days ?? 30,
      hazmatIncompatibilityTags: row.hazmat_incompatibility_tags || [],
      mustScanSn: row.must_scan_sn ?? false,
    };

    this.constraintCache.set(skuId, { constraint, cachedAt: now });
    return constraint;
  }

  /**
   * 清除缓存
   */
  invalidateCache(skuId?: string): void {
    if (skuId) {
      this.constraintCache.delete(skuId);
    } else {
      this.constraintCache.clear();
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
      if (!this.checkTemperatureRange(constraint.storageTempRange, request.locationTemp)) {
        violations.push({
          code: 'TEMPERATURE_OUT_OF_RANGE',
          message: `库位温度 ${request.locationTemp}°C 不在要求范围 ${constraint.storageTempRange} 内`,
          severity: 'ERROR',
          field: 'locationId',
        });
      }
    }

    // 3. 危险品不兼容检查
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

    return {
      compliant: violations.filter(v => v.severity === 'ERROR').length === 0,
      violations,
      warnings,
    };
  }

  /**
   * 批量获取约束（用于波次/批量操作前预检）
   */
  async getConstraintsBatch(skuIds: string[]): Promise<Map<string, ProductConstraint>> {
    const result = new Map<string, ProductConstraint>();
    const uniqueIds = [...new Set(skuIds)];

    const rows = await this.constraintRepo.findBySkuBatch(uniqueIds);

    for (const row of rows) {
      const constraint: ProductConstraint = {
        skuId: row.product_id,
        requiredZoneType: row.required_zone_type ?? undefined,
        hsCode: row.hs_code ?? undefined,
        isDangerous: row.is_dangerous ?? false,
        maxOutFridgeSeconds: row.max_out_fridge_seconds ?? undefined,
        storageTempRange: row.storage_temp_range ?? undefined,
        expiryThresholdDays: row.expiry_threshold_days ?? 30,
        hazmatIncompatibilityTags: row.hazmat_incompatibility_tags || [],
        mustScanSn: row.must_scan_sn ?? false,
      };
      result.set(row.product_id, constraint);
    }

    return result;
  }

  /**
   * 温度范围解析与校验
   * 支持格式: "2~8°C", "2-8", "<= -18", "15~25"
   */
  private checkTemperatureRange(range: string, currentTemp: number): boolean {
    try {
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

      return true;
    } catch {
      return true;
    }
  }

  /**
   * 危险品不兼容检查
   */
  private async checkHazmatIncompatibility(
    locationId: string,
    containerId: string | undefined,
    incompatTags: string[]
  ): Promise<{ compatible: boolean; conflictingTags: string[] }> {
    // 这里需要查询同库位/同容器内的其他危险品标签
    // 暂时返回兼容，实际实现需要通过 inventory + product_constraints 关联查询
    return { compatible: true, conflictingTags: [] };
  }
}

export default ManageProductConstraintUseCase;