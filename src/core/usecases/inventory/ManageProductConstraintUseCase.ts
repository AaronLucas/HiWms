/**
 * 产品约束管理用例
 * 替代 ProductConstraintService，注入 Repository Ports
 */
import { IProductRepository } from '@core/ports/db/IProductRepository';
import { IProductConstraintRepository } from '@core/ports/db/IProductConstraintRepository';
import type { Tables, TablesInsert, TablesUpdate } from '@/types/database';

type ProductConstraintRow = Tables<'product_constraints'>;
type ProductConstraintInsert = TablesInsert<'product_constraints'>;
type ProductConstraintUpdate = TablesUpdate<'product_constraints'>;

export interface ManageProductConstraintInput {
  action: 'create' | 'update' | 'delete' | 'get' | 'list';
  tenantId: string;
  skuId?: string;
  data?: Partial<ProductConstraintInsert>;
  constraintId?: string;
}

export interface ProductConstraintResult {
  success: boolean;
  constraint?: ProductConstraintRow;
  constraints?: ProductConstraintRow[];
  message: string;
}

export class ManageProductConstraintUseCase {
  constructor(
    private productRepo: IProductRepository,
    private constraintRepo: IProductConstraintRepository
  ) {}

  async execute(input: ManageProductConstraintInput): Promise<ProductConstraintResult> {
    switch (input.action) {
      case 'create':
        return this.create(input);
      case 'update':
        return this.update(input);
      case 'delete':
        return this.delete(input);
      case 'get':
        return this.get(input);
      case 'list':
        return this.list(input);
      default:
        return { success: false, message: 'Unknown action' };
    }
  }

  private async create(input: ManageProductConstraintInput): Promise<ProductConstraintResult> {
    if (!input.skuId || !input.data) {
      return { success: false, message: 'SKU ID and data required for create' };
    }

    // 验证 SKU 存在
    const product = await this.productRepo.findBySku(input.skuId);
    if (!product) {
      return { success: false, message: 'Product not found' };
    }

    // 检查是否已存在约束
    const existing = await this.constraintRepo.findBySku(input.skuId);
    if (existing) {
      return { success: false, message: 'Constraint already exists for this SKU' };
    }

    const constraint = await this.constraintRepo.create({
      sku_id: input.skuId,
      tenant_id: input.tenantId,
      ...input.data,
    } as ProductConstraintInsert);

    return { success: true, constraint, message: 'Constraint created' };
  }

  private async update(input: ManageProductConstraintInput): Promise<ProductConstraintResult> {
    if (!input.constraintId || !input.data) {
      return { success: false, message: 'Constraint ID and data required for update' };
    }

    const constraint = await this.constraintRepo.update(input.constraintId, input.data as ProductConstraintUpdate);
    return { success: true, constraint, message: 'Constraint updated' };
  }

  private async delete(input: ManageProductConstraintInput): Promise<ProductConstraintResult> {
    if (!input.constraintId) {
      return { success: false, message: 'Constraint ID required for delete' };
    }

    await this.constraintRepo.delete(input.constraintId);
    return { success: true, message: 'Constraint deleted' };
  }

  private async get(input: ManageProductConstraintInput): Promise<ProductConstraintResult> {
    if (!input.skuId) {
      return { success: false, message: 'SKU ID required for get' };
    }

    const constraint = await this.constraintRepo.findBySku(input.skuId);
    return { success: true, constraint: constraint ?? undefined, message: constraint ? 'Found' : 'Not found' };
  }

  private async list(input: ManageProductConstraintInput): Promise<ProductConstraintResult> {
    const constraints = await this.constraintRepo.findByTenant(input.tenantId);
    return { success: true, constraints, message: `Found ${constraints.length} constraints` };
  }
}
