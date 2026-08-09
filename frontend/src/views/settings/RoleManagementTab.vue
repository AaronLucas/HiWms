<template>
  <div class="role-management-tab">
    <div class="tab-header">
      <div class="header-left">
        <h2>角色管理</h2>
        <el-tag v-if="loading" type="info">加载中...</el-tag>
      </div>
      <el-button @click="openDialog" :loading="submitLoading" type="primary">
        <el-icon><Plus /></el-icon>
        新建角色
      </el-button>
    </div>

    <el-card class="search-card" shadow="never">
      <el-form :inline="true" :model="searchForm" class="search-form">
        <el-form-item label="角色名称">
          <el-input
            v-model="searchForm.name"
            @keyup.enter="handleSearch"
            placeholder="角色名称"
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
        <el-form-item label="类型">
          <el-select
            v-model="searchForm.scope"
            clearable
            style="width: 160px"
            placeholder="请选择类型"
          >
            <el-option label="租户级" value="tenant" />
            <el-option label="平台级" value="platform" />
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
        <el-table-column prop="name" label="角色名称" width="200" show-overflow-tooltip />
        <el-table-column prop="description" label="描述" min-width="200" show-overflow-tooltip />
        <el-table-column prop="tenantName" label="租户" width="160" show-overflow-tooltip />
        <el-table-column label="类型" width="120">
          <template #default="scope"
            ><el-tag
              :type="scope.row.scope === 'platform' ? 'warning' : 'primary'"
              size="small"
              effect="dark"
              >{{ scope.row.scope === 'platform' ? '平台级' : '租户级' }}</el-tag
            ></template
          >
        </el-table-column>
        <el-table-column label="创建时间" width="160"
          ><template #default="scope">{{
            formatDate(scope.row.createdAt)
          }}</template></el-table-column
        >
        <el-table-column label="操作" width="220" fixed="right">
          <template #default="scope">
            <el-button @click="openDialog(scope.row)" size="small" type="primary" link
              >编辑</el-button
            >
            <el-divider direction="vertical" />
            <el-button @click="openPermissionDialog(scope.row)" size="small" type="info" link
              >配置权限</el-button
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
        <el-form-item label="角色名称" prop="name"
          ><el-input v-model="form.name" placeholder="请输入角色名称" maxlength="50" clearable
        /></el-form-item>
        <el-form-item label="描述" prop="description"
          ><el-input
            v-model="form.description"
            :rows="2"
            type="textarea"
            placeholder="请输入描述"
            maxlength="200"
        /></el-form-item>
        <el-form-item v-if="!form.id" label="租户" prop="tenantId">
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
        <el-form-item v-if="!form.id" label="类型" prop="scope">
          <el-select v-model="form.scope" placeholder="请选择类型" style="width: 100%">
            <el-option label="租户级" value="tenant" />
            <el-option label="平台级" value="platform" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer
        ><div class="dialog-footer">
          <el-button @click="dialogVisible = false">取消</el-button
          ><el-button :loading="submitLoading" @click="handleSubmit" type="primary">确定</el-button>
        </div></template
      >
    </el-dialog>

    <el-dialog
      v-model="permissionDialogVisible"
      :title="permissionDialogTitle"
      width="800px"
      destroy-on-close
    >
      <el-card v-if="permissionRole" shadow="never">
        <div class="permission-tree">
          <el-tree
            ref="permissionTreeRef"
            :data="permissionTreeData"
            :props="treeProps"
            :default-checked-keys="defaultCheckedKeys"
            show-checkbox
            node-key="id"
            default-expand-all
            highlight-current
          />
        </div>
      </el-card>
      <el-empty v-else description="加载中..." />
      <template #footer
        ><div class="dialog-footer">
          <el-button @click="permissionDialogVisible = false">取消</el-button
          ><el-button
            :loading="permissionSubmitLoading"
            @click="handlePermissionSubmit"
            type="primary"
            >保存权限</el-button
          >
        </div></template
      >
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, computed } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Plus, Search, Refresh, Delete, Setting, Lock } from '@element-plus/icons-vue';
import { api, ENDPOINTS } from '@/services/api';

const loading = ref(false);
const submitLoading = ref(false);
const dialogVisible = ref(false);
const dialogTitle = ref('');
const formRef = ref();
const form = reactive({
  id: '',
  name: '',
  description: '',
  tenantId: '',
  scope: 'tenant',
});

