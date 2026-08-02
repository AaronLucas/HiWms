# uniWMS v3.8 需求 vs 现有实现 vs 行业标准：三方批判性分析

> **日期**: 2026-08-02  
> **审计方法**: ECC multi-agent 双维度分析（planner 用例逐项扫描 + architect 架构/DB 对齐），叠加行业对标批判性评估  
> **需求来源**: `HiWmsSupabase/uniWMS需求3.8.md`（早期产物，不可全盘接受）  
> **分析原则**: 每个特性以"现有实现/需求文档/行业标准"三方对照，给出判断：**采用现有方案 / 采用需求方案 / 折中 / 重新设计**

---

## 0. 总体判断

**需求文档 v3.8 作为愿景参考是好的，但以下问题需要警惕：**

| 问题 | 说明 |
|------|------|
| **过度设计** | UC-020 AI耗材预测在仓库连基础耗材用量统计都没跑通之前就上 ML——行业里 Blue Yonder 也是先做 rule-based 再逐步 ML |
| **概念混淆** | "松耦合收货"(UC-019)其实已经被现有的 UNIDENTIFIED_GOODS 机制覆盖，需求文档的描述反而不如现有设计清晰 |
| **缺失关键项** | 需求文档没提"库存预留/锁定"、没提"盘点差异处理"、没提"自动化批次追溯"——这些是 Manhattan/SAP EWM 的核心功能 |
| **过早商业化** | 免费/收费切换（`jsonb_data`/`premium_features` 列）在第一个付费客户都没有之前就铺到全部 40+ 表——富勒 FLUX 也是先有客户再有分层，不是反过来 |

**结论：需求文档作为功能清单可用，但架构方案不可直接施工。每个特性必须经过行业对标检验。**

---

## 1. 20 个用例批判性评审

### UC-001：设备注册授权

| 维度 | 评估 |
|------|------|
| **需求文档** | IMEI/MAC/序列号加密生成 deviceId、管理员审核绑定、**AI 故障预测**、按扫描次数/时长计费 |
| **现有实现** | ADR-019 三层凭证体系（API Key + JWT + Refresh Token）、Device API provision/login/refresh、RBAC `devices:CREATE` |
| **行业标准** | Manhattan 的设备管理核心是"设备→仓库→区域"绑定（确保操作员在正确物理位置），而非 AI 预测。计费按设备 license 而非按扫描次数 |
| **判断** | **采用现有方案 + 部分折中**。ADR-019 的凭证体系已经比需求文档的"IMEI 加密"更成熟。但设备健康数据采集（电量/信号/温度）是仓库运营的刚需，不需要 AI 预测模型——先做阈值告警即可。**不需要按扫描次数计费**——Manhattan/Oracle 都是按 device license 收费 |

### UC-002：紧耦合验货

| 维度 | 评估 |
|------|------|
| **需求文档** | 关联订单，五面照片 <5MB，合规检查（温度/危险品/HS编码） |
| **现有实现** | `verification_rules`（版本化验货规则）+ `quality_inspections` 表 + `fn_verify_weight` RPC。**缺照片存证表** |
| **行业标准** | SAP EWM 的 Inspection 是"抽样规则→检验项→结果→处置"四步流，照片是可选附件而非必选项。五面照片是电商仓库特有需求（防纠纷），非 3PL 标准 |
| **判断** | **折中**。保留现有的验货规则+质检单体系（对齐 SAP EWM），新增 `inspection_photos` 作为可选附件表。**不接受需求文档的"五面必拍"作为硬约束**——做成租户级配置 |

### UC-003：出库工单履行

| 维度 | 评估 |
|------|------|
| **需求文档** | 拣货→打包→发货 WO 生成→客户通知 |
| **现有实现** | DB 层 95% 就绪（work_orders/packing_tasks/shipping_documents/vehicles/loading_tasks 全套表），Device API 离线 sync_events 路径通，Tenant API 0% |
| **行业标准** | Manhattan 的 Outbound 是 "Wave→Pick→Pack→Ship" 四段，每段独立工单，父子工单级联。通知不在 WO 层做，而是独立 Shipment Notification 子系统 |
| **判断** | **采用现有方案**。DB 设计已经对齐 Manhattan 的段式工单模型。缺的只是 API 暴露。**不接受需求文档把"客户通知"写进 WO 履行流**——通知应走独立的 Notification 子系统（见 UC-012） |

