<template>
  <div class="waves-page">
    <div class="page-header">
      <div class="header-left">
        <h1>波次管理</h1>
        <el-tag v-if="loading" type="info">加载中...</el-tag>
      </div>
      <el-button @click="openGenerateDialog" :loading="submitLoading" type="primary">
        <el-icon><Plus /></el-icon>
        生成波次
      </el-button>
    </div>

    <el-card class="search-card" shadow="never">
      <el-form :inline="true" :model="searchForm" class="search-form">
        <el-form-item label="波次编号">
          <el-input
            v-model="searchForm.waveNo"
            @keyup.enter="handleSearch"
            placeholder="波次编号"
            clearable
          />
        </el-form-item>
        <el-form-item label="状态">
          <el-select
            v-model="searchForm.status"
            clearable
            style="width: 160px"
            placeholder="请选择状态"
          >
            <el-option label="草稿" value="draft" />
            <el-option label="已释放" value="released" />
            <el-option label="已完成" value="completed" />
            <el-option label="已取消" value="cancelled" />
          </el-select>
        </el-form-item>
        <el-form-item label="仓库">
          <el-select
            v-model="searchForm.warehouseId"
            :remote-method="remoteWarehouseSearch"
            :loading="warehouseLoading"
            clearable
            style="width: 200px"
            placeholder="请选择仓库"
            filterable
            remote
          >
            <el-option v-for="w in warehouseOptions" :key="w.id" :label="w.name" :value="w.id" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button @click="handleSearch" type="primary"
            ><el-icon><Search /></el-icon> 搜索</el-button
          >
          <el-button @click="handleReset"
            ><el-icon><Refresh /></el-icon> 重置</el-button
          >
        </el-form-item>
      </el-form>
    </el-card>

    <el-card shadow="never">
      <el-table
        v-loading="loading"
        :data="tableData"
        @row-dblclick="openDetailDialog"
        row-key="id"
        border
        style="width: 100%"
      >
        <el-table-column prop="waveNo" label="波次编号" width="180" show-overflow-tooltip />
        <el-table-column prop="warehouseName" label="仓库" width="140" show-overflow-tooltip />
        <el-table-column label="状态" width="120">
          <template #default="scope"
            ><el-tag :type="statusTypeMap[scope.row.status]" size="small" effect="dark">{{
              statusLabelMap[scope.row.status]
            }}</el-tag></template
          >
        </el-table-column>
        <el-table-column prop="orderCount" label="订单数" width="100" align="right" />
        <el-table-column prop="totalQty" label="总数量" width="100" align="right" />
        <el-table-column prop="allocatedQty" label="已分配" width="100" align="right" />
        <el-table-column label="创建时间" width="160"
          ><template #default="scope">{{
            formatDate(scope.row.createdAt)
          }}</template></el-table-column
        >
        <el-table-column label="释放时间" width="160"
          ><template #default="scope">{{
            formatDate(scope.row.releasedAt)
          }}</template></el-table-column
        >
        <el-table-column label="完成时间" width="160"
          ><template #default="scope">{{
            formatDate(scope.row.completedAt)
          }}</template></el-table-column
        >
        <el-table-column label="操作" width="220" fixed="right">
          <template #default="scope">
            <el-button @click="openDetailDialog(scope.row)" size="small" type="primary" link
              >详情</el-button
            >
            <el-divider direction="vertical" />
            <el-button
              @click="releaseWave(scope.row)"
              v-if="scope.row.status === 'draft'"
              size="small"
              type="success"
              link
              >释放</el-button
            >
            <el-divider v-if="scope.row.status === 'draft'" direction="vertical" />
            <el-button
              @click="cancelWave(scope.row)"
              v-if="scope.row.status === 'draft'"
              size="small"
              type="danger"
              link
              >取消</el-button
            >
            <el-divider direction="vertical" />
            <el-popconfirm
              @confirm="handleDelete(scope.row.id)"
              title="确定要删除吗？"
              confirm-button-text="确定"
              cancel-button-text="取消"
            >
              <template #reference
                ><el-button size="small" type="danger" link>删除</el-button></template
              >
            </el-popconfirm>
          </template>
        </el-table-column>
      </el-table>

      <div class="pagination-wrapper">
        <el-pagination
          v-model:current-page="pagination.page"
          v-model:page-size="pagination.pageSize"
          :total="pagination.total"
          :page-sizes="[10, 20, 50, 100]"
          @size-change="handleSizeChange"
          @current-change="handleCurrentChange"
          layout="total, sizes, prev, pager, next, jumper"
        />
      </div>
    </el-card>

    <el-dialog
      v-model="generateDialogVisible"
      :title="generateDialogTitle"
      :before-close="handleGenerateDialogClose"
      width="600px"
      destroy-on-close
    >
      <el-form
        ref="generateFormRef"
        :model="generateForm"
        :rules="generateRules"
        label-width="120px"
      >
        <el-form-item label="仓库" prop="warehouseId">
          <el-select
            v-model="generateForm.warehouseId"
            :remote-method="remoteWarehouseSearch"
            :loading="warehouseLoading"
            placeholder="请选择仓库"
            filterable
            remote
            style="width: 100%"
          >
            <el-option v-for="w in warehouseOptions" :key="w.id" :label="w.name" :value="w.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="策略" prop="strategy">
          <el-select v-model="generateForm.strategy" placeholder="请选择策略" style="width: 100%">
            <el-option label="按订单优先级" value="priority" />
            <el-option label="按下单时间" value="order_time" />
            <el-option label="按客户分组" value="customer" />
            <el-option label="按区域分组" value="zone" />
          </el-select>
        </el-form-item>
        <el-form-item label="最大订单数" prop="maxOrders"
          ><el-input-number
            v-model="generateForm.maxOrders"
            :min="1"
            :max="100"
            :step="1"
            controls-position="right"
            placeholder="默认 50"
        /></el-form-item>
        <el-form-item label="最大数量" prop="maxQty"
          ><el-input-number
            v-model="generateForm.maxQty"
            :min="1"
            :step="1"
            controls-position="right"
            placeholder="默认不限制"
        /></el-form-item>
        <el-form-item label="仅分配可用库存" prop="onlyAllocated"
          ><el-switch
            v-model="generateForm.onlyAllocated"
            active-value="true"
            inactive-value="false"
        /></el-form-item>
      </el-form>
      <template #footer
        ><div class="dialog-footer">
          <el-button @click="generateDialogVisible = false">取消</el-button
          ><el-button :loading="submitLoading" @click="handleGenerate" type="primary"
            >生成</el-button
          >
        </div></template
      >
    </el-dialog>

    <el-dialog
      v-model="detailDialogVisible"
      :title="detailDialogTitle"
      width="900px"
      destroy-on-close
    >
      <el-card v-if="detailData" shadow="never">
        <div class="detail-section">
          <h4>基本信息</h4>
          <el-descriptions :column="4" border>
            <el-descriptions-item label="波次编号">{{ detailData.waveNo }}</el-descriptions-item>
            <el-descriptions-item label="仓库">{{ detailData.warehouseName }}</el-descriptions-item>
            <el-descriptions-item label="状态"
              ><el-tag :type="statusTypeMap[detailData.status]" effect="dark">{{
                statusLabelMap[detailData.status]
              }}</el-tag></el-descriptions-item
            >
            <el-descriptions-item label="策略">{{ detailData.strategy }}</el-descriptions-item>
            <el-descriptions-item label="订单数">{{ detailData.orderCount }}</el-descriptions-item>
            <el-descriptions-item label="总数量">{{ detailData.totalQty }}</el-descriptions-item>
            <el-descriptions-item label="已分配">{{
              detailData.allocatedQty
            }}</el-descriptions-item>
            <el-descriptions-item label="创建时间">{{
              formatDate(detailData.createdAt)
            }}</el-descriptions-item>
            <el-descriptions-item label="释放时间">{{
              formatDate(detailData.releasedAt)
            }}</el-descriptions-item>
            <el-descriptions-item label="完成时间">{{
              formatDate(detailData.completedAt)
            }}</el-descriptions-item>
          </el-descriptions>
        </div>
        <div class="detail-section">
          <div class="section-header">
            <h4>包含订单</h4>
            <el-button
              @click="openAddOrdersDialog(detailData)"
              v-if="detailData.status === 'draft'"
              size="small"
              ><el-icon><Plus /></el-icon> 添加订单</el-button
            >
          </div>
          <el-table :data="detailData.orders" border style="width: 100%">
            <el-table-column prop="orderNo" label="订单号" width="180" show-overflow-tooltip />
            <el-table-column
              prop="customerName"
              label="客户"
              min-width="180"
              show-overflow-tooltip
            />
            <el-table-column prop="totalQty" label="数量" width="100" align="right" />
            <el-table-column prop="allocatedQty" label="已分配" width="100" align="right" />
            <el-table-column label="状态" width="120"
              ><template #default="scope"
                ><el-tag :type="orderStatusTypeMap[scope.row.status]" size="small" effect="dark">{{
                  orderStatusLabelMap[scope.row.status]
                }}</el-tag></template
              ></el-table-column
            >
            <el-table-column
              v-if="detailData.status === 'draft'"
              label="操作"
              width="100"
              align="center"
            >
              <template #default="scope">
                <el-button
                  @click="removeOrderFromWave(detailData.id, scope.row.id)"
                  size="small"
                  type="danger"
                  link
                  ><el-icon><Delete /></el-icon
                ></el-button>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </el-card>
      <el-empty v-else description="加载中..." />
      <template #footer><el-button @click="detailDialogVisible = false">关闭</el-button></template>
    </el-dialog>

    <el-dialog
      v-model="addOrdersDialogVisible"
      :title="addOrdersDialogTitle"
      width="800px"
      destroy-on-close
    >
      <el-form ref="addOrdersFormRef" :model="addOrdersForm" label-width="120px">
        <el-form-item label="可选订单">
          <el-table
            :data="availableOrders"
            v-loading="addOrdersLoading"
            @selection-change="addOrdersSelectionChange"
            row-key="id"
            border
            style="width: 100%"
          >
            <el-table-column type="selection" width="55" align="center" />
            <el-table-column prop="orderNo" label="订单号" width="180" show-overflow-tooltip />
            <el-table-column
              prop="customerName"
              label="客户"
              min-width="180"
              show-overflow-tooltip
            />
            <el-table-column prop="totalQty" label="数量" width="100" align="right" />
            <el-table-column prop="priority" label="优先级" width="100" align="center">
              <template #default="scope"
                ><el-tag :type="priorityTypeMap[scope.row.priority]" size="small" effect="dark">{{
                  priorityLabelMap[scope.row.priority]
                }}</el-tag></template
              >
            </el-table-column>
            <el-table-column label="下单时间" width="160"
              ><template #default="scope">{{
                formatDate(scope.row.orderDate)
              }}</template></el-table-column
            >
          </el-table>
        </el-form-item>
      </el-form>
      <template #footer
        ><div class="dialog-footer">
          <el-button @click="addOrdersDialogVisible = false">取消</el-button
          ><el-button
            :loading="addOrdersSubmitLoading"
            @click="handleAddOrders"
            :disabled="addOrdersSelectedIds.length === 0"
            type="primary"
            >添加选中订单</el-button
          >
        </div></template
      >
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Plus, Search, Refresh, Delete, Box, ArrowRight } from '@element-plus/icons-vue';
import { api, ENDPOINTS } from '@/services/api';

