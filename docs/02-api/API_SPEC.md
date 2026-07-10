# API 规范文档 (OpenAPI 3.1)

## 1. 概览

### 1.1 基础信息
| 属性 | 值 |
|------|-----|
| **标题** | WMS7 仓储管理系统 API |
| **版本** | 2.1.0 |
| **规范** | OpenAPI 3.1.0 |
| **基础路径** | `/api/v1` (Admin/Tenant/Device) / `/api/edge` (Edge Worker) |
| **传输协议** | HTTPS |
| **数据格式** | JSON (请求/响应) |

### 1.2 多端 API 矩阵

| 端 | 基础路径 | 认证方式 | 目标受众 | 部署 |
|----|---------|---------|---------|------|
| **Admin API** | `/api/v1/admin` | Platform JWT (RS256) + API Key | 平台运营、超管 | K8s Deployment |
| **Tenant API** | `/api/v1/tenant` | Tenant JWT (HS256/RS256) + API Key | 租户管理员、仓库操作员 | K8s Deployment |
| **Device API** | `/api/v1/device` | Device JWT + API Key + Device Binding | PDA/手持终端、AGV | Edge 节点 |
| **Edge Worker** | `/api/edge` | Lightweight JWT (JWKS) + API Key | 边缘计算、Webhook、缓存 | Cloudflare Workers |

### 1.3 通用响应格式

```json
// 成功响应
{
  "success": true,
  "data": T,
  "meta": {
    "requestId": "uuid",
    "timestamp": "ISO8601",
    "version": "2.1.0"
  }
}

// 分页响应
{
  "success": true,
  "data": T[],
  "meta": {
    "requestId": "uuid",
    "timestamp": "ISO8601",
    "pagination": {
      "page": 1,
      "pageSize": 20,
      "total": 100,
      "totalPages": 5
    }
  }
}

// 错误响应
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable message",
    "details": {},
    "requestId": "uuid"
  }
}
```

### 1.4 通用错误码
| HTTP | 代码 | 含义 |
|------|------|------|
| 400 | `VALIDATION_ERROR` | 请求参数校验失败 |
| 401 | `UNAUTHORIZED` | 认证失败/Token 过期 |
| 403 | `FORBIDDEN` | 权限不足/租户隔离违规 |
| 404 | `NOT_FOUND` | 资源不存在 |
| 409 | `CONFLICT` | 资源冲突/乐观锁失败 |
| 422 | `BUSINESS_RULE_VIOLATION` | 业务规则违反 |
| 429 | `RATE_LIMITED` | 限流 |
| 500 | `INTERNAL_ERROR` | 服务器内部错误 |
| 503 | `SERVICE_UNAVAILABLE` | 服务不可用/熔断 |

---

## 2. Admin API (平台运营端)

### 2.1 租户管理
| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| POST | `/tenants` | 创建租户 | `platform_admin` |
| GET | `/tenants` | 租户列表 (分页、筛选) | `platform_admin, platform_operator` |
| GET | `/tenants/{id}` | 租户详情 | `platform_admin, platform_operator` |
| PATCH | `/tenants/{id}` | 更新租户 | `platform_admin` |
| DELETE | `/tenants/{id}` | 删除/停用租户 | `platform_admin` |
| POST | `/tenants/{id}/activate` | 激活租户 | `platform_admin` |
| POST | `/tenants/{id}/suspend` | 暂停租户 | `platform_admin` |
| GET | `/tenants/{id}/usage` | 租户用量统计 | `platform_admin, platform_operator` |
| PATCH | `/tenants/{id}/billing-strategy` | 更新计费策略 | `platform_admin` |

### 2.2 用户管理 (跨租户)
| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| GET | `/users` | 用户列表 | `platform_admin` |
| GET | `/users/{id}` | 用户详情 | `platform_admin` |
| PATCH | `/users/{id}` | 更新用户 | `platform_admin` |
| POST | `/users/{id}/impersonate` | 模拟登录租户 | `platform_admin` |

### 2.3 计费与发票
| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| GET | `/billing/rules` | 计费规则列表 | `platform_admin, platform_operator` |
| POST | `/billing/rules` | 创建计费规则 | `platform_admin` |
| PATCH | `/billing/rules/{id}` | 更新计费规则 | `platform_admin` |
| GET | `/billing/invoices` | 发票列表 | `platform_admin, platform_operator` |
| POST | `/billing/invoices/generate` | 生成发票 (按周期) | `platform_admin` |
| GET | `/billing/reconciliation` | 对账报表 | `platform_admin, platform_operator` |

