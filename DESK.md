# DESK.md — finstack Desk 设计基线

> Desk 是 finstack 的第二个客户端：一个由 engine 进程自身托管的本地 Web 工作台。
> 对话流是第一个客户端；Desk 承担对话里别扭的交互（滑条、分诊、实时观战），
> 两者共享同一份 `~/.finstack/` 文件事实源和同一个进程。
>
> 本文是动工前的完整规格：产品定义、交互模型、写者矩阵、进程与安全架构、
> 技术栈、分期与风险。所有关键裁定均经过五线深度调研验证（§9 调研档案）。
> 实现偏离本文时，以代码为准回改本文。

---

## 0. 一句话架构

一个 Bun 二进制、三个表面：stdio MCP（agent）、CLI（终端）、`Bun.serve`（Desk）。
agent 经 MCP 工具写文件，人经 Desk 直写文件或应答 agent 的等待，
文件即协议，进程内事件总线即总线，SSE 即投影。

```
                  ┌─────────────────────────────┐
                  │        ~/.finstack/          │
                  │ portfolio shadow theses ...  │
                  └──────┬───────────▲───────────┘
        内部事件总线      │           │  POST（人的操作）
                  ┌──────▼───────────┴───────────┐
  agent 走 MCP    │  finstack binary（单进程）    │
  工具写文件  ───►│  stdio MCP + CLI + Bun.serve │
                  └──────┬───────────────────────┘
                SSE 推送  │        ▲ POST /decision/:id
                  ┌──────▼────────┴──────┐        （resolve 挂起的
                  │  浏览器（Codex IAB    │          await_decision）
                  │  或系统浏览器）       │ ←— 人直接交互
                  └──────────────────────┘
```

设计源头是 ChatCut 的 Codex 插件模式（agent 与人共享同一块可见画布，
"live workbench, not a one-time proof"），但 finstack 是本地插件 + 本地数据，
无需 OAuth/boot token/CDN 白名单，机制大幅简化；同构先例
mcp-feedback-enhanced 验证了核心回路（stdio MCP → 进程内 web server →
浏览器提交成为工具返回值），其安全缺陷清单即本文的加固规格。

---

## 1. 产品定义

**屏幕中央是你，不是市场。** 投资者的界面母语是交易终端（watchlist 纵栏、
等宽数字、深色高密度、order ticket）。Desk 借用这层熟悉感获得可信度，
但核心翻转：Bloomberg 的中央是行情，Desk 的中央是镜子——真实的你 vs
纪律的你。

**产品纪律（默认拒绝清单）：**

- 任何让 Desk 滑向"又一个行情终端"的功能默认拒绝。行情数据只作为决策
  上下文出现，永远不是主角。
- GUI 不得成为取消确认的地方（反例：aider `--browser` 强制 `yes=True`
  自动确认一切编辑）。Desk 的方向相反：GUI 是让确认**更有信息量**的地方
  ——Ticket 上的实时风险重算与行为模式警告。
- 静态报告路径（`engine/src/report/`）在 Desk 落地后整体删除。两套呈现
  路径是重复配置，即缺陷。

### 界面结构

四个常驻区 + 一个中央舞台，命名取自投资者母语：

```
┌──────────────────────────────────────────────────────────┐
│ TAPE   regime · day P&L · agent ● active        [status] │
├──────────┬───────────────────────────────┬───────────────┤
│ BOOK     │            STAGE              │  SIGNALS      │
│ 持仓      │   默认: MIRROR（镜子）         │  sense 分诊    │
│  NVDA    │   真实 vs 影子净值 · alpha     │   dismiss     │
│  ...     │   行为成本($)                  │   watch       │
│ ─────    │   接管: ARENA / TICKET        │   → escalate  │
│ 观察      │   切换: MEMO / WEB            │               │
└──────────┴───────────────────────────────┴───────────────┘
```

| 区域 | 母语对应 | 职责 | 交互通道 |
|---|---|---|---|
| **Tape** | 行情带 | 市场状态、当日盈亏、agent 连接指示灯 | ③ 只读 |
| **Book** | 交易员的 book | 持仓 + watchlist；录入真实成交、增删观察 | ② 直写 |
| **Signals** | 收件箱 | sense 分诊：划掉 / 关注 / 升级 | ② 直写 |
| **Stage** | 监视器 | 视图栈（NLE 逻辑：底层常驻，上层按需推入） | ①③ |