const loading = ref(false);
const submitLoading = ref(false);
const generateDialogVisible = ref(false);
const generateDialogTitle = ref('生成波次');
const generateFormRef = ref();
const generateForm = reactive({
  warehouseId: '',
  strategy: 'priority',
  maxOrders: 50,
  maxQty: 0,
  onlyAllocated: true,
});

const generateRules = {
  warehouseId: [{ required: true, message: '请选择仓库', trigger: 'change' }],
  strategy: [{ required: true, message: '请选择策略', trigger: 'change' }],
};

const searchForm = reactive({ waveNo: '', status: '', warehouseId: '' });
const pagination = reactive({ page: 1, pageSize: 20, total: 0 });
const tableData = ref<any[]>([]);

const statusTypeMap: Record<string, string> = {
  draft: 'info',
  released: 'primary',
  completed: 'success',
  cancelled: 'danger',
};
const statusLabelMap: Record<string, string> = {
  draft: '草稿',
  released: '已释放',
  completed: '已完成',
  cancelled: '已取消',
};
const orderStatusTypeMap: Record<string, string> = {
  pending: 'info',
  allocated: 'primary',
  picking: 'warning',
  packed: 'success',
  shipped: 'success',
  cancelled: 'danger',
};
const orderStatusLabelMap: Record<string, string> = {
  pending: '待处理',
  allocated: '已分配',
  picking: '拣货中',
  packed: '已打包',
  shipped: '已发货',
  cancelled: '已取消',
};
const priorityTypeMap: Record<string, string> = {
  normal: 'info',
  high: 'warning',
  urgent: 'danger',
};
const priorityLabelMap: Record<string, string> = { normal: '普通', high: '高', urgent: '紧急' };