### 2.4 系统监控
| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| GET | `/monitoring/health` | 系统健康检查 | `platform_admin, platform_operator` |
| GET | `/monitoring/metrics` | 核心指标 | `platform_admin, platform_operator` |

---

## 3. Tenant API (业务租户端)

### 3.1 商品管理
| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| GET | `/products` | 商品列表 (分页、搜索、筛选) | `tenant_admin, warehouse_manager, operator` |
| GET | `/products/{id}` | 商品详情 | `tenant_admin, warehouse_manager, operator` |
| POST | `/products` | 创建商品 | `tenant_admin, warehouse_manager` |
| PATCH | `/products/{id}` | 更新商品 | `tenant_admin, warehouse_manager` |
| DELETE | `/products/{id}` | 删除/停用商品 | `tenant_admin` |
| GET | `/products/{id}/constraints` | 商品约束 (重量、尺寸、温度等) | `tenant_admin, warehouse_manager, operator` |
| POST | `/products/{id}/constraints` | 创建/更新商品约束 | `tenant_admin, warehouse_manager` |
| GET | `/products/{id}/barcodes` | 商品条码映射 | `tenant_admin, warehouse_manager, operator` |
| POST | `/products/{id}/barcodes` | 添加条码映射 | `tenant_admin, warehouse_manager` |
| PATCH | `/products/{id}/abc-class` | 更新 ABC 分类 | `tenant_admin, warehouse_manager` |

### 3.2 库存管理
| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| GET | `/inventory` | 库存列表 (多维筛选) | `tenant_admin, warehouse_manager, operator` |
| GET | `/inventory/{id}` | 库存明细 | `tenant_admin, warehouse_manager, operator` |
| GET | `/inventory/available` | 可用库存查询 | `tenant_admin, warehouse_manager, operator` |
| POST | `/inventory/adjust` | 库存调整 (增/减/盘点) | `tenant_admin, warehouse_manager` |
| POST | `/inventory/transfer` | 库存移库/调拨 | `tenant_admin, warehouse_manager` |
| POST | `/inventory/reserve` | 创建库存预留 | `tenant_admin, warehouse_manager` |
| DELETE | `/inventory/reserve/{id}` | 释放库存预留 | `tenant_admin, warehouse_manager` |
| GET | `/inventory/locks` | 库存锁定列表 | `tenant_admin, warehouse_manager` |
| POST | `/inventory/locks` | 创建库存锁定 | `tenant_admin, warehouse_manager` |
| DELETE | `/inventory/locks/{id}` | 释放库存锁定 | `tenant_admin, warehouse_manager` |
| GET | `/inventory/history` | 库存变动历史 | `tenant_admin, warehouse_manager, operator` |
| GET | `/inventory/replenishment-needs` | 补货需求 | `tenant_admin, warehouse_manager` |
| GET | `/inventory/total/{productId}` | 商品总库存量 | `tenant_admin, warehouse_manager, operator` |

### 3.3 库位管理
| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| GET | `/locations` | 库位列表 (分区、类型、状态筛选) | `tenant_admin, warehouse_manager, operator` |
| GET | `/locations/{id}` | 库位详情 | `tenant_admin, warehouse_manager, operator` |
| POST | `/locations` | 创建库位 | `tenant_admin, warehouse_manager` |
| PATCH | `/locations/{id}` | 更新库位 | `tenant_admin, warehouse_manager` |
| PATCH | `/locations/{id}/status` | 更新库位状态 (激活/冻结) | `tenant_admin, warehouse_manager` |
| PATCH | `/locations/{id}/capacity` | 更新库位容量 | `tenant_admin, warehouse_manager` |
| GET | `/locations/{id}/utilization` | 库位利用率 | `tenant_admin, warehouse_manager` |
| GET | `/locations/zone/{zoneType}` | 按区域类型查询 | `tenant_admin, warehouse_manager, operator` |

### 3.4 容器/LPN 管理
| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| GET | `/containers` | 容器列表 | `tenant_admin, warehouse_manager, operator` |
| GET | `/containers/{id}` | 容器详情 | `tenant_admin, warehouse_manager, operator` |
| GET | `/containers/lpn/{lpnCode}` | 按 LPN 码查询 | `tenant_admin, warehouse_manager, operator` |
| POST | `/containers` | 创建容器 | `tenant_admin, warehouse_manager` |
| PATCH | `/containers/{id}` | 更新容器 | `tenant_admin, warehouse_manager` |
| PATCH | `/containers/{id}/seal` | 封箱/解封 | `tenant_admin, warehouse_manager, operator` |
| POST | `/containers/{id}/move` | 移动容器到新库位 | `tenant_admin, warehouse_manager, operator` |
| GET | `/containers/{id}/contents` | 容器内明细 | `tenant_admin, warehouse_manager, operator` |
| GET | `/containers/{id}/tree` | 容器层级树 | `tenant_admin, warehouse_manager, operator` |

