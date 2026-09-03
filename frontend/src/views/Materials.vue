<template>
  <div class="materials-page">
    <div class="page-header">
      <div class="header-left">
        <h1>物料管理</h1>
        <el-tag v-if="loading" type="info">加载中...</el-tag>
      </div>
      <el-button @click="openCreateDialog" :loading="submitLoading" type="primary">
        <el-icon><Plus /></el-icon>
        新建物料
      </el-button>
    </div>

    <el-card class="search-card" shadow="never">
      <el-form :inline="true" :model="searchForm" class="search-form">
        <el-form-item label="关键词">
          <el-input
            v-model="searchForm.keyword"
            @keyup.enter="handleSearch"
            placeholder="SKU/名称/条码"
            clearable
          />
        </el-form-item>
        <el-form-item label="ABC 分类">
          <el-select v-model="searchForm.abcClass" clearable style="width: 140px">
            <el-option label="A 类" value="A" />
            <el-option label="B 类" value="B" />
            <el-option label="C 类" value="C" />
          </el-select>
        </el-form-item>
        <el-form-item label="基础单位">
          <el-input
            v-model="searchForm.baseUom"
            placeholder="PCS/箱/托"
            clearable
            style="width: 140px"
          />
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
        <el-table-column type="expand">
          <template #default="props">
            <div v-if="props.row.barcodes && props.row.barcodes.length" class="expand-content">
              <h4>关联条码 ({{ props.row.barcodes.length }})</h4>
              <el-tag
                v-for="bc in props.row.barcodes"
                :key="bc.id"
                size="small"
                effect="plain"
                class="barcode-tag"
              >
                {{ bc.barcode }} ({{ bc.targetType }}) {{ bc.isPrimary ? '主' : '' }}
              </el-tag>
            </div>
            <div v-else class="expand-content">暂无条码</div>
          </template>
        </el-table-column>

        <el-table-column prop="sku" label="SKU" width="140" show-overflow-tooltip />
        <el-table-column prop="name" label="名称" min-width="180" show-overflow-tooltip />
        <el-table-column label="基础单位" width="100">
          <template #default="scope"
            ><el-tag size="small">{{ scope.row.baseUom }}</el-tag></template
          >
        </el-table-column>
        <el-table-column label="ABC 分类" width="100">
          <template #default="scope">
            <el-tag :type="abcTypeMap[scope.row.abcClass]" size="small" effect="dark"
              >{{ scope.row.abcClass }} 类</el-tag
            >
          </template>
        </el-table-column>
        <el-table-column label="体积/重量" width="160">
          <template #default="scope">
            <span v-if="scope.row.unitVolume || scope.row.unitWeight"
              >{{ scope.row.unitVolume || 0 }} m³ / {{ scope.row.unitWeight || 0 }} kg</span
            >
            <span v-else class="text-muted">未设置</span>
          </template>
        </el-table-column>
        <el-table-column label="唯一追踪" width="100">
          <template #default="scope">
            <el-tag :type="scope.row.requiresUniqueTracking ? 'success' : 'info'" size="small">{{
              scope.row.requiresUniqueTracking ? '是' : '否'
            }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="保质期" width="100">
          <template #default="scope"
            ><span v-if="scope.row.shelfLifeDays">{{ scope.row.shelfLifeDays }} 天</span
            ><span v-else class="text-muted">不限</span></template
          >
        </el-table-column>
        <el-table-column label="创建时间" width="160">
          <template #default="scope">{{ formatDate(scope.row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="200" fixed="right">
          <template #default="scope">
            <el-button @click="openEditDialog(scope.row)" size="small" type="primary" link
              >编辑</el-button
            >
            <el-divider direction="vertical" />
            <el-button @click="openBarcodesDialog(scope.row)" size="small" type="info" link
              >条码</el-button
            >
            <el-divider direction="vertical" />
            <el-button @click="openConstraintsDialog(scope.row)" size="small" type="warning" link
              >约束</el-button
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
      width="720px"
      destroy-on-close
    >
      <el-form ref="formRef" :model="form" :rules="rules" label-width="100px">
        <el-row :gutter="20">
          <el-col :span="12"
            ><el-form-item label="SKU" prop="sku"
              ><el-input
                v-model="form.sku"
                :disabled="!!form.id"
                placeholder="请输入 SKU"
                maxlength="100" /></el-form-item
          ></el-col>
          <el-col :span="12"
            ><el-form-item label="名称" prop="name"
              ><el-input
                v-model="form.name"
                placeholder="请输入物料名称"
                maxlength="200" /></el-form-item
          ></el-col>
          <el-col :span="12"
            ><el-form-item label="基础单位" prop="baseUom"
              ><el-input v-model="form.baseUom" placeholder="PCS" maxlength="20" /></el-form-item
          ></el-col>
          <el-col :span="12"
            ><el-form-item label="ABC 分类" prop="abcClass"
              ><el-select v-model="form.abcClass" placeholder="请选择" style="width: 100%"
                ><el-option label="A 类" value="A" /><el-option label="B 类" value="B" /><el-option
                  label="C 类"
                  value="C" /></el-select></el-form-item
          ></el-col>
          <el-col :span="12"
            ><el-form-item label="体积" prop="unitVolume"
              ><el-input-number
                v-model="form.unitVolume"
                :min="0"
                :step="0.0001"
                :precision="4"
                controls-position="right"
                placeholder="m³" /></el-form-item
          ></el-col>
          <el-col :span="12"
            ><el-form-item label="重量" prop="unitWeight"
              ><el-input-number
                v-model="form.unitWeight"
                :min="0"
                :step="0.01"
                :precision="3"
                controls-position="right"
                placeholder="kg" /></el-form-item
          ></el-col>
          <el-col :span="12"
            ><el-form-item label="保质期" prop="shelfLifeDays"
              ><el-input-number
                v-model="form.shelfLifeDays"
                :min="1"
                controls-position="right"
                placeholder="天" /></el-form-item
          ></el-col>
          <el-col :span="12"
            ><el-form-item label="唯一追踪" prop="requiresUniqueTracking"
              ><el-switch
                v-model="form.requiresUniqueTracking"
                active-value="true"
                inactive-value="false" /></el-form-item
          ></el-col>
        </el-row>
        <el-form-item label="描述" prop="description"
          ><el-input
            v-model="form.description"
            :rows="3"
            type="textarea"
            placeholder="请输入描述"
            maxlength="500"
        /></el-form-item>
      </el-form>
      <template #footer>
        <div class="dialog-footer">
          <el-button @click="dialogVisible = false">取消</el-button
          ><el-button :loading="submitLoading" @click="handleSubmit" type="primary">{{
            form.id ? '更新' : '创建'
          }}</el-button>
        </div>
      </template>
    </el-dialog>

    <el-dialog v-model="barcodesDialogVisible" title="条码管理" width="720px" destroy-on-close>
      <div class="barcodes-header">
        <h4>{{ currentMaterial?.name }} ({{ currentMaterial?.sku }})</h4>
        <el-button @click="openBarcodeFormDialog" type="primary" size="small"
          ><el-icon><Plus /></el-icon> 添加条码</el-button
        >
      </div>
      <el-table :data="currentBarcodes" border style="width: 100%" row-key="id">
        <el-table-column prop="barcode" label="条码" min-width="180" show-overflow-tooltip />
        <el-table-column prop="targetType" label="目标类型" width="120"
          ><template #default="scope"
            ><el-tag size="small" effect="plain">{{ scope.row.targetType }}</el-tag></template
          ></el-table-column
        >
        <el-table-column
          prop="targetSubtype"
          label="目标子类型"
          width="140"
          show-overflow-tooltip
        />
        <el-table-column label="主条码" width="100"
          ><template #default="scope"
            ><el-tag :type="scope.row.isPrimary ? 'success' : 'info'" size="small">{{
              scope.row.isPrimary ? '是' : '否'
            }}</el-tag></template
          ></el-table-column
        >
        <el-table-column label="操作" width="120" fixed="right"
          ><template #default="scope"
            ><el-button @click="handleDeleteBarcode(scope.row.id)" size="small" type="danger" link
              >删除</el-button
            ></template
          ></el-table-column
        >
      </el-table>
    </el-dialog>

    <el-dialog
      v-model="barcodeFormDialogVisible"
      :title="barcodeFormTitle"
      width="500px"
      destroy-on-close
    >
      <el-form ref="barcodeFormRef" :model="barcodeForm" :rules="barcodeRules" label-width="100px">
        <el-form-item label="条码" prop="barcode"
          ><el-input v-model="barcodeForm.barcode" placeholder="请输入条码" maxlength="100"
        /></el-form-item>
        <el-form-item label="目标类型" prop="targetType"
          ><el-select v-model="barcodeForm.targetType" placeholder="请选择" style="width: 100%"
            ><el-option label="物料" value="product" /><el-option
              label="SKU"
              value="sku" /><el-option label="批次" value="batch" /><el-option
              label="序列号"
              value="serial" /></el-select
        ></el-form-item>
        <el-form-item label="目标子类型" prop="targetSubtype"
          ><el-input v-model="barcodeForm.targetSubtype" placeholder="可选" maxlength="50"
        /></el-form-item>
        <el-form-item label="主条码" prop="isPrimary"
          ><el-switch v-model="barcodeForm.isPrimary" active-value="true" inactive-value="false"
        /></el-form-item>
      </el-form>
      <template #footer
        ><el-button @click="barcodeFormDialogVisible = false">取消</el-button
        ><el-button :loading="barcodeSubmitLoading" @click="handleBarcodeSubmit" type="primary">{{
          barcodeFormTitle.includes('编辑') ? '更新' : '添加'
        }}</el-button></template
      >
    </el-dialog>

    <el-dialog v-model="constraintsDialogVisible" title="约束管理" width="720px" destroy-on-close>
      <div class="barcodes-header">
        <h4>{{ currentMaterial?.name }} ({{ currentMaterial?.sku }})</h4>
        <el-button @click="openConstraintFormDialog" type="primary" size="small"
          ><el-icon><Plus /></el-icon> 添加约束</el-button
        >
      </div>
      <el-table :data="currentConstraints" border style="width: 100%" row-key="id">
        <el-table-column prop="constraintType" label="约束类型" min-width="180"
          ><template #default="scope"
            ><el-tag size="small" effect="plain">{{ scope.row.constraintType }}</el-tag></template
          ></el-table-column
        >
        <el-table-column
          prop="constraintValue"
          label="约束值"
          min-width="150"
          show-overflow-tooltip
        />
        <el-table-column label="严重程度" width="120"
          ><template #default="scope"
            ><el-tag :type="severityTypeMap[scope.row.severity]" size="small" effect="dark">{{
              scope.row.severity
            }}</el-tag></template
          ></el-table-column
        >
        <el-table-column label="操作" width="100" fixed="right"
          ><template #default="scope"
            ><el-button
              @click="handleDeleteConstraint(scope.row.id)"
              size="small"
              type="danger"
              link
              >删除</el-button
            ></template
          ></el-table-column
        >
      </el-table>
    </el-dialog>

    <el-dialog
      v-model="constraintFormDialogVisible"
      title="添加约束"
      width="500px"
      destroy-on-close
    >
      <el-form
        ref="constraintFormRef"
        :model="constraintForm"
        :rules="constraintRules"
        label-width="100px"
      >
        <el-form-item label="约束类型" prop="constraintType"
          ><el-select
            v-model="constraintForm.constraintType"
            placeholder="请选择"
            style="width: 100%"
            ><el-option label="库位类型" value="location_type" /><el-option
              label="冷链要求"
              value="cold_chain" /><el-option
              label="危险品等级"
              value="dangerous_goods" /><el-option
              label="温度范围"
              value="temperature_range" /><el-option
              label="堆码层数"
              value="stacking_limit" /><el-option label="自定义" value="custom" /></el-select
        ></el-form-item>
        <el-form-item label="约束值" prop="constraintValue"
          ><el-input
            v-model="constraintForm.constraintValue"
            placeholder="请输入约束值"
            maxlength="200"
        /></el-form-item>
        <el-form-item label="严重程度" prop="severity"
          ><el-select v-model="constraintForm.severity" placeholder="请选择" style="width: 100%"
            ><el-option label="ERROR (阻塞)" value="ERROR" /><el-option
              label="WARN (警告)"
              value="WARN" /><el-option label="INFO (提示)" value="INFO" /></el-select
        ></el-form-item>
      </el-form>
      <template #footer
        ><el-button @click="constraintFormDialogVisible = false">取消</el-button
        ><el-button
          :loading="constraintSubmitLoading"
          @click="handleConstraintSubmit"
          type="primary"
          >添加</el-button
        ></template
      >
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, type Component } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  Plus,
  Search,
  Refresh,
  Box,
  ShoppingCart,
  Connection,
  Setting,
  Edit,
  Delete,
  Ticket,
  Warning,
  Check,
  Close,
  Document,
} from '@element-plus/icons-vue';
import { api, ENDPOINTS } from '@/services/api';

