# DBA 迁移 024/026/036 集成指南

**目标**：安全地将三个关键迁移同步到应用层，验证与现有代码的兼容性

**时间估算**：1-1.5 天（包括测试和问题修复）

---

## 📋 执行步骤

### Step 1: 运行基线验证脚本（15 分钟）

```bash
bash scripts/verify-dba-migrations-024-026-036.sh
```

**预期输出**：所有基线检查通过，Supabase 环境就绪

---

### Step 2: 从 DBA 项目获取迁移文件（5 分钟）

```bash
# 从 HiWmsSupabase 复制三个迁移
cp ../dba-migrations/supabase/migrations/024_rbac_permissions_seed_backfill.sql supabase/migrations/
cp ../dba-migrations/supabase/migrations/026_auth_identity_bridge_trigger.sql supabase/migrations/
cp ../dba-migrations/supabase/migrations/036_tenant_isolation_hardening.sql supabase/migrations/

# 验证
ls -la supabase/migrations/{024,026,036}_*.sql
```

---

### Step 3: 逐个应用迁移并验证（30-45 分钟）

#### 3.1 迁移 024（RBAC 权限种子）

```bash
supabase migration up

# 验证权限表
psql "postgresql://postgres:postgres@localhost:54322/postgres" \
  -c "SELECT COUNT(*) FROM permissions;"
# 期望：> 50 行

# 测试权限系统
RUN_DB_INTEGRATION_TESTS=1 npm run test -- src/__tests__/integration/device-api/ --run
```

#### 3.2 迁移 026（Auth 身份桥接）

```bash
supabase migration up

# 验证触发器
psql "postgresql://postgres:postgres@localhost:54322/postgres" \
  -c "SELECT trigger_name FROM information_schema.triggers WHERE trigger_name='handle_new_user';"
# 期望：handle_new_user

# 测试用户创建
RUN_DB_INTEGRATION_TESTS=1 npm run test -- src/__tests__/integration/auth/tenant-isolation.test.ts --run
```

#### 3.3 迁移 036（租户隔离）

```bash
supabase migration up

# 验证隔离约束
psql "postgresql://postgres:postgres@localhost:54322/postgres" \
  -c "SELECT column_name FROM information_schema.columns WHERE table_name='containers' AND column_name='tenant_id';"
# 期望：tenant_id

# 测试隔离
RUN_DB_INTEGRATION_TESTS=1 npm run test -- src/__tests__/integration/repositories/SupabaseContainerRepository.concurrency.test.ts --run
```

---

### Step 4: 重新生成类型定义

```bash
supabase gen types typescript --project-id pkthcaqsdktlhqkowhkt > src/types/database.ts
npm run build
# 期望：tsc --noEmit 成功
```

---

### Step 5: 完整测试和提交

```bash
# 运行所有集成测试
RUN_DB_INTEGRATION_TESTS=1 npm run test:integration

# 如果全部通过
git add supabase/migrations/024_* supabase/migrations/026_* supabase/migrations/036_*
git add src/types/database.ts
git commit -m "chore: sync DBA migrations 024/026/036 (RBAC/Auth/Isolation)"
git push && gh pr create
```

---

## 🚨 关键注意事项

1. **迁移顺序必须是 024 → 026 → 036**
   - 026 依赖 024 的 fn_provision_tenant_defaults 函数
   - 如果顺序错误，用户创建会失败

2. **权限种子必须回填**
   - 迁移 024 会补齐 permissions 表的缺失行
   - 不执行此迁移，所有权限校验都会返回 403

3. **容器隔离不可逆**
   - 迁移 036 会锁定容器的 tenant_id
   - 一旦锁定，容器永远属于该租户

4. **性能影响**
   - 迁移 036 引入 SELECT ... FOR UPDATE 序列化
   - 监控容器操作的吞吐量变化

---

## ✅ 完成检查

- [ ] 基线验证通过
- [ ] 三个迁移文件复制到 supabase/migrations/
- [ ] 迁移 024 应用并验证 → 权限表有数据
- [ ] 迁移 026 应用并验证 → 触发器创建成功
- [ ] 迁移 036 应用并验证 → 隔离约束生效
- [ ] TypeScript 重新编译成功
- [ ] 所有集成测试通过
- [ ] PR 提交并通过审核
