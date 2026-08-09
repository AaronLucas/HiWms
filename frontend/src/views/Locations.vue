<template>
  <div class="locations-page">
    <div class="page-header">
      <div class="header-left">
        <h1>库位管理</h1>
        <el-tag v-if="loading" type="info">加载中...</el-tag>
      </div>
      <el-button type="primary" @click="openDialog" :loading="submitLoading">
        <el-icon><Plus /></el-icon>
        新建库位
      </el-button>
    </div>

    <el-card class="search-card" shadow="never">
      <el-form :inline="true" :model="searchForm" class="search-form">
        <el-form-item label="库位编码">
          <el-input v-model="searchForm.code" placeholder="库位编码" clearable @keyup.enter="handleSearch" />
        </el-form-item>
        <el-form-item label="库区">
        <el-select v-model="searchForm.zoneId" placeholder="请选择库区" clearable style="width: 200px" filterable remote :remote-method="remoteZoneSearch" :loading="zoneLoading">
            <el-option v-for="z in zoneOptions" :key="z.id" :label="z.name" :value="z.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="库位类型">
          <el-select v-model="searchForm.type" clearable style="width: 160px" placeholder="请选择类型">
            <el-option label="存储库位" value="storage" />
            <el-option label="拣选库位" value="picking" />
            <el-option label="暂存库位" value="staging" />
            <el-option label="发货库位" value="shipping" />
            <el-option label="收货库位" value="receiving" />
            <el-option label="质检库位" value="quarantine" />
            <el-option label="退货库位" value="returns" />
          </el-select>
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="searchForm.status" clearable style="width: 140px" placeholder="请选择状态">
            <el-option label="启用" value="active" />
            <el-option label="禁用" value="inactive" />
            <el-option label="冻结" value="frozen" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="handleSearch"><el-icon><Search /></el-icon> 搜索</el-button>
          <el-button @click="handleReset"><el-icon><Refresh /></el-icon> 重置</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card shadow="never">
      <el-table v-loading="loading" :data="tableData" row-key="id" border style="width: 100%" @row-dblclick="openDialog">
        <el-table-column prop="code" label="库位编码" width="160" show-overflow-tooltip />
        <el-table-column prop="name" label="库位名称" min-width="180" show-overflow-tooltip />
        <el-table-column prop="zoneName" label="库区" width="160" show-overflow-tooltip />
        <el-table-column label="类型" width="120">
          <template #default="scope"><el-tag :type="typeTypeMap[scope.row.type]" size="small" effect="dark">{{ typeLabelMap[scope.row.type] }}</el-tag></template>
        </el-table-column>
        <el-table-column label="状态" width="120">
          <template #default="scope"><el-tag :type="statusTypeMap[scope.row.status]" size="small" effect="dark">{{ statusLabelMap[scope.row.status] }}</el-tag></template>
        </el-table-column>
        <el-table-column prop="maxCapacity" label="最大容量" width="120" align="right">
          <template #default="scope">{{ scope.row.maxCapacity || '-' }}</template>
        </el-table-column>
        <el-table-column prop="currentUsage" label="当前占用" width="120" align="right">
          <template #default="scope">{{ scope.row.currentUsage || 0 }}</template>
        </el-table-column>
        <el-table-column label="利用率" width="120" align="right">
          <template #default="scope">
            <el-progress :percentage="scope.row.maxCapacity ? Math.round((scope.row.currentUsage || 0) / scope.row.maxCapacity * 100) : 0" :stroke-width="16" />
          </template>
        </el-table-column>
        <el-table-column prop="priority" label="优先级" width="100" align="center" />
        <el-table-column label="允许混储" width="100" align="center">
          <template #default="scope"><el-tag v-if="scope.row.allowMixed" type="success" size="small">是</el-tag><el-tag v-else type="info" size="small">否</el-tag></template>
        </el-table-column>
        <el-table-column label="创建时间" width="160"><template #default="scope">{{ formatDate(scope.row.createdAt) }}</template></el-table-column>
        <el-table-column label="操作" width="200" fixed="right">
          <template #default="scope">
            <el-button size="small" type="primary" link @click="openDialog(scope.row)">编辑</el-button>
            <el-divider direction="vertical" />
            <el-button size="small" :type="scope.row.status === 'active' ? 'warning' : 'success'" link @click="toggleStatus(scope.row)">{{ scope.row.status === 'active' ? '禁用' : '启用' }}</el-button>
            <el-divider direction="vertical" />
            <el-button size="small" type="info" link @click="openCapacityDialog(scope.row)">容量</el-button>
            <el-divider direction="vertical" />
            <el-popconfirm title="确定要删除吗？" confirm-button-text="确定" cancel-button-text="取消" @confirm="handleDelete(scope.row.id)">
              <template #reference><el-button size="small" type="danger" link>删除</el-button></template>
            </el-popconfirm>
          </template>
        </el-table-column>
      </el-table>

      <div class="pagination-wrapper">
        <el-pagination v-model:current-page="pagination.page" v-model:page-size="pagination.pageSize" :total="pagination.total" :page-sizes="[10, 20, 50, 100]" layout="total, sizes, prev, pager, next, jumper" @size-change="handleSizeChange" @current-change="handleCurrentChange" />
      </div>
    </el-card>

    <el-dialog v-model="dialogVisible" :title="dialogTitle" width="600px" :before-close="handleDialogClose" destroy-on-close>
      <el-form :model="form" :rules="rules" ref="formRef" label-width="120px">
        <el-form-item label="库区" prop="zoneId">
          <el-select v-model="form.zoneId" placeholder="请选择库区" filterable remote :remote-method="remoteZoneSearch" :loading="zoneLoading" style="width: 100%">
            <el-option v-for="z in zoneOptions" :key="z.id" :label="z.name" :value="z.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="库位编码" prop="code"><el-input v-model="form.code" placeholder="请输入库位编码" maxlength="50" clearable /></el-form-item>
        <el-form-item label="库位名称" prop="name"><el-input v-model="form.name" placeholder="请输入库位名称" maxlength="100" clearable /></el-form-item>
        <el-form-item label="库位类型" prop="type">
          <el-select v-model="form.type" placeholder="请选择类型" style="width: 100%">
            <el-option label="存储库位" value="storage" />
            <el-option label="拣选库位" value="picking" />
            <el-option label="暂存库位" value="staging" />
            <el-option label="发货库位" value="shipping" />
            <el-option label="收货库位" value="receiving" />
            <el-option label="质检库位" value="quarantine" />
            <el-option label="退货库位" value="returns" />
          </el-select>
        </el-form-item>
        <el-form-item label="最大容量" prop="maxCapacity"><el-input-number v-model="form.maxCapacity" :min="0" :step="1" controls-position="right" placeholder="请输入最大容量" /></el-form-item>
        <el-form-item label="优先级" prop="priority"><el-input-number v-model="form.priority" :min="0" :step="1" controls-position="right" placeholder="请输入优先级（数值越小优先级越高）" /></el-form-item>
        <el-form-item label="允许混储" prop="allowMixed"><el-switch v-model="form.allowMixed" active-value="true" inactive-value="false" /></el-form-item>
        <el-form-item label="允许拆分" prop="allowSplit"><el-switch v-model="form.allowSplit" active-value="true" inactive-value="false" /></el-form-item>
        <el-form-item label="备注" prop="description"><el-input v-model="form.description" type="textarea" :rows="2" placeholder="请输入备注" maxlength="200" /></el-form-item>
      </el-form>
      <template #footer><div class="dialog-footer"><el-button @click="dialogVisible = false">取消</el-button><el-button type="primary" :loading="submitLoading" @click="handleSubmit">确定</el-button></div></template>
    </el-dialog>

    <el-dialog v-model="capacityDialogVisible" :title="capacityDialogTitle" width="500px" destroy-on-close>
      <el-card shadow="never" v-if="capacityData">
        <div class="capacity-info">
          <div class="capacity-row">
            <span class="label">最大容量</span>
            <span class="value">{{ capacityData.maxCapacity }}</span>
          </div>
          <div class="capacity-row">
            <span class="label">当前占用</span>
            <span class="value">{{ capacityData.currentUsage }}</span>
          </div>
          <div class="capacity-row">
            <span class="label">可用容量</span>
            <span class="value">{{ capacityData.availableCapacity }}</span>
          </div>
          <div class="capacity-row">
            <span class="label">利用率</span>
            <span class="value">
              <el-progress :percentage="capacityData.maxCapacity ? Math.round(capacityData.currentUsage / capacityData.maxCapacity * 100) : 0" :stroke-width="16" />
            </span>
          </div>
        </div>
      </el-card>
      <el-empty v-else description="暂无容量数据" />
      <template #footer><el-button @click="capacityDialogVisible = false">关闭</el-button></template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { Plus, Search, Refresh, Box, Warehouse, Setting, Edit, Delete } from "@element-plus/icons-vue";
