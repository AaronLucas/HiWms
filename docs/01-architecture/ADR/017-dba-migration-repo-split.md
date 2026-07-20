# ADR-017: DBA 迁移脚本拆分至独立仓库 HiWmsSupabase

## 状态
✅ Accepted（已实施：仓库已创建并推送初始内容，CI 已接线）

## 背景

`supabase/migrations`（001-008）、`seed.sql`、`.readonly/` 设计文档此前只存在于本地
磁盘——`.gitignore` 的 `supabase/*`/`.readonly/` 通配行为导致这些文件从未被本仓库的
git 跟踪。这本身是此前多轮调查（`REPOSITORY_ROADMAP.md`「剩余缺口清单」CRITICAL 第 2
项、PR #36 的排查记录）反复确认过的既有问题：想让 CI 跑一个"起本地 Postgres、应用
迁移、跑并发测试"的 job，缺了迁移文件本身没法运行；但直接把这些文件提交进本仓库
历史，又会让应用团队的 git 历史里永久包含 DBA 团队的原始 SQL 产出物，边界不清晰。

## 决策

拆分为两个独立仓库，零 git 层面关联（不用 submodule）：

- **HiWms**（本仓库，即 `wms7`）：应用代码，`supabase/`、`.readonly/` 目录本身仍在
  `.gitignore` 里，但注释更新为反映"有意不跟踪，权威版本在别处"，而不是此前的
  "暂缓决策"。
- **[HiWmsSupabase](https://github.com/AaronLucas/HiWmsSupabase)**（新建，私有）：
  DBA 团队直接管理的迁移脚本仓库，独立 `git init`，与本仓库没有共享的提交历史。
  目录结构见该仓库自己的 README：`supabase/`（标准 Supabase CLI 项目结构，可直接
  `supabase start`）+ `design-docs/`（每个迁移对应的设计文档 + PR 自查清单）+
  `ops-scripts/`（不属于编号迁移序列的独立运维脚本）。

CI 集成方式：`.github/workflows/db-integration.yml` 通过一把**只读、绑定单一仓库、
无过期时间的 SSH Deploy Key**（`HIWMS_SUPABASE_DEPLOY_KEY` secret）checkout
HiWmsSupabase，落地到本仓库 CI 运行时的 `./supabase/` 路径，再走标准
`supabase start && supabase db reset` 流程。本地开发用等价的
`scripts/sync-db-migrations.sh`（浅克隆同步，同样不建立 git 关联）。

## 方案对比：Deploy Key vs PAT vs Submodule

| 维度 | Deploy Key（采用） | Fine-grained PAT | Git Submodule |
|---|---|---|---|
| 有效期 | 无过期，仅手动吊销 | 强制过期（GitHub 限制，最长约 1 年），需定期轮换 | 不适用（非认证机制） |
| 权限范围 | 绑定单一仓库、可设只读 | 通常绑定发行者账号，权限面更大，即使 fine-grained 也有账号层面的关联风险 | 不适用 |
| 是否与个人账号会话绑定 | 否 | 是（即使是 fine-grained PAT，也挂在某个用户账号下） | 不适用 |
| 本仓库 git 历史是否包含对方仓库内容 | 否（CI 运行时 checkout，不落 git） | 否 | 是（子模块指针进 git 历史，且默认会拉取对方仓库内容到本地工作区） |
| 采用理由 | 无过期时间从根本上避免"两份都有有效期，CI 更容易断"的问题（用户在决策过程中提出的顾虑）；权限面天然最小 | 曾作为过渡方案考虑，因上述顾虑被否决 | 用户明确选择"纯 CI checkout，不建立仓库关联"，排除此选项 |

## 后果

### 正面
- DBA 团队的 SQL 产出物与应用代码的提交历史彻底解耦，各自演进、各自评审。
- CI 首次真正能跑通"应用迁移 + 并发测试"这条此前因文件缺失而无法运行的链路。
- Deploy Key 方案不产生"未来某天因 token 过期而静默断裂"的运维债务。

### 负面/风险
- 两个仓库间没有版本锁定机制（不是 submodule）——CI/本地同步永远拉取
  HiWmsSupabase 的最新 `main`，如果 DBA 团队推送了一个尚未验证的迁移，CI 会立刻
  用它跑测试。当前判断这个风险可接受（HiWmsSupabase 本身要求 DBA 按自查清单
  流程提交），但如果未来出现"需要固定测某个已验证版本"的场景，需要重新评估是否
  改为 submodule 或在 CI 里显式 pin 一个 commit SHA。
- `db-integration.yml` 是全新基础设施，首次运行前无法完全预判 Docker 启动耗时、
  Deploy Key 权限传播等问题，因此暂不接入 `ci-success` 硬门禁，留出观察期。

## 关联文档
- `docs/04-workflows/WORKFLOWS.md` §3.2.1 —— CI 流水线细节
- `docs/05-operations/OPS.md` §9.4 —— Deploy Key secret 的运维台账
- `docs/00-project/ROADMAP.md` §1.4.3 —— 任务落地记录
- `docs/03-database/REPOSITORY_ROADMAP.md`「剩余缺口清单」CRITICAL 第 2 项 —— 本 ADR 解决的原始缺口

---

*决策者：主工程师（用户在对话中提出方案方向与 Deploy Key 顾虑，具体实现由 Claude Code 落地）| 状态：已实施 | 记录日期：2026-07-20*
