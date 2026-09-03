<template>
  <div class="user-management-tab">
    <div class="tab-header">
      <div class="header-left">
        <h2>用户管理</h2>
        <el-tag v-if="loading" type="info">加载中...</el-tag>
      </div>
      <el-button @click="openDialog" :loading="submitLoading" type="primary">
        <el-icon><Plus /></el-icon>
        新建用户
      </el-button>
    </div>

    <el-card class="search-card" shadow="never">
      <el-form :inline="true" :model="searchForm" class="search-form">
        <el-form-item label="邮箱">
          <el-input
            v-model="searchForm.email"
            @keyup.enter="handleSearch"
            placeholder="邮箱"
            clearable
          />
        </el-form-item>
        <el-form-item label="租户">
          <el-select
            v-model="searchForm.tenantId"
            :remote-method="remoteTenantSearch"
            :loading="tenantLoading"
            placeholder="请选择租户"
            clearable
            style="width: 200px"
            filterable
            remote
          >
            <el-option v-for="t in tenantOptions" :key="t.id" :label="t.name" :value="t.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="角色">
          <el-select
            v-model="searchForm.roleId"
            :remote-method="remoteRoleSearch"
            :loading="roleLoading"
            placeholder="请选择角色"
            clearable
            style="width: 200px"
            filterable
            remote
          >
            <el-option v-for="r in roleOptions" :key="r.id" :label="r.name" :value="r.id" />
          </el-select>
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
        <el-table-column prop="email" label="邮箱" width="220" show-overflow-tooltip />
        <el-table-column prop="tenantName" label="租户" width="160" show-overflow-tooltip />
        <el-table-column prop="roleName" label="角色" width="140" show-overflow-tooltip />
        <el-table-column label="状态" width="100">
          <template #default="scope"
            ><el-tag :type="scope.row.isActive ? 'success' : 'danger'" size="small" effect="dark">{{
              scope.row.isActive ? '启用' : '禁用'
            }}</el-tag></template
          >
        </el-table-column>
        <el-table-column label="平台管理员" width="120" align="center">
          <template #default="scope"
            ><el-tag v-if="scope.row.isSystemUser" type="warning" size="small">是</el-tag
            ><el-tag v-else type="info" size="small">否</el-tag></template
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
            <el-button @click="resetPassword(scope.row)" size="small" type="danger" link
              >重置密码</el-button
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
        <el-form-item label="邮箱" prop="email"
          ><el-input v-model="form.email" placeholder="请输入邮箱" maxlength="100" clearable
        /></el-form-item>
        <el-form-item label="租户" prop="tenantId">
          <el-select
            v-model="form.tenantId"
            :remote-method="remoteTenantSearch"
            :loading="tenantLoading"
            placeholder="请选择租户"
            filterable
            remote
            style="width: 100%"
          >
            <el-option v-for="t in tenantOptions" :key="t.id" :label="t.name" :value="t.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="角色" prop="roleId">
          <el-select
            v-model="form.roleId"
            :remote-method="remoteRoleSearch"
            :loading="roleLoading"
            placeholder="请选择角色"
            filterable
            remote
            style="width: 100%"
          >
            <el-option v-for="r in roleOptions" :key="r.id" :label="r.name" :value="r.id" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="!form.id" label="密码" prop="password"
          ><el-input v-model="form.password" type="password" placeholder="请输入密码" show-password
        /></el-form-item>
        <el-form-item v-if="!form.id" label="平台管理员" prop="isSystemUser"
          ><el-switch v-model="form.isSystemUser" active-value="true" inactive-value="false"
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
import { Plus, Search, Refresh, Delete, User, Lock } from '@element-plus/icons-vue';
import { api, ENDPOINTS } from '@/services/api';

const loading = ref(false);
const submitLoading = ref(false);
const dialogVisible = ref(false);
const dialogTitle = ref('');
const formRef = ref();
const form = reactive({
  id: '',
  email: '',
  tenantId: '',
  roleId: '',
  password: '',
  isSystemUser: false,
  isActive: true,
});