### 3.5 入库管理
| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| GET | `/inbound/receipts` | 入库单列表 | `tenant_admin, warehouse_manager, operator` |
| GET | `/inbound/receipts/{id}` | 入库单详情 (含质检项) | `tenant_admin, warehouse_manager, operator` |
| POST | `/inbound/receipts` | 创建入库单 | `tenant_admin, warehouse_manager` |
| PATCH | `/inbound/receipts/{id}` | 更新入库单 | `tenant_admin, warehouse_manager` |
| POST | `/inbound/receipts/{id}/receive` | 确认收货 | `tenant_admin, warehouse_manager, operator` |
| POST | `/inbound/receipts/{id}/inspect` | 质检录入 | `tenant_admin, warehouse_manager, operator` |
| POST | `/inbound/receipts/{id}/putaway` | 生成上架工单 | `tenant_admin, warehouse_manager` |
| GET | `/inbound/receipts/{id}/items` | 入库明细行 | `tenant_admin, warehouse_manager, operator` |
| POST | `/inbound/asn` | 创建 ASN 预入库单 | `tenant_admin, warehouse_manager` |
| GET | `/inbound/asn` | ASN 列表 | `tenant_admin, warehouse_manager, operator` |

### 3.6 出库/波次管理
| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| GET | `/outbound/orders` | 出库订单列表 | `tenant_admin, warehouse_manager, operator` |
| GET | `/outbound/orders/{id}` | 订单详情 (含明细) | `tenant_admin, warehouse_manager, operator` |
| POST | `/outbound/orders` | 创建出库订单 | `tenant_admin, warehouse_manager` |
| PATCH | `/outbound/orders/{id}/status` | 更新订单状态 | `tenant_admin, warehouse_manager` |
| GET | `/outbound/waves` | 波次列表 | `tenant_admin, warehouse_manager, operator` |
| GET | `/outbound/waves/{id}` | 波次详情 | `tenant_admin, warehouse_manager, operator` |
| POST | `/outbound/waves` | 创建波次 | `tenant_admin, warehouse_manager` |
| PATCH | `/outbound/waves/{id}/status` | 更新波次状态 | `tenant_admin, warehouse_manager` |
| POST | `/outbound/waves/{id}/allocate` | 触发库存分配 (RPC) | `tenant_admin, warehouse_manager` |
| POST | `/outbound/waves/{id}/orders` | 添加订单到波次 | `tenant_admin, warehouse_manager` |
| DELETE | `/outbound/waves/{id}/orders/{orderId}` | 从波次移除订单 | `tenant_admin, warehouse_manager` |

### 3.7 作业工单管理
| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| GET | `/work-orders` | 工单列表 | `tenant_admin, warehouse_manager, operator` |
| GET | `/work-orders/{id}` | 工单详情 | `tenant_admin, warehouse_manager, operator` |
| POST | `/work-orders` | 创建工单 | `tenant_admin, warehouse_manager` |
| PATCH | `/work-orders/{id}/status` | 更新工单状态 | `tenant_admin, warehouse_manager, operator` |
| POST | `/work-orders/{id}/assign` | 派发工单 | `tenant_admin, warehouse_manager` |
| POST | `/work-orders/{id}/actions` | 记录操作日志 | `tenant_admin, warehouse_manager, operator` |
| GET | `/work-orders/{id}/logs` | 工单操作日志 | `tenant_admin, warehouse_manager, operator` |
| GET | `/work-orders/wave/{waveId}` | 波次下的工单 | `tenant_admin, warehouse_manager, operator` |
| GET | `/work-orders/assignee/{userId}` | 指派给用户的工单 | `tenant_admin, warehouse_manager, operator` |

