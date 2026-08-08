/**
 * Supabase 容器/LPN 仓储实现
 */
import { SupabaseBaseRepository } from './SupabaseBaseRepository';
import { IContainerRepository } from '@core/ports/db/IContainerRepository';
import type { Tables, TablesInsert, TablesUpdate } from '../../../types/database';
import { CONTAINER_STATUS } from '../../../core/constants/status';

type ContainerRow = Tables<'containers'>;
type ContainerInsert = TablesInsert<'containers'>;
type ContainerUpdate = TablesUpdate<'containers'>;

export class SupabaseContainerRepository extends SupabaseBaseRepository<
  ContainerRow,
  ContainerInsert,
  ContainerUpdate,
  string
> implements IContainerRepository {
  protected tableName = 'containers' as const;
  protected idColumn = 'id';

  async findByCode(code: string, tenantId: string): Promise<ContainerRow | null> {
    const { data, error } = await (this.getClient() as any)
      .from(this.tableName)
      .select('*')
      .eq('lpn_code', code)
      .eq('tenant_id', tenantId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw error;
    }
    return data as ContainerRow;
  }

  async findByParent(parentContainerId: string): Promise<ContainerRow[]> {
    const { data, error } = await (this.getClient() as any)
      .from(this.tableName)
      .select('*')
      .eq('parent_container_id', parentContainerId)
      .order('created_at', { ascending: true });

    if (error) throw error;
    return (data as ContainerRow[]) || [];
  }

  async findByTenant(
    tenantId: string,
    options?: { limit?: number; offset?: number; status?: string; containerType?: string }
  ): Promise<ContainerRow[]> {
    const { limit = 100, offset = 0, status, containerType } = options || {};
    let query = (this.getClient() as any)
      .from(this.tableName)
      .select('*')
      .eq('tenant_id', tenantId)
      .order('lpn_code', { ascending: true })
      .range(offset, offset + limit - 1);

    if (status) query = query.eq('status', status);
    if (containerType) query = query.eq('container_type', containerType);

    const { data, error } = await query;
    if (error) throw error;
    return (data as ContainerRow[]) || [];
  }

  async findAvailable(
    tenantId: string,
    options?: { minVolume?: number; minWeight?: number }
  ): Promise<ContainerRow[]> {
    let query = (this.getClient() as any)
      .from(this.tableName)
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('is_sealed', false)
      .eq('status', CONTAINER_STATUS.IDLE);

    const { data, error } = await query;
    if (error) throw error;
    return (data as ContainerRow[]) || [];
  }

  async updateSealStatus(containerId: string, isSealed: boolean): Promise<ContainerRow> {
    return this.update(containerId, { is_sealed: isSealed } as ContainerUpdate);
  }

  async updateCapacity(
    containerId: string,
    capacity: { maxVolume?: number; maxWeight?: number; currentVolume?: number; currentWeight?: number }
  ): Promise<ContainerRow> {
    // containers 表没有容量字段，只能更新状态
    // 实际容量管理通过 inventory 表关联实现
    return this.update(containerId, {} as ContainerUpdate);
  }

  async getUtilizationStats(tenantId: string): Promise<Array<{
    containerId: string;
    code: string;
    currentVolume: number;
    currentWeight: number;
    maxVolume: number;
    maxWeight: number;
    utilizationPct: number;
  }>> {
    const { data, error } = await (this.getClient() as any)
      .from(this.tableName)
      .select('id, lpn_code')
      .eq('tenant_id', tenantId)
      .eq('is_sealed', false);

    if (error) throw error;
    return ((data as ContainerRow[]) || []).map(row => ({
      containerId: row.id,
      code: row.lpn_code,
      currentVolume: 0,
      currentWeight: 0,
      maxVolume: 0,
      maxWeight: 0,
      utilizationPct: 0,
    }));
  }

  // ===== Sprint 6: 容器全量写操作 =====

  async getContents(containerId: string, includeNested?: boolean): Promise<Array<{
    productId: string;
    productSku: string;
    productName: string;
    quantity: number;
    batchNo?: string;
    serialNo?: string;
  }>> {
    // 查询容器关联的库存记录
    const { data: inventory, error: invError } = await (this.getClient() as any)
      .from('inventory')
      .select(`
        product_id,
        quantity,
        batch_no,
        serial_no,
        products!inner(sku, name)
      `)
      .eq('container_id', containerId);

    if (invError) throw invError;

    return (inventory || []).map((row: any) => ({
      productId: row.product_id,
      productSku: row.products?.sku,
      productName: row.products?.name,
      quantity: row.quantity,
      batchNo: row.batch_no,
      serialNo: row.serial_no,
    }));
  }

  async moveContainer(containerId: string, newParentId: string | null): Promise<ContainerRow> {
    const updateData: Partial<ContainerUpdate> = { parent_container_id: newParentId };
    return this.update(containerId, updateData as ContainerUpdate);
  }

  async getHierarchy(containerId: string): Promise<{
    container: ContainerRow;
    children: Array<{
      container: ContainerRow;
      children: any[];
    }>;
  } | null> {
    const { data: container, error: containerError } = await (this.getClient() as any)
      .from(this.tableName)
      .select('*')
      .eq('id', containerId)
      .single();

    if (containerError) {
      if (containerError.code === 'PGRST116') return null;
      throw containerError;
    }

    // 使用递归 CTE 一次性查询完整层级树（限制最大深度 20 层防止无限递归）
    const { data: hierarchy, error: hierarchyError } = await (this.getClient() as any)
      .rpc('get_container_hierarchy', { root_id: containerId, max_depth: 20 });

    if (hierarchyError) {
      // 回退到 N+1 查询（兼容无 RPC 函数的环境）
      const buildHierarchy = async (parentId: string): Promise<Array<{
        container: ContainerRow;
        children: any[];
      }>> => {
        const { data: children, error: childrenError } = await (this.getClient() as any)
          .from(this.tableName)
          .select('*')
          .eq('parent_container_id', parentId)
          .order('created_at', { ascending: true });

        if (childrenError) throw childrenError;

        const result = [];
        for (const child of children || []) {
          result.push({
            container: child as ContainerRow,
            children: await buildHierarchy(child.id),
          });
        }
        return result;
      };

      return {
        container: container as ContainerRow,
        children: await buildHierarchy(containerId),
      };
    }

    // 将扁平化结果重建为树结构
    const nodeMap = new Map<string, { container: ContainerRow; children: any[] }>();
    for (const row of hierarchy || []) {
      nodeMap.set(row.id, { container: row as ContainerRow, children: [] });
    }

    const root = nodeMap.get(containerId);
    if (!root) return null;

    for (const row of hierarchy || []) {
      if (row.parent_container_id && nodeMap.has(row.parent_container_id)) {
        nodeMap.get(row.parent_container_id)!.children.push(nodeMap.get(row.id)!);
      }
    }

    return {
      container: root.container,
      children: root.children,
    };
  }

  async findByLpn(lpnCode: string, tenantId: string): Promise<ContainerRow | null> {
    const { data, error } = await (this.getClient() as any)
      .from(this.tableName)
      .select('*')
      .eq('lpn_code', lpnCode)
      .eq('tenant_id', tenantId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw error;
    }
    return data as ContainerRow;
  }
}