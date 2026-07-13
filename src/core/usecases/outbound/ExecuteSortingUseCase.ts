/**
 * 执行分拣用例
 * 替代 SortingService，注入 Repository Ports
 */
import { ISortingTaskRepository } from '@core/ports/db/ISortingTaskRepository';
import { ISortingChuteRepository } from '@core/ports/db/ISortingChuteRepository';
import { IWorkOrderRepository } from '@core/ports/db/IWorkOrderRepository';

export interface ExecuteSortingInput {
  taskId: string;
  userId: string;
  tenantId: string;
  scannedQty: number;
  serialNumbers?: string[];
  exceptionReason?: string;
}

export interface SortingResult {
  success: boolean;
  taskId: string;
  sortedQty: number;
  remainingQty: number;
  nextChuteId?: string;
  message: string;
}

export class ExecuteSortingUseCase {
  constructor(
    private sortingTaskRepo: ISortingTaskRepository,
    private sortingChuteRepo: ISortingChuteRepository,
    private workOrderRepo: IWorkOrderRepository
  ) {}

  async execute(input: ExecuteSortingInput): Promise<SortingResult> {
    // 1. 查找分拣任务
    const task = await this.sortingTaskRepo.findById(input.taskId);
    if (!task) {
      return { success: false, taskId: input.taskId, sortedQty: 0, remainingQty: 0, message: 'Task not found' };
    }

    // 2. 验证任务状态
    if (task.status === 'completed') {
      return { success: false, taskId: input.taskId, sortedQty: task.sorted_qty || 0, remainingQty: 0, message: 'Task already completed' };
    }

    // 3. 如果有异常，记录异常
    if (input.exceptionReason) {
      await this.sortingTaskRepo.recordException(input.taskId, input.exceptionReason);
      return { success: false, taskId: input.taskId, sortedQty: task.sorted_qty || 0, remainingQty: 0, message: `Exception recorded: ${input.exceptionReason}` };
    }

    // 4. 记录分拣完成
    const newSortedQty = (task.sorted_qty || 0) + input.scannedQty;
    const updatedTask = await this.sortingTaskRepo.recordSortingComplete(input.taskId, newSortedQty);

    // 5. 如果有序列号，记录
    if (input.serialNumbers && input.serialNumbers.length > 0) {
      // 记录序列号逻辑
    }

    // 6. 如果分配了滑道，更新滑道数量
    let nextChuteId: string | undefined;
    if (task.chute_id) {
      const chute = await this.sortingChuteRepo.updateCurrentQty(task.chute_id, newSortedQty);
      // 查找下一个可用滑道
      const nextChutes = await this.sortingChuteRepo.findAvailable(input.tenantId, task.wave_id ?? undefined, { minCapacity: 1 });
      if (nextChutes.length > 0) nextChuteId = nextChutes[0].id;
    }

    // 7. 检查是否完成
    const remainingQty = task.qty - newSortedQty;
    if (remainingQty <= 0) {
      await this.sortingTaskRepo.updateStatus(input.taskId, 'completed', { completedAt: new Date().toISOString() });
    }

    return {
      success: true,
      taskId: input.taskId,
      sortedQty: newSortedQty,
      remainingQty: Math.max(0, remainingQty),
      nextChuteId,
      message: `Sorted ${input.scannedQty} units, ${remainingQty > 0 ? remainingQty + ' remaining' : 'task completed'}`,
    };
  }
}

/**
 * 执行打包用例
 * 替代 PackingService
 */
import { IPackingTaskRepository } from '@core/ports/db/IPackingTaskRepository';
import { IPackageSpecRepository } from '@core/ports/db/IPackageSpecRepository';
import { ILabelTemplateRepository } from '@core/ports/db/ILabelTemplateRepository';

export interface ExecutePackingInput {
  taskId: string;
  userId: string;
  tenantId: string;
  action: 'start' | 'pack' | 'label' | 'seal' | 'exception';
  data?: {
    boxesPacked?: number;
    totalWeight?: number;
    totalVolume?: number;
    trackingNumbers?: string[];
    labelCount?: number;
    exceptionReason?: string;
  };
}

export interface PackingResult {
  success: boolean;
  taskId: string;
  status: string;
  message: string;
}

export class ExecutePackingUseCase {
  constructor(
    private packingTaskRepo: IPackingTaskRepository,
    private packageSpecRepo: IPackageSpecRepository,
    private labelTemplateRepo: ILabelTemplateRepository
  ) {}