const formatDate = (dateStr: string | undefined) => {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const warehouseOptions = ref<any[]>([]);
const warehouseLoading = ref(false);

async function remoteWarehouseSearch(query: string) {
  warehouseLoading.value = true;
  try {
    const response: any = await api.get(ENDPOINTS.LOCATIONS_LIST, { keyword: query, limit: 20 });
    warehouseOptions.value = (response.data as any[]) || [];
  } catch (error) {
    console.error('Warehouse search failed:', error);
    warehouseOptions.value = [];
  } finally {
    warehouseLoading.value = false;
  }
}

async function fetchList() {
  loading.value = true;
  try {
    const params: Record<string, any> = {
      limit: pagination.pageSize,
      offset: (pagination.page - 1) * pagination.pageSize,
    };
    if (searchForm.waveNo) params.waveNo = searchForm.waveNo;
    if (searchForm.status) params.status = searchForm.status;
    if (searchForm.warehouseId) params.warehouseId = searchForm.warehouseId;
    const response: any = await api.get(ENDPOINTS.WAVES_LIST, params);
    tableData.value = (response.data as any[]) || [];
    pagination.total = response.meta?.total || (response.data as any[])?.length || 0;
  } catch (error) {
    console.error('Failed to fetch waves:', error);
    tableData.value = [];
    pagination.total = 0;
  } finally {
    loading.value = false;
  }
}

function handleSearch() {
  pagination.page = 1;
  fetchList();
}
function handleReset() {
  searchForm.waveNo = '';
  searchForm.status = '';
  searchForm.warehouseId = '';
  pagination.page = 1;
  fetchList();
}
function handleSizeChange(size: number) {
  pagination.pageSize = size;
  pagination.page = 1;
  fetchList();
}
function handleCurrentChange(page: number) {
  pagination.page = page;
  fetchList();
}

function openGenerateDialog() {
  resetGenerateForm();
  generateDialogVisible.value = true;
}

function resetGenerateForm() {
  generateForm.warehouseId = '';
  generateForm.strategy = 'priority';
  generateForm.maxOrders = 50;
  generateForm.maxQty = 0;
  generateForm.onlyAllocated = true;
  generateFormRef.value?.clearValidate?.();
}
function handleGenerateDialogClose(done: () => void) {
  resetGenerateForm();
  done();
}

async function handleGenerate() {
  generateFormRef.value?.validate?.(async (valid: boolean) => {
    if (!valid) return;
    submitLoading.value = true;
    try {
      const payload = {
        warehouseId: generateForm.warehouseId,
        strategy: generateForm.strategy,
        maxOrders: generateForm.maxOrders || undefined,
        maxQty: generateForm.maxQty || undefined,
        onlyAllocated: generateForm.onlyAllocated,
      };
      await api.post(ENDPOINTS.WAVES_GENERATE, payload);
      ElMessage.success('波次生成成功');
      generateDialogVisible.value = false;
      fetchList();
    } catch (error) {
      console.error('Generate error:', error);
    } finally {
      submitLoading.value = false;
    }
  });
}

async function handleDelete(id: string) {
  try {
    await ElMessageBox.confirm('确定要删除该波次吗？', '确认删除', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning',
    });
    await api.delete(ENDPOINTS.WAVES_GET(id));
    ElMessage.success('删除成功');
    fetchList();
  } catch (error) {
    if (error !== 'cancel') console.error('Delete error:', error);
  }
}