import { api, ENDPOINTS } from "@/services/api";

const loading = ref(false);
const submitLoading = ref(false);
const dialogVisible = ref(false);
const dialogTitle = ref("");
const formRef = ref();
const form = reactive({
  id: "",
  zoneId: "",
  code: "",
  name: "",
  type: "storage",
  maxCapacity: 0,
  priority: 0,
  allowMixed: false,
  allowSplit: false,
  description: "",
  status: "active"
});

const rules = {
  zoneId: [{ required: true, message: "请选择库区", trigger: "change" }],
  code: [{ required: true, message: "请输入库位编码", trigger: "blur" }, { max: 50, message: "编码长度不能超过 50 字符", trigger: "blur" }],
  name: [{ required: true, message: "请输入库位名称", trigger: "blur" }, { max: 100, message: "名称长度不能超过 100 字符", trigger: "blur" }],
  type: [{ required: true, message: "请选择库位类型", trigger: "change" }],
  maxCapacity: [{ required: true, message: "请输入最大容量", trigger: "blur" }, { min: 0, message: "容量不能为负数", trigger: "blur" }],
  priority: [{ min: 0, message: "优先级不能为负数", trigger: "blur" }]
};

const searchForm = reactive({ code: "", zoneId: "", type: "", status: "" });
const pagination = reactive({ page: 1, pageSize: 20, total: 0 });
const tableData = ref<any[]>([]);