const loading = ref(false);
const submitLoading = ref(false);
const dialogVisible = ref(false);
const dialogTitle = ref('新建物料');
const formRef = ref();
const form = reactive({
  id: '',
  sku: '',
  name: '',
  baseUom: 'PCS',
  abcClass: 'C',
  unitVolume: null,
  unitWeight: null,
  shelfLifeDays: null,
  requiresUniqueTracking: false,
  description: '',
});

const rules = {
  sku: [
    { required: true, message: '请输入 SKU', trigger: 'blur' },
    {
      pattern: /^[A-Z0-9_-]+$/,
      message: 'SKU 只能包含大写字母、数字、下划线、连字符',
      trigger: 'blur',
    },
    { min: 1, max: 100, message: '长度在 1 到 100 字符', trigger: 'blur' },
  ],
  name: [
    { required: true, message: '请输入物料名称', trigger: 'blur' },
    { min: 1, max: 200, message: '长度在 1 到 200 字符', trigger: 'blur' },
  ],
  baseUom: [
    { required: true, message: '请输入基础单位', trigger: 'blur' },
    { max: 20, message: '长度不能超过 20 字符', trigger: 'blur' },
  ],
  abcClass: [{ required: true, message: '请选择 ABC 分类', trigger: 'change' }],
};

