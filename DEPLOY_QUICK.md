# a4claw 本地部署指南（简化版）

由于 Phase 5-6 代码包含较多 TypeScript 类型问题，建议先使用以下方式运行核心功能（Phase 1-4）：

## 快速启动（仅核心功能）

### 1. 安装依赖
```bash
cd E:\CODE2\AI\a4claw
npm install
```

### 2. 配置环境变量
创建 `.env` 文件：
```env
DATABASE_URL=postgresql://user:password@localhost:5432/a4claw
JWT_SECRET=your-jwt-secret-min-32-chars
OPENAI_API_KEY=your-api-key
MODEL_OVERRIDE=gpt-4
PORT=3000
```

### 3. 数据库迁移
```bash
npm run db:migrate
```

### 4. 启动开发服务器
```bash
npm run dev
```

访问 http://localhost:5173

## 注意事项

1. **Phase 5-6 功能暂时禁用**：Redis Cluster、熔断器、插件系统等功能需要额外配置
2. **测试重点**：先验证 Phase 1-4 核心流程：
   - 旨意看板任务流转
   - 聊天自动转任务
   - 审批闸门
   - DAG 依赖图

3. **完整功能**：等 TypeScript 错误修复后，Phase 5-6 将自动启用