### UC-004：复杂订单录入

| 维度 | 评估 |
|------|------|
| **需求文档** | 拆箱/包箱 BOM 计算、快递单据导入导出 |
| **现有实现** | `vas_boms`/`vas_bom_items` 表存在（用于 kitting/de-kitting），订单 CRUD 已有 |
| **行业标准** | Blue Yonder 的 Order 入口是 EDI/API 自动化为主，手工录入是例外。BOM 属于 Product Master 而非 Order 域 |
| **判断** | **采用现有方案**。VAS BOM 表已经正确放在 Product 域下，不需要在订单录入里重复做 BOM 计算。快递单据导入导出属于外部集成（见 F5.3）|

### UC-005：补货工单

| 维度 | 评估 |
|------|------|
| **需求文档** | 基于安全库存或需求预测，触发供应商采购或跨仓调拨 |
| **现有实现** | `v_replenishment_needs` 视图存在，inventory 表有 `picking_priority`，work_orders 支持 Transfer/Replenishment 类型。缺：replenishment_rules 表、自动触发调度 |
| **行业标准** | 成熟 WMS 的补货分两层：(1) Min/Max 规则驱动（库内补货），(2) 需求预测驱动（采购补货）。前者是 WMS 核心，后者是 SCM/ERP 范畴 |
| **判断** | **折中**。Min/Max 规则驱动补货应在 WMS 内闭环——现有 `v_replenishment_needs` 视图 + 新增 `replenishment_rules` 表即可。**不接受需求文档把"供应商采购"放进 WMS**——那是 ERP/SCM 的职责 |

### UC-006：异常货品处理

| 维度 | 评估 |
|------|------|
| **需求文档** | 损坏/丢失调查、生成 Damaged WO、通知客户 |
| **现有实现** | 统一异常领域三表（exception_type_catalog/exceptions/exception_events）、9 种预设异常类型、Device API 只读查看。**缺：解决闭环、通知链路** |
| **行业标准** | SAP EWM 的 Exception Handling 是"登记→分配→调查→处置→关闭"五步，与 WO 体系平行而非嵌套 |
| **判断** | **采用现有方案**。ADR-011 的统一异常领域设计已经比需求文档的系统化，且与 SAP EWM 的五步模型高度一致。缺的只是 Tenant API 的管理端点和通知集成 |

### UC-007：财务流水审计

| 维度 | 评估 |
|------|------|
| **需求文档** | 入项/出项记录，多租户费用分析 |
| **现有实现** | `billing_rules`（版本化）+ `billing_rule_tiers`（阶梯价）+ `billing_transactions`（4 种类型）+ `fn_get_active_billing_rule` RPC。缺：API |
| **行业标准** | 3PL 计费核心是"Rate Quote → Invoice → Reconciliation"三段。Oracle WMS 的计费模块独立于 WMS 操作模块 |
| **判断** | **采用现有方案**。DB 设计已经覆盖 Rate Quote（billing_rules）+ Transaction（billing_transactions）两段，比需求文档的"入项/出项记录"更结构化 |

### UC-008：多级审批流 🔴 CRITICAL

| 维度 | 评估 |
|------|------|
| **需求文档** | 高价值单据（>$5000）需主管+财务双重审批 |
| **现有实现** | `src/core/workflow/` 目录为空。无 approval_requests/approval_steps 表 |
| **行业标准** | Manhattan 的 Approval 是独立的工作流引擎（Workflow Engine），支持条件路由、并行审批、超时升级。不是简单的"金额>$5000→两级审批" |
| **判断** | **重新设计**。需求文档的审批规则过于粗糙（仅按金额）。需要 ADR + Workflow Engine 设计（ADR-008 从未实施）。建议对齐 Manhattan 模型：审批规则可配置（金额/品类/客户/仓库）+ 审批链可编排（串行/并行/会签）+ 超时自动升级 |

### UC-009：客户自助查询