async function releaseWave(row: any) {
  try {
    await api.patch(ENDPOINTS.WAVES_RELEASE(row.id));
    ElMessage.success('释放成功');
    fetchList();
  } catch (error) {
    console.error('Release error:', error);
  }
}

async function cancelWave(row: any) {
  try {
    await ElMessageBox.confirm('确定要取消该波次吗？', '确认取消', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning',
    });
    await api.patch(ENDPOINTS.WAVES_STATUS(row.id), { status: 'cancelled' });
    ElMessage.success('取消成功');
    fetchList();
  } catch (error) {
    console.error('Cancel error:', error);
  }
}

const detailDialogVisible = ref(false);
const detailDialogTitle = ref('波次详情');
const detailData = ref<any>(null);

async function openDetailDialog(row: any) {
  detailDialogTitle.value = `波次详情 - ${row.waveNo}`;
  detailDialogVisible.value = true;
  detailData.value = null;
  try {
    const response: any = await api.get(ENDPOINTS.WAVES_GET(row.id));
    detailData.value = response.data;
  } catch (error) {
    console.error('Failed to fetch wave detail:', error);
  }
}

const addOrdersDialogVisible = ref(false);
const addOrdersDialogTitle = ref('添加订单到波次');
const addOrdersFormRef = ref();
const addOrdersForm = reactive({});
const addOrdersLoading = ref(false);
const addOrdersSubmitLoading = ref(false);
const availableOrders = ref<any[]>([]);
const addOrdersSelectedIds = ref<string[]>([]);

