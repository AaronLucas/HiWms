<template>
  <div class="inventory-page">
    <div class="page-header">
      <div class="header-left">
        <h1>库存管理</h1>
        <el-tag v-if="loading" type="info">加载中...</el-tag>
      </div>
      <el-button @click="openAdjustDialog" :loading="submitLoading" type="primary">
        <el-icon><Edit /></el-icon>
        库存调整
      </el-button>
      <el-button @click="openTransferDialog" :loading="submitLoading" type="success">
        <el-icon><ArrowRight /></el-icon>
        移库
      </el-button>
      <el-button @click="openReserveDialog" :loading="submitLoading" type="info">
        <el-icon><Lock /></el-icon>
        预留
      </el-button>
    </div>

    <el-card class="search-card" shadow="never">
      <el-form :inline="true" :model="searchForm" class="search-form">
        <el-form-item label="商品">
          <el-input
            v-model="searchForm.productSku"
            @keyup.enter="handleSearch"
            placeholder="SKU/名称"
            clearable
          />
        </el-form-item>
        <el-form-item label="库位">
          <el-input v-model="searchForm.locationCode" placeholder="库位编码" clearable />
        </el-form-item>
        <el-form-item label="批次号">
          <el-input v-model="searchForm.batchNo" placeholder="批次号" clearable />
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="searchForm.status" clearable style="width: 140px">
            <el-option label="正常" value="normal" />
            <el-option label="预留" value="reserved" />
            <el-option label="锁定" value="locked" />
            <el-option label="质检" value="quarantine" />
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
      <el-table v-loading="loading" :data="tableData" row-key="id" border style="width: 100%">
        <el-table-column prop="productSku" label="商品 SKU" width="140" show-overflow-tooltip />
        <el-table-column
          prop="productName"
          label="商品名称"
          min-width="180"
          show-overflow-tooltip
        />
        <el-table-column prop="locationCode" label="库位" width="140" show-overflow-tooltip />
        <el-table-column prop="batchNo" label="批次号" width="140" show-overflow-tooltip />
        <el-table-column prop="serialNo" label="序列号" width="160" show-overflow-tooltip />
        <el-table-column prop="quantity" label="数量" width="100" align="right">
          <template #default="scope"
            ><span :class="scope.row.quantity <= 0 ? 'text-danger' : ''">{{
              scope.row.quantity
            }}</span></template
          >
        </el-table-column>
        <el-table-column prop="reservedQty" label="预留量" width="100" align="right" />
        <el-table-column prop="lockedQty" label="锁定量" width="100" align="right" />
        <el-table-column label="状态" width="120">
          <template #default="scope"
            ><el-tag :type="statusTypeMap[scope.row.status]" size="small" effect="dark">{{
              statusLabelMap[scope.row.status]
            }}</el-tag></template
          >
        </el-table-column>
        <el-table-column label="效期" width="140">
          <template #default="scope"
            ><span v-if="scope.row.expiryDate">{{ formatDate(scope.row.expiryDate) }}</span
            ><span v-else class="text-muted">无效期</span></template
          >
        </el-table-column>
        <el-table-column label="创建时间" width="160"
          ><template #default="scope">{{
            formatDate(scope.row.createdAt)
          }}</template></el-table-column
        >
        <el-table-column label="操作" width="180" fixed="right">
          <template #default="scope">
            <el-button @click="openAdjustDialog(scope.row)" size="small" type="primary" link
              >调整</el-button
            >
            <el-divider direction="vertical" />
            <el-button @click="openTransferDialog(scope.row)" size="small" type="info" link
              >移库</el-button
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
      v-model="dialogVisible"
      :title="dialogTitle"
      :before-close="handleDialogClose"
      width="600px"
      destroy-on-close
    >
      <el-form ref="formRef" :model="form" :rules="rules" label-width="120px">
        <el-form-item label="商品" prop="productId"
          ><el-select
            v-model="form.productId"
            :remote-method="remoteProductSearch"
            :loading="productLoading"
            placeholder="请选择商品"
            filterable
            remote
            style="width: 100%"
            ><el-option
              v-for="p in productOptions"
              :key="p.id"
              :label="p.sku + ' - ' + p.name"
              :value="p.id" /></el-select
        ></el-form-item>
        <el-form-item label="库位" prop="locationId"
          ><el-select
            v-model="form.locationId"
            :remote-method="remoteLocationSearch"
            :loading="locationLoading"
            placeholder="请选择库位"
            filterable
            remote
            style="width: 100%"
            ><el-option
              v-for="l in locationOptions"
              :key="l.id"
              :label="l.code"
              :value="l.id" /></el-select
        ></el-form-item>
        <el-form-item label="批次号" prop="batchNo"
          ><el-input v-model="form.batchNo" placeholder="可选" maxlength="50" clearable
        /></el-form-item>
        <el-form-item label="序列号" prop="serialNo"
          ><el-input
            v-model="form.serialNo"
            placeholder="可选（唯一追踪商品必填）"
            maxlength="100"
            clearable
        /></el-form-item>
        <el-form-item label="数量" prop="quantity"
          ><el-input-number
            v-model="form.quantity"
            :min="1"
            :step="1"
            controls-position="right"
            placeholder="请输入数量"
        /></el-form-item>
        <el-form-item label="效期" prop="expiryDate"
          ><el-date-picker
            v-model="form.expiryDate"
            type="date"
            placeholder="可选"
            value-format="YYYY-MM-DD"
            clearable
        /></el-form-item>
        <el-form-item v-if="dialogType === 'adjust'" label="操作类型"
          ><el-radio-group v-model="form.adjustType"
            ><el-radio label="increase">增加</el-radio><el-radio label="decrease">减少</el-radio
            ><el-radio label="set">设定</el-radio></el-radio-group
          ></el-form-item
        >
        <el-form-item v-if="dialogType === 'transfer'" label="目标库位" prop="toLocationId"
          ><el-select
            v-model="form.toLocationId"
            :remote-method="remoteLocationSearch"
            :loading="toLocationLoading"
            placeholder="请选择目标库位"
            filterable
            remote
            style="width: 100%"
            ><el-option
              v-for="l in locationOptions"
              :key="l.id"
              :label="l.code"
              :value="l.id" /></el-select
        ></el-form-item>
        <el-form-item label="备注" prop="reason"
          ><el-input
            v-model="form.reason"
            :rows="2"
            type="textarea"
            placeholder="请输入原因"
            maxlength="200"
        /></el-form-item>
      </el-form>
      <template #footer
        ><div class="dialog-footer">
          <el-button @click="dialogVisible = false">取消</el-button
          ><el-button :loading="submitLoading" @click="handleSubmit" type="primary">确定</el-button>
        </div></template
      >
    </el-dialog>

    <el-dialog
      v-model="reserveDialogVisible"
      :title="reserveDialogTitle"
      width="500px"
      destroy-on-close
    >
      <el-form ref="reserveFormRef" :model="reserveForm" :rules="reserveRules" label-width="100px">
        <el-form-item label="商品" prop="productId"
          ><el-select
            v-model="reserveForm.productId"
            :remote-method="remoteProductSearch"
            :loading="productLoading"
            placeholder="请选择商品"
            filterable
            remote
            style="width: 100%"
            ><el-option
              v-for="p in productOptions"
              :key="p.id"
              :label="p.sku + ' - ' + p.name"
              :value="p.id" /></el-select
        ></el-form-item>
        <el-form-item label="库位" prop="locationId"
          ><el-select
            v-model="reserveForm.locationId"
            :remote-method="remoteLocationSearch"
            :loading="locationLoading"
            placeholder="请选择库位"
            filterable
            remote
            style="width: 100%"
            ><el-option
              v-for="l in locationOptions"
              :key="l.id"
              :label="l.code"
              :value="l.id" /></el-select
        ></el-form-item>
        <el-form-item label="数量" prop="quantity"
          ><el-input-number
            v-model="reserveForm.quantity"
            :min="1"
            :step="1"
            controls-position="right"
        /></el-form-item>
        <el-form-item label="关联单据" prop="orderId"
          ><el-input
            v-model="reserveForm.orderId"
            placeholder="订单/工单 ID（可选）"
            maxlength="50"
            clearable
        /></el-form-item>
        <el-form-item label="过期时间" prop="expiresAt"
          ><el-date-picker
            v-model="reserveForm.expiresAt"
            type="datetime"
            placeholder="可选"
            value-format="YYYY-MM-DD HH:mm:ss"
            clearable
        /></el-form-item>
      </el-form>
      <template #footer
        ><el-button @click="reserveDialogVisible = false">取消</el-button
        ><el-button :loading="reserveSubmitLoading" @click="handleReserveSubmit" type="primary">{{
          reserveDialogType === 'reserve' ? '预留' : '锁定'
        }}</el-button></template
      >
    </el-dialog>

    <el-dialog v-model="historyDialogVisible" title="库存变动历史" width="900px" destroy-on-close>
      <el-table :data="historyData" border style="width: 100%" row-key="id">
        <el-table-column prop="productSku" label="商品 SKU" width="140" show-overflow-tooltip />
        <el-table-column prop="locationCode" label="库位" width="140" show-overflow-tooltip />
        <el-table-column prop="quantityBefore" label="变动前" width="100" align="right" />
        <el-table-column prop="quantityAfter" label="变动后" width="100" align="right" />
        <el-table-column prop="changeQty" label="变动量" width="100" align="right"
          ><template #default="scope"
            ><span :class="scope.row.changeQty > 0 ? 'text-success' : 'text-danger'"
              >{{ scope.row.changeQty > 0 ? '+' : '' }}{{ scope.row.changeQty }}</span
            ></template
          ></el-table-column
        >
        <el-table-column prop="changeType" label="变动类型" width="140"
          ><template #default="scope"
            ><el-tag size="small" effect="plain">{{ scope.row.changeType }}</el-tag></template
          ></el-table-column
        >
        <el-table-column prop="reason" label="原因" min-width="200" show-overflow-tooltip />
        <el-table-column prop="referenceId" label="关联单据" width="160" show-overflow-tooltip />
        <el-table-column prop="createdAt" label="时间" width="180"
          ><template #default="scope">{{
            formatDate(scope.row.createdAt)
          }}</template></el-table-column
        >
      </el-table>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  Edit,
  ArrowRight,
  Lock,
  Delete,
  Search,
  Refresh,
  ArrowRight as ArrowRightIcon,
  ArrowLeft,
  Timer,
  Box,
} from '@element-plus/icons-vue';
import { api, ENDPOINTS } from '@/services/api';

