<!-- 新建于 2026-07-18，ECC 治理试点第 4 项（转正）。此前项目没有 PR 模板文件，
     这不是修改，是新建（见 docs/06-agents/AGENTS.md §8.3.2）。 -->

## Summary
<!-- 这个 PR 做了什么、为什么做（关注"为什么"而非罗列文件改动） -->

## Test plan
<!-- 具体验证步骤，未做的项保留未勾选，不要虚报为已完成 -->
- [ ]

## 提交前自检（详细清单见 `docs/00-project/CONVENTIONS.md` §8）
- [ ] TypeScript 编译通过（`npm run lint`）、单元测试通过（`npm run test`）
- [ ] 无 `any` 类型；所有数据库操作带 `tenant_id`；错误处理使用自定义错误类
- [ ] 涉及 `.sql` 文件：已按 `.readonly/unWMS_PR_Pre_Submission_Checklist_V1.md` 逐条自查并在下方附验证证据
- [ ] 严重级别（CRITICAL/HIGH/MEDIUM/LOW，定义见 `.claude/rules/ecc/common/code-review.md`）：本 PR 已知问题为 ___ 级，CRITICAL/HIGH 已解决或在描述中说明原因

<!-- 涉及 .sql 文件时，DBA 清单验证证据贴在这里 -->
