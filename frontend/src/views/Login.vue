<template>
  <div class="login-page">
    <el-card class="login-form" shadow="never">
      <div class="login-header">
        <el-icon class="login-icon"><Box /></el-icon>
        <h1>HiWMS 登录</h1>
      </div>
      <el-form :model="form" :rules="rules" ref="formRef" label-width="80px" class="login-form-el">
        <el-form-item label="邮箱" prop="email">
          <el-input v-model="form.email" placeholder="请输入邮箱" prefix-icon="User" clearable />
        </el-form-item>
        <el-form-item label="密码" prop="password">
          <el-input v-model="form.password" type="password" placeholder="请输入密码" prefix-icon="Lock" show-password />
        </el-form-item>
        <el-form-item label="租户 ID" prop="tenantId">
          <el-input v-model="form.tenantId" placeholder="请输入租户 ID" prefix-icon="OfficeBuilding" clearable />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="loading" block @click="handleLogin">
            登录
          </el-button>
        </el-form-item>
      </el-form>
      <el-alert v-if="error" :title="error" type="error" show-icon closable @close="error = ''" />
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { Box, User, Lock, OfficeBuilding } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { useAuth } from '@/composables/useAuth'
import { useRouter } from 'vue-router'

const router = useRouter()
const formRef = ref()
const form = ref({ email: '', password: '', tenantId: '' })
const loading = ref(false)
const error = ref('')

const { login } = useAuth()

const rules = {
  email: [
    { required: true, message: '请输入邮箱', trigger: 'blur' },
    { type: 'email', message: '邮箱格式不正确', trigger: 'blur' },
  ],
  password: [
    { required: true, message: '请输入密码', trigger: 'blur' },
    { min: 6, message: '密码长度不能少于 6 位', trigger: 'blur' },
  ],
  tenantId: [
    { required: true, message: '请输入租户 ID', trigger: 'blur' },
  ],
}

async function handleLogin() {
  if (!formRef.value) return

  await formRef.value.validate(async (valid: boolean) => {
    if (!valid) return

    loading.value = true
    error.value = ''

    const success = await login(form.value)
    if (success) {
      ElMessage.success('登录成功')
      router.push('/dashboard')
    }
    loading.value = false
  })
}
</script>

<style scoped>
.login-page {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 100vh;
  background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
  padding: 20px;
}
.login-form {
  width: 100%;
  max-width: 420px;
  border-radius: 12px;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.1);
}
.login-header {
  text-align: center;
  margin-bottom: 24px;
}
.login-icon {
  font-size: 48px;
  color: #409eff;
  margin-bottom: 16px;
}
.login-header h1 {
  margin: 0;
  font-size: 24px;
  font-weight: 600;
  color: #303133;
}
.login-form-el :deep(.el-form-item) {
  margin-bottom: 20px;
}
.login-form-el :deep(.el-input__prefix) {
  color: #909399;
}
</style>