**Stage 视图栈：**

- **Mirror**（基底，默认画面）— `/track` 的投影：真实 vs 影子净值曲线、
  cognitive alpha 分解、行为成本（美元计）、论点生命周期。
- **Arena**（agent 发起的接管）— `/judge` 运行时推上栈：Bull/Bear 逐轮
  实时渲染；终局弹出条件置信度滑条 + 条件清单，提交即解除 agent 等待。
- **Ticket**（agent 发起的接管）— `/act` 的 decision ticket：仓位/止损/
  期限滑条，组合热度、单仓风险、相关性实时重算；`profile.json` 的行为
  模式警告钉在确认按钮正上方。确认即封存计划至 shadow.json。
- **Memo / Web**（人主动切换）— research 备忘录批注、cascade 因果 DAG。
  Phase 4。

**Thesis 是贯穿线。** signal 升级 → thesis 创建 → Arena 裁决 → Ticket
封存 → Mirror 追踪偏离 → reflect 归因，全程同一 thesis id。历史
Arena/Ticket 沿 thesis 可回看（只读）。

### 场景裁定（哪些时刻值得一块画布）

| 时刻 | 对话流为何失效 | Desk 形态 |
|---|---|---|
| `/act` 定仓位 | 连续参数空间，一问一答 vs 拖滑条实时重算 | Ticket |
| `/judge` 裁决 | 辩论值得逐轮观看；置信度是带条件的连续值 | Arena |
| `/sense` 分诊 | 十几个高频微决策，打字十几行 vs inbox 划卡 | Signals |
| `/cascade` 推演 | 因果图是空间结构，文本线性化损失拓扑 | Web（DAG） |

`/track` 钻取、`/research` 批注：交互密度低，搭车实现。
`/screen`、`/review`：终端表格/报告够用，不进 Desk。

---

## 2. 交互模型：三通道

人和 agent 在同一页面上的交互有三种，混为一谈会设计出错误的协议。
每个控件属于且只属于一类：

**① 决策应答（人回应 agent 的等待）— 阻塞工具桥。**
agent 调 MCP 工具 `await_decision`，调用挂起于进程内 promise map；
人在页面上完成表单，`POST /decision/:id` resolve 该 promise；
工具返回决策内容，agent 同一回合继续。无轮询、无中间文件——MCP server
与 web server 同进程，页面的 POST 直接变成工具返回值。

**② 自主操作（人不需要 agent 参与）— 直接写文件。**
分诊 dismiss、编辑 watchlist、录入成交、批注 memo：POST 直接落
`~/.finstack/`。文件是唯一事实源，agent 下次读取自然看到。
Desk 因此有独立价值：没有 agent 会话时它也是一个能用的应用。

**③ 状态推送（agent 改了世界）— SSE。**
agent 经现有 MCP 工具写文件，server 推增量给页面。Arena 逐轮直播
即此通道。

**明确不做：** 页面主动发起新的 agent 回合。Codex 无页面注入 prompt
的通道（ChatCut 亦然）。降级：此类按钮生成预填 prompt 复制到剪贴板。
诚实的边界，不造假通道。

### await_decision 契约

词汇表采纳 Agent Inbox 成熟 schema：

```
请求  { requestId, action_request: { action, args },
        config: { allow_accept, allow_edit, allow_respond, allow_ignore },
        description }
响应  { type: "accept" | "edit" | "respond" | "ignore", args }
```

- **以 requestId 幂等**：宿主重试（MCP 2026-07-28 的 MRTR 语义）或
  skill 重调不重复弹单；未决请求跨 SSE 重连原样重投。
- 超时兜底：`waitSeconds = 240` 到期返回 `{status: "pending"}`，
  skill 循环重调或降级为对话内提问。
- SKILL.md 必须显式声明"此工具设计为长挂起，等待即正确行为"——
  对抗 GPT-5.6 developer prompt 劝阻 >60s 阻塞的偏置。

### Codex 宿主约束（调研确认，源码级）