### 3.8 拣选/打包/分拣/装车
| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| GET | `/tasks/picking` | 拣选任务列表 | `tenant_admin, warehouse_manager, operator` |
| POST | `/tasks/picking/{id}/confirm` | 确认拣选 | `tenant_admin, warehouse_manager, operator` |
| GET | `/tasks/packing` | 打包任务列表 | `tenant_admin, warehouse_manager, operator` |
| POST | `/tasks/packing/{id}/start` | 开始打包 | `tenant_admin, warehouse_manager, operator` |
| POST | `/tasks/packing/{id}/add-item` | 添加商品到箱 | `tenant_admin, warehouse_manager, operator` |
| POST | `/tasks/packing/{id}/complete` | 完成打包 | `tenant_admin, warehouse_manager, operator` |
| GET | `/tasks/sorting` | 分拣任务列表 | `tenant_admin, warehouse_manager, operator` |
| POST | `/tasks/sorting/{id}/assign-chute` | 分配滑道 | `tenant_admin, warehouse_manager` |
| POST | `/tasks/sorting/{id}/sort` | 执行分拣 | `tenant_admin, warehouse_manager, operator` |
| GET | `/tasks/loading` | 装车任务列表 | `tenant_admin, warehouse_manager, operator` |
| POST | `/tasks/loading/{id}/load` | 装车确认 | `tenant_admin, warehouse_manager, operator` |

### 3.9 交叉理货
| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| GET | `/cross-dock/jobs` | 交叉理货任务列表 | `tenant_admin, warehouse_manager, operator` |
| GET | `/cross-dock/jobs/{id}` | 任务详情 | `tenant_admin, warehouse_manager, operator` |
| POST | `/cross-dock/jobs` | 创建交叉理货任务 | `tenant_admin, warehouse_manager` |
| POST | `/cross-dock/jobs/{id}/match` | 触发匹配 (RPC) | `tenant_admin, warehouse_manager` |
| POST | `/cross-dock/jobs/{id}/stage` | 暂存确认 | `tenant_admin, warehouse_manager, operator` |
| POST | `/cross-dock/jobs/{id}/ship` | 发货确认 | `tenant_admin, warehouse_manager, operator` |

### 3.10 补货管理
| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| GET | `/replenishment/tasks` | 补货任务列表 | `tenant_admin, warehouse_manager, operator` |
| POST | `/replenishment/tasks` | 创建补货任务 | `tenant_admin, warehouse_manager` |
| POST | `/replenishment/tasks/{id}/execute` | 执行补货 | `tenant_admin, warehouse_manager, operator` |
| GET | `/replenishment/rules` | 补货规则列表 | `tenant_admin, warehouse_manager` |
| POST | `/replenishment/rules` | 创建补货规则 | `tenant_admin, warehouse_manager` |

### 3.11 发货与运输
| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| GET | `/shipping/documents` | 发货单据列表 | `tenant_admin, warehouse_manager, operator` |
| GET | `/shipping/documents/{id}` | 发货单详情 | `tenant_admin, warehouse_manager, operator` |
| POST | `/shipping/documents` | 创建发货单 | `tenant_admin, warehouse_manager` |
| POST | `/shipping/documents/{id}/handover` | 交接承运商 | `tenant_admin, warehouse_manager, operator` |
| GET | `/vehicles` | 车辆列表 | `tenant_admin, warehouse_manager` |
| POST | `/vehicles` | 登记车辆 | `tenant_admin, warehouse_manager` |

### 3.12 质检管理
| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| GET | `/quality/inspections` | 质检单列表 | `tenant_admin, warehouse_manager, operator` |
| GET | `/quality/inspections/{id}` | 质检详情 | `tenant_admin, warehouse_manager, operator` |
| POST | `/quality/inspections` | 创建质检单 | `tenant_admin, warehouse_manager` |
| POST | `/quality/inspections/{id}/items/{itemId}/result` | 录入质检结果 | `tenant_admin, warehouse_manager, operator` |
| POST | `/quality/inspections/{id}/complete` | 完成质检 | `tenant_admin, warehouse_manager` |

### 3.13 计费与账单
| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| GET | `/billing/rules` | 计费规则列表 | `tenant_admin, warehouse_manager` |
| GET | `/billing/rules/active` | 获取生效计费规则 (RPC) | `tenant_admin, warehouse_manager` |
| GET | `/billing/transactions` | 账单交易记录 | `tenant_admin, warehouse_manager` |
| POST | `/billing/reconcile` | 触发对账 | `tenant_admin` |

### 3.14 设备管理
| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| GET | `/devices` | 设备列表 | `tenant_admin, warehouse_manager` |
| GET | `/devices/{id}` | 设备详情 | `tenant_admin, warehouse_manager` |
| POST | `/devices` | 注册设备 | `tenant_admin` |
| PATCH | `/devices/{id}` | 更新设备 | `tenant_admin` |
| POST | `/devices/{id}/provision` | 设备配置下发 | `tenant_admin` |
| GET | `/devices/{id}/status` | 设备在线状态 | `tenant_admin, warehouse_manager` |

