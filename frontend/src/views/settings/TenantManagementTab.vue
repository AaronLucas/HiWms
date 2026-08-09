<template>
  <div class="tenant-management-tab">
    <div class="tab-header">
      <div class="header-left">
        <h2>租户管理</h2>
        <el-tag v-if="loading" type="info">加载中...</el-tag>
      </div>
      <el-button @click="openDialog" :loading="submitLoading" type="primary">
        <el-icon><Plus /></el-icon>
        新建租户
      </el-button>
    </div>

    <el-card class="search-card" shadow="never">
      <el-form :inline="true" :model="searchForm" class="search-form">
        <el-form-item label="租户名称">
          <el-input
            v-model="searchForm.name"
            @keyup.enter="handleSearch"
            placeholder="租户名称"
            clearable
          />
        </el-form-item>
        <el-form-item label="状态">
          <el-select
            v-model="searchForm.isActive"
            clearable
            style="width: 140px"
            placeholder="请选择状态"
          >
            <el-option label="启用" value="true" />
            <el-option label="禁用" value="false" />
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
        @row-dblclick="openDialog"
        row-key="id"
        border
        style="width: 100%"
      >
        <el-table-column prop="name" label="租户名称" width="200" show-overflow-tooltip />
        <el-table-column prop="code" label="租户编码" width="160" show-overflow-tooltip />
        <el-table-column label="状态" width="100">
          <template #default="scope"
            ><el-tag :type="scope.row.isActive ? 'success' : 'danger'" size="small" effect="dark">{{
              scope.row.isActive ? '启用' : '禁用'
            }}</el-tag></template
          >
        </el-table-column>
        <el-table-column label="创建时间" width="160"
          ><template #default="scope">{{
            formatDate(scope.row.createdAt)
          }}</template></el-table-column
        >
        <el-table-column label="操作" width="200" fixed="right">
          <template #default="scope">
            <el-button @click="openDialog(scope.row)" size="small" type="primary" link
              >编辑</el-button
            >
            <el-divider direction="vertical" />
            <el-button
              :type="scope.row.isActive ? 'warning' : 'success'"
              @click="toggleStatus(scope.row)"
              size="small"
              link
              >{{ scope.row.isActive ? '禁用' : '启用' }}</el-button
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
        <el-form-item label="租户名称" prop="name"
          ><el-input v-model="form.name" placeholder="请输入租户名称" maxlength="100" clearable
        /></el-form-item>
        <el-form-item label="租户编码" prop="code"
          ><el-input v-model="form.code" placeholder="请输入租户编码" maxlength="50" clearable
        /></el-form-item>
        <el-form-item label="联系邮箱" prop="contactEmail"
          ><el-input
            v-model="form.contactEmail"
            placeholder="请输入联系邮箱"
            maxlength="100"
            clearable
        /></el-form-item>
        <el-form-item label="联系电话" prop="contactPhone"
          ><el-input
            v-model="form.contactPhone"
            placeholder="请输入联系电话"
            maxlength="20"
            clearable
        /></el-form-item>
        <el-form-item v-if="form.id" label="状态" prop="isActive"
          ><el-switch v-model="form.isActive" active-value="true" inactive-value="false"
        /></el-form-item>
      </el-form>
      <template #footer
        ><div class="dialog-footer">
          <el-button @click="dialogVisible = false">取消</el-button
          ><el-button :loading="submitLoading" @click="handleSubmit" type="primary">确定</el-button>
        </div></template
      >
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Plus, Search, Refresh, Delete } from '@element-plus/icons-vue';
import { api, ENDPOINTS } from '@/services/api';

const loading = ref(false);
const submitLoading = ref(false);
const dialogVisible = ref(false);
const dialogTitle = ref('');
const formRef = ref();
const form = reactive({
  id: '',
  name: '',
  code: '',
  contactEmail: '',
  contactPhone: '',
  isActive: true,
});

const rules = {
  name: [
    { required: true, message: '请输入租户名称', trigger: 'blur' },
    { max: 100, message: '名称长度不能超过 100 字符', trigger: 'blur' },
  ],
  code: [
    { required: true, message: '请输入租户编码', trigger: 'blur' },
    { max: 50, message: '编码长度不能超过 50 字符', trigger: 'blur' },
  ],
  contactEmail: [{ type: 'email', message: '邮箱格式不正确', trigger: 'blur' }],
};

const searchForm = reactive({ name: '', isActive: '' });
const pagination = reactive({ page: 1, pageSize: 20, total: 0 });
const tableData = ref<any[]>([]);

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
    if (searchForm.name) params.name = searchForm.name;
    if (searchForm.isActive !== '') params.isActive = searchForm.isActive;
    const response: any = await api.get('/admin/tenants', params);
    tableData.value = (response.data as any[]) || [];
    pagination.total = response.meta?.total || (response.data as any[])?.length || 0;
  } catch (error) {
    console.error('Failed to fetch tenants:', error);
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
  searchForm.name = '';
  searchForm.isActive = '';
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

function openDialog(row?: any) {
  resetForm();
  dialogTitle.value = row ? '编辑租户' : '新建租户';
  if (row) {
    form.id = row.id;
    form.name = row.name;
    form.code = row.code;
    form.contactEmail = row.contactEmail || '';
    form.contactPhone = row.contactPhone || '';
    form.isActive = row.isActive !== false;
  }
  dialogVisible.value = true;
}

function resetForm() {
  form.id = '';
  form.name = '';
  form.code = '';
  form.contactEmail = '';
  form.contactPhone = '';
  form.isActive = true;
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
        name: form.name,
        code: form.code,
        contactEmail: form.contactEmail || undefined,
        contactPhone: form.contactPhone || undefined,
        isActive: form.isActive,
      };
      if (form.id) {
        await api.patch(`/admin/tenants/${form.id}`, payload);
        ElMessage.success('更新成功');
      } else {
        await api.post('/admin/tenants', payload);
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
    await ElMessageBox.confirm('确定要删除该租户吗？', '确认删除', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning',
    });
    await api.delete(`/admin/tenants/${id}`);
    ElMessage.success('删除成功');
    fetchList();
  } catch (error) {
    if (error !== 'cancel') console.error('Delete error:', error);
  }
}

async function toggleStatus(row: any) {
  try {
    await api.patch(`/admin/tenants/${row.id}`, { isActive: !row.isActive });
    ElMessage.success(row.isActive ? '已禁用' : '已启用');
    fetchList();
  } catch (error) {
    console.error('Toggle status error:', error);
  }
}

onMounted(() => {
  fetchList();
});
</script>

<style scoped>
.tenant-management-tab {
  padding: 0;
}
.tab-header {
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
.header-left h2 {
  margin: 0;
  font-size: 18px;
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
</style>