- `.mcp.json` 为 finstack server 显式写 `tool_timeout_sec = 86400`；
  setup 流程校验生效。Codex 当前代码默认 300s（官方文档的 60s 是陈旧值），
  无硬上限；超时是**可恢复错误**（session 不断、进程不被杀）。
- `notifications/progress` 在 Codex 只被 log，**不重置超时钟**。不发。
- elicitation：Codex 仅支持平面原语字段表单，且 `codex exec` **静默
  取消一切 elicitation**。不作主通道；若未来启用降级路径，须检测
  "瞬时 Cancel"并落回桥，不得误判为用户拒绝。
- code_mode 陷阱：开启时阻塞调用被每 30–50s 重采样烧 token。安装文档
  记缓解项 `[features.code_mode] direct_only_tool_namespaces`。
- MCP Apps：Codex Desktop 事实上能渲染但未文档化、CLI 不渲染。不作
  产品契约；免费采纳其约定——UI-only 工具标
  `_meta.ui.visibility: ["app"]`，状态区分模型可见/UI 私有——换取未来
  GUI 宿主直接渲染 Desk 面板的可能。季度复查文档化进度。

### 浏览器交接

需要可见时刻的工具结果携带 `browserHandoff: { url, required }`。
skill 契约：Codex 桌面端用浏览器控制能力开 IAB；CLI 环境 `open` 系统
浏览器。同一 URL。IAB 对 Desk origin 的**首次** per-origin 授权会弹
一次卡片——skill 写明"请点击授权卡"的提示话术（ChatCut Browser pane
协议同款）。IAB 偶发 localhost 拦截 bug 的降级路径：系统浏览器。
tab 打开成功即视为交接完成，不轮询等加载、不为证明打开而截图。

---

## 3. 写者矩阵

双写不是全局属性，是逐状态域单独裁定的属性。此矩阵是所有接口形状的
上游，改动它须先过产品裁定：

| 状态域 | 人（GUI） | 人（经 agent） | agent 自主 | 理由 |
|---|---|---|---|---|
| watchlist | ✅ | ✅ | ✅（screen 建议后确认） | 低风险清单 |
| portfolio（真实成交） | ✅ | ✅ | ❌ | 只有人知道实际做了什么交易 |
| signals 分诊 | ✅ | ✅ | ❌ | 分诊本身在测量人的注意力选择 |
| theses | ✅（批注/状态） | ✅ | ✅（research 产出） | 结构化字段 agent 写、批注人写 |
| **shadow.json** | ❌ | ❌ | ✅（仅 act 决策边界，append-only） | **产品命门** |
| confidence / 裁决 | ✅（Arena） | ✅ | ❌ | 定义上只能来自人 |
| patterns / profile | ❌ | ❌ | ✅（仅 reflect） | 测量结论；异议走对话 |

**红线：** shadow 是决策时刻封存的对照组，人若能事后编辑即是追改对照组，
execution drag 失去意义——两个人类入口都封死，GUI 显式呈现"当时封存的
计划"。patterns/profile 同理：镜子不可被照镜子的人涂改；异议走
`/reflect`，让 agent 记录"用户对此模式有异议"。

**准确表述：多数操作状态双写，全部测量状态单写。**

### 并发（agent 的快照过期问题）

MCP server 与 web server 同进程，所有写入串行过同一事件循环——物理竞态
不存在。剩下唯一问题与 ChatCut 相同：agent 推理基于过期快照。三层处理：

1. **每状态域单调 rev**，所有读写结果携带。
2. **agent 修改工具强制 `expectedRev`（CAS）**：不匹配即拒绝，错误体
   直接携带当前状态（重读成本摊进失败路径）。比 ChatCut 的纯 skill
   纪律更硬：协议层保证"不重读就写不进去"。
3. **每个工具结果附 `humanEdits` 摘要**：自上次调用以来人在 GUI 的动作
   （由 actions.jsonl 游标生成）。agent 是轮询感知，把人的动作日志塞进
   它每个感知窗口。

人的 GUI 写入不做 CAS：页面吃着 SSE 即当前状态，且人赢是既定策略。

**残余风险（接受，与 ChatCut 同构）：** agent 长推理中人改前提。防线
唯一：skill 契约规定决定性写入前最后一次 CAS。

### actor 归因是产品数据