### 3.15 报表分析
| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| GET | `/reports/inventory-aging` | 库龄分析 | `tenant_admin, warehouse_manager` |
| GET | `/reports/turnover-rate` | 周转率统计 | `tenant_admin, warehouse_manager` |
| GET | `/reports/picking-efficiency` | 拣选效率 | `tenant_admin, warehouse_manager` |
| GET | `/reports/packing-efficiency` | 打包效率 | `tenant_admin, warehouse_manager` |
| GET | `/reports/space-utilization` | 空间利用率 | `tenant_admin, warehouse_manager` |
| GET | `/reports/boss-cockpit` | 老板驾驶舱 | `tenant_admin` |

---

## 4. Device API (PDA/手持终端端)

### 4.1 认证与同步
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/auth/login` | 设备登录 (获取 JWT) |
| POST | `/auth/refresh` | 刷新 Token |
| POST | `/sync` | 离线数据同步 (批量上传) |
| GET | `/sync/status` | 同步状态查询 |
| GET | `/sync/conflicts` | 获取冲突列表 |
| POST | `/sync/conflicts/{id}/resolve` | 解决冲突 |

### 4.2 任务执行
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/tasks` | 获取待执行任务列表 |
| GET | `/tasks/{id}` | 任务详情 |
| GET | `/tasks/{id}/steps` | 任务步骤 |
| POST | `/tasks/{id}/start` | 开始任务 |
| POST | `/tasks/{id}/steps/{stepId}/complete` | 完成步骤 (扫码、确认等) |
| POST | `/tasks/{id}/complete` | 完成任务 |
| POST | `/tasks/{id}/exception` | 上报异常 |
| GET | `/tasks/assigned` | 我派发的任务 |

### 4.3 核心作业操作
| 方法 | 路径 | 说明 |
|------|------|------|
| **收货** |
| POST | `/inbound/receive` | 扫描收货 |
| POST | `/inbound/inspect` | 质检录入 |
| POST | `/inbound/putaway` | 上架确认 |
| POST | `/inbound/blackbox/resolve` | 黑盒解箱 (RPC) |
| **拣选** |
| POST | `/outbound/pick/scan-location` | 扫描库位 |
| POST | `/outbound/pick/scan-product` | 扫描商品 |
| POST | `/outbound/pick/confirm-qty` | 确认数量 |
| **打包** |
| POST | `/outbound/pack/scan-container` | 扫描容器/箱 |
| POST | `/outbound/pack/add-product` | 添加商品到箱 |
| POST | `/outbound/pack/print-label` | 打印面单 |
| POST | `/outbound/pack/seal-box` | 封箱 |
| **分拣** |
| POST | `/outbound/sort/scan` | 扫描分拣 |
| POST | `/outbound/sort/assign-chute` | 分配滑道 |
| **发货** |
| POST | `/outbound/ship/scan` | 扫描发货 |
| POST | `/outbound/ship/handover` | 交接承运商 |
| **盘点** |
| POST | `/inventory/count/scan` | 盘点扫描 |
| POST | `/inventory/count/submit` | 提交盘点差异 |

### 4.4 查询接口
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/products/search` | 商品搜索 (SKU/名称/条码) |
| GET | `/locations/search` | 库位搜索 |
| GET | `/inventory/lookup` | 库存查询 |
| GET | `/tasks/next` | 获取下一个推荐任务 |

---

## 5. Edge Worker API (Cloudflare Workers)

### 5.1 轻量查询
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/products/{sku}` | 商品基础信息 (缓存优先) |
| GET | `/inventory/check` | 快速库存校验 |
| GET | `/locations/{code}` | 库位信息 |
| GET | `/containers/{lpnCode}` | 容器信息 |

### 5.2 标签生成
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/labels/generate` | 生成标签 (ZPL/PDF) |
| POST | `/labels/batch` | 批量生成标签 |
| GET | `/labels/templates` | 标签模板列表 |
| GET | `/labels/templates/{id}` | 模板详情 |

### 5.3 Webhook 接收
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/webhooks/carrier/{carrierId}` | 承运商轨迹/签收回调 |
| POST | `/webhooks/erp/{tenantId}` | ERP 回调 |
| POST | `/webhooks/payment/{provider}` | 支付回调 |
| POST | `/webhooks/edi` | EDI 报文接收 |

### 5.4 边缘计算
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/compute/route-optimize` | 拣选路径优化 |
| POST | `/compute/packing-suggest` | 装箱建议 |
| POST | `/compute/load-plan` | 装车规划 |

### 5.5 配置与缓存
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/config/feature-flags` | 功能开关 |
| GET | `/config/tenant/{tenantId}` | 租户配置 (缓存) |
| POST | `/cache/invalidate` | 缓存失效 |
| GET | `/cache/stats` | 缓存统计 |

