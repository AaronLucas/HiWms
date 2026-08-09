<template>
  <div class="orders-page">
    <div class="page-header">
      <div class="header-left">
        <h1>订单管理</h1>
        <el-tag v-if="loading" type="info">加载中...</el-tag>
      </div>
      <el-button type="primary" @click="openDialog" :loading="submitLoading">
        <el-icon><Plus /></el-icon>
        新建订单
      </el-button>
    </div>

    <el-card class="search-card" shadow="never">
      <el-form :inline="true" :model="searchForm" class="search-form">
        <el-form-item label="订单号">
          <el-input v-model="searchForm.orderNo" placeholder="订单号" clearable @keyup.enter="handleSearch" />
        </el-form-item>
        <el-form-item label="客户">
          <el-input v-model="searchForm.customerName" placeholder="客户名称" clearable />
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="searchForm.status" clearable style="width: 160px" placeholder="请选择状态">
            <el-option label="待处理" value="pending" />
            <el-option label="已分配" value="allocated" />
            <el-option label="拣货中" value="picking" />
            <el-option label="已打包" value="packed" />
            <el-option label="已发货" value="shipped" />
            <el-option label="已取消" value="cancelled" />
          </el-select>
        </el-form-item>
        <el-form-item label="优先级">
          <el-select v-model="searchForm.priority" clearable style="width: 140px" placeholder="请选择优先级">
            <el-option label="普通" value="normal" />
            <el-option label="高" value="high" />
            <el-option label="紧急" value="urgent" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="handleSearch"><el-icon><Search /></el-icon> 搜索</el-button>
          <el-button @click="handleReset"><el-icon><Refresh /></el-icon> 重置</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card shadow="never">
      <el-table v-loading="loading" :data="tableData" row-key="id" border style="width: 100%" @row-dblclick="openDetailDialog">
        <el-table-column prop="orderNo" label="订单号" width="180" show-overflow-tooltip />
        <el-table-column prop="customerName" label="客户" min-width="180" show-overflow-tooltip />
        <el-table-column prop="warehouseName" label="仓库" width="140" show-overflow-tooltip />
        <el-table-column label="状态" width="120">
          <template #default="scope"><el-tag :type="statusTypeMap[scope.row.status]" size="small" effect="dark">{{ statusLabelMap[scope.row.status] }}</el-tag></template>
        </el-table-column>
        <el-table-column label="优先级" width="100" align="center">
          <template #default="scope"><el-tag :type="priorityTypeMap[scope.row.priority]" size="small" effect="dark">{{ priorityLabelMap[scope.row.priority] }}</el-tag></template>
        </el-table-column>
        <el-table-column prop="totalQty" label="总数量" width="100" align="right" />
        <el-table-column prop="allocatedQty" label="已分配" width="100" align="right" />
        <el-table-column prop="shippedQty" label="已发货" width="100" align="right" />
        <el-table-column label="下单时间" width="160"><template #default="scope">{{ formatDate(scope.row.orderDate) }}</template></el-table-column>
        <el-table-column label="要求发货时间" width="160"><template #default="scope">{{ formatDate(scope.row.requiredShipDate) }}</template></el-table-column>
        <el-table-column label="创建时间" width="160"><template #default="scope">{{ formatDate(scope.row.createdAt) }}</template></el-table-column>
        <el-table-column label="操作" width="240" fixed="right">
          <template #default="scope">
            <el-button size="small" type="primary" link @click="openDetailDialog(scope.row)">详情</el-button>
            <el-divider direction="vertical" />
            <el-button size="small" type="success" link @click="openDialog(scope.row)" v-if="scope.row.status === 'pending'">编辑</el-button>
            <el-divider direction="vertical" v-if="scope.row.status === 'pending' || scope.row.status === 'allocated'" />
            <el-button size="small" type="warning" link @click="allocateOrder(scope.row)" v-if="scope.row.status === 'pending' || scope.row.status === 'allocated'">分配</el-button>
            <el-divider direction="vertical" v-if="scope.row.status !== 'cancelled' && scope.row.status !== 'shipped'" />
            <el-button size="small" type="danger" link @click="cancelOrder(scope.row)" v-if="scope.row.status !== 'cancelled' && scope.row.status !== 'shipped'">取消</el-button>
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

    <el-dialog v-model="dialogVisible" :title="dialogTitle" width="700px" :before-close="handleDialogClose" destroy-on-close>
      <el-form :model="form" :rules="rules" ref="formRef" label-width="120px">
        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="客户" prop="customerId">
              <el-select v-model="form.customerId" placeholder="请选择客户" filterable remote :remote-method="remoteCustomerSearch" :loading="customerLoading" style="width: 100%">
                <el-option v-for="c in customerOptions" :key="c.id" :label="c.name" :value="c.id" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="仓库" prop="warehouseId">
              <el-select v-model="form.warehouseId" placeholder="请选择仓库" filterable remote :remote-method="remoteWarehouseSearch" :loading="warehouseLoading" style="width: 100%">
                <el-option v-for="w in warehouseOptions" :key="w.id" :label="w.name" :value="w.id" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="优先级" prop="priority">
              <el-select v-model="form.priority" placeholder="请选择优先级" style="width: 100%">
                <el-option label="普通" value="normal" />
                <el-option label="高" value="high" />
                <el-option label="紧急" value="urgent" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="要求发货时间" prop="requiredShipDate">
              <el-date-picker v-model="form.requiredShipDate" type="datetime" placeholder="请选择" value-format="YYYY-MM-DD HH:mm:ss" clearable style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="24">
            <el-form-item label="备注" prop="remark"><el-input v-model="form.remark" type="textarea" :rows="2" placeholder="请输入备注" maxlength="500" /></el-form-item>
          </el-col>
        </el-row>

        <el-form-item label="订单明细" v-if="form.id">
          <div class="order-lines">
            <div class="lines-header">
              <span>商品明细</span>
              <el-button size="small" @click="addOrderLine"><el-icon><Plus /></el-icon> 添加行</el-button>
            </div>
            <el-table :data="orderLines" border style="width: 100%" size="small">
              <el-table-column prop="productSku" label="商品 SKU" width="160" show-overflow-tooltip />
              <el-table-column prop="productName" label="商品名称" min-width="200" show-overflow-tooltip />
              <el-table-column label="数量" width="100" align="right">
                <template #default="scope">
                  <el-input-number v-model="scope.row.qty" :min="1" :step="1" controls-position="right" style="width: 100px" @change="updateOrderLine(scope.$index, scope.row)" />
                </template>
              </el-table-column>
              <el-table-column label="已分配" width="100" align="right">
                <template #default="scope">{{ scope.row.allocatedQty || 0 }}</template>
              </el-table-column>
              <el-table-column label="操作" width="100" align="center">
                <template #default="scope">
                  <el-button size="small" type="danger" link @click="removeOrderLine(scope.$index)" v-if="orderLines.length > 1"><el-icon><Delete /></el-icon></el-button>
                </template>
              </el-table-column>
            </el-table>
          </div>
        </el-form-item>
      </el-form>
      <template #footer><div class="dialog-footer"><el-button @click="dialogVisible = false">取消</el-button><el-button type="primary" :loading="submitLoading" @click="handleSubmit">确定</el-button></div></template>
    </el-dialog>

    <el-dialog v-model="detailDialogVisible" :title="detailDialogTitle" width="900px" destroy-on-close>
      <el-card shadow="never" v-if="detailData">
        <div class="detail-section">
          <h4>基本信息</h4>
          <el-descriptions :column="4" border>
            <el-descriptions-item label="订单号">{{ detailData.orderNo }}</el-descriptions-item>
            <el-descriptions-item label="客户">{{ detailData.customerName }}</el-descriptions-item>
            <el-descriptions-item label="仓库">{{ detailData.warehouseName }}</el-descriptions-item>
            <el-descriptions-item label="状态"><el-tag :type="statusTypeMap[detailData.status]" effect="dark">{{ statusLabelMap[detailData.status] }}</el-tag></el-descriptions-item>
            <el-descriptions-item label="优先级"><el-tag :type="priorityTypeMap[detailData.priority]" effect="dark">{{ priorityLabelMap[detailData.priority] }}</el-tag></el-descriptions-item>
            <el-descriptions-item label="总数量">{{ detailData.totalQty }}</el-descriptions-item>
            <el-descriptions-item label="已分配">{{ detailData.allocatedQty }}</el-descriptions-item>
            <el-descriptions-item label="已发货">{{ detailData.shippedQty }}</el-descriptions-item>
            <el-descriptions-item label="下单时间">{{ formatDate(detailData.orderDate) }}</el-descriptions-item>
            <el-descriptions-item label="要求发货时间">{{ formatDate(detailData.requiredShipDate) }}</el-descriptions-item>
            <el-descriptions-item label="备注">{{ detailData.remark || '-' }}</el-descriptions-item>
            <el-descriptions-item label="创建时间">{{ formatDate(detailData.createdAt) }}</el-descriptions-item>
            <el-descriptions-item label="更新时间">{{ formatDate(detailData.updatedAt) }}</el-descriptions-item>
          </el-descriptions>
        </div>
        <div class="detail-section">
          <h4>订单明细</h4>
          <el-table :data="detailData.lines" border style="width: 100%">
            <el-table-column prop="productSku" label="商品 SKU" width="160" show-overflow-tooltip />
            <el-table-column prop="productName" label="商品名称" min-width="200" show-overflow-tooltip />
            <el-table-column prop="qty" label="数量" width="100" align="right" />
            <el-table-column prop="allocatedQty" label="已分配" width="100" align="right" />
            <el-table-column prop="shippedQty" label="已发货" width="100" align="right" />
            <el-table-column prop="unitPrice" label="单价" width="100" align="right">
              <template #default="scope">{{ scope.row.unitPrice ? scope.row.unitPrice.toFixed(2) : '-' }}</template>
            </el-table-column>
            <el-table-column prop="totalPrice" label="金额" width="100" align="right">
              <template #default="scope">{{ scope.row.totalPrice ? scope.row.totalPrice.toFixed(2) : '-' }}</template>
            </el-table-column>
          </el-table>
        </div>
      </el-card>
      <el-empty v-else description="加载中..." />
      <template #footer><el-button @click="detailDialogVisible = false">关闭</el-button></template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { Plus, Search, Refresh, Delete, Box, Truck, User } from "@element-plus/icons-vue";
