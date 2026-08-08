<template>
  <div class="dashboard">
    <header class="dashboard-header">
      <h1>仪表盘</h1>
      <div class="user-info">
        <span>租户: {{ tenantId }}</span>
        <button @click="logout">退出登录</button>
      </div>
    </header>
    <main class="dashboard-content">
      <div class="stats-grid">
        <div class="stat-card">
          <h3>总库存</h3>
          <p class="stat-value">{{ totalInventory }}</p>
        </div>
        <div class="stat-card">
          <h3>待处理订单</h3>
          <p class="stat-value">{{ pendingOrders }}</p>
        </div>
        <div class="stat-card">
          <h3>活跃波次</h3>
          <p class="stat-value">{{ activeWaves }}</p>
        </div>
        <div class="stat-card">
          <h3>执行中工单</h3>
          <p class="stat-value">{{ activeWorkOrders }}</p>
        </div>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';

const router = useRouter();
const tenantId = ref(localStorage.getItem('tenant_id') || '-');
const totalInventory = ref(0);
const pendingOrders = ref(0);
const activeWaves = ref(0);
const activeWorkOrders = ref(0);

function logout() {
  localStorage.removeItem('access_token');
  localStorage.removeItem('refresh_token');
  localStorage.removeItem('tenant_id');
  router.push('/login');
}

onMounted(async () => {
  totalInventory.value = 1250;
  pendingOrders.value = 23;
  activeWaves.value = 3;
  activeWorkOrders.value = 8;
});
</script>

<style scoped>
.dashboard {
  padding: 2rem;
}
.dashboard-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 2rem;
}
.user-info {
  display: flex;
  align-items: center;
  gap: 1rem;
}
button {
  padding: 0.5rem 1rem;
  background: #ff4d4f;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}
.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 1.5rem;
}
.stat-card {
  background: white;
  padding: 1.5rem;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}
.stat-card h3 {
  margin: 0 0 0.5rem;
  color: #666;
  font-size: 1rem;
  font-weight: 500;
}
.stat-value {
  margin: 0;
  font-size: 2.5rem;
  font-weight: 600;
  color: #1890ff;
}
</style>