---

## 6. 外部系统集成 (Webhook/Callback)

### 6.1 ERP 集成
| 方向 | 事件 | 端点 | 重试策略 |
|------|------|------|----------|
| ERP → WMS | 创建入库预报 (ASN) | `POST /api/v1/tenant/inbound/asn` | 3次指数退避 |
| ERP → WMS | 创建出库订单 | `POST /api/v1/tenant/outbound/orders` | 3次指数退避 |
| ERP → WMS | 取消订单 | `POST /api/v1/tenant/outbound/orders/{id}/cancel` | 3次指数退避 |
| WMS → ERP | 入库完成通知 | 配置的 ERP Callback URL | 5次指数退避 |
| WMS → ERP | 出库发货通知 | 配置的 ERP Callback URL | 5次指数退避 |
| WMS → ERP | 库存变动同步 | 配置的 ERP Callback URL | 5次指数退避 |
| WMS → ERP | 计费账单推送 | 配置的 ERP Callback URL | 3次指数退避 |

### 6.2 承运商集成
| 方向 | 事件 | 端点 |
|------|------|------|
| WMS → Carrier | 创建运单/获取面单号 | Carrier API |
| Carrier → WMS | 轨迹推送 | `POST /api/edge/webhooks/carrier/{carrierId}` |
| Carrier → WMS | 签收/异常回调 | `POST /api/edge/webhooks/carrier/{carrierId}` |

### 6.3 EDI 集成
| 标准 | 报文类型 | 处理方式 |
|------|---------|----------|
| X12/EDIFACT | 850/ORDERS (采购订单) | EDI Parser → 内部订单模型 |
| X12/EDIFACT | 856/DESADV (发货通知) | EDI Parser → 入库预报 |
| X12/EDIFACT | 810/INVOIC (发票) | EDI Parser → 计费对账 |
| X12/EDIFACT | 997/CONTRL (功能确认) | 自动回复 |

---

## 7. 认证授权详细规范

### 7.1 JWT Claims 结构
```typescript
// Platform JWT (Admin API)
interface PlatformJwtPayload {
  sub: string;              // 用户 ID
  type: 'platform';
  roles: ('platform_admin' | 'platform_operator')[];
  permissions: string[];
  iat: number;
  exp: number;
  iss: 'wms7-platform';
}

// Tenant JWT (Tenant/Device API)
interface TenantJwtPayload {
  sub: string;              // 用户/设备 ID
  type: 'tenant' | 'device';
  tenantId: string;         // 租户 ID (RLS 依赖)
  roles: ('tenant_admin' | 'warehouse_manager' | 'operator')[];
  permissions: string[];
  deviceId?: string;        // 设备端必填
  iat: number;
  exp: number;
  iss: 'wms7-tenant';
}
```

### 7.2 RBAC 权限矩阵
| 资源 | platform_admin | platform_operator | tenant_admin | warehouse_manager | operator |
|------|---------------|-------------------|--------------|-------------------|----------|
| 租户管理 | CRUD | R | - | - | - |
| 用户管理 | CRUD | R | CRUD | R | - |
| 商品管理 | - | - | CRUD | CRUD | R |
| 库存调整 | - | - | CRUD | CRUD | R |
| 入库作业 | - | - | CRUD | CRUD | CRUD |
| 出库作业 | - | - | CRUD | CRUD | CRUD |
| 波次管理 | - | - | CRUD | CRUD | R |
| 计费规则 | CRUD | R | R | R | - |
| 发票管理 | CRUD | R | R | - | - |
| 设备管理 | - | - | CRUD | CRUD | R |
| 系统配置 | CRUD | R | R | - | - |
| 审计日志 | R | R | - | - | - |

### 7.3 API Key 格式
```
# Platform API Key
wms7_pk_{base64url(32字节随机)}

# Tenant API Key
wms7_tk_{tenantId}_{base64url(32字节随机)}

# Device API Key
wms7_dk_{deviceId}_{base64url(32字节随机)}
```

---

## 8. 核心业务 RPC (V2.1)

> 通过 PostgREST `rpc` 端点调用：`POST /rpc/<function_name>`