| 维度 | 评估 |
|------|------|
| **需求文档** | 客户 Web/App 端查询库存、跟踪运单、审批费用 |
| **现有实现** | 无 |
| **行业标准** | Manhattan 的 Customer Portal 是独立应用层，通过 API Gateway 与 WMS 核心通信，不是 WMS 内嵌功能。权限模型是"客户只能看自己的货" |
| **判断** | **重新设计**。这是个新应用端（Customer Portal），不是 Tenant API 的扩展。需要 ADR，且应在多端拓扑中新增第五端（见 ARCHITECTURE.md §4） |

### UC-010：数据归档审计

| 维度 | 评估 |
|------|------|
| **需求文档** | 半年数据归档，符合 GDPR/ISO 27001 |
| **现有实现** | `fn_purge_old_action_logs`（Migration 023，pg_cron 注册）+ daily_summary 聚合表 |
| **行业标准** | SAP EWM 的数据归档是分层策略：热数据（Postgres）、温数据（对象存储）、冷数据（归档）。GDPR 的核心是"删除权"和"导出权"，不是简单的 180 天清理 |
| **判断** | **采用现有方案 + 扩展**。清理函数已就绪。GDPR 合规需要的是：(1) 用户数据导出 API，(2) 用户数据删除 API，(3) 审计日志不可篡改证明——这些是合规功能，需求文档的描述不够具体 |

### UC-011：硬件批量扫描

| 维度 | 评估 |
|------|------|
| **需求文档** | PDA/RFID 每秒 100 标签 |
| **现有实现** | `sync_events` batch insert + 离线同步链完整 |
| **行业标准** | Zebra/Honeywell 的 RFID 是独立中间件层，WMS 只接收解析后的标准化事件 |
| **判断** | **采用现有方案**。sync_events 的 batch 机制已经满足需求。100 标签/秒需要性能测试验证而非架构改动 |

### UC-012：多渠道通知 🟡 HIGH

| 维度 | 评估 |
|------|------|
| **需求文档** | 邮件/SMS/App 推送订单状态、补货预警 |
| **现有实现** | 零。notifications 表不存在。`adapters/external/notification/` 目录为空 |
| **行业标准** | 成熟 WMS 的通知是独立微服务——事件总线消费→模板渲染→渠道路由。不在 WMS 核心内嵌 SMPT 客户端 |
| **判断** | **重新设计**。需要独立的 Notification 子系统端口+适配器。需求文档的正确之处在于识别了这个需求，但"WMS 直接发邮件/SMS"是错误架构——应该走事件→队列→通知服务的解耦路径 |

### UC-013：跨仓调拨

| 维度 | 评估 |
|------|------|
| **需求文档** | 生成 Transfer WO，核算运输成本，路径跟踪 |
| **现有实现** | work_orders 支持 Transfer 类型。`fn_adjust_inventory_at_location` 原子库存写入。缺：运输成本核算 |
| **行业标准** | Manhattan 的 Transfer 是完整的"源仓出库→在途→目的仓入库"三段。运输成本属于 TMS（运输管理系统），不是 WMS |
| **判断** | **采用现有方案**。Transfer WO + 原子库存写入已覆盖核心流。**不接受需求文档把"运输成本"和"路径跟踪"放进 WMS**——这是 TMS 的职责 |

### UC-014：海关合规申报 🔴 CRITICAL

| 维度 | 评估 |
|------|------|
| **需求文档** | HS 编码验证、申报价值记录、生成海关报告 |
| **现有实现** | `product_constraints.hs_code` 列存在。缺：customs_declarations 表、海关 API 适配器 |
| **行业标准** | 跨境 WMS 的海关集成通常走第三方清关行 API（如 Flexport/ Expeditors），而非直接对接海关系统。HS 编码库是本地维护的参考数据 |
| **判断** | **重新设计**。需求文档的"集成海关 API"过于理想化——各国海关 API 完全不同。建议 V1 做 HS 编码本地校验 + 报关单生成，清关行对接留到 V2。需要 ADR-027 |

### UC-015：波次拣货