const loading = ref(false);
const submitLoading = ref(false);
const dialogVisible = ref(false);
const dialogTitle = ref('');
const dialogType = ref<'adjust' | 'transfer'>('adjust');
const formRef = ref();
const form = reactive({
  id: '',
  productId: '',
  locationId: '',
  toLocationId: '',
  batchNo: '',
  serialNo: '',
  quantity: 1,
  expiryDate: '',
  adjustType: 'increase',
  reason: '',
});

const rules = {
  productId: [{ required: true, message: '请选择商品', trigger: 'change' }],
  locationId: [{ required: true, message: '请选择库位', trigger: 'change' }],
  quantity: [
    { required: true, message: '请输入数量', trigger: 'blur' },
    { min: 1, message: '数量必须大于 0', trigger: 'blur' },
  ],
  reason: [{ required: true, message: '请输入原因', trigger: 'blur' }],
  toLocationId: [{ required: true, message: '请选择目标库位', trigger: 'change' }],
};

const searchForm = reactive({ productSku: '', locationCode: '', batchNo: '', status: '' });
const pagination = reactive({ page: 1, pageSize: 20, total: 0 });
const tableData = ref<any[]>([]);
const statusTypeMap: Record<string, string> = {
  normal: 'success',
  reserved: 'warning',
  locked: 'info',
  quarantine: 'danger',
};
const statusLabelMap: Record<string, string> = {
  normal: '正常',
  reserved: '预留',
  locked: '锁定',
  quarantine: '隔离',
};

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