const typeTypeMap: Record<string, string> = { storage: "primary", picking: "success", staging: "warning", shipping: "info", receiving: "info", quarantine: "danger", returns: "warning" };
const typeLabelMap: Record<string, string> = { storage: "存储", picking: "拣选", staging: "暂存", shipping: "发货", receiving: "收货", quarantine: "质检", returns: "退货" };
const statusTypeMap: Record<string, string> = { active: "success", inactive: "info", frozen: "warning" };
const statusLabelMap: Record<string, string> = { active: "启用", inactive: "禁用", frozen: "冻结" };

const formatDate = (dateStr: string | undefined) => { if (!dateStr) return "-"; return new Date(dateStr).toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }); };

const zoneOptions = ref<any[]>([]);
const zoneLoading = ref(false);

async function remoteZoneSearch(query: string) {
  zoneLoading.value = true;
  try {
    const response: any = await api.get(ENDPOINTS.LOCATIONS_LIST, { keyword: query, limit: 20 });
    zoneOptions.value = (response.data as any[]) || [];
  } catch (error) {
    console.error("Zone search failed:", error);
    zoneOptions.value = [];
  } finally {
    zoneLoading.value = false;
  }
}

async function fetchList() {
  loading.value = true;
  try {
    const params: Record<string, any> = { limit: pagination.pageSize, offset: (pagination.page - 1) * pagination.pageSize };
    if (searchForm.code) params.code = searchForm.code;
    if (searchForm.zoneId) params.zoneId = searchForm.zoneId;
    if (searchForm.type) params.type = searchForm.type;
    if (searchForm.status) params.status = searchForm.status;
    const response: any = await api.get(ENDPOINTS.LOCATIONS_LIST, params);
    tableData.value = (response.data as any[]) || [];
    pagination.total = response.meta?.total || (response.data as any[])?.length || 0;
  } catch (error) { console.error("Failed to fetch locations:", error); tableData.value = []; pagination.total = 0; }
  finally { loading.value = false; }
}