| 维度 | 评估 |
|------|------|
| **需求文档** | 汇总小订单，生成总拣货任务 |
| **现有实现** | 85% 就绪：waves 表 + `fn_logic_stock_allocation` RPC + GenerateWaveUseCase + Tenant API 2 端点 |
| **行业标准** | Manhattan 的 Wave 是"策略模板→波次创建→订单分配→释放→生成工单"五步。策略可配置（按承运商/路线/优先级/截单时间） |
| **判断** | **采用现有方案 + 扩展**。现有设计已经走在正确的方向上。缺的是策略配置化和路径优化——这些在 API_SPEC 中已有规划 |

### UC-016：分拣墙播种

| 维度 | 评估 |
|------|------|
| **需求文档** | 总拣商品通过 PDA 扫描分配至具体订单格口 |
| **现有实现** | 80% 就绪：sorting_chutes + sorting_tasks + sorting_waves 表 + `fn_allocate_chute` RPC |
| **行业标准** | 播种式分拣（Put-to-Light/Put Wall）在成熟 WMS 中是通过分拣墙硬件+灯光提示实现，纯 PDA 方案是降级版 |
| **判断** | **采用现有方案**。DB 设计完整，补 API 即可。Put-to-Light 硬件集成留到 Stage 4 |

### UC-017：出库拆箱回库

| 维度 | 评估 |
|------|------|
| **需求文档** | 剩余货品标记"开箱"回流至散件区，更新 FIFO 优先级 |
| **现有实现** | `inventory.picking_priority = 99` 已实现"开箱散件最高拣货优先级"机制 + `fn_logic_resolve_blackbox_box` 黑盒解析 |
| **行业标准** | SAP EWM 的 Open-Box 处理是"开箱→余量回库→库存重新定位→优先级更新"四步，与现有 picking_priority 机制逻辑一致 |
| **判断** | **采用现有方案**。picking_priority=99 的机制已经对齐行业做法。需求文档的描述不如现有设计精确 |

### UC-018：空箱处理 🔴 CRITICAL

| 维度 | 评估 |
|------|------|
| **需求文档** | 记录空箱回收、存储（空箱区）、复用或报废流程及费用 |
| **现有实现** | 零。containers 表有 seal 状态，locations 有 zone_type，但无专门的空箱管理 |
| **行业标准** | 空箱管理在 3PL 中是成本中心级别的功能——空箱流转=费用。Manhattan 的做法是 Container 实体加状态机（IN_USE→EMPTY→DAMAGED→SCRAPPED），不另建表 |
| **判断** | **折中**。**不接受需求文档暗示的"独立空箱表"方案**——空箱只是容器的一种状态，不是新实体。参考 Manhattan：在 containers 表加 `container_status` 字段，location zone_type 加 `EMPTY_BOX_ZONE`，复用现有的容器封箱/移动逻辑 |

### UC-019：松耦合收货

| 维度 | 评估 |
|------|------|
| **需求文档** | 未关联订单收货，记录临时货品信息，后期补录订单关联 |
| **现有实现** | UNIDENTIFIED_GOODS 异常域 + `fn_receive_unidentified_goods` + `fn_identify_unidentified_goods` + Device API `/unidentified/receive` + `/unidentified/identify` |
| **行业标准** | Manhattan 的 Blind Receiving 流程是"收货→暂存→质检→匹配 PO/ASN→入库"。与现有 UNIDENTIFIED_GOODS 设计高度一致 |
| **判断** | **采用现有方案**。ADR-011 的 UNIDENTIFIED_GOODS 设计已经比需求文档的"临时工单→手动关联"方案更成熟。需求文档没有意识到这个机制已经存在 |

### UC-020：AI 耗材补货 🔴 CRITICAL

| 维度 | 评估 |
|------|------|
| **需求文档** | 基于历史预测耗材缺口，生成 Consumable WO |
| **现有实现** | `consumable_usages` 表存在。`package_specs` 表存在。缺：预测引擎、自动触发 |
| **行业标准** | Blue Yonder 的耗材管理是先做"安全库存阈值→自动补货工单"（Rule-based），运营 6-12 个月积累数据后才引入 ML 预测。没有 WMS 一上线就跑 AI 耗材预测的 |
| **判断** | **重新设计**。**拒绝需求文档的"AI 预测先行"方案**——这是典型的过度设计。V1 方案：(1) consumable_usages 记录每次打包的耗材消耗，(2) 设置 min_threshold，(3) 低于阈值自动生成 Consumable WO。ML 预测留到 V3，且需要先积累 6+ 个月的历史数据 |