const rules = {
  name: [
    { required: true, message: '请输入角色名称', trigger: 'blur' },
    { max: 50, message: '名称长度不能超过 50 字符', trigger: 'blur' },
  ],
  description: [{ max: 200, message: '描述长度不能超过 200 字符', trigger: 'blur' }],
  tenantId: [{ required: true, message: '请选择租户', trigger: 'change' }],
  scope: [{ required: true, message: '请选择类型', trigger: 'change' }],
};

const searchForm = reactive({ name: '', tenantId: '', scope: '' });
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
const tenantLoading = ref(false);

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

async function fetchList() {
  loading.value = true;
  try {
    const params: Record<string, any> = {
      limit: pagination.pageSize,
      offset: (pagination.page - 1) * pagination.pageSize,
    };
    if (searchForm.name) params.name = searchForm.name;
    if (searchForm.tenantId) params.tenantId = searchForm.tenantId;
    if (searchForm.scope) params.scope = searchForm.scope;
    const response: any = await api.get('/admin/roles', params);
    tableData.value = (response.data as any[]) || [];
    pagination.total = response.meta?.total || (response.data as any[])?.length || 0;
  } catch (error) {
    console.error('Failed to fetch roles:', error);
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
  searchForm.tenantId = '';
  searchForm.scope = '';
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
  dialogTitle.value = row ? '编辑角色' : '新建角色';
  if (row) {
    form.id = row.id;
    form.name = row.name;
    form.description = row.description || '';
    form.tenantId = row.tenantId;
    form.scope = row.scope || 'tenant';
  }
  dialogVisible.value = true;
}

function resetForm() {
  form.id = '';
  form.name = '';
  form.description = '';
  form.tenantId = '';
  form.scope = 'tenant';
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
        description: form.description || undefined,
        tenantId: form.tenantId || undefined,
        scope: form.scope,
      };
      if (form.id) {
        await api.patch(`/admin/roles/${form.id}`, payload);
        ElMessage.success('更新成功');
      } else {
        await api.post('/admin/roles', payload);
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
    await ElMessageBox.confirm('确定要删除该角色吗？', '确认删除', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning',
    });
    await api.delete(`/admin/roles/${id}`);
    ElMessage.success('删除成功');
    fetchList();
  } catch (error) {
    if (error !== 'cancel') console.error('Delete error:', error);
  }
}

const permissionDialogVisible = ref(false);
const permissionDialogTitle = ref('配置权限');
const permissionSubmitLoading = ref(false);
const permissionTreeRef = ref();
const permissionRole = ref<any>(null);
const permissionTreeData = ref<any[]>([]);
const defaultCheckedKeys = ref<string[]>([]);

const treeProps = {
  children: 'children',
  label: 'name',
  disabled: 'disabled',
};

async function openPermissionDialog(role: any) {
  permissionRole.value = role;
  permissionDialogTitle.value = `配置权限 - ${role.name}`;
  permissionDialogVisible.value = true;
  defaultCheckedKeys.value = [];
  try {
    const [permsRes, rolePermsRes] = await Promise.all([
      api.get<any>('/admin/permissions', { limit: 1000 }),
      api.get<any>(`/admin/roles/${role.id}/permissions`),
    ]);
    const allPerms = (permsRes.data as any[]) || [];
    const rolePerms = (rolePermsRes.data as any[]) || [];
    permissionTreeData.value = buildPermissionTree(allPerms);
    defaultCheckedKeys.value = rolePerms.map((p: any) => p.permissionId);
  } catch (error) {
    console.error('Failed to fetch permissions:', error);
    permissionTreeData.value = [];
  }
}

function buildPermissionTree(perms: any[]): any[] {
  const groups: Record<string, any> = {};
  for (const p of perms) {
    const group = p.resource || '其他';
    if (!groups[group]) {
      groups[group] = { id: `group-${group}`, name: group, children: [] };
    }
    groups[group].children.push({ id: p.id, name: `${p.resource}:${p.action}`, disabled: false });
  }
  return Object.values(groups);
}

async function handlePermissionSubmit() {
  const tree = permissionTreeRef.value;
  if (!tree || !permissionRole.value) return;
  const checkedKeys = tree.getCheckedKeys(false);
  permissionSubmitLoading.value = true;
  try {
    await api.put(`/admin/roles/${permissionRole.value.id}/permissions`, {
      permissionIds: checkedKeys,
    });
    ElMessage.success('权限配置成功');
    permissionDialogVisible.value = false;
  } catch (error) {
    console.error('Permission submit error:', error);
  } finally {
    permissionSubmitLoading.value = false;
  }
}

onMounted(() => {
  fetchList();
});
</script>

<style scoped>
.role-management-tab {
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
.permission-tree {
  max-height: 500px;
  overflow: auto;
}
</style>
