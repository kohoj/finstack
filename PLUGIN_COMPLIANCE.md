# finstack: OpenAI Codex Plugin 合规性报告

**版本**: v0.7.6

**日期**: 2026-08-26

**状态**: ✅ 生产就绪

## 执行摘要

finstack 已完成向 OpenAI Codex Plugin 规范的完整迁移，所有 P0-P4 问题已解决。插件现已极度标准化，可通过 OpenAI marketplace 直接添加。

## 合规性检查清单

### P0（阻断安装）— 全部完成 ✅

- ✅ **plugin.json 位置**: 已移至 `.codex-plugin/`（OpenAI 规范要求）
- ✅ **Manifest 字段**: 已移除 Codex 校验器不接受的 `$schema` 提示字段
- ✅ **环境变量优先级**: `PLUGIN_ROOT` 优先于 `CODEX_PLUGIN_ROOT`
- ✅ **数据目录**: `PLUGIN_DATA` 优先于 `FINSTACK_HOME`

### P1（功能增强）— 全部完成 ✅

- ✅ **MCP 配置**: `.mcp.json` 已创建（占位结构，未来可暴露核心命令）
- ✅ **plugin.json mcpServers**: 指向 `./.mcp.json`
- ✅ **defaultPrompt**: 扩展到 10 个示例（覆盖所有 9 个 skill）

### P2（用户体验）— 全部完成 ✅

- ✅ **Lifecycle hooks + MCP bootstrap**: `hooks/hooks.json` 预构建；`bin/finstack-runtime` 是 MCP 的独立启动入口
  - onInstall/onUpgrade: 在插件根目录编译引擎
  - 首次 MCP 调用: 若 hook 未运行，启动入口从已安装源码重建一次
- ✅ **隐私政策**: privacyPolicyURL → SECURITY.md
- ✅ **服务条款**: termsOfServiceURL → LICENSE

### P3（视觉完整性）— 全部完成 ✅

- ✅ **icon.png**: 512×512 白底圆角单色插件图标，同时用于 `composerIcon` 和 `logo`（26KB）
- ✅ **wordmark.png**: 1600×480 新版横向标识，仅用于宽幅文档（41KB）
- ✅ **wordmark.svg / wordmark-reversed.svg**: 明暗两套可缩放路径字标
- ✅ **截图 4 个**（1600×900，共 3.7MB）：
  - screenshot-portfolio.png: 投资组合与风险指标
  - screenshot-judge.png: Bull vs Bear 对抗论证
  - screenshot-alpha.png: 真实交易 vs shadow 基准对比
  - screenshot-cascade.png: 多步骤链式反应分析

### P4（最佳实践）— 全部完成 ✅

- ✅ **defaultPrompt 覆盖**: 10 个示例覆盖所有使用场景
- ✅ **assets 规格**: 所有文件符合 OpenAI 推荐规格
- ✅ **文档完整**: README/SECURITY/LICENSE 全部就绪

## 规范对比

| 项目 | OpenAI Codex 要求 | Agent Plugins 1.0.0 | finstack 状态 |
|------|-------------------|---------------------|---------------|
| plugin.json 位置 | `.codex-plugin/` | 根目录 | ✅ `.codex-plugin/` |
| $schema | 不接受未知字段 | 可选实现差异 | ✅ 已移除 |
| 环境变量 | PLUGIN_ROOT + PLUGIN_DATA | 同 | ✅ 标准优先 |
| MCP 配置 | .mcp.json | mcp.json | ✅ .mcp.json |
| Hooks | hooks/hooks.json | 未定义 | ✅ 已创建 |
| Assets | ./assets/ | 未定义 | ✅ 完整 |
| defaultPrompt | 4-8 个推荐 | 基础支持 | ✅ 10 个 |
| 隐私/条款链接 | 推荐 | 未定义 | ✅ 已添加 |

