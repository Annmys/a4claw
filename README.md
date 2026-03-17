# a4claw

面向内网和私有部署的 AI 助手控制台 + 任务中枢系统。

从单人聊天面板演进为多用户、多中心、多部门、多员工的协同操作中枢。

## 核心特性

### Phase 1 - 基础架构 ✅
- **旨意看板**：7 状态任务工作流（待接收 → 待研判 → 已分派 → 执行中 → 待复核 → 已完成/阻塞）
- **组织结构**：中心 / 部门 / 员工 三级架构
- **账号映射**：Web 账号 ↔ 员工绑定
- **审计时间线**：完整的事件记录与追溯

### Phase 2 - 自动化层 ✅
- **审批闸门**：多类型审批（技能执行、高成本操作、破坏性操作、外部 API 调用）
- **自动转任务**：聊天消息 AI 意图识别，自动创建任务
- **技能编排**：AI 驱动的技能选择与执行人推荐
- **结果回写**：执行结果自动同步到审计时间线

### Phase 3 - 协作层 ✅
- **DAG 依赖管理**：任务间依赖关系（FS/SS/FF/SF），自动解锁依赖任务
- **多智能体协作**：4 种协作策略（单智能体、并行、顺序、层级）
- **工作流引擎**：6 种步骤类型（task/condition/parallel/loop/wait/notification）

### Phase 4 - 可视化层 ✅
- **DAG 可视化**：可拖拽的依赖图编辑器
- **工作流设计器**：可视化工作流编排
- **实时监控面板**：系统指标、任务状态分布、资源使用
- **审批管理界面**：闸门配置、审批请求处理

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 后端 | Node.js + TypeScript + Express |
| 前端 | React + Vite + TailwindCSS |
| 数据库 | PostgreSQL + Drizzle ORM |
| 缓存 | Redis（可选） |
| AI 网关 | OpenClaw 本地网关 |
| 消息 | WebSocket + 长轮询降级 |

---

## 项目结构

```text
a4claw/
├── src/                          # 后端源码
│   ├── agents/tools/             # AI 工具（意图识别、任务转换、技能编排）
│   ├── core/                     # 核心引擎（工作流、多智能体协作）
│   ├── interfaces/web/routes/    # API 路由
│   ├── memory/repositories/      # 数据层（任务、依赖、执行器）
│   ├── security/                 # 安全层（审批闸门、审计日志）
│   └── ...
├── web/src/                      # 前端源码
│   ├── components/               # 组件（DAG、工作流设计器、监控）
│   └── pages/                    # 页面（旨意看板、审批管理）
├── data/skills/                  # 技能定义
├── config/                       # 配置文件
└── docs/                         # 文档
```

---

## 核心流程

### 对话 → 任务 → 执行 完整链路

```
用户消息
    ↓
WebSocket 接收
    ↓
AI 意图识别 (task-intent-detector.ts)
    ↓
自动创建任务 (message-to-task-converter.ts)
    ↓
自动分派 (skill-orchestrator.ts)
    ↓
创建执行单
    ↓
审批闸门检查 (approval-gate.ts)
    ↓
触发执行 (task-executor.ts → engine.process())
    ↓
结果回写 (task-execution-writeback.ts)
    ↓
解锁依赖任务 (task-dependencies.ts)
```

---

## 快速开始

### 环境要求

- Node.js 22+
- PostgreSQL 15+
- Redis（可选）

### 安装

```bash
# 克隆仓库
git clone https://github.com/Annmys/a4claw.git
cd a4claw

# 安装后端依赖
npm install

# 安装前端依赖
cd web && npm install && cd ..
```

### 配置

创建 `.env` 文件：

```env
# 数据库
DATABASE_URL=postgresql://user:password@localhost:5432/a4claw

# 安全
JWT_SECRET=your-jwt-secret-min-32-chars
ENCRYPTION_KEY=your-encryption-key-32-chars

# AI 模型（支持多提供商）
OPENAI_API_KEY=your-api-key
OPENAI_BASE_URL=https://api.openai.com/v1
MODEL_OVERRIDE=gpt-4

# OpenClaw 网关（可选）
OPENCLAW_GATEWAY_TOKEN=your-gateway-token
OPENCLAW_GATEWAY_URL=ws://localhost:18789

# 服务器
PORT=3000
HOST=0.0.0.0
```

### 数据库迁移

```bash
# 生成迁移
npm run db:generate

# 执行迁移
npm run db:migrate
```

### 开发模式

```bash
# 后端
npm run dev

# 前端（新终端）
cd web && npm run dev
```

访问：http://localhost:5173

### 生产构建

```bash
# 构建后端
npm run build

# 构建前端
cd web && npm run build && cd ..

# 启动
node dist/index.js
```

或使用 PM2：

```bash
pm2 start dist/index.js --name a4claw
pm2 save
```

---

## API 端点

### 任务中枢

| 端点 | 说明 |
|------|------|
| `GET /api/command-center/overview` | 仪表盘概览 |
| `POST /api/command-center/tasks` | 创建任务 |
| `GET /api/command-center/tasks/:id` | 任务详情 |
| `POST /api/command-center/tasks/:id/auto-dispatch` | 自动分派 |
| `GET /api/command-center/dag` | 获取任务依赖图 |
| `POST /api/command-center/tasks/:id/dependencies` | 添加依赖 |

### 审批闸门

| 端点 | 说明 |
|------|------|
| `GET /api/command-center/approval-gates` | 闸门列表 |
| `POST /api/command-center/approval-gates` | 创建闸门 |
| `GET /api/command-center/approvals/pending` | 待审批列表 |
| `POST /api/command-center/approvals/:id/decide` | 审批决策 |

### 工作流

| 端点 | 说明 |
|------|------|
| `GET /api/command-center/workflows` | 工作流列表 |
| `POST /api/command-center/workflows` | 创建工作流 |
| `POST /api/command-center/workflows/:id/start` | 启动工作流 |

---

## 功能截图

### 旨意看板
- 7 列状态看板
- 任务拖拽流转
- 实时状态更新

### DAG 依赖图
- 可视化依赖关系
- 拖拽创建依赖
- 自动拓扑排序

### 实时监控
- 系统资源使用
- 任务状态分布
- 执行队列深度

---

## 部署

### Docker

```bash
# 构建镜像
docker build -t a4claw .

# 运行
docker run -p 3000:3000 \
  -e DATABASE_URL=postgresql://... \
  -e JWT_SECRET=... \
  a4claw
```

### Docker Compose

```bash
docker-compose up -d
```

---

## 开发计划

- [x] Phase 1: 基础架构
- [x] Phase 2: 自动化层
- [x] Phase 3: 协作层
- [x] Phase 4: 可视化层
- [ ] Phase 5: 性能优化与扩展
- [ ] Phase 6: 插件生态系统

---

## 许可证

MIT License

---

## 作者

Annmys (annmys@users.noreply.github.com)
