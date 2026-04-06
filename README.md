# Cloudflare 账号管理服务

这是一个可部署到 Cloudflare Workers 的账号管理 Web 服务，前端使用 Vue 3 + Naive UI，后端使用 Hono + D1。

## 功能

- 账号增删改查（账号、密码、client_id、refresh_token、备注）
- 支持批量导入：`账号----密码` 或 `账号----密码----client_id----refresh_token`
- 上传配置可视化管理：URL、方法、Content-Type、请求头、数据模板
- 支持占位符：`_account_`、`_password_`、`_id_`、`_token_`、`captchaurn`
- 上传任务支持并发控制、失败重试、每条结果回显（含尝试次数）
- 后台登录鉴权（基于 HttpOnly Cookie 会话）

## 本地开发

1. 安装依赖：

```bash
npm install
```

2. 新建 `.dev.vars`（供 `wrangler dev` 使用）：

```env
ADMIN_USERNAME=admin
ADMIN_PASSWORD=your_password
SESSION_SECRET=replace_with_long_random_secret
```

3. 启动 Worker API：

```bash
npm run dev:worker
```

4. 启动前端：

```bash
npm run dev
```

`vite.config.ts` 已将 `/api` 代理到 `http://127.0.0.1:8787`。

## 部署到 Cloudflare

1. 创建 D1 数据库：

```bash
wrangler d1 create account_manager_db
```

2. 把返回的 `database_id` 填入 `wrangler.toml` 的 `[[d1_databases]]`。

3. 设置鉴权密钥：

```bash
wrangler secret put ADMIN_PASSWORD
wrangler secret put SESSION_SECRET
```

> `ADMIN_USERNAME` 默认来自 `wrangler.toml` 的 `[vars]`，默认为 `admin`。

4. 执行数据库迁移：

```bash
wrangler d1 migrations apply account_manager_db --remote
```

5. 构建并部署：

```bash
npm run deploy
```

## 上传模板说明

### 模板示例 1

```json
{"data":"captchaurn"}
```

`captchaurn` 会被替换为：

- `账号----密码`
- `账号----密码----client_id----refresh_token`

### 模板示例 2

```json
{"a":"_account_","p":"_password_","c":"_id_","t":"_token_"}
```

- `_account_`: 账号
- `_password_`: 密码
- `_id_`: client_id
- `_token_`: refresh_token

也支持混用：

```json
{"data":"captchaurn","a":"_account_","p":"_password_"}
```

## 重试与并发配置

- `并发数`：同时上传的账号请求数，范围 `1-10`
- `重试次数`：单条失败后自动重试次数，范围 `0-5`
- `重试间隔(ms)`：每次重试前等待时长，范围 `0-10000`

## 目录结构

- `src/` 前端页面（Naive UI）
- `worker/index.ts` Worker API 与静态资源入口
- `migrations/0001_init.sql` D1 初始化 SQL
- `wrangler.toml` Cloudflare 配置