每笔写入记 `actor: "human-gui" | "human-via-agent" | "agent"`，追加
`actions.jsonl`（append-only：ts/actor/domain/op/rev）。对一般应用是
审计日志；对 finstack 是测量数据——"对话深思后调整止损"与"半夜 GUI
手滑改止损"是行为学上不同的事件，`/reflect` 应看见区别。

---

## 4. 进程与生命周期

```
finstack binary
├─ stdio MCP     ← Codex（现有）；stdin 关闭 → 干净退出
├─ CLI 子命令     ← 终端（现有）
└─ Bun.serve     ← Desk（新增；mcp-server 启动即监听）
```

- **端口：固定默认 41307**（可配）。随机端口 = 每次新 origin = IAB
  每次重弹授权；token+cookie 使固定端口可接受，授权疲劳降为首次一次。
- **单实例（绑定即锁）：** 绑 `127.0.0.1:41307`；`EADDRINUSE` → 读发现
  文件 `~/.finstack/desk.json` `{port, pid, token, startedAt, version}`
  （0600）→ **token 认证健康探针**验证活性（防 pid 复用误报；同时证明
  "是我们的进程"）→ 活则复用其 URL，死则清理接管。探针失败且占用者是
  外来进程 → 从默认端口**递增扫描**（有限次，marimo 策略），实际端口
  写入发现文件。绑定成功后才写发现文件；读取容忍半写 JSON；退出 unlink。
- **多 Codex 会话并存**：各持自己的 Desk 实例（await promise 是进程
  局部的，不跨桥）。首个实例占默认端口，后续递增。文档写明。
- **独立入口** `finstack desk`：有活会话开其 URL，无则起 serve-only
  实例（无 stdin 绑定）。
- **版本偏斜防护（marimo skew token 模式）：** skill 会在源码变更时
  重编译二进制，旧 tab 的 SPA 可能打到新 server。发现文件与 SSE 首帧
  携带 `version`，页面检测不匹配即自助重载。

---

## 5. 安全规格

威胁模型：Desk 展示敏感财务数据、其 POST 能改本地文件并 resolve 一个
正在 shell 里跑的 agent 的工具调用——**这是 RCE 面**（MCP Inspector
CVE-2025-49596 CVSS 9.4、goose 1-click RCE、marimo pre-auth RCE 全是
同类）。对本机同用户进程不设防（它们本来就能读 `~/.finstack/`）；防的
是浏览器上下文攻击：DNS rebinding、CSRF 打 localhost、XSS 窃 token。

**认证三层（每层独立击破 DNS rebinding，全部实施）：**

1. **token → cookie 兑换（Jupyter 模型）。** per-launch 256-bit token
   仅经启动 URL 路径引导；首次 GET 兑换 **HMAC 签名 HttpOnly cookie**
   （`SameSite=Strict; Path=/`，名称带端口后缀），随即
   `history.replaceState()` 抹除 token。`Authorization` header 保留给
   程序化访问。签名值防 RFC 6265 "cookie 不隔离端口"；per-launch 密钥
   保证重启后旧 cookie 失效。**cookie 兑换是硬需求而非规范洁癖：
   EventSource 无法带自定义 header，SSE 只能靠 cookie 认证。**
2. **`Host` 精确校验**：≠ `127.0.0.1:<port>` → 403（MCP spec MUST）。
   loopback 宽免须 peer IP **且** Host 同为 loopback（Codexia 细化）。
3. **CSRF**：非 GET 要求 `Sec-Fetch-Site: same-origin|none`；缺失时
   精确匹配 `Origin`；fail closed。不发任何 CORS 头。

**铁律：每条路由无豁免。** SSE、健康探针、每个辅助端点过同一认证
中间件。反例即 CVE：marimo 全站有 token 但 `/terminal/ws` 一条路由
跳过校验 → pre-auth RCE。token 比较用常数时间。token/cookie 永不入
日志与错误页（Jupyter CVE-2022-24757 教训）。

**响应头（每响应）：**

```
Content-Security-Policy: default-src 'self'; script-src 'self';
  object-src 'none'; base-uri 'none'; form-action 'self';
  frame-ancestors 'none'
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
Cache-Control: no-store        （HTML 与所有 API/数据响应）
X-Frame-Options: DENY          （legacy 双保险）
```