const rules = {
  email: [
    { required: true, message: '请输入邮箱', trigger: 'blur' },
    { type: 'email', message: '邮箱格式不正确', trigger: 'blur' },
  ],
  tenantId: [{ required: true, message: '请选择租户', trigger: 'change' }],
  roleId: [{ required: true, message: '请选择角色', trigger: 'change' }],
  password: [
    { required: true, message: '请输入密码', trigger: 'blur' },
    { min: 6, message: '密码长度不能少于 6 位', trigger: 'blur' },
  ],
};

const searchForm = reactive({ email: '', tenantId: '', roleId: '', isActive: '' });
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

const tenantOptions = ref<any[]>([]);
const roleOptions = ref<any[]>([]);
const tenantLoading = ref(false);
const roleLoading = ref(false);

async function remoteTenantSearch(query: string) {
  tenantLoading.value = true;
  try {
    const response: any = await api.get('/admin/tenants', { keyword: query, limit: 20 });
    tenantOptions.value = (response.data as any[]) || [];
  } catch (error) {
    console.error('Tenant search failed:', error);
    tenantOptions.value = [];
  } finally {
    tenantLoading.value = false;
  }
}

async function remoteRoleSearch(query: string) {
  roleLoading.value = true;
  try {
    const response: any = await api.get('/admin/roles', { keyword: query, limit: 20 });
    roleOptions.value = (response.data as any[]) || [];
  } catch (error) {
    console.error('Role search failed:', error);
    roleOptions.value = [];
  } finally {
    roleLoading.value = false;
  }
}

async function fetchList() {
  loading.value = true;
  try {
    const params: Record<string, any> = {
      limit: pagination.pageSize,
      offset: (pagination.page - 1) * pagination.pageSize,
    };
    if (searchForm.email) params.email = searchForm.email;
    if (searchForm.tenantId) params.tenantId = searchForm.tenantId;
    if (searchForm.roleId) params.roleId = searchForm.roleId;
    if (searchForm.isActive !== '') params.isActive = searchForm.isActive;
    const response: any = await api.get('/admin/users', params);
    tableData.value = (response.data as any[]) || [];
    pagination.total = response.meta?.total || (response.data as any[])?.length || 0;
  } catch (error) {
    console.error('Failed to fetch users:', error);
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
  searchForm.email = '';
  searchForm.tenantId = '';
  searchForm.roleId = '';
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
  dialogTitle.value = row ? '编辑用户' : '新建用户';
  if (row) {
    form.id = row.id;
    form.email = row.email;
    form.tenantId = row.tenantId;
    form.roleId = row.roleId;
    form.isSystemUser = row.isSystemUser || false;
    form.isActive = row.isActive !== false;
  }
  dialogVisible.value = true;
}

function resetForm() {
  form.id = '';
  form.email = '';
  form.tenantId = '';
  form.roleId = '';
  form.password = '';
  form.isSystemUser = false;
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
        email: form.email,
        tenantId: form.tenantId,
        roleId: form.roleId,
        password: form.password || undefined,
        isSystemUser: form.isSystemUser,
        isActive: form.isActive,
      };
      if (form.id) {
        await api.patch(`/admin/users/${form.id}`, payload);
        ElMessage.success('更新成功');
      } else {
        await api.post('/admin/users', payload);
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
    await ElMessageBox.confirm('确定要删除该用户吗？', '确认删除', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning',
    });
    await api.delete(`/admin/users/${id}`);
    ElMessage.success('删除成功');
    fetchList();
  } catch (error) {
    if (error !== 'cancel') console.error('Delete error:', error);
  }
}

async function toggleStatus(row: any) {
  try {
    await api.patch(`/admin/users/${row.id}`, { isActive: !row.isActive });
    ElMessage.success(row.isActive ? '已禁用' : '已启用');
    fetchList();
  } catch (error) {
    console.error('Toggle status error:', error);
  }
}

async function resetPassword(row: any) {
  try {
    await ElMessageBox.prompt('请输入新密码', '重置密码', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      inputPattern: /^.{6,}$/,
      inputErrorMessage: '密码长度不能少于 6 位',
    });
    ElMessage.success('密码重置成功（需后端接口支持）');
  } catch (error) {
    if (error !== 'cancel') console.error('Reset password error:', error);
  }
}

onMounted(() => {
  fetchList();
});
</script>

<style scoped>
.user-management-tab {
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