const searchForm = reactive({
  keyword: '',
  abcClass: '',
  baseUom: '',
});

const pagination = reactive({
  page: 1,
  pageSize: 20,
  total: 0,
});

const tableData = ref<any[]>([]);
const abcTypeMap: Record<string, string> = { A: 'success', B: 'warning', C: 'info' };
const severityTypeMap: Record<string, string> = { ERROR: 'danger', WARN: 'warning', INFO: 'info' };

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

async function fetchList() {
  loading.value = true;
  try {
    const params: Record<string, any> = {
      limit: pagination.pageSize,
      offset: (pagination.page - 1) * pagination.pageSize,
    };
    if (searchForm.keyword) params.q = searchForm.keyword;
    if (searchForm.abcClass) params.abcClass = searchForm.abcClass;
    if (searchForm.baseUom) params.baseUom = searchForm.baseUom;

    const response: any = await api.get(ENDPOINTS.MATERIALS_LIST, params);
    tableData.value = (response.data as any[]) || [];
    pagination.total = response.meta?.total || (response.data as any[])?.length || 0;
  } catch (error) {
    console.error('Failed to fetch materials:', error);
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
  searchForm.keyword = '';
  searchForm.abcClass = '';
  searchForm.baseUom = '';
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

function openCreateDialog() {
  resetForm();
  dialogTitle.value = '新建物料';
  dialogVisible.value = true;
}
function openEditDialog(row: any) {
  resetForm();
  dialogTitle.value = '编辑物料';
  form.id = row.id;
  form.sku = row.sku;
  form.name = row.name;
  form.baseUom = row.baseUom;
  form.abcClass = row.abcClass;
  form.unitVolume = row.unitVolume;
  form.unitWeight = row.unitWeight;
  form.shelfLifeDays = row.shelfLifeDays;
  form.requiresUniqueTracking = row.requiresUniqueTracking || false;
  form.description = row.description || '';
  dialogVisible.value = true;
}

function resetForm() {
  form.id = '';
  form.sku = '';
  form.name = '';
  form.baseUom = 'PCS';
  form.abcClass = 'C';
  form.unitVolume = null;
  form.unitWeight = null;
  form.shelfLifeDays = null;
  form.requiresUniqueTracking = false;
  form.description = '';
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
      const payload = {
        sku: form.sku,
        name: form.name,
        baseUom: form.baseUom,
        abcClass: form.abcClass,
        unitVolume: form.unitVolume,
        unitWeight: form.unitWeight,
        shelfLifeDays: form.shelfLifeDays,
        requiresUniqueTracking: form.requiresUniqueTracking,
        description: form.description,
      };
      if (form.id) {
        await api.patch(ENDPOINTS.MATERIALS_UPDATE(form.id), payload);
        ElMessage.success('更新成功');
      } else {
        await api.post(ENDPOINTS.MATERIALS_CREATE, payload);
        ElMessage.success('创建成功');
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
    await ElMessageBox.confirm('确定要删除该物料吗？删除后不可恢复。', '确认删除', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning',
    });
    await api.delete(ENDPOINTS.MATERIALS_DELETE(id));
    ElMessage.success('删除成功');
    fetchList();
  } catch (error) {
    if (error !== 'cancel') console.error('Delete error:', error);
  }
}

/* 条码管理 */
const barcodesDialogVisible = ref(false);
const currentMaterial = ref<any>(null);
const currentBarcodes = ref<any[]>([]);

async function openBarcodesDialog(row: any) {
  currentMaterial.value = row;
  await fetchBarcodes(row.id);
  barcodesDialogVisible.value = true;
}

async function fetchBarcodes(materialId: string) {
  try {
    const response: any = await api.get(ENDPOINTS.MATERIALS_BARCODES(materialId));
    currentBarcodes.value = (response.data as any[]) || [];
  } catch (error) {
    console.error('Failed to fetch barcodes:', error);
    currentBarcodes.value = [];
  }
}

const barcodeFormDialogVisible = ref(false);
const barcodeFormTitle = ref('添加条码');
const barcodeFormRef = ref();
const barcodeForm = reactive({
  id: '',
  barcode: '',
  targetType: 'product',
  targetSubtype: '',
  isPrimary: false,
});
const barcodeRules = {
  barcode: [{ required: true, message: '请输入条码', trigger: 'blur' }],
  targetType: [{ required: true, message: '请选择目标类型', trigger: 'change' }],
};
const barcodeSubmitLoading = ref(false);
const barcodeTargetTypeOptions = [
  { label: '物料', value: 'product' },
  { label: 'SKU', value: 'sku' },
  { label: '批次', value: 'batch' },
  { label: '序列号', value: 'serial' },
];

function openBarcodeFormDialog() {
  resetBarcodeForm();
  barcodeFormTitle.value = '添加条码';
  barcodeFormDialogVisible.value = true;
}
function resetBarcodeForm() {
  barcodeForm.id = '';
  barcodeForm.barcode = '';
  barcodeForm.targetType = 'product';
  barcodeForm.targetSubtype = '';
  barcodeForm.isPrimary = false;
  barcodeFormRef.value?.clearValidate?.();
}

async function handleBarcodeSubmit() {
  barcodeFormRef.value?.validate?.(async (valid: boolean) => {
    if (!valid) return;
    barcodeSubmitLoading.value = true;
    try {
      const materialId = currentMaterial.value?.id;
      if (!materialId) throw new Error('未选择物料');
      const payload = {
        barcode: barcodeForm.barcode,
        targetType: barcodeForm.targetType,
        targetSubtype: barcodeForm.targetSubtype || undefined,
        isPrimary: barcodeForm.isPrimary,
      };
      if (barcodeForm.id) {
        await api.delete(ENDPOINTS.MATERIALS_BARCODE_DELETE(materialId, barcodeForm.id));
        await api.post(ENDPOINTS.MATERIALS_BARCODE_CREATE(materialId), payload);
        ElMessage.success('更新成功');
      } else {
        await api.post(ENDPOINTS.MATERIALS_BARCODE_CREATE(materialId), payload);
        ElMessage.success('添加成功');
      }
      barcodeFormDialogVisible.value = false;
      await fetchBarcodes(materialId);
    } catch (error) {
      console.error('Barcode submit error:', error);
    } finally {
      barcodeSubmitLoading.value = false;
    }
  });
}

async function handleDeleteBarcode(barcodeId: string) {
  try {
    await ElMessageBox.confirm('确定要删除该条码吗？', '确认删除', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning',
    });
    const materialId = currentMaterial.value?.id;
    if (!materialId) throw new Error('未选择物料');
    await api.delete(ENDPOINTS.MATERIALS_BARCODE_DELETE(materialId, barcodeId));
    ElMessage.success('删除成功');
    await fetchBarcodes(materialId);
  } catch (error) {
    if (error !== 'cancel') console.error('Delete barcode error:', error);
  }
}

