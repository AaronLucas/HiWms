# ADR-002: 计费规则双轨制——规范化表 + JSONB 回退兼容

## 状态
✅ Accepted (2026-07-08)

## 背景
原 `tenants.billing_strategy` 仅用 JSONB 存储阶梯费率，存在问题：
- 无法追溯历史费率（调价后无法复核旧账单适用规则）
- 无法版本化管理（无法灰度发布新费率、无法回滚）
- 规则复用困难（多仓/多客户共享同一套模板需重复维护）
- JSONB 查询/索引性能弱于关系表

## 决策
引入 **规范化计费表** 双轨并存，作为低成本过渡方案：

### 新增表
1. `billing_rules` - 规则主表
   - `tenant_id`, `rule_name`, `currency`, `is_default`
   - `effective_from`, `effective_to` (日期版本化，支持历史回溯)
2. `billing_rule_tiers` - 阶梯明细
   - `rule_id`, `min_days`, `max_days`, `rate`, `description`
   - `min_charge`, `max_charge`, `tier_sequence`

### 兼容策略
- 保留 `tenants.billing_strategy` JSONB 作为：
  - 前端展示缓存（避免连表查询）
  - 未配置规范化规则时的默认费率（`fn_get_active_billing_rule` 回退逻辑）
- 查询入口统一：`fn_get_active_billing_rule(tenant_id)` 优先查规范化表，找不到回退 JSONB

### 迁移路径
1. 新租户/新规则直接用规范化表
2. 存量租户逐步将 JSONB 迁移入规范化表（一次性脚本）
3. 业务稳定后废弃 JSONB 字段

## 替代方案评估
| 方案 | 优点 | 缺点 | 结论 |
|------|------|------|------|
| 仅 JSONB | 零改动 | 无法追溯、无版本、查询弱 | ❌ |
| 仅规范化表 | 彻底 | 一次性改动大、风险高 | ❌ |
| **双轨并存** | **平滑过渡、可回退、风险可控** | **临时冗余** | ✅ |

## 后果
- 正面：费率可追溯、支持多模板、可灰度发布
- 负面：短期存双份数据、查询逻辑稍复杂
- 风险：双轨数据不一致 → 需定期校验脚本

## 关联
- 表定义见 `supabase/migrations/001_initial_schema.sql` §7
- 查询函数 `fn_get_active_billing_rule()` 同文件