function handleSearch() { pagination.page = 1; fetchList(); }
function handleReset() { searchForm.code = ""; searchForm.zoneId = ""; searchForm.type = ""; searchForm.status = ""; pagination.page = 1; fetchList(); }
function handleSizeChange(size: number) { pagination.pageSize = size; pagination.page = 1; fetchList(); }
function handleCurrentChange(page: number) { pagination.page = page; fetchList(); }

function openDialog(row?: any) {
  resetForm();
  dialogTitle.value = row ? "编辑库位" : "新建库位";
  if (row) {
    form.id = row.id;
    form.zoneId = row.zoneId;
    form.code = row.code;
    form.name = row.name;
    form.type = row.type;
    form.maxCapacity = row.maxCapacity || 0;
    form.priority = row.priority || 0;
    form.allowMixed = row.allowMixed || false;
    form.allowSplit = row.allowSplit || false;
    form.description = row.description || "";
  }
  dialogVisible.value = true;
}

function resetForm() { form.id = ""; form.zoneId = ""; form.code = ""; form.name = ""; form.type = "storage"; form.maxCapacity = 0; form.priority = 0; form.allowMixed = false; form.allowSplit = false; form.description = ""; formRef.value?.clearValidate?.(); }
function handleDialogClose(done: () => void) { resetForm(); done(); }

async function handleSubmit() {
  formRef.value?.validate?.(async (valid: boolean) => {
    if (!valid) return;
    submitLoading.value = true;
    try {
      const payload = {
        zoneId: form.zoneId,
        code: form.code,
        name: form.name,
        type: form.type,
        maxCapacity: form.maxCapacity,
        priority: form.priority,
        allowMixed: form.allowMixed,
        allowSplit: form.allowSplit,
        description: form.description || undefined
      };
      if (form.id) {
        await api.put(ENDPOINTS.LOCATIONS_UPDATE(form.id), payload);
        ElMessage.success("更新成功");
      } else {
        await api.post(ENDPOINTS.LOCATIONS_CREATE, payload);
        ElMessage.success("创建成功");
      }
      dialogVisible.value = false;
      fetchList();
    } catch (error) { console.error("Submit error:", error); }
    finally { submitLoading.value = false; }
  });
}

async function handleDelete(id: string) {
  try {
    await ElMessageBox.confirm("确定要删除该库位吗？", "确认删除", { confirmButtonText: "确定", cancelButtonText: "取消", type: "warning" });
    await api.delete(ENDPOINTS.LOCATIONS_GET(id));
    ElMessage.success("删除成功");
    fetchList();
  } catch (error) { if (error !== "cancel") console.error("Delete error:", error); }
}

async function toggleStatus(row: any) {
  try {
    const newStatus = row.status === "active" ? "inactive" : "active";
    await api.patch(ENDPOINTS.LOCATIONS_STATUS(row.id), { status: newStatus });
    ElMessage.success(newStatus === "active" ? "启用成功" : "禁用成功");
    fetchList();
  } catch (error) { console.error("Toggle status error:", error); }
}

const capacityDialogVisible = ref(false);
const capacityDialogTitle = ref("库位容量");
const capacityData = ref<any>(null);

async function openCapacityDialog(row: any) {
  capacityDialogTitle.value = `${row.code} - 容量详情`;
  capacityDialogVisible.value = true;
  try {
    const response: any = await api.get(ENDPOINTS.LOCATIONS_CAPACITY(row.id));
    capacityData.value = response.data;
  } catch (error) { console.error("Failed to fetch capacity:", error); capacityData.value = null; }
}

onMounted(() => { fetchList(); });
</script>

<style scoped>
.locations-page {
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
.header-left h1 { margin: 0; font-size: 20px; font-weight: 600; }
.search-card { margin-bottom: 20px; }
.search-form :deep(.el-form-item) { margin-bottom: 0; }
.pagination-wrapper { margin-top: 16px; display: flex; justify-content: flex-end; }
.dialog-footer { display: flex; justify-content: flex-end; gap: 12px; }
.capacity-info { padding: 16px 0; }
.capacity-row { display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 1px solid var(--el-border-color-lighter); }
.capacity-row:last-child { border-bottom: none; }
.capacity-row .label { color: var(--el-text-color-secondary); }
.capacity-row .value { display: flex; align-items: center; gap: 8px; }
.capacity-row .value .el-progress { width: 150px; }
</style>