---

## 2. 五个功能域批判性评审

### F1：设备与安全

| 子特性 | 需求方案 | 现有方案 | 行业对标 | 判断 |
|--------|---------|---------|---------|------|
| F1.1 动态设备授权 | IMEI/MAC 加密 | ADR-019 凭证体系 | Manhattan device→zone 绑定 | **采用现有** |
| F1.2 RBAC | 8 角色 | 8 角色+权限矩阵+RPC | SAP EWM 角色+授权对象 | **采用现有** |
| F1.3 AI 设备健康 | AI 故障预测 | 零 | 阈值告警→维护工单 | **重新设计**（V1 阈值告警，不加 AI） |
| F1.4 设备运营费 | 按扫描/时长计费 | 零 | 按 device license | **采用行业**（按 license，不按扫描次数） |
| F1.5 用户培训 | 内置视频/测试 | 零 | LMS 集成，非 WMS 内嵌 | **重新设计**（对接外部 LMS，不内嵌） |

### F2：仓库与库存

| 子特性 | 需求方案 | 现有方案 | 行业对标 | 判断 |
|--------|---------|---------|---------|------|
| F2.1 多级空间管理 | 含空箱区 | locations + zones 分层 | Manhattan location hierarchy | **采用现有** + empty_box zone_type |
| F2.2 验货照片 | 五面必拍 | verification_rules + quality_inspections | SAP EWM 照片为可选附件 | **折中**（照片可选，租户级配置） |
| F2.3 松耦合收货 | 临时工单→后关联 | UNIDENTIFIED_GOODS 异常域 | Manhattan Blind Receiving | **采用现有** |
| F2.4 空箱管理 | 独立空箱表 | 零 | Container 状态机 | **折中**（containers + status 字段） |
| F2.5 开箱回仓 | 标记开箱/FIFO | picking_priority=99 | SAP EWM 重新定位+优先级 | **采用现有** |
| F2.6 批次FIFO | 生产日期/有效期 | FEFO RPC + idx_inv_sku_priority | 行业标准 FEFO/FIFO | **采用现有** |

### F3：电商履约

| 子特性 | 需求方案 | 现有方案 | 行业对标 | 判断 |
|--------|---------|---------|---------|------|
| F3.1 一件代发 | PO/SO行项级拆分 | 零 | 独立 Dropship 模块 | **重新设计**（需 ADR + 独立模块） |
| F3.2 智能波次 | 汇总+路径优化 | waves + RPC + UseCase | Manhattan Wave 五步 | **采用现有** + 策略配置化 |
| F3.3 二次分拣 | 播种墙+格口提示 | sorting 三表 + RPC | Put Wall 硬件集成 | **采用现有** |
| F3.4 自动化打包贴单 | 集成快递 API | packing + label 表 | 独立 Label Service | **重新设计**（Label 独立服务） |
| F3.5 AI 耗材预测 | 体积预测+自动触发 | consumable_usages 表 | Rule-based → ML 渐进 | **重新设计**（V1 rule-based） |

### F4：工单体系

| 子特性 | 需求方案 | 现有方案 | 行业对标 | 判断 |
|--------|---------|---------|---------|------|
| 10 种 WO 类型 | 收货/入库/拣货/打包/发货/退货/损毁/调拨/补货/耗材 | 9 种（缺耗材WO） | Manhattan 段式工单 | **采用现有** |
| 审批流 | >$5000 二级审批 | 零 | 可配置 Workflow Engine | **重新设计**（ADR+Engine） |
| WO 执行 (PDA) | 无具体设计 | 离线同步链完整 | 离线优先+预分工 | **采用现有** |
| WO 管理 (Web) | 无具体设计 | API_SPEC §3.7 规划 | Web 管理面 | **采用现有规划** |

### F5：财务与集成