`frame-ancestors 'none'` 经查证不影响 Codex IAB（顶层 Chromium
WebContentsView，非 iframe）；Annotation mode 靠 DOM 注入，CSP 不拦。
严格 CSP 是对 XSS→token 窃取类（Jupyter CVE-2026-40171）的主防线。

**传输：明文 HTTP 是定案。** loopback 是 potentially-trustworthy
origin（secure-context API 全可用）；自签 https 反而撞 Codex IAB 无
证书错误豁免的墙。Chrome LNA 与我们无关：loopback 页面访问自身 origin
被 spec 显式豁免，任何浏览器无弹窗。

---

## 6. SSE 与状态同步

行业共同痛点是**恢复而非重连**（Gradio 至今无 Last-Event-ID 续传；
Codexia/claudecodeui/OpenHands 的回放设计是参照）。规格：

- 每 tab 一条多路复用流，所有事件类型走同一流（HTTP/1.1 六连接/origin
  上限真实存在；本地明文无 h2）。多 tab 需求出现时用 SharedWorker 共享，
  v1 接受低 tab 预算。
- handler 首行 `server.timeout(req, 0)`——Bun `idleTimeout` 默认 10s
  且作用于流中，这是必踩的坑。
- 全局单调 seq；事件 `id:` 置于 `data:` 之后（书签只在送达后前进）；
  重连按 `Last-Event-ID` 回放有界缓冲；深度不足回落
  `GET /api/state?since=<rev>` 全量对账。
- **待决 decision 请求跨重连重投**（claudecodeui 模式）——状态重同步
  是硬问题，传输重连是送的。
- 15s 心跳注释（兼作 tab 关闭检测）；SSE 路由禁走压缩中间件；关停回
  204 终止重连；标准 ReadableStream，禁 `type: "direct"`。

**状态监听：** 进程内写入走内部事件总线（自己是主要写者，不依赖 fs
事件）。`fs.watch` 仅作带外写入对账（用户在另一终端跑 CLI 直写）：
**watch 父目录而非文件**（macOS inode 监听死于原子改名，wontfix）；
启动时急建状态文件（Bun 曾漏报后建文件）；`rename`≡`change` →
100ms 防抖 → 重 stat + 内容哈希去重。

---

## 7. 技术栈（版本裁定）

| 层 | 决定 | 关键依据 |
|---|---|---|
| Bun | **pin ≥ 1.3.14** | 该版重写 macOS fs.watch 为纯 FSEvents；本机 1.3.13 需升级 |
| 资产嵌入 | **HTML import**（`import app from "./index.html"`） | `--asset` 目录嵌入是 1.4-only；HTML import 自 1.2.17 在 `--compile` 下完整可用，AOT 打包整个前端依赖图，MIME/ETag 正确 |
| 前端依赖 | lockfile 固定的普通依赖，由 `bun build --compile` 打包 | 删掉 import map/specifier 重写/vendor 维护；运行时仍完全离线 |
| UI | preact@10.x（**pin，11 是 RC**）+ @preact/signals；htm 可选（Bun 原生转译 JSX，`jsxImportSource: "preact"`） | ~11KB gz |
| 图表 | **uPlot@1.6.32** | `bands` 原语直接映射净值回撤/置信带；MIT 无归因条款；~23KB gz。lightweight-charts 仅当 K 线成一等需求再议（TradingView 归因 + 3× 体积） |
| 样式 | CSS custom properties 单 token 表 + 单 stylesheet，原生嵌套 | 不引入任何形态 Tailwind（`@tailwindcss/browser` 是 74KB gz 的运行时编译器，比整个前端栈还大） |
| 升级检查项 | Bun 升级后跑 SSE 断连冒烟测试 | Bun 2026 年中完成 Zig→Rust 重写，流终结器崩溃类回归风险 |

总前端增量 ~35KB gz。零新工具链：`bun build --compile` 是现有构建命令。

---

## 8. 分期与出口判据

