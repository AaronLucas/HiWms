<template>
  <div class="system-params-tab">
    <div class="tab-header">
      <div class="header-left">
        <h2>系统参数</h2>
        <el-tag v-if="loading" type="info">加载中...</el-tag>
      </div>
      <el-button @click="openDialog" :loading="submitLoading" type="primary">
        <el-icon><Plus /></el-icon>
        新增参数
      </el-button>
    </div>

    <el-card class="search-card" shadow="never">
      <el-form :inline="true" :model="searchForm" class="search-form">
        <el-form-item label="参数键">
          <el-input
            v-model="searchForm.key"
            @keyup.enter="handleSearch"
            placeholder="参数键"
            clearable
          />
        </el-form-item>
        <el-form-item label="分类">
          <el-select
            v-model="searchForm.category"
            clearable
            style="width: 160px"
            placeholder="请选择分类"
          >
            <el-option label="系统" value="system" />
            <el-option label="业务" value="business" />
            <el-option label="安全" value="security" />
            <el-option label="集成" value="integration" />
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
        <el-table-column prop="key" label="参数键" width="200" show-overflow-tooltip />
        <el-table-column prop="value" label="参数值" min-width="200" show-overflow-tooltip>
          <template #default="scope"
            ><el-tooltip :content="scope.row.value" placement="top"
              ><span
                style="
                  max-width: 300px;
                  overflow: hidden;
                  text-overflow: ellipsis;
                  white-space: nowrap;
                  display: inline-block;
                "
                >{{ scope.row.value }}</span
              ></el-tooltip
            ></template
          >
        </el-table-column>
        <el-table-column prop="category" label="分类" width="120">
          <template #default="scope"
            ><el-tag size="small" effect="plain">{{ scope.row.category }}</el-tag></template
          >
        </el-table-column>
        <el-table-column prop="description" label="描述" min-width="250" show-overflow-tooltip />
        <el-table-column label="是否敏感" width="100" align="center">
          <template #default="scope"
            ><el-tag v-if="scope.row.isSensitive" type="warning" size="small">是</el-tag
            ><el-tag v-else type="info" size="small">否</el-tag></template
          >
        </el-table-column>
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
        <el-form-item label="参数键" prop="key"
          ><el-input
            v-model="form.key"
            v-if="!form.id"
            placeholder="请输入参数键（如: max_retry_count）"
            maxlength="100"
            clearable
        /></el-form-item>
        <el-form-item v-if="form.id" label="参数键"
          ><span>{{ form.key }}</span></el-form-item
        >
        <el-form-item label="参数值" prop="value"
          ><el-input
            v-model="form.value"
            :rows="3"
            type="textarea"
            placeholder="请输入参数值"
            maxlength="1000"
        /></el-form-item>
        <el-form-item label="分类" prop="category">
          <el-select v-model="form.category" placeholder="请选择分类" style="width: 100%">
            <el-option label="系统" value="system" />
            <el-option label="业务" value="business" />
            <el-option label="安全" value="security" />
            <el-option label="集成" value="integration" />
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
        <el-form-item label="是否敏感" prop="isSensitive"
          ><el-switch v-model="form.isSensitive" active-value="true" inactive-value="false"
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
  key: '',
  value: '',
  category: 'system',
  description: '',
  isSensitive: false,
});

const rules = {
  key: [
    { required: true, message: '请输入参数键', trigger: 'blur' },
    { max: 100, message: '参数键长度不能超过 100 字符', trigger: 'blur' },
  ],
  value: [{ required: true, message: '请输入参数值', trigger: 'blur' }],
  category: [{ required: true, message: '请选择分类', trigger: 'change' }],
};

const searchForm = reactive({ key: '', category: '' });
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
    if (searchForm.key) params.key = searchForm.key;
    if (searchForm.category) params.category = searchForm.category;
    const response: any = await api.get('/admin/system-params', params);
    tableData.value = (response.data as any[]) || [];
    pagination.total = response.meta?.total || (response.data as any[])?.length || 0;
  } catch (error) {
    console.error('Failed to fetch system params:', error);
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
  searchForm.key = '';
  searchForm.category = '';
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
  dialogTitle.value = row ? '编辑参数' : '新增参数';
  if (row) {
    form.id = row.id;
    form.key = row.key;
    form.value = row.value;
    form.category = row.category;
    form.description = row.description || '';
    form.isSensitive = row.isSensitive || false;
  }
  dialogVisible.value = true;
}

function resetForm() {
  form.id = '';
  form.key = '';
  form.value = '';
  form.category = 'system';
  form.description = '';
  form.isSensitive = false;
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
        key: form.key,
        value: form.value,
        category: form.category,
        description: form.description || undefined,
        isSensitive: form.isSensitive,
      };
      if (form.id) {
        await api.patch(`/admin/system-params/${form.id}`, payload);
        ElMessage.success('更新成功');
      } else {
        await api.post('/admin/system-params', payload);
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
    await ElMessageBox.confirm('确定要删除该参数吗？', '确认删除', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning',
    });
    await api.delete(`/admin/system-params/${id}`);
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
.system-params-tab {
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