| 子特性 | 需求方案 | 现有方案 | 行业对标 | 判断 |
|--------|---------|---------|---------|------|
| F5.1 计费引擎 | 报价单+结算单 | billing_rules + transactions + RPC | Oracle 三段计费 | **采用现有** |
| F5.2 海关合规 | 集成海关 API | hs_code 列 | 清关行 API 对接 | **重新设计**（V1 HS 校验+报关单） |
| F5.3 数据回传 | ERP/电商/快递回传 | 零 | Event-driven + Queue | **重新设计**（ADR-023） |

---

## 3. 需求文档遗漏的关键功能（行业对标发现）

以下功能在成熟 WMS 中是标配，但需求文档 v3.8 完全没提：

| 遗漏功能 | 行业依据 | 严重度 |
|---------|---------|--------|
| **库存预留/锁定** | Manhattan/Blue Yonder 的核心功能——订单分配后必须锁定库存防止重复分配 | 🔴 CRITICAL |
| **盘点差异处理** | SAP EWM 的 Physical Inventory 是独立模块，含差异审批、复盘、过账 | 🔴 CRITICAL |
| **自动化批次追溯** | FDA/GS1 要求食品/药品行业必须支持正向追溯+反向召回 | 🟡 HIGH |
| **库位利用率可视化** | 所有成熟 WMS 的 Dashboard 标配——热力图、ABC 分布 | 🟡 HIGH |
| **承运商 SLA 管理** | 3PL 的计费通常与承运商绩效挂钩 | 🟡 MEDIUM |
| **增值服务计费** | VAS BOM 表已建但需求文档完全没提 kitting/assembly 的计费逻辑 | 🟡 MEDIUM |
| **EDI 集成** | API_SPEC §6.3 已规划 X12/EDIFACT，需求文档没提 | 🟡 MEDIUM |

**好消息**：其中库存预留/锁定、盘点差异、批次追溯、库位可视化、VAS、EDI 在现有 DB Schema 和 API_SPEC 中**已经设计了**——需求文档只是没写，不是系统不支持。

---

## 4. 最终判断矩阵

### 采用现有方案（现有设计 > 需求方案，行业对标验证通过）✅
- UC-001 设备注册认证（ADR-019）
- UC-003 出库工单履行
- UC-004 复杂订单录入
- UC-006 异常货品处理（统一异常领域）
- UC-007 财务流水审计
- UC-011 硬件批量扫描
- UC-013 跨仓调拨
- UC-015 波次拣货
- UC-016 分拣墙播种
- UC-017 出库拆箱回库
- UC-019 松耦合收货
- F1.1 设备授权
- F1.2 RBAC
- F2.1 空间管理
- F2.5 开箱回仓
- F2.6 批次FIFO
- F3.2 波次
- F3.3 二次分拣
- F4 WO 类型+执行
- F5.1 计费引擎

### 折中（需求方向对，但方案需调整，行业对标提供更好路径）🔄
- UC-002 验货照片（可选附件>必拍）
- UC-005 补货工单（Min/Max>供应商采购）
- UC-010 数据归档（补 GDPR 合规功能）
- UC-018 空箱管理（containers 状态机>独立表）
- F2.2 照片存证
- F2.4 空箱管理

### 重新设计（需求方案不成熟或与行业实践冲突）🔴
- UC-008 审批流（需 Workflow Engine）
- UC-009 客户自助查询（需新应用端 ADR）
- UC-012 多渠道通知（需独立 Notification 子系统）
- UC-014 海关合规（清关行 API>直连海关）
- UC-020 AI 耗材（V1 rule-based，不加 ML）
- F1.3 设备健康（阈值告警>AI 预测）
- F1.4 设备计费（license>扫描次数）
- F1.5 用户培训（外部 LMS>内嵌 WMS）
- F3.1 一件代发（独立 Dropship 模块）
- F3.4 打包贴单（独立 Label Service）
- F3.5 耗材预测
- F5.2 海关合规
- F5.3 数据回传

### 需求文档遗漏（应将现有设计补充进需求文档）📋
- 库存预留/锁定
- 盘点差异处理
- 批次追溯（正向+反向）
- 库位利用率 Dashboard
- 承运商 SLA
- VAS 计费
- EDI 集成