| 期 | 交付 | 出口判据 |
|---|---|---|
| **1 · 桥 + 框架** | 固定端口 + 绑定锁 + 发现文件；token→cookie 兑换；SSE（seq/回放/心跳）；`await_decision`（requestId 幂等 + 重投）；安全清单全量；SPA 四区骨架 + **Ticket**；setup 校验 `tool_timeout_sec` | `/act` 端到端：agent 发起 → 人在 GUI 调参确认 → 计划封存 shadow.json |
| **2 · Arena** | judge 逐轮直播 + 裁决滑条；humanEdits 摘要；CAS 上线 | `/judge` 全程 Stage 可看，裁决经桥返回 |
| **3 · Desk 日常** | Signals 分诊、Mirror（uPlot）、Book 直写；**删除 `engine/src/report/` 及 CDN 依赖** | 晨间流程可纯 GUI 分诊后入对话 |
| **4 · 纵深** | Memo 批注、thesis 回看、Cascade DAG | — |

**Phase 1 同一变更内落的文档：** ARCHITECTURE.md 增 Desk 章（指回本文）、
AGENTS.md 增 workbench 启动/调试路径 + Bun 版本门槛 + `tool_timeout_sec`
安装契约 + code_mode 缓解项、`sense/judge/act/track` 四个 SKILL.md 更新
交接与回合边界纪律、ROADMAP.md 对齐分期。

**Skill 契约变更清单：** 新增 MCP 工具 `desk_open`、
`await_decision(kind, payload, waitSeconds)`；现有变更类工具
（watchlist/portfolio/thesis）加 `expectedRev`；工具结果附 `humanEdits`。

### 残余风险登记

| 风险 | 处置 |
|---|---|
| agent 长推理中人改前提 | commit 前最后一次 CAS；与 ChatCut 同构，接受 |
| IAB 首次 per-origin 授权弹卡 | 固定端口降为仅首次；skill 写明提示话术 |
| IAB 偶发 localhost 拦截 bug | 降级 `open` 系统浏览器，同一 URL |
| MCP Apps 在 Codex 文档化进度 | 季度复查；已按其约定预留兼容层 |
| GPT-5.6 偏置对抗长挂起 | SKILL.md 显式声明等待即正确；失效则缩短 waitSeconds 走重调循环 |

---

## 9. 调研档案（裁定依据索引）

2026-08 五线深度调研，结论互相咬合无冲突。原始报告在会话记录中；
此处仅存裁定与关键出处，供未来质疑某条规格时溯源。

**① Codex MCP 挂起约束**（openai/codex 源码级）：
`tool_timeout_sec` 逐 server 可配、代码默认 300s、无硬上限、超时可恢复；
progress 通知被忽略；elicitation 在 `codex exec` 被静默取消；
code_mode 重采样陷阱（openai/codex#32640）。
→ 裁定：阻塞桥可行，条件是显式 `tool_timeout_sec = 86400`。

**② MCP 人机交互原语**（spec 2026-07-28 + 各宿主验证）：
elicitation 仅平面原语、无滑条渲染先例；MRTR 重构（SEP-2322）要求
幂等重试；MCP Apps 是官方扩展但 Codex 未文档化、CLI 不渲染；
Sampling/Roots 已废弃。
→ 裁定：无原生原语胜过自建桥；按 MRTR 语义做 requestId 幂等。

**③ 本地 workbench 先例**（mcp-feedback-enhanced、MCP Inspector、
Codexia、claudecodeui、vibe-kanban、Agent Inbox、HumanLayer、goose、
marimo、streamlit、gradio、aider、OpenHands）：
同构架构已验证；Agent Inbox 词汇表；绑定即锁 + Jupyter 发现文件 +
token 健康探针；SSE 收敛与回放模式；aider GUI 自动确认为反面教材。
→ 裁定：§2 契约、§4 生命周期、§6 同步规格。

**④ localhost 安全**（CVE-2025-49596、CVE-2026-39987、goose RCE、
Jupyter 系列 CVE、Chrome LNA spec、Codex IAB 行为）：
三层防线、token→cookie、每路由无豁免、明文 HTTP、
`frame-ancestors 'none'` 不影响 IAB、LNA loopback 豁免。
→ 裁定：§5 全部。

**⑤ Bun + 前端栈**（bun.sh docs/issues、npm 实测）：
HTML import vs `--asset`、`idleTimeout` SSE 坑、1.3.14 fs.watch 重写、
preact/uPlot 版本与体积实测、Tailwind 运行时否决。
→ 裁定：§7 全部。
