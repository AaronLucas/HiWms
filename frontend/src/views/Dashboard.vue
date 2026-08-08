<template>
  <div class="dashboard">
    <el-page-header @back="goBack" class="dashboard-header">
      <template #breadcrumb>
        <el-breadcrumb separator="/">
          <el-breadcrumb-item>首页</el-breadcrumb-item>
        </el-breadcrumb>
      </template>
      <el-avatar :size="40" :src="userAvatar" class="user-avatar" />
      <div class="header-actions">
        <el-dropdown trigger="click">
          <span class="user-dropdown">
            <el-avatar :size="30" :src="userAvatar" />
            <span>{{ auth.user?.email || "用户" }}</span>
            <el-icon><ArrowDown /></el-icon>
          </span>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item @click="changePassword">
                <el-icon><Lock /></el-icon>
                <span>修改密码</span>
              </el-dropdown-item>
              <el-dropdown-item divided @click="logout">
                <el-icon><SwitchButton /></el-icon>
                <span>退出登录</span>
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
    </el-page-header>

    <el-row :gutter="20" class="stats-row">
      <el-col :xs="24" :sm="12" :md="6" :lg="3" v-for="stat in stats" :key="stat.key">
        <el-card class="stat-card" shadow="hover">
          <div class="stat-icon" :class="stat.iconClass">
            <el-icon :size="24"><component :is="stat.icon" /></component></el-icon>
          </div>
          <div class="stat-content">
            <p class="stat-label">{{ stat.label }}</p>
            <p class="stat-value">{{ stat.value }}</p>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <el-row :gutter="20">
      <el-col :xs="24" :lg="12">
        <el-card shadow="never">
          <template #header>
            <div class="card-header">
              <span>快速操作</span>
            </div>
          </template>
          <div class="quick-actions">
            <el-button type="primary" @click="$router.push('/materials')" :icon="Plus" plain block>新建物料</el-button>
            <el-button type="success" @click="$router.push('/orders')" :icon="ShoppingCart" plain block>创建订单</el-button>
            <el-button type="info" @click="$router.push('/waves')" :icon="Connection" plain block>生成波次</el-button>
            <el-button type="warning" @click="$router.push('/work-orders')" :icon="Setting" plain block>创建工单</el-button>
          </div>
        </el-card>
      </el-col>
      <el-col :xs="24" :lg="12">
        <el-card shadow="never">
          <template #header>
            <div class="card-header">
              <span>系统通知</span>
            </div>
          </template>
          <el-empty description="暂无通知" image="https://fuss10.elemecdn.com/e/empty/3f894115b78f8c86b5f3b1e4b2e8c4f8.svg" />
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import { useAuth } from "@/composables/useAuth";
import {
  Plus,
  ShoppingCart,
  Connection,
  Setting,
  Lock,
  SwitchButton,
  ArrowDown,
  Box,
} from "@element-plus/icons-vue";

const router = useRouter();
const auth = useAuth();

const stats = ref([
  { key: "inventory", label: "总库存", value: 0, icon: Box, iconClass: "icon-primary" },
  { key: "orders", label: "待处理订单", value: 0, icon: ShoppingCart, iconClass: "icon-success" },
  { key: "waves", label: "活跃波次", value: 0, icon: Connection, iconClass: "icon-info" },
  { key: "workOrders", label: "执行中工单", value: 0, icon: Setting, iconClass: "icon-warning" },
]);

const userAvatar = computed(() => {
  const email = auth.user?.email || "";
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(email)}&background=409EFF&color=fff`;
});

async function loadDashboardStats() {
  try {
    stats.value[0].value = 1250;
    stats.value[1].value = 23;
    stats.value[2].value = 3;
    stats.value[3].value = 8;
  } catch (error) {
    ElMessage.error("加载统计数据失败");
  }
}

function goBack() {
  router.go(-1);
}

async function logout() {
  await auth.logout();
}

function changePassword() {
  ElMessage.info("修改密码功能开发中...");
}

onMounted(() => {
  auth.loadFromStorage();
  loadDashboardStats();
});
</script>

<style scoped>
.dashboard {
  padding: 20px;
}
.dashboard-header {
  margin-bottom: 20px;
}
.header-actions {
  display: flex;
  align-items: center;
  gap: 16px;
}
.user-dropdown {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  padding: 4px 12px;
  border-radius: 20px;
  transition: background 0.2s;
}
.user-dropdown:hover {
  background: #f5f7fa;
}
.user-avatar {
  cursor: pointer;
}
.stats-row {
  margin-bottom: 20px;
}
.stat-card {
  height: 100%;
  transition: transform 0.2s, box-shadow 0.2s;
}
.stat-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.1);
}
.stat-icon {
  width: 48px;
  height: 48px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 12px;
}
.icon-primary { background: #eef2ff; color: #409eff; }
.icon-success { background: #f0fdf4; color: #67c23a; }
.icon-info { background: #ecfeff; color: #409eff; }
.icon-warning { background: #fdf6ec; color: #e6a23c; }
.stat-content {
  text-align: center;
}
.stat-label {
  margin: 0;
  font-size: 14px;
  color: #909399;
}
.stat-value {
  margin: 4px 0 0;
  font-size: 28px;
  font-weight: 600;
  color: #303133;
}
.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.quick-actions {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.quick-actions .el-button {
  height: 48px;
  font-size: 15px;
}
</style>