import { api, ENDPOINTS } from "@/services/api";

const loading = ref(false);
const submitLoading = ref(false);
const dialogVisible = ref(false);
const dialogTitle = ref("");
const formRef = ref();
const form = reactive({
  id: "",
  customerId: "",
  warehouseId: "",
  priority: "normal",
  requiredShipDate: "",
  remark: ""
});

const rules = {
  customerId: [{ required: true, message: "请选择客户", trigger: "change" }],
  warehouseId: [{ required: true, message: "请选择仓库", trigger: "change" }],
  priority: [{ required: true, message: "请选择优先级", trigger: "change" }]
};

const orderLines = ref<any[]>([]);

const searchForm = reactive({ orderNo: "", customerName: "", status: "", priority: "" });
const pagination = reactive({ page: 1, pageSize: 20, total: 0 });
const tableData = ref<any[]>([]);

const statusTypeMap: Record<string, string> = { pending: "info", allocated: "primary", picking: "warning", packed: "success", shipped: "success", cancelled: "danger" };
const statusLabelMap: Record<string, string> = { pending: "待处理", allocated: "已分配", picking: "拣货中", packed: "已打包", shipped: "已发货", cancelled: "已取消" };
const priorityTypeMap: Record<string, string> = { normal: "info", high: "warning", urgent: "danger" };
const priorityLabelMap: Record<string, string> = { normal: "普通", high: "高", urgent: "紧急" };