---

## 5. 需要新增的 ADR

| ADR | 驱动特性 | 核心决策 |
|-----|---------|---------|
| ADR-020 | F1.3 设备健康 | pg_cron 定时采集→阈值告警→自动生成维护 WO；不加 AI |
| ADR-021 | F3.4 承运商 API | 单 `ICarrierApiClient` 端口；异步标签生成；Supabase Vault 存储凭证 |
| ADR-023 | F5.3 数据回传 | 事件驱动 + at-least-once + 指数退避 + 死信队列 |
| ADR-024 | 免费/收费切换 | 四层 edition 模型；策略模式分离算法；降级 90 天缓冲 |
| ADR-026 | F2.4 空箱管理 | Container 状态机扩展；成本中心归属 |
| ADR-027 | F5.2 海关合规 | V1 HS 本地校验+报关单生成；V2 清关行 API 对接 |
| ADR-028 | UC-012 通知子系统 | 独立 Notification 服务；事件总线→模板渲染→渠道路由 |

---

## 6. 建议实施优先级

| 优先级 | 内容 | 理由 |
|--------|------|------|
| **P0** | Quick Wins（UC-015/016/007/003 补 API） | 零新增 DB，纯胶水代码，2-3 周可交付 |
| **P0** | 审批流 Workflow Engine（ADR-008 实施） | 阻塞计费和工单系统 |
| **P1** | 通知子系统（ADR-028） | 解锁 4 个用例的通知闭环 |
| **P1** | 空箱管理（ADR-026，containers 状态字段） | 低改动量，高运营价值 |
| **P1** | 补货规则引擎 | `v_replenishment_needs` 已就绪 |
| **P2** | 海关合规 V1（ADR-027，HS 校验+报关单） | 跨境业务刚需 |
| **P2** | 承运商 API（ADR-021） | 打包贴单流程闭环 |
| **P2** | 数据回传（ADR-023） | 企业版核心卖点 |
| **P3** | 设备健康（ADR-020） | 依赖运营数据积累 |
| **P3** | 耗材自动补货（Rule-based V1） | 依赖 consumable_usages 数据积累 |
| **P4** | 客户自助门户（新应用端） | 需产品侧明确需求范围 |
| **P4** | 一件代发 | 需产品侧明确 PO/SO 拆解规则 |
| **远期** | AI 耗材预测、AI 设备预测 | 需 6+ 月历史数据 + ML 基础设施 |

---

## 7. 不对齐清单（需求文档与现有设计的冲突点）

| 冲突点 | 需求文档 | 现有设计 | 裁决 |
|--------|---------|---------|------|
| 设备注册方式 | IMEI/MAC 加密 | ADR-019 API Key + JWT 凭证体系 | **现有** |
| 设备计费方式 | 按扫描次数/时长 | 未设计 | **行业标准**（按 license） |
| 验货照片 | 五面必拍 | 未设计 | **折中**（可选，可配置） |
| 空箱存储 | 独立 empty_box 表 | containers 表已有 | **折中**（containers + status） |
| 补货触发 | 供应商采购+跨仓调拨 | 库内 Min/Max | **现有**（WMS 不做采购） |
| 运输成本 | WMS 内核算 | 属 TMS | **行业**（不做在 WMS） |
| 海关对接 | 集成海关 API | hs_code 列 | **重新设计**（清关行 API） |
| 通知方式 | WMS 直接发邮件/SMS | 无 | **重新设计**（独立服务） |
| AI 耗材 | 一上线就跑 ML | consumable_usages 已有 | **重新设计**（V1 rule-based） |
| 客户门户 | WMS 内嵌功能 | 无 | **重新设计**（独立应用端） |
| 收费切换 | 所有表加 jsonb_data | 未设计 | **暂缓**（先有客户再设计） |

---

*分析执行者：ecc:planner + ecc:architect + 人工批判性评估*
*关联文档：第一轮 TENANT_GAP_ANALYSIS.md（PR #73）、BACKEND_GAP_ANALYSIS.md、API_SPEC.md、ARCHITECTURE.md*
