<template>
  <div class="login-page">
    <div class="login-form">
      <h1>HiWMS 登录</h1>
      <form @submit.prevent="handleLogin">
        <div class="form-group">
          <label for="email">邮箱</label>
          <input id="email" v-model="form.email" type="email" required placeholder="请输入邮箱" />
        </div>
        <div class="form-group">
          <label for="password">密码</label>
          <input
            id="password"
            v-model="form.password"
            type="password"
            required
            placeholder="请输入密码"
          />
        </div>
        <div class="form-group">
          <label for="tenantId">租户 ID</label>
          <input
            id="tenantId"
            v-model="form.tenantId"
            type="text"
            required
            placeholder="请输入租户 ID"
          />
        </div>
        <button :disabled="loading" type="submit">
          {{ loading ? '登录中...' : '登录' }}
        </button>
        <p v-if="error" class="error">{{ error }}</p>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { createClient } from '@supabase/supabase-js';

const router = useRouter();
const form = ref({ email: '', password: '', tenantId: '' });
const loading = ref(false);
const error = ref('');

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL || 'http://localhost:54321',
  import.meta.env.VITE_SUPABASE_ANON_KEY || 'your-anon-key'
);

async function handleLogin() {
  loading.value = true;
  error.value = '';
  try {
    const { data, error: authError } = await supabase.auth.signInWithPassword({
      email: form.value.email,
      password: form.value.password,
    });
    if (authError) throw authError;

    if (data.session) {
      localStorage.setItem('access_token', data.session.access_token);
      localStorage.setItem('refresh_token', data.session.refresh_token);
    }

    router.push('/dashboard');
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : '登录失败';
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.login-page {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 100vh;
  background: #f5f5f5;
}
.login-form {
  background: white;
  padding: 2rem;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  width: 100%;
  max-width: 400px;
}
.login-form h1 {
  margin-bottom: 1.5rem;
  text-align: center;
  color: #333;
}
.form-group {
  margin-bottom: 1rem;
}
.form-group label {
  display: block;
  margin-bottom: 0.5rem;
  font-weight: 500;
}
.form-group input {
  width: 100%;
  padding: 0.75rem;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 1rem;
  box-sizing: border-box;
}
button {
  width: 100%;
  padding: 0.75rem;
  background: #1890ff;
  color: white;
  border: none;
  border-radius: 4px;
  font-size: 1rem;
  cursor: pointer;
}
button:disabled {
  background: #99d3ff;
  cursor: not-allowed;
}
.error {
  color: #ff4d4f;
  margin-top: 1rem;
  text-align: center;
}
</style>