const formatDate = (dateStr: string | undefined) => { if (!dateStr) return "-"; return new Date(dateStr).toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }); };

const customerOptions = ref<any[]>([]);
const warehouseOptions = ref<any[]>([]);
const customerLoading = ref(false);
const warehouseLoading = ref(false);

async function remoteCustomerSearch(query: string) {
  customerLoading.value = true;
  try {
    const response: any = await api.get(ENDPOINTS.MATERIALS_LIST, { q: query, limit: 20 });
    customerOptions.value = (response.data as any[]) || [];
  } catch (error) { console.error("Customer search failed:", error); customerOptions.value = []; }
  finally { customerLoading.value = false; }
}

async function remoteWarehouseSearch(query: string) {
  warehouseLoading.value = true;
  try {
    const response: any = await api.get(ENDPOINTS.LOCATIONS_LIST, { keyword: query, limit: 20 });
    warehouseOptions.value = (response.data as any[]) || [];
  } catch (error) { console.error("Warehouse search failed:", error); warehouseOptions.value = []; }
  finally { warehouseLoading.value = false; }
}

async function fetchList() {
  loading.value = true;
  try {
    const params: Record<string, any> = { limit: pagination.pageSize, offset: (pagination.page - 1) * pagination.pageSize };
    if (searchForm.orderNo) params.orderNo = searchForm.orderNo;
    if (searchForm.customerName) params.customerName = searchForm.customerName;
    if (searchForm.status) params.status = searchForm.status;
    if (searchForm.priority) params.priority = searchForm.priority;
    const response: any = await api.get(ENDPOINTS.ORDERS_LIST, params);
    tableData.value = (response.data as any[]) || [];
    pagination.total = response.meta?.total || (response.data as any[])?.length || 0;
  } catch (error) { console.error("Failed to fetch orders:", error); tableData.value = []; pagination.total = 0; }
  finally { loading.value = false; }
}