/* 约束管理 */
const constraintsDialogVisible = ref(false);
const currentConstraints = ref<any[]>([]);

async function openConstraintsDialog(row: any) {
  currentMaterial.value = row;
  await fetchConstraints(row.id);
  constraintsDialogVisible.value = true;
}

async function fetchConstraints(materialId: string) {
  try {
    const response: any = await api.get(ENDPOINTS.MATERIALS_CONSTRAINTS(materialId));
    currentConstraints.value = (response.data as any[]) || [];
  } catch (error) {
    console.error('Failed to fetch constraints:', error);
    currentConstraints.value = [];
  }
}

const constraintFormDialogVisible = ref(false);
const constraintFormRef = ref();
const constraintForm = reactive({
  constraintType: 'location_type',
  constraintValue: '',
  severity: 'WARN',
});
const constraintRules = {
  constraintType: [{ required: true, message: '请选择约束类型', trigger: 'change' }],
  constraintValue: [{ required: true, message: '请输入约束值', trigger: 'blur' }],
  severity: [{ required: true, message: '请选择严重程度', trigger: 'change' }],
};
const constraintSubmitLoading = ref(false);

const constraintTypeOptions = [
  { label: '库位类型', value: 'location_type' },
  { label: '冷链要求', value: 'cold_chain' },
  { label: '危险品等级', value: 'dangerous_goods' },
  { label: '温度范围', value: 'temperature_range' },
  { label: '堆码层数', value: 'stacking_limit' },
  { label: '自定义', value: 'custom' },
];
const severityOptions = [
  { label: 'ERROR (阻塞)', value: 'ERROR' },
  { label: 'WARN (警告)', value: 'WARN' },
  { label: 'INFO (提示)', value: 'INFO' },
];