| RPC 函数 | 参数 | 返回值 | 描述 |
|----------|------|--------|------|
| `fn_logic_stock_allocation` | `p_order_id uuid, p_sku_id uuid, p_needed_qty numeric` | `TABLE(source_lpn varchar, alloc_qty numeric)` | **跨箱库存分配**：散货优先 → 近效期(FEFO) → 入库时间早 |
| `fn_logic_resolve_blackbox_box` | `p_lpn_code varchar, p_sku_id uuid, p_qty numeric, p_batch varchar` | `void` | **黑盒入库解析**：扫箱不扫货，开箱时确认 SKU/数量，置 `picking_priority=99` |
| `fn_match_cross_dock` | `p_receipt_id uuid, p_sku_id uuid, p_qty numeric` | `TABLE(job_id uuid, outbound_order_id uuid, matched_qty numeric, staging_loc_id uuid)` | **直通匹配**：入库单+SKU→匹配出库单，按优先级/截单时间排序 |
| `fn_allocate_chute` | `p_wave_id uuid, p_sku_id uuid` | `TABLE(chute_id uuid, chute_code varchar, allocated_qty numeric)` | **滑道分配**：优先填满已用滑道、集中分拣 |
| `fn_verify_weight` | `p_sku_id uuid, p_actual_weight numeric` | `TABLE(passed boolean, tolerance_pct numeric, expected_min numeric, expected_max numeric, rule_id uuid)` | **重量校验**：基于验货规则当前生效版本自动判定 |
| `fn_get_active_billing_rule` | `p_tenant_id uuid` | `TABLE(rule_id uuid, rule_name varchar, currency varchar, source varchar)` | **查询生效计费规则**：规范化表优先，回退 JSONB |
| `check_user_permission` | `p_user_id uuid, p_resource varchar, p_action varchar, p_scope varchar` | `TABLE(has_permission boolean)` | **RBAC 权限检查**：供 AuthMiddleware 调用 |
| `fn_current_tenant_id` | 无 | `uuid` | **获取当前租户 ID**：优先 JWT app_metadata，回退 users 表 |
| `adjust_inventory` | `p_tenant_id uuid, p_sku varchar, p_quantity numeric, p_reason varchar` | `TABLE(id uuid, quantity numeric)` | **库存调整**：入库/出库/盘点，乐观锁保护 |
| `fn_cross_dock_timeout_sweep` | 无 | `int` | **直通超时自动降级**：MATCHED/STAGING→FALLBACK (挂 pg_cron 每 5 分) |
| `fn_purge_old_action_logs` | `p_days int DEFAULT 180` | `TABLE(purged_wo_logs bigint, purged_inventory_history bigint)` | **历史日志清理**：wo_action_logs + inventory_history (挂 pg_cron 每天 3 点) |
| `sync_inventory_from_source` | `p_tenant_id uuid` | `TABLE(synced_count numeric)` | **跨库同步库存** |

---

## 9. 请求/响应示例

### 9.1 创建商品 (Tenant API)
```http
POST /api/v1/tenant/products
Authorization: Bearer <tenant_jwt>
Content-Type: application/json

{
  "sku": "SKU-2024-001",
  "name": "iPhone 15 Pro Max 256GB 黑色",
  "categoryId": "cat-electronics",
  "unit": "PCS",
  "specs": {
    "color": "黑色",
    "storage": "256GB",
    "model": "iPhone 15 Pro Max"
  },
  "constraints": {
    "weight": { "min": 220, "max": 230, "unit": "g" },
    "dimensions": { "length": 159.9, "width": 76.7, "height": 8.3, "unit": "mm" },
    "temperature": { "min": 0, "max": 35, "unit": "°C" },
    "fragile": true,
    "hazardous": false,
    "shelfLifeDays": 730
  },
  "barcodes": ["6901234567890", "6901234567891"]
}

Response 201:
{
  "success": true,
  "data": {
    "id": "prod-uuid",
    "sku": "SKU-2024-001",
    "name": "iPhone 15 Pro Max 256GB 黑色",
    "status": "active",
    "createdAt": "2024-01-15T10:30:00Z"
  },
  "meta": { "requestId": "req-uuid", "timestamp": "2024-01-15T10:30:00Z" }
}
```

### 9.2 库存调整 (Tenant API)
```http
POST /api/v1/tenant/inventory/adjust
Authorization: Bearer <tenant_jwt>
Content-Type: application/json

{
  "adjustments": [
    {
      "productId": "prod-uuid",
      "locationId": "loc-uuid",
      "quantity": 10,
      "reason": "damaged",
      "referenceId": "wo-uuid",
      "referenceType": "work_order"
    }
  ],
  "operatorId": "user-uuid"
}

Response 200:
{
  "success": true,
  "data": {
    "adjusted": 1,
    "details": [
      {
        "inventoryId": "inv-uuid",
        "previousQty": 100,
        "newQty": 110,
        "version": 5
      }
    ]
  },
  "meta": { "requestId": "req-uuid", "timestamp": "2024-01-15T10:30:00Z" }
}
```

### 9.3 PDA 任务执行 - 拣选确认 (Device API)
```http
POST /api/v1/device/tasks/pick-123/step/step-2/complete
Authorization: Bearer <device_jwt>
Content-Type: application/json

{
  "scannedData": {
    "locationCode": "A-01-02-03",
    "productSku": "SKU-2024-001",
    "quantity": 5,
    "batchNo": "BATCH-20240115",
    "containerLpn": "LPN-001"
  },
  "deviceInfo": {
    "gps": { "lat": 31.2304, "lng": 121.4737 },
    "network": "wifi",
    "battery": 85
  }
}

Response 200:
{
  "success": true,
  "data": {
    "stepCompleted": true,
    "nextStep": {
      "id": "step-3",
      "type": "confirm",
      "instruction": "请确认拣选数量并放入周转箱"
    },
    "taskProgress": { "completed": 2, "total": 4 }
  },
  "meta": { "requestId": "req-uuid", "timestamp": "2024-01-15T10:30:00Z" }
}
```

### 9.4 Edge Worker 标签生成
```http
POST /api/edge/labels/generate
Authorization: Bearer <edge_jwt>
Content-Type: application/json

{
  "templateId": "tpl-shipping-label",
  "data": {
    "orderNo": "SO-20240115-001",
    "carrier": "SF",
    "trackingNo": "SF1234567890",
    "sender": { "name": "仓库A", "address": "上海市浦东新区...", "phone": "021-12345678" },
    "receiver": { "name": "张三", "address": "北京市朝阳区...", "phone": "13800138000" },
    "items": [
      { "sku": "SKU-2024-001", "name": "iPhone 15 Pro Max", "qty": 1 }
    ],
    "boxNo": 1,
    "totalBoxes": 1,
    "weight": 0.5,
    "dimensions": "20x10x5cm"
  },
  "format": "zpl"
}

Response 200:
{
  "success": true,
  "data": {
    "labelUrl": "https://r2.wms7.com/labels/label-uuid.zpl",
    "format": "zpl",
    "size": "100x150mm"
  },
  "meta": { "requestId": "req-uuid", "timestamp": "2024-01-15T10:30:00Z" }
}
```

---

## 10. 限流与配额

| 端 | 策略 | 限制 |
|----|------|------|
| Admin API | Token Bucket | 1000 req/min per IP |
| Tenant API | Token Bucket | 500 req/min per tenant |
| Device API | Leaky Bucket | 200 req/min per device |
| Edge Worker | Cloudflare 内置 | 1000 req/min per IP |

---

## 11. 版本控制与废弃策略

| 策略 | 说明 |
|------|------|
| **URL 版本** | `/api/v1/...` `/api/v2/...` |
| **Header 版本** | `Accept: application/vnd.wms7.v1+json` |
| **废弃通知** | `Sunset` Header + 6 个月缓冲期 |
| **破坏性变更** | 只在新版本引入，旧版本维护 12 个月 |

---

## 12. 相关文档

| 文档 | 路径 |
|------|------|
| **架构设计** | `docs/01-architecture/ARCHITECTURE.md` |
| **数据库设计** | `docs/03-database/DB_SCHEMA.md` |
| **仓储层设计** | `docs/03-database/REPOSITORY_DESIGN.md` |
| **仓储层路线图** | `docs/03-database/REPOSITORY_ROADMAP.md` |
| **工作流/部署** | `docs/04-workflows/WORKFLOWS.md` |
| **运维体系** | `docs/05-operations/OPS.md` |
| **开发手册** | `docs/07-development/DEVELOPMENT.md` |
| **PDA 离线同步设计** | `docs/01-architecture/PDA_OFFLINE_SYNC_DESIGN.md` |
| **设备端 API 协议详细规范** | `docs/02-api/DEVICE_PROTOCOL_SPEC.md` |
| **同步接口契约规范** | `docs/02-api/SYNC_API_CONTRACT.md` |
| **冲突解决策略矩阵** | `docs/03-database/CONFLICT_RESOLUTION_STRATEGY.md` |
| **PDA 本地 SQLite Schema** | `docs/03-database/SQLITE_LOCAL_SCHEMA.md` |

---

*文档版本：2.1.0*
*最后更新：2025-07-10*
*维护者：架构组*