const productOptions = ref<any[]>([]);
const locationOptions = ref<any[]>([]);
const productLoading = ref(false);
const locationLoading = ref(false);
const toLocationLoading = ref(false);

async function remoteProductSearch(query: string) {
  if (!query) return;
  productLoading.value = true;
  try {
    const response: any = await api.get(ENDPOINTS.MATERIALS_LIST, { q: query, limit: 20 });
    productOptions.value = (response.data as any[]) || [];
  } catch (error) {
    console.error('Product search failed:', error);
    productOptions.value = [];
  } finally {
    productLoading.value = false;
  }
}
async function remoteLocationSearch(query: string) {
  locationLoading.value = true;
  try {
    const response: any = await api.get(ENDPOINTS.LOCATIONS_LIST, { keyword: query, limit: 20 });
    locationOptions.value = (response.data as any[]) || [];
  } catch (error) {
    console.error('Location search failed:', error);
    locationOptions.value = [];
  } finally {
    locationLoading.value = false;
  }
}

async function fetchList() {
  loading.value = true;
  try {
    const params: Record<string, any> = {
      limit: pagination.pageSize,
      offset: (pagination.page - 1) * pagination.pageSize,
    };
    if (searchForm.productSku) params.productSku = searchForm.productSku;
    if (searchForm.locationCode) params.locationCode = searchForm.locationCode;
    if (searchForm.batchNo) params.batchNo = searchForm.batchNo;
    if (searchForm.status) params.status = searchForm.status;
    const response: any = await api.get(ENDPOINTS.INVENTORY_LIST, params);
    tableData.value = (response.data as any[]) || [];
    pagination.total = response.meta?.total || (response.data as any[])?.length || 0;
  } catch (error) {
    console.error('Failed to fetch inventory:', error);
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
  searchForm.productSku = '';
  searchForm.locationCode = '';
  searchForm.batchNo = '';
  searchForm.status = '';
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

function openAdjustDialog(row?: any) {
  resetForm();
  dialogType.value = 'adjust';
  dialogTitle.value = row ? '库存调整' : '新增库存';
  if (row) {
    form.id = row.id;
    form.productId = row.productId;
    form.locationId = row.locationId;
    form.batchNo = row.batchNo || '';
    form.serialNo = row.serialNo || '';
    form.quantity = row.quantity || 1;
    form.expiryDate = row.expiryDate || '';
    form.adjustType = 'increase';
  }
  dialogVisible.value = true;
}
function openTransferDialog(row?: any) {
  resetForm();
  dialogType.value = 'transfer';
  dialogTitle.value = '库存移库';
  if (row) {
    form.id = row.id;
    form.productId = row.productId;
    form.locationId = row.locationId;
    form.batchNo = row.batchNo || '';
    form.serialNo = row.serialNo || '';
    form.quantity = row.quantity || 1;
  }
  dialogVisible.value = true;
}
function openReserveDialog(row?: any) {
  reserveDialogType.value = row?.status === 'locked' ? 'lock' : 'reserve';
  reserveDialogTitle.value = reserveDialogType.value === 'lock' ? '锁定库存' : '预留库存';
  resetReserveForm();
  if (row) {
    reserveForm.productId = row.productId;
    reserveForm.locationId = row.locationId;
    reserveForm.quantity = row.quantity || 1;
  }
  reserveDialogVisible.value = true;
}

function resetForm() {
  form.id = '';
  form.productId = '';
  form.locationId = '';
  form.toLocationId = '';
  form.batchNo = '';
  form.serialNo = '';
  form.quantity = 1;
  form.expiryDate = '';
  form.adjustType = 'increase';
  form.reason = '';
  formRef.value?.clearValidate?.();
}
function handleDialogClose(done: () => void) {
  resetForm();
  done();
}

async function handleSubmit() {
  formRef.value?.validate?.(async (valid: boolean) => {
    if (!valid) return;
    submitLoading.value = true;
    try {
      if (dialogType.value === 'adjust') {
        const payload = {
          productId: form.productId,
          locationId: form.locationId,
          batchNo: form.batchNo || undefined,
          serialNo: form.serialNo || undefined,
          quantity: form.quantity,
          expiryDate: form.expiryDate || undefined,
          adjustType: form.adjustType,
          reason: form.reason,
        };
        await api.post(ENDPOINTS.INVENTORY_ADJUST, payload);
        ElMessage.success('库存调整成功');
      } else if (dialogType.value === 'transfer') {
        const payload = {
          productId: form.productId,
          fromLocationId: form.locationId,
          toLocationId: form.toLocationId,
          batchNo: form.batchNo || undefined,
          serialNo: form.serialNo || undefined,
          quantity: form.quantity,
          reason: form.reason,
        };
        await api.post(ENDPOINTS.INVENTORY_TRANSFER, payload);
        ElMessage.success('移库成功');
      }
      dialogVisible.value = false;
      fetchList();
    } catch (error) {
      console.error('Submit error:', error);
    } finally {
      submitLoading.value = false;
    }
  });
}

async function handleDelete(id: string) {
  try {
    await ElMessageBox.confirm('确定要删除该库存记录吗？', '确认删除', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning',
    });
    await api.delete(ENDPOINTS.INVENTORY_GET(id));
    ElMessage.success('删除成功');
    fetchList();
  } catch (error) {
    if (error !== 'cancel') console.error('Delete error:', error);
  }
}

const reserveDialogVisible = ref(false);
const reserveDialogTitle = ref('预留库存');
const reserveDialogType = ref<'reserve' | 'lock'>('reserve');
const reserveFormRef = ref();
const reserveSubmitLoading = ref(false);
const reserveForm = reactive({
  productId: '',
  locationId: '',
  quantity: 1,
  orderId: '',
  expiresAt: '',
});
const reserveRules = {
  productId: [{ required: true, message: '请选择商品', trigger: 'change' }],
  locationId: [{ required: true, message: '请选择库位', trigger: 'change' }],
  quantity: [
    { required: true, message: '请输入数量', trigger: 'blur' },
    { min: 1, message: '数量必须大于 0', trigger: 'blur' },
  ],
};

function resetReserveForm() {
  reserveForm.productId = '';
  reserveForm.locationId = '';
  reserveForm.quantity = 1;
  reserveForm.orderId = '';
  reserveForm.expiresAt = '';
  reserveFormRef.value?.clearValidate?.();
}

async function handleReserveSubmit() {
  reserveFormRef.value?.validate?.(async (valid: boolean) => {
    if (!valid) return;
    reserveSubmitLoading.value = true;
    try {
      const payload = {
        productId: reserveForm.productId,
        locationId: reserveForm.locationId,
        quantity: reserveForm.quantity,
        orderId: reserveForm.orderId || undefined,
        expiresAt: reserveForm.expiresAt || undefined,
      };
      if (reserveDialogType.value === 'reserve') {
        await api.post(ENDPOINTS.INVENTORY_RESERVE, payload);
        ElMessage.success('预留成功');
      } else {
        await api.post(ENDPOINTS.INVENTORY_LOCK, payload);
        ElMessage.success('锁定成功');
      }
      reserveDialogVisible.value = false;
      fetchList();
    } catch (error) {
      console.error('Reserve submit error:', error);
    } finally {
      reserveSubmitLoading.value = false;
    }
  });
}

const historyDialogVisible = ref(false);
const historyData = ref<any[]>([]);
async function openHistoryDialog() {
  historyDialogVisible.value = true;
  try {
    const response: any = await api.get(ENDPOINTS.INVENTORY_HISTORY, { limit: 100 });
    historyData.value = (response.data as any[]) || [];
  } catch (error) {
    console.error('Failed to fetch history:', error);
    historyData.value = [];
  }
}

onMounted(() => {
  fetchList();
});
</script>