function handleSearch() { pagination.page = 1; fetchList(); }
function handleReset() { searchForm.orderNo = ""; searchForm.customerName = ""; searchForm.status = ""; searchForm.priority = ""; pagination.page = 1; fetchList(); }
function handleSizeChange(size: number) { pagination.pageSize = size; pagination.page = 1; fetchList(); }
function handleCurrentChange(page: number) { pagination.page = page; fetchList(); }

function openDialog(row?: any) {
  resetForm();
  dialogTitle.value = row ? "编辑订单" : "新建订单";
  if (row) {
    form.id = row.id;
    form.customerId = row.customerId;
    form.warehouseId = row.warehouseId;
    form.priority = row.priority;
    form.requiredShipDate = row.requiredShipDate || "";
    form.remark = row.remark || "";
    orderLines.value = row.lines ? [...row.lines] : [];
  } else {
    orderLines.value = [{ productId: "", productSku: "", productName: "", qty: 1, allocatedQty: 0, shippedQty: 0 }];
  }
  dialogVisible.value = true;
}

function resetForm() { form.id = ""; form.customerId = ""; form.warehouseId = ""; form.priority = "normal"; form.requiredShipDate = ""; form.remark = ""; orderLines.value = []; formRef.value?.clearValidate?.(); }
function handleDialogClose(done: () => void) { resetForm(); done(); }

function addOrderLine() { orderLines.value.push({ productId: "", productSku: "", productName: "", qty: 1, allocatedQty: 0, shippedQty: 0 }); }
function updateOrderLine(index: number, line: any) { /* 可在此添加校验逻辑 */ }
function removeOrderLine(index: number) { orderLines.value.splice(index, 1); }

async function handleSubmit() {
  formRef.value?.validate?.(async (valid: boolean) => {
    if (!valid) return;
    if (orderLines.value.length === 0 || orderLines.value.some(l => !l.productId)) {
      ElMessage.error("请至少添加一行商品明细");
      return;
    }
    submitLoading.value = true;
    try {
      const payload = {
        customerId: form.customerId,
        warehouseId: form.warehouseId,
        priority: form.priority,
        requiredShipDate: form.requiredShipDate || undefined,
        remark: form.remark || undefined,
        lines: orderLines.value.map(l => ({ productId: l.productId, qty: l.qty }))
      };
      if (form.id) {
        await api.put(ENDPOINTS.ORDERS_GET(form.id), payload);
        ElMessage.success("更新成功");
      } else {
        await api.post(ENDPOINTS.ORDERS_CREATE, payload);
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
    await ElMessageBox.confirm("确定要删除该订单吗？", "确认删除", { confirmButtonText: "确定", cancelButtonText: "取消", type: "warning" });
    await api.delete(ENDPOINTS.ORDERS_GET(id));
    ElMessage.success("删除成功");
    fetchList();
  } catch (error) { if (error !== "cancel") console.error("Delete error:", error); }
}

async function allocateOrder(row: any) {
  try {
    await api.post(ENDPOINTS.ORDERS_ALLOCATE(row.id));
    ElMessage.success("分配成功");
    fetchList();
  } catch (error) { console.error("Allocate error:", error); }
}

async function cancelOrder(row: any) {
  try {
    await ElMessageBox.confirm("确定要取消该订单吗？", "确认取消", { confirmButtonText: "确定", cancelButtonText: "取消", type: "warning" });
    await api.patch(ENDPOINTS.ORDERS_STATUS(row.id), { status: "cancelled" });
    ElMessage.success("取消成功");
    fetchList();
  } catch (error) { console.error("Cancel error:", error); }
}

const detailDialogVisible = ref(false);
const detailDialogTitle = ref("订单详情");
const detailData = ref<any>(null);

async function openDetailDialog(row: any) {
  detailDialogTitle.value = `订单详情 - ${row.orderNo}`;
  detailDialogVisible.value = true;
  detailData.value = null;
  try {
    const response: any = await api.get(ENDPOINTS.ORDERS_GET(row.id));
    detailData.value = response.data;
  } catch (error) { console.error("Failed to fetch order detail:", error); }
}

onMounted(() => { fetchList(); });
</script>

<style scoped>
.orders-page {
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
.order-lines { margin-top: 8px; }
.lines-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.detail-section { margin-bottom: 24px; }
.detail-section h4 { margin: 0 0 16px 0; font-size: 14px; font-weight: 600; color: var(--el-text-color-primary); }
</style>