# 夸父会员储值消费订单明细

查询夸父运营后台中会员储值余额的消费记录，按时间倒序展示。

## 功能

- 查询储值余额 Top 50 且充值总额 > 0 的会员消费记录
- 按消费时间倒序排列
- 支持按手机号/姓名搜索特定会员
- 支持按日期范围筛选消费记录
- 消费概览卡片：记录数、消费总额、本金/赠金消耗、涉及会员/门店数
- 明细表：消费时间、会员、门店、消费金额、本金消耗、赠金消耗、消费后余额、订单 ID

## 架构

```
浏览器 (HTML)
  ↓ fetch
Node.js 代理服务器 (:8766)
  ↓ proxy
夸父运营后台 API (b.kuafood.com)
```

代理服务器负责 CORS 转发和限频（3 并发 / 350ms 间隔），避免前端直连导致跨域和过载。

## 快速开始

```bash
# 1. 启动代理服务器
node kuafood-member-prepaid-server.mjs

# 2. 浏览器打开
open http://127.0.0.1:8766/
```

## 授权方式

### 方式一：Chrome 插件导入（推荐）

1. 在浏览器登录 [夸父运营后台](https://b.kuafood.com)
2. 点击页面上的「从插件导入运营后台授权」
3. 授权信息自动填充

### 方式二：手动粘贴

1. 展开「高级设置」
2. 从浏览器 DevTools Network 面板复制 Bearer Token
3. 粘贴到 Bearer Token 输入框
4. App ID 和 Brand ID 保持默认值（`cli_a222ece4c4b8500d` / `1`）

## 数据查询逻辑

```
拉取会员列表（按 totalBalance 降序，最多 200 条）
  ↓
过滤：totalBalance Top 50
  ↓
过滤：totalCharge > 0（排除从未充值的会员）
  ↓
逐个调用 prePaidLogs(type=2) 拉取消费记录
  ↓
合并 → 日期过滤 → 按 createdAt 降序 → 渲染
```

## 请求量控制

- 会员列表：1 次 API 调用（pageSize=200，仅取第 1 页）
- 消费日志：N 次（N = totalCharge > 0 的会员数，实测约 14 次）
- 总计约 15 次 API 请求，2-3 秒完成

## API 接口

| 接口 | 说明 |
|------|------|
| `GET /api/b/customer/lists` | 会员列表，按 totalBalance 降序 |
| `GET /api/b/customer/{id}/prePaidLogs?type=2` | 会员消费日志（type=2 为消费） |

## 文件说明

| 文件 | 说明 |
|------|------|
| `kuafood-member-prepaid-server.mjs` | Node.js 代理服务器（端口 8766） |
| `kuafood-member-prepaid-query.html` | 前端页面，嵌入在服务器中静态托管 |

## 技术栈

- Node.js（原生 http 模块，零依赖）
- 原生 HTML/CSS/JS（无框架）
- Rate limiter：3 并发 + 350ms 间隔离限频
