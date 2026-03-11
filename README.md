# a4claw

面向内网和私有部署的 AI 助手控制台，当前重点包含：

- Web 聊天
- 会话历史
- 文件回传到共享目录
- OpenClaw 直连面板
- 基础用户注册与权限控制
- 任务中枢 / 旨意看板（Phase 1）

当前仓库已经按单提交历史重建，适合作为你自己的干净版本继续维护。

## 当前状态

- 项目名：`a4claw`
- 后端：Node.js + TypeScript + Express
- 前端：React + Vite
- 数据库：PostgreSQL
- 可选组件：Redis、OpenClaw
- 默认内网访问：`http://192.168.1.99:3000`

## 已完成的关键改造

- 聊天文件上传后可回传到共享目录
- 保存/导出/附件请求会自动走完整执行链路
- 非首个用户可直接注册
- 兼容旧前端的会话列表接口
- WebSocket 断线或无响应时自动降级 HTTP 重试
- OpenClaw 面板已接通本机网关
- OpenClaw 页面支持按当前用户作用域自动恢复历史消息
- 主聊天页会话列表默认折叠，点击后展开
- 新增独立的 `command-center` 数据模型：
  - center
  - department
  - member
  - user binding
  - task
  - task event
- 新增「旨意看板」前端页面：
  - 状态看板
  - 中心/部门/员工搭建
  - 任务详情
  - 审计时间线
- 用户管理已接入组织结构绑定：
  - 可将 web 登录账号绑定到中心/部门/员工
  - 为后续多中心、多部门、多员工权限设计打底
- 后端已提供任务中枢接口：
  - `/api/command-center/overview`
  - `/api/command-center/centers`
  - `/api/command-center/departments`
  - `/api/command-center/members`
  - `/api/command-center/tasks`

## 目录结构

```text
src/         后端源码
dist/        后端构建产物
web/         前端源码
data/        技能与运行数据
config/      配置文件
docs/        补充文档
00_*.md      当前重构工作区说明文档
```

## 当前重构方向

当前仓库正在向“中枢系统”演进，不再只是单人聊天面板。目标是把未来多用户、多中心、多部门、多员工的协同操作统一到一个可审计的中枢里。

Phase 1 已落地的是：

- 组织骨架：中心 / 部门 / 员工
- 账号映射：web 账号 <-> 员工绑定
- 看板骨架：任务按状态分栏
- 审计骨架：每次创建、流转、备注都写入事件时间线

Phase 2 计划接入：

- 聊天 / Telegram / OpenClaw 自动产生命令任务
- 审批闸门
- 技能与工具自动编排
- 任务执行结果和 artifacts 回写

## 运行要求

- Node.js 22+
- PostgreSQL
- Redis（可选）

## 环境变量

至少需要这些变量：

```env
DATABASE_URL=postgresql://user:password@127.0.0.1:5432/clawdagent
JWT_SECRET=your-jwt-secret
ENCRYPTION_KEY=your-encryption-key
OPENAI_API_KEY=your-api-key
OPENAI_BASE_URL=https://code.ppchat.vip/v1
MODEL_OVERRIDE=ppchat/gpt-5.4
```

如果要启用 OpenClaw 面板，还需要：

```env
DEFAULT_SSH_SERVER=root@127.0.0.1
DEFAULT_SSH_KEY_PATH=/root/.ssh/openclaw_local_ed25519
OPENCLAW_GATEWAY_TOKEN=your-openclaw-token
```

## 开发

后端：

```bash
npm install
npm run build
npm run dev
```

前端：

```bash
cd web
npm install
npm run build
npm run dev
```

## 生产构建

后端：

```bash
npm run build
```

前端：

```bash
cd web
npm run build
```

启动：

```bash
node dist/index.js
```

或用 `pm2`：

```bash
pm2 start dist/index.js --name a4claw --cwd /www/wwwroot/ClawdAgent
pm2 save
```

## OpenClaw

本仓库已经接入 OpenClaw 本地网关：

- 网关地址：`ws://127.0.0.1:18789`
- 默认模型：`ppchat/gpt-5.4`
- 配置文件：`/root/.openclaw/openclaw.json`

OpenClaw 页面特点：

- 与主聊天页独立
- 使用当前登录用户的独立 `sessionKey`
- 切换页面后会自动恢复该用户的 OpenClaw 历史消息

## 共享目录

默认共享根目录：

```text
/data/gongxiang/
```

用户目录规则：

```text
/data/gongxiang/<user>/
```

Windows 访问示例：

```text
\\192.168.1.99\gongxiang\<user>\
```

## 常用命令

构建后端：

```bash
cd /www/wwwroot/ClawdAgent
npm run build
```

构建前端：

```bash
cd /www/wwwroot/ClawdAgent/web
npm run build
```

重启服务：

```bash
pm2 restart a4claw
```

查看 OpenClaw 网关状态：

```bash
openclaw gateway health --url ws://127.0.0.1:18789 --token <token>
```