  async execute(input: ExecutePackingInput): Promise<PackingResult> {
    const task = await this.packingTaskRepo.findWithConsumables(input.taskId);
    if (!task) {
      return { success: false, taskId: input.taskId, status: 'error', message: 'Packing task not found' };
    }

    switch (input.action) {
      case 'start':
        await this.packingTaskRepo.updateStatus(input.taskId, 'in_progress', { startedAt: new Date().toISOString() });
        return { success: true, taskId: input.taskId, status: 'in_progress', message: 'Packing started' };

      case 'pack':
        if (!input.data?.boxesPacked || !input.data?.totalWeight || !input.data?.totalVolume) {
          return { success: false, taskId: input.taskId, status: 'error', message: 'Packing data required' };
        }
        await this.packingTaskRepo.recordPackingComplete(input.taskId, {
          boxesPacked: input.data.boxesPacked,
          totalWeight: input.data.totalWeight,
          totalVolume: input.data.totalVolume,
          trackingNumbers: input.data.trackingNumbers || [],
        });
        return { success: true, taskId: input.taskId, status: 'packed', message: 'Packing recorded' };

      case 'label':
        if (!input.data?.labelCount) {
          return { success: false, taskId: input.taskId, status: 'error', message: 'Label count required' };
        }
        await this.packingTaskRepo.recordLabelPrint(input.taskId, input.data.labelCount);
        return { success: true, taskId: input.taskId, status: 'labeled', message: 'Labels printed' };

      case 'seal':
        await this.packingTaskRepo.updateStatus(input.taskId, 'completed', { completedAt: new Date().toISOString() });
        return { success: true, taskId: input.taskId, status: 'completed', message: 'Packing completed and sealed' };

      case 'exception':
        await this.packingTaskRepo.updateStatus(input.taskId, 'exception', { exceptionReason: input.data?.exceptionReason });
        return { success: false, taskId: input.taskId, status: 'exception', message: `Exception: ${input.data?.exceptionReason}` };

      default:
        return { success: false, taskId: input.taskId, status: 'error', message: 'Unknown action' };
    }
  }
}

/**
 * 执行装车用例
 * 替代 LoadingService
 */
import { ILoadingTaskRepository } from '@core/ports/db/ILoadingTaskRepository';
import { IVehicleRepository } from '@core/ports/db/IVehicleRepository';

export interface ExecuteLoadingInput {
  taskId: string;
  userId: string;
  tenantId: string;
  action: 'start' | 'load' | 'complete' | 'exception';
  data?: {
    actualWeight?: number;
    actualVolume?: number;
    sealNumber?: string;
    exceptionReason?: string;
  };
}

export interface LoadingResult {
  success: boolean;
  taskId: string;
  status: string;
  message: string;
}

export class ExecuteLoadingUseCase {
  constructor(
    private loadingTaskRepo: ILoadingTaskRepository,
    private vehicleRepo: IVehicleRepository
  ) {}

  async execute(input: ExecuteLoadingInput): Promise<LoadingResult> {
    const task = await this.loadingTaskRepo.findById(input.taskId);
    if (!task) {
      return { success: false, taskId: input.taskId, status: 'error', message: 'Loading task not found' };
    }

    switch (input.action) {
      case 'start':
        await this.loadingTaskRepo.updateStatus(input.taskId, 'in_progress', { startedAt: new Date().toISOString() });
        return { success: true, taskId: input.taskId, status: 'in_progress', message: 'Loading started' };

      case 'load':
        // 记录装载进度
        return { success: true, taskId: input.taskId, status: 'loading', message: 'Loading in progress' };

      case 'complete':
        if (!input.data?.sealNumber) {
          return { success: false, taskId: input.taskId, status: 'error', message: 'Seal number required for completion' };
        }
        await this.loadingTaskRepo.updateStatus(input.taskId, 'completed', {
          completedAt: new Date().toISOString(),
          actual_weight: input.data.actualWeight,
          actual_volume: input.data.actualVolume,
          seal_number: input.data.sealNumber,
        });
        return { success: true, taskId: input.taskId, status: 'completed', message: 'Loading completed and sealed' };

      case 'exception':
        await this.loadingTaskRepo.updateStatus(input.taskId, 'exception', { exceptionReason: input.data?.exceptionReason });
        return { success: false, taskId: input.taskId, status: 'exception', message: `Exception: ${input.data?.exceptionReason}` };

      default:
        return { success: false, taskId: input.taskId, status: 'error', message: 'Unknown action' };
    }
  }
}
