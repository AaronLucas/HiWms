<template>
  <div class="audit-log-tab">
    <div class="tab-header">
      <div class="header-left">
        <h2>审计日志</h2>
        <el-tag v-if="loading" type="info">加载中...</el-tag>
      </div>
    </div>

    <el-card class="search-card" shadow="never">
      <el-form :inline="true" :model="searchForm" class="search-form">
        <el-form-item label="用户">
          <el-input
            v-model="searchForm.userEmail"
            @keyup.enter="handleSearch"
            placeholder="用户邮箱"
            clearable
          />
        </el-form-item>
        <el-form-item label="操作">
          <el-input v-model="searchForm.action" placeholder="操作类型" clearable />
        </el-form-item>
        <el-form-item label="资源">
          <el-input v-model="searchForm.resource" placeholder="资源类型" clearable />
        </el-form-item>
        <el-form-item label="时间范围">
          <el-date-picker
            v-model="searchForm.startTime"
            type="datetime"
            placeholder="开始时间"
            value-format="YYYY-MM-DD HH:mm:ss"
            clearable
            style="width: 180px"
          />
          <span class="date-separator">至</span>
          <el-date-picker
            v-model="searchForm.endTime"
            type="datetime"
            placeholder="结束时间"
            value-format="YYYY-MM-DD HH:mm:ss"
            clearable
            style="width: 180px"
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
        <el-table-column prop="id" label="ID" width="100" show-overflow-tooltip />
        <el-table-column prop="userEmail" label="操作用户" width="200" show-overflow-tooltip />
        <el-table-column prop="action" label="操作" width="120">
          <template #default="scope"
            ><el-tag size="small" effect="plain">{{ scope.row.action }}</el-tag></template
          >
        </el-table-column>
        <el-table-column prop="resource" label="资源" width="140" show-overflow-tooltip />
        <el-table-column prop="resourceId" label="资源 ID" width="160" show-overflow-tooltip />
        <el-table-column label="详情" min-width="300"
          ><template #default="scope"
            ><span class="text-muted">{{ scope.row.details || '-' }}</span></template
          ></el-table-column
        >
        <el-table-column prop="ipAddress" label="IP 地址" width="160" show-overflow-tooltip />
        <el-table-column label="时间" width="180"
          ><template #default="scope">{{
            formatDate(scope.row.createdAt)
          }}</template></el-table-column
        >
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
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import { Search, Refresh } from '@element-plus/icons-vue';
import { api, ENDPOINTS } from '@/services/api';

const loading = ref(false);
const searchForm = reactive({
  userEmail: '',
  action: '',
  resource: '',
  startTime: '',
  endTime: '',
});
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
    if (searchForm.userEmail) params.userEmail = searchForm.userEmail;
    if (searchForm.action) params.action = searchForm.action;
    if (searchForm.resource) params.resource = searchForm.resource;
    if (searchForm.startTime) params.startTime = searchForm.startTime;
    if (searchForm.endTime) params.endTime = searchForm.endTime;
    const response: any = await api.get('/admin/audit-logs', params);
    tableData.value = (response.data as any[]) || [];
    pagination.total = response.meta?.total || (response.data as any[])?.length || 0;
  } catch (error) {
    console.error('Failed to fetch audit logs:', error);
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
  searchForm.userEmail = '';
  searchForm.action = '';
  searchForm.resource = '';
  searchForm.startTime = '';
  searchForm.endTime = '';
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

onMounted(() => {
  fetchList();
});
</script>

<style scoped>
.audit-log-tab {
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
.date-separator {
  margin: 0 8px;
  color: var(--el-text-color-secondary);
}
.pagination-wrapper {
  margin-top: 16px;
  display: flex;
  justify-content: flex-end;
}
</style>