function openConstraintFormDialog() {
  constraintForm.constraintType = 'location_type';
  constraintForm.constraintValue = '';
  constraintForm.severity = 'WARN';
  constraintFormRef.value?.clearValidate?.();
  constraintFormDialogVisible.value = true;
}

async function handleConstraintSubmit() {
  constraintFormRef.value?.validate?.(async (valid: boolean) => {
    if (!valid) return;
    constraintSubmitLoading.value = true;
    try {
      const materialId = currentMaterial.value?.id;
      if (!materialId) throw new Error('未选择物料');
      const payload = {
        constraintType: constraintForm.constraintType,
        constraintValue: constraintForm.constraintValue,
        severity: constraintForm.severity,
      };
      await api.post(ENDPOINTS.MATERIALS_CONSTRAINT_CREATE(materialId), payload);
      ElMessage.success('添加成功');
      constraintFormDialogVisible.value = false;
      await fetchConstraints(materialId);
    } catch (error) {
      console.error('Constraint submit error:', error);
    } finally {
      constraintSubmitLoading.value = false;
    }
  });
}

async function handleDeleteConstraint(constraintId: string) {
  try {
    await ElMessageBox.confirm('确定要删除该约束吗？', '确认删除', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning',
    });
    const materialId = currentMaterial.value?.id;
    if (!materialId) throw new Error('未选择物料');
    await api.delete(ENDPOINTS.MATERIALS_CONSTRAINT_DELETE(materialId, constraintId));
    ElMessage.success('删除成功');
    await fetchConstraints(materialId);
  } catch (error) {
    if (error !== 'cancel') console.error('Delete constraint error:', error);
  }
}

onMounted(() => {
  fetchList();
});
</script>

<style scoped>
.materials-page {
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
.barcodes-header,
.expand-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}
.barcode-tag {
  margin: 4px;
  cursor: default;
}
.expand-content {
  padding: 8px 0;
}
.expand-content h4 {
  margin: 0 0 8px;
  font-size: 14px;
  font-weight: 500;
  color: #303133;
}
.text-muted {
  color: #909399;
}
.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}
</style>
