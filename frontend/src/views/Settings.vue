<template>
  <div class="settings-page">
    <div class="page-header">
      <h1>系统设置</h1>
    </div>

    <el-tabs v-model="activeTab" @tab-click="handleTabChange" type="card">
      <el-tab-pane label="用户管理" name="users">
        <UserManagementTab />
      </el-tab-pane>
      <el-tab-pane label="角色管理" name="roles">
        <RoleManagementTab />
      </el-tab-pane>
      <el-tab-pane label="权限管理" name="permissions">
        <PermissionManagementTab />
      </el-tab-pane>
      <el-tab-pane label="租户管理" name="tenants">
        <TenantManagementTab />
      </el-tab-pane>
      <el-tab-pane label="审计日志" name="audit">
        <AuditLogTab />
      </el-tab-pane>
      <el-tab-pane label="系统参数" name="system">
        <SystemParamsTab />
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import UserManagementTab from './settings/UserManagementTab.vue';
import RoleManagementTab from './settings/RoleManagementTab.vue';
import PermissionManagementTab from './settings/PermissionManagementTab.vue';
import TenantManagementTab from './settings/TenantManagementTab.vue';
import AuditLogTab from './settings/AuditLogTab.vue';
import SystemParamsTab from './settings/SystemParamsTab.vue';

const activeTab = ref('users');

function handleTabChange(tab: any) {
  console.log('Tab changed:', tab.name);
}
</script>

<style scoped>
.settings-page {
  padding: 20px;
}
.page-header {
  margin-bottom: 20px;
}
.page-header h1 {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
}
</style>
