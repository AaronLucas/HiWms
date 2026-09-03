<template>
  <div class="permission-management-tab">
    <div class="tab-header">
      <div class="header-left">
        <h2>权限管理</h2>
        <el-tag v-if="loading" type="info">加载中...</el-tag>
      </div>
      <el-button @click="openDialog" :loading="submitLoading" type="primary">
        <el-icon><Plus /></el-icon>
        新建权限
      </el-button>
    </div>

    <el-card class="search-card" shadow="never">
      <el-form :inline="true" :model="searchForm" class="search-form">
        <el-form-item label="资源">
          <el-input
            v-model="searchForm.resource"
            @keyup.enter="handleSearch"
            placeholder="资源名称"
            clearable
          />
        </el-form-item>
        <el-form-item label="操作">
          <el-select
            v-model="searchForm.action"
            clearable
            style="width: 160px"
            placeholder="请选择操作"
          >
            <el-option label="创建" value="CREATE" />
            <el-option label="读取" value="READ" />
            <el-option label="更新" value="UPDATE" />
            <el-option label="删除" value="DELETE" />
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
        <el-table-column prop="id" label="ID" width="100" show-overflow-tooltip />
        <el-table-column prop="resource" label="资源" width="200" show-overflow-tooltip />
        <el-table-column prop="action" label="操作" width="120">
          <template #default="scope"
            ><el-tag size="small" effect="plain">{{ scope.row.action }}</el-tag></template
          >
        </el-table-column>
        <el-table-column prop="description" label="描述" min-width="300" show-overflow-tooltip />
        <el-table-column label="创建时间" width="160"
          ><template #default="scope">{{
            formatDate(scope.row.createdAt)
          }}</template></el-table-column
        >
        <el-table-column label="操作" width="160" fixed="right">
          <template #default="scope">
            <el-button @click="openDialog(scope.row)" size="small" type="primary" link
              >编辑</el-button
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
        <el-form-item label="资源" prop="resource"
          ><el-input
            v-model="form.resource"
            placeholder="请输入资源名称（如: users, products, orders）"
            maxlength="50"
            clearable
        /></el-form-item>
        <el-form-item label="操作" prop="action">
          <el-select v-model="form.action" placeholder="请选择操作" style="width: 100%">
            <el-option label="创建" value="CREATE" />
            <el-option label="读取" value="READ" />
            <el-option label="更新" value="UPDATE" />
            <el-option label="删除" value="DELETE" />
          </el-select>
        </el-form-item>
        <el-form-item label="描述" prop="description"
          ><el-input
            v-model="form.description"
            :rows="2"
            type="textarea"
            placeholder="请输入描述"
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
  resource: '',
  action: 'READ',
  description: '',
});

const rules = {
  resource: [
    { required: true, message: '请输入资源名称', trigger: 'blur' },
    { max: 50, message: '资源名称长度不能超过 50 字符', trigger: 'blur' },
  ],
  action: [{ required: true, message: '请选择操作', trigger: 'change' }],
  description: [{ max: 200, message: '描述长度不能超过 200 字符', trigger: 'blur' }],
};

const searchForm = reactive({ resource: '', action: '' });
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
    if (searchForm.resource) params.resource = searchForm.resource;
    if (searchForm.action) params.action = searchForm.action;
    const response: any = await api.get('/admin/permissions', params);
    tableData.value = (response.data as any[]) || [];
    pagination.total = response.meta?.total || (response.data as any[])?.length || 0;
  } catch (error) {
    console.error('Failed to fetch permissions:', error);
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
  searchForm.resource = '';
  searchForm.action = '';
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
  dialogTitle.value = row ? '编辑权限' : '新建权限';
  if (row) {
    form.id = row.id;
    form.resource = row.resource;
    form.action = row.action;
    form.description = row.description || '';
  }
  dialogVisible.value = true;
}

function resetForm() {
  form.id = '';
  form.resource = '';
  form.action = 'READ';
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
        resource: form.resource,
        action: form.action,
        description: form.description || undefined,
      };
      if (form.id) {
        await api.patch(`/admin/permissions/${form.id}`, payload);
        ElMessage.success('更新成功');
      } else {
        await api.post('/admin/permissions', payload);
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
    await ElMessageBox.confirm('确定要删除该权限吗？', '确认删除', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning',
    });
    await api.delete(`/admin/permissions/${id}`);
    ElMessage.success('删除成功');
    fetchList();
  } catch (error) {
    if (error !== 'cancel') console.error('Delete error:', error);
  }
}

onMounted(() => {
  fetchList();
});
</script>

<style scoped>
.permission-management-tab {
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