**决策**: 采用 OpenAI Codex 规范，因为目标是通过 OpenAI marketplace 分发。

## 结构验证

```
finstack/
├── .codex-plugin/
│   └── plugin.json          ✅ 完整字段
├── .mcp.json                ✅ MCP 注册（经 `bin/finstack-runtime` 保证可执行）
├── hooks/
│   └── hooks.json           ✅ 生命周期钩子
├── assets/
│   ├── icon.png             ✅ 512×512
│   ├── wordmark.png         ✅ 1600×480
│   ├── wordmark.svg         ✅ 矢量深色版
│   ├── wordmark-reversed.svg ✅ 矢量反白版
│   ├── screenshot-*.png     ✅ 4 个 1600×900
│   └── README.md            ✅ 资源说明
├── skills/                  ✅ 9 个 SKILL.md
│   ├── sense/
│   ├── research/
│   ├── judge/
│   ├── act/
│   ├── cascade/
│   ├── track/
│   ├── reflect/
│   ├── screen/
│   └── review/
├── engine/                  ✅ Bun + TypeScript
└── .agents/                 ✅ Marketplace 配置
```

## 质量门禁

```
✓ 574 tests pass (13 skip, 0 fail)
✓ 31/31 docs checks pass
✓ lint clean (biome)
✓ typecheck clean (tsc)
✓ 9 个 preamble 字节一致
```

## Git 历史

```
cec3457 feat: add complete visual assets - production ready
203f1be feat: P2-P4 完整标准化 - OpenAI Codex plugin 生产就绪
03edef9 fix: OpenAI Codex plugin spec 完整合规
8a7ea84 fix: Agent Plugins Spec 1.0.0 合规性 P0 修正
```

**文件变更**: 19 files changed, 102 insertions(+), 23 deletions(-)  
**Assets 总大小**: 4.6MB

## 安装指南

### 通过 OpenAI Marketplace 添加

1. 打开 ChatGPT Desktop 或 Codex
2. Settings → Plugins → Add plugin marketplace
3. 填写：
   - Source: `kohoj/agent-plugins` 或 `https://github.com/kohoj/agent-plugins`
   - Git ref: `main`
   - Sparse paths: 留空（加载整个插件）
4. Click "Add marketplace"

### 命令行安装（可选）

```bash
codex plugin marketplace add kohoj/agent-plugins
codex plugin add finstack@kohoj-agent-plugins
codex plugin marketplace list
```

## 零配置验证

```bash
# 测试基础数据获取（无需 API key）
$F quote AAPL

# 测试状态管理
$F portfolio init
$F portfolio add MSFT 10 420

# 验证 schema 校验
echo '{"ticker":"MSFT","thesis":"test","verdict":"hold","conditions":[...]}' | $F thesis add
```

## 已知限制

1. **MCP 服务器**: `.mcp.json` 当前为占位结构。24 个命令尚未暴露为 MCP tools（未来增强）。
2. **首次编译**: Preamble 自动编译需要 ~2 秒。Hooks 提供进度反馈。
3. **Windows 支持**: Preamble 当前为 bash。PowerShell 版本待补充（P5）。

## 后续路线图

### 近期（1-2 周）
- 实现 MCP 服务器暴露核心命令
- 添加 Windows PowerShell preamble
- 补充更多截图（sense/research/track）

### 中期（1-3 月）
- 提交到 OpenAI 官方 plugin 目录
- ChatGPT / Cursor 跨客户端测试
- 社区反馈收集与迭代

### 长期
- 多语言 skill 支持
- 移动端 remote control 集成
- 插件市场分析与优化

## 联系方式

- **GitHub**: https://github.com/kohoj/finstack
- **Issues**: https://github.com/kohoj/finstack/issues
- **Security**: SECURITY.md
- **License**: MIT

---

**最后更新**: 2025-08-07  
**维护者**: kohoj  
**合规性认证**: OpenAI Codex Plugin Specification 1.0.0