function addOrdersSelectionChange(selection: any[]) {
  addOrdersSelectedIds.value = selection.map((s) => s.id);
}

async function openAddOrdersDialog(wave: any) {
  addOrdersDialogTitle.value = `添加订单到波次 - ${wave.waveNo}`;
  addOrdersDialogVisible.value = true;
  addOrdersSelectedIds.value = [];
  addOrdersLoading.value = true;
  try {
    const response: any = await api.get(ENDPOINTS.ORDERS_LIST, {
      status: 'pending,allocated',
      limit: 100,
    });
    availableOrders.value = (response.data as any[]) || [];
  } catch (error) {
    console.error('Failed to fetch available orders:', error);
    availableOrders.value = [];
  } finally {
    addOrdersLoading.value = false;
  }
}

async function handleAddOrders() {
  if (addOrdersSelectedIds.value.length === 0) return;
  addOrdersSubmitLoading.value = true;
  try {
    const waveId = detailData.value?.id;
    if (!waveId) return;
    for (const orderId of addOrdersSelectedIds.value) {
      await api.post(ENDPOINTS.WAVES_ADD_ORDERS(waveId), { orderIds: [orderId] });
    }
    ElMessage.success('添加成功');
    addOrdersDialogVisible.value = false;
    await openDetailDialog(detailData.value);
  } catch (error) {
    console.error('Add orders error:', error);
  } finally {
    addOrdersSubmitLoading.value = false;
  }
}

async function removeOrderFromWave(waveId: string, orderId: string) {
  try {
    await ElMessageBox.confirm('确定要从波次中移除该订单吗？', '确认移除', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning',
    });
    await api.delete(ENDPOINTS.WAVES_REMOVE_ORDER(waveId, orderId));
    ElMessage.success('移除成功');
    await openDetailDialog(detailData.value);
  } catch (error) {
    if (error !== 'cancel') console.error('Remove order error:', error);
  }
}

onMounted(() => {
  fetchList();
});
</script>

<style scoped>
.waves-page {
  padding: 20px;
}
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}
.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}
.header-left h1 {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
}
.search-card {
  margin-bottom: 20px;
}
.search-form :deep(.el-form-item) {
  margin-bottom: 0;
}
.pagination-wrapper {
  margin-top: 16px;
  display: flex;
  justify-content: flex-end;
}
.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}
.detail-section {
  margin-bottom: 24px;
}
.detail-section h4 {
  margin: 0 0 16px 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}
.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}
.section-header h4 {
  margin: 0;
}
</style>
