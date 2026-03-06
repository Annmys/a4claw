# Folder Structure

本文件用于说明 `a4claw` 的目录分类与职责，便于开发、部署与排障。

## Top-Level

| 路径 | 类型 | 说明 |
|---|---|---|
| `src/` | 后端源码 | 核心引擎、API、工具、任务、协议、安全、内存层 |
| `web/` | 前端源码 | 管理控制台（React + Vite） |
| `docs/` | 文档 | 架构、规范、运维文档 |
| `config/` | 配置 | 配置文件与模板 |
| `plugins/` | 插件 | 可插拔功能扩展 |
| `scripts/` | 脚本 | 安装、构建、运维辅助脚本 |
| `tests/` | 测试 | 单元/集成测试 |
| `apps/` | 子应用 | 扩展应用入口 |
| `data/` | 运行数据 | 持久化运行数据（仅保留允许分发内容） |
| `dist/` | 构建产物 | 后端构建输出目录 |

## Backend (`src/`)

| 子目录 | 说明 |
|---|---|
| `src/core/` | 核心能力：引擎、模型路由、工具执行、进化与治理 |
| `src/interfaces/` | 对外接口：Web、Telegram、Discord、Webhook 等 |
| `src/agents/` | Agent 定义与工具实现 |
| `src/actions/` | 具体业务动作（browser、rag、ssh、voice 等） |
| `src/memory/` | 数据库 schema、迁移、仓储 |
| `src/security/` | 鉴权、RBAC、审计、安全检测 |
| `src/protocols/` | A2A / ACP 协议实现 |
| `src/utils/` | 通用工具库 |
| `src/queue/` | 队列与调度能力 |

## Frontend (`web/`)

| 子目录 | 说明 |
|---|---|
| `web/src/pages/` | 各功能页面 |
| `web/src/components/` | 共享组件 |
| `web/src/stores/` | 状态管理（Zustand） |
| `web/src/api/` | 前端 API 客户端 |
| `web/src/utils/` | 前端通用工具 |

## Runtime & Ignore Strategy

以下内容默认是运行时数据，不建议纳入版本控制：

- `logs/`
- `uploads/`
- `data/*`（保留 `data/skills/`）
- `.env`

以根目录 `.gitignore` 为准。
