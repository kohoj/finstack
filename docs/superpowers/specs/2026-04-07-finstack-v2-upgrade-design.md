# finstack v0.3–v0.6 升级设计文档

> 从"精彩论文"到"一人基金研究部"——渐进重构方案

## 1. 背景与动机

finstack 的认知架构（cascade 追踪、thesis falsification、cognitive alpha、条件置信度）是其核心护城河，设计水准一流。但工程成熟度和日常可用性距离一流产品有显著差距：

- **数据层脆弱**：Yahoo Finance 逆向工程随时可能失效，网络请求无超时无重试
- **无日常骨架**：缺少 watchlist、筛选器、提醒系统，无法作为"每天打开的工具"
- **可靠性不足**：非原子写入（断电丢数据）、exit(1) 式错误处理、无版本校验
- **无可视化**：纯文本输出，关键洞察难以直观呈现
- **缺少工程纪律**：无 E2E skill 测试、无操作学习系统、无 ARCHITECTURE.md / CONTRIBUTING.md / CHANGELOG.md

### 目标用户

- **有经验的个人投资者**：有基本投资知识（P/E、止损），不一定会写代码，需要清晰文档和丝滑上手
- **量化/技术背景投资者**：既懂投资又会写代码，可接受 CLI，会想自己扩展功能

### 市场覆盖

- **美股为核心**（NYSE / NASDAQ 个股）
- **自然覆盖 ETF、主要指数、大宗商品 ticker**（如 GLD、USO、SPY）
- 不做多交易所适配

### 升级策略

**渐进重构**——保留现有 7 个 skill 和 engine 架构不变，在现有骨架上逐层升级。每个 Phase 都是"加固一块地基 + 上一个可见功能"，功能与地基相伴相随。

---

## 2. Phase 1：数据层重建 + Watchlist（v0.3.0）

### 2.1 网络可靠性层

**新增文件**：`engine/src/net.ts`

所有外部 HTTP 请求经过此层，提供超时控制和重试能力。

```typescript
// 核心 API
fetchWithTimeout(url: string, opts?: RequestInit, timeoutMs?: number): Promise<Response>
// 默认超时 10 秒，超时抛出 TimeoutError

fetchWithRetry(url: string, opts?: RequestInit, config?: RetryConfig): Promise<Response>
// 默认重试 2 次，指数退避 [1000ms, 3000ms]
// 仅对 5xx 和网络错误重试，4xx 不重试（不是暂时性问题）
// 每次重试内部调用 fetchWithTimeout
```

**改造范围**：`engine/src/data/` 下所有数据源文件（yahoo.ts、fred.ts、edgar.ts、alphavantage.ts、polygon.ts）中的裸 `fetch()` 调用全部替换为 `fetchWithRetry()`。

### 2.2 原子写入

**新增文件**：`engine/src/fs.ts`

所有持久化 JSON 数据（portfolio.json、theses.json、shadow.json、consensus.json、watchlist.json、keys.json、profile.json）的写入改为原子操作。

```typescript
// 核心 API
atomicWriteJSON(filePath: string, data: unknown): void
// 实现：写入 filePath.tmp.{pid} → fsync → rename 到 filePath
// rename 是 POSIX 原子操作，断电安全
// 文件权限：敏感文件（keys.json）使用 0o600，其他使用 0o644

readJSONSafe<T>(filePath: string, fallback: T): T
// 读取 JSON，解析失败或文件不存在时返回 fallback，不抛异常
```

**改造范围**：所有使用 `writeFileSync(path, JSON.stringify(...))` 的地方替换为 `atomicWriteJSON()`。涉及文件：
- `engine/src/commands/portfolio.ts`
- `engine/src/commands/regime.ts`
- `engine/src/commands/keys.ts`
- `engine/src/commands/thesis.ts`
- `engine/src/commands/risk.ts`
- `engine/src/data/thesis.ts`
- `engine/src/data/shadow.ts`
- `engine/src/data/keys.ts`
- `engine/src/cache.ts`

### 2.3 可操作错误信息

**改造标准**：所有面向用户的错误输出从单纯的错误描述改为包含诊断建议的结构化 JSON。

```typescript
// 错误输出结构
interface ActionableError {
  error: string;        // 人类可读的错误描述
  source?: string;      // 数据源标识（yahoo / fred / edgar 等）
  reason?: string;      // 技术原因
  suggestion: string;   // 用户应该做什么
  cached?: {            // 如果有过期缓存数据，附上
    data: unknown;
    age: string;        // 人类可读的缓存年龄，如 "47 分钟前"
  };
}
```

**实现方式**：在 `cli.ts` 的 catch 块中统一处理，各命令抛出的 Error 可以携带 `suggestion` 和 `source` 属性（通过自定义 FinstackError 类）。

```typescript
// engine/src/errors.ts
class FinstackError extends Error {
  constructor(
    message: string,
    public source?: string,
    public reason?: string,
    public suggestion?: string,
    public cached?: { data: unknown; age: string },
  ) {
    super(message);
  }
}
```

### 2.4 数据源降级链

**改造方式**：不引入 abstract DataProvider 接口（过度设计）。在需要降级的命令中，使用简单的 try-catch 链。

以 `quote` 命令为例：

```typescript
async function fetchQuoteWithFallback(ticker: string) {
  // 1. 尝试主数据源
  try {
    return await fetchFromYahoo(ticker);
  } catch (e) {
    // 2. 尝试备选数据源（如果配置了 key）
    const polygonKey = getKey('polygon');
    if (polygonKey) {
      try {
        return await fetchFromPolygon(ticker, polygonKey);
      } catch {}
    }
    // 3. 返回缓存数据 + 警告
    const cached = readCache(`quote-${ticker}`);
    if (cached) {
      return { ...cached.data, _stale: true, _cacheAge: formatAge(cached.timestamp) };
    }
    // 4. 全部失败
    throw new FinstackError(
      `无法获取 ${ticker} 报价`,
      'yahoo',
      e.message,
      '稍后重试，或配置备选数据源: finstack keys set polygon YOUR_KEY'
    );
  }
}
```

**降级链定义**（各数据类型）：

| 数据类型 | 优先级 1 | 优先级 2 | 优先级 3 | 最终降级 |
|----------|----------|----------|----------|----------|
| Quote | Yahoo | Polygon | — | 缓存 + 警告 |
| Financials | Yahoo | FMP（新增） | — | 缓存 + 警告 |
| History | Yahoo | Polygon | — | 缓存 + 警告 |
| Earnings | Alpha Vantage | Yahoo calendarEvents | — | 缓存 + 警告 |
| Macro | FRED | — | — | 缓存 + 警告 |
| Filing | SEC EDGAR | — | — | 缓存 + 警告 |

### 2.5 FMP（Financial Modeling Prep）数据源

**新增文件**：`engine/src/data/fmp.ts`

FMP 免费层提供 250 次/天 API 调用，覆盖财务数据。作为 Yahoo Financials 的降级备选。

```typescript
const FMP_BASE = 'https://financialmodelingprep.com/api/v3';

export async function fetchFMPFinancials(ticker: string, apiKey: string) {
  const [profile, ratios] = await Promise.all([
    fetchWithRetry(`${FMP_BASE}/profile/${ticker}?apikey=${apiKey}`),
    fetchWithRetry(`${FMP_BASE}/ratios-ttm/${ticker}?apikey=${apiKey}`),
  ]);
  // 转换为 finstack 统一的 financials 格式
}
```

API key 通过 `finstack keys set fmp YOUR_KEY` 管理，与现有 key 基础设施一致。

### 2.6 FINSTACK_HOME 环境变量

当前所有数据存储路径硬编码为 `~/.finstack/`。新增环境变量支持，使数据目录可配置：

```typescript
// engine/src/paths.ts
export const FINSTACK_HOME = process.env.FINSTACK_HOME || join(homedir(), '.finstack');
export const CACHE_DIR = join(FINSTACK_HOME, 'cache');
export const JOURNAL_DIR = join(FINSTACK_HOME, 'journal');
// ... 所有路径基于 FINSTACK_HOME 派生
```

所有现有文件中的 `~/.finstack/` 硬编码路径替换为 `FINSTACK_HOME` 常量引用。

这解决两个问题：
1. E2E 测试可以指向临时目录，不污染用户数据
2. 用户可以将数据目录放在 Dropbox/iCloud 等同步盘中

### 2.7 Yahoo Finance 加固

现有 `yahoo.ts` 的 crumb 机制需要加固：

- crumb 缓存加 TTL（30 分钟过期，强制重新获取）
- getCrumb() 失败时清除缓存的 crumb/cookie，下次重试全流程
- 所有 Yahoo 请求经过 `fetchWithRetry()`
- User-Agent 轮换（预设 3 个常见 UA 字符串，随机选择）

### 2.6 版本校验

engine binary 启动时（`cli.ts` 的 `main()` 入口）：

1. 读取 `engine/dist/.version`（构建时写入的 git hash）
2. 尝试读取源码目录的 `git rev-parse HEAD`（如果源码可访问）
3. 如果不匹配，在 stderr 输出警告：`⚠ engine binary 版本过旧 (built: abc123, current: def456)，请运行: bun run build`
4. 不阻断执行，仅警告

### 2.7 缓存层加固

在现有 `cache.ts` 上增加两个能力：

**缓存版本号**：

```typescript
interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
  _v: number;  // 新增：缓存版本号
}

const CACHE_VERSION = 2;  // 全局版本号，数据格式变更时递增
// 读取缓存时，如果 _v !== CACHE_VERSION，视为过期
```

**缓存降级**：

```typescript
function readCacheWithFallback<T>(key: string, ttl: number): { data: T; stale: boolean; age: string } | null
// 正常 TTL 内：返回 { data, stale: false }
// 超过 TTL 但文件存在：返回 { data, stale: true, age: "2 小时前" }
// 文件不存在：返回 null
```

### 2.8 Watchlist 命令

**新增文件**：`engine/src/commands/watchlist.ts`

```bash
finstack watchlist                          # 显示完整 watchlist
finstack watchlist add NVDA "等Q2财报后判断"  # 添加，附带理由
finstack watchlist add NVDA --thesis t_abc   # 关联已有论文
finstack watchlist remove NVDA               # 移除
finstack watchlist tag NVDA semiconductor    # 打标签
finstack watchlist untag NVDA semiconductor  # 移除标签
```

**存储结构**：`~/.finstack/watchlist.json`

```typescript
interface WatchlistEntry {
  ticker: string;
  addedAt: string;              // ISO 日期
  reason: string;               // 为什么关注
  tags: string[];               // 用户自定义标签
  linkedThesis: string | null;  // 关联的 thesis ID
  alerts: WatchlistAlert[];     // 提醒条件
}

interface WatchlistAlert {
  type: 'price' | 'earnings' | 'date';
  condition?: 'above' | 'below';  // price 类型
  value?: number;                  // price 类型的目标价
  date?: string;                   // date/earnings 类型
  note: string;                    // 用户备注
  triggered: boolean;              // 是否已触发
  triggeredAt?: string;            // 触发时间
}
```

使用 `atomicWriteJSON` 写入，`readJSONSafe` 读取。

### 2.9 提醒系统

**新增文件**：`engine/src/commands/alerts.ts`

```bash
finstack alerts                    # 显示所有待触发提醒
finstack alerts --due 7            # 未来 7 天内到期的
finstack alerts --source thesis    # 仅论文相关提醒
finstack alerts --source watchlist # 仅 watchlist 提醒
finstack alerts --source earnings  # 仅财报日期提醒
```

**提醒来源聚合**：

1. **Watchlist alerts**：遍历 watchlist.json，检查价格条件（需调用 quote）和日期条件
2. **Thesis deadlines**：遍历 theses.json，提取 `obituaryDueDate` 和 conditions 中的 `resolveBy`
3. **Earnings dates**：对持仓 + watchlist 中的 ticker，查询下次财报日期（Phase 1 使用 Yahoo calendarEvents module 获取基本日期；Phase 2 升级为 Alpha Vantage + calendar 命令提供更完整的数据）

输出 JSON 数组，按紧急程度排序（已过期 > 今天 > 未来 3 天 > 未来 7 天 > 更远）。

### 2.10 `/sense` Skill 改造

修改 `sense/SKILL.md`，扩展数据收集步骤：

**原来的数据收集**：
1. 读取持仓
2. 扫描 trending
3. 获取 macro
4. 检查 thesis 威胁

**改造后**：
1. 读取持仓
2. 读取 watchlist（`$F watchlist`）
3. 检查提醒（`$F alerts --due 7`）
4. 扫描 trending
5. 获取 macro
6. 检查 thesis 威胁

**输出结构调整**（在 SKILL.md 的输出格式指引中修改）：

```
需要立即关注 (N)
  [持仓/watchlist中有 alerts 触发或即将触发的]

值得留意 (N)
  [持仓异动 + watchlist 价格变化 + thesis 状态变化]

背景信息
  [Trending + Macro 概况]

未来 7 天关键日期
  [财报、论文到期、watchlist 日期提醒]
```

### 2.11 CLI 注册

在 `cli.ts` 中注册新命令：

```typescript
import { watchlist } from './commands/watchlist';
import { alerts } from './commands/alerts';

const commands = {
  // ...existing...
  watchlist,
  alerts,
};
```

Help 输出更新：

```
  watchlist [add|remove|tag|untag]    Watchlist management
  alerts [--due N] [--source S]      Check pending alerts
```

### 2.12 Phase 1 测试清单

**单元测试**（`engine/test/`）：

- `net.test.ts`：超时触发、重试逻辑（mock fetch）、退避时间验证
- `fs.test.ts`：原子写入（验证 rename 而非直接写入）、readJSONSafe 容错
- `errors.test.ts`：FinstackError 序列化、suggestion 字段传递
- `watchlist.test.ts`：增删改查、alert 触发逻辑、关联 thesis
- `alerts.test.ts`：多来源聚合、排序逻辑、日期计算
- `cache.test.ts`：版本号校验、降级读取

**集成测试**：

- Yahoo 降级到 Polygon 到缓存的完整链路（mock 各数据源按序失败）
- Watchlist + alerts + thesis 的交叉引用正确性

---

## 3. Phase 2：日常骨架 + 工程纪律（v0.4.0）

### 3.1 筛选器

**新增文件**：
- `engine/src/commands/screen.ts` — 筛选命令
- `engine/src/data/universe.ts` — 内置 ticker 列表
- `engine/src/data/presets.ts` — 预设筛选条件
- `screen/SKILL.md` — `/screen` skill

**Universe 数据**：

`universe.ts` 内置 S&P 500 + NASDAQ 100 成分股（去重后约 550-600 个 ticker）。以静态数组存储，附带最后更新日期。

```typescript
export const SP500: string[] = ['AAPL', 'MSFT', 'AMZN', /* ... */];
export const NASDAQ100: string[] = ['AAPL', 'MSFT', /* ... */];
export const UNIVERSE_UPDATED = '2026-04-07';

export function getUniverse(name?: string): string[] {
  // 'sp500' | 'nasdaq100' | 'all' | undefined → 去重 ticker 列表
  // 用户也可以通过 --universe NVDA,AMD,INTC 自定义
}
```

**筛选语法解析**：

```typescript
interface ScreenFilter {
  field: string;       // financials 字段名
  op: '>' | '<' | '>=' | '<=' | '=' | '!=';
  value: number | string;
}

function parseFilters(query: string): ScreenFilter[]
// "marketCap<50e9 grossMargin>0.4 sector=Technology"
// → [{ field: 'marketCap', op: '<', value: 50e9 }, ...]
// 支持科学计数法，字符串值不需要引号（sector=Technology）
```

**执行流程**：

1. 确定 universe（默认 all，可 --universe 或 --preset 覆盖）
2. 批量获取 financials（并行，限速 5 并发，带缓存 1h TTL）
3. 内存过滤 + 排序（默认按 marketCap 降序）
4. 输出 JSON 结果

**限速控制**：

```typescript
async function batchFetch<T>(
  tickers: string[],
  fetcher: (ticker: string) => Promise<T>,
  concurrency: number = 5,
): Promise<Map<string, T>>
// 使用简单的信号量模式控制并发
// 单个 ticker 失败不影响其他 ticker（catch 并记录错误）
```

**预设**：

```typescript
const presets: Record<string, string> = {
  growth:   "revenueGrowth>0.15 grossMargin>0.4 marketCap>5e9",
  value:    "trailingPE<20 priceToBook<3 dividendYield>0.01 marketCap>2e9",
  dividend: "dividendYield>0.03 payoutRatio<0.7 debtToEquity<1.5 marketCap>5e9",
};
```

**CLI**：

```bash
finstack screen "marketCap<50e9 grossMargin>0.4 sector=Technology"
finstack screen --preset growth
finstack screen --preset growth "sector=Technology"  # 预设 + 追加条件
finstack screen "grossMargin>0.5" --universe NVDA,AMD,INTC,TSM,ASML
finstack screen "revenueGrowth>0.2" --sort revenueGrowth --limit 10
```

### 3.2 Earnings Calendar

**修改文件**：`engine/src/commands/earnings.ts`

扩展现有 earnings 命令，新增 `--upcoming` flag 和独立的 `calendar` 命令。

```bash
finstack earnings NVDA              # 已有：历史 earnings（8 季度）
finstack earnings NVDA --upcoming   # 新增：下次财报日期 + 预期
finstack calendar                   # 新增：未来 30 天所有持仓 + watchlist 的财报
finstack calendar --range 90        # 未来 90 天
```

**新增文件**：`engine/src/commands/calendar.ts`

```typescript
async function calendar(args: string[]) {
  const range = parseRangeArg(args) || 30;  // 默认 30 天
  
  // 获取所有需要追踪的 ticker
  const portfolio = readJSONSafe(PORTFOLIO_PATH, { positions: [] });
  const watchlist = readJSONSafe(WATCHLIST_PATH, []);
  const tickers = dedupe([
    ...portfolio.positions.map(p => p.ticker),
    ...watchlist.map(w => w.ticker),
  ]);
  
  // 批量获取 earnings 日期
  const results = await batchFetch(tickers, fetchUpcomingEarnings, 5);
  
  // 过滤未来 N 天内的
  // 按日期排序输出
}
```

**数据源降级**：
1. Alpha Vantage earnings calendar（如果有 key）
2. Yahoo `calendarEvents` module（通过 quoteSummary）
3. 缓存

**与 `/sense` 集成**：`/sense` 的提醒检查中，财报前 3 天的 ticker 自动标记为高优先级。如果该 ticker 有关联的 thesis，提示"论文即将迎来验证时刻"。

### 3.3 ARCHITECTURE.md

**新增文件**：项目根目录 `ARCHITECTURE.md`

结构：

```markdown
# finstack Architecture

## Design Philosophy
- 双层架构：Cognitive Layer (skills) + Data Layer (engine)
- 认知循环：Sense → Research → Judge → Act → Cascade → Track → Reflect
- 数据分层：Tier 0 (免费) → Tier 1 (免费 key) → Tier 2 (付费)

## System Architecture
- Engine: Bun 编译的 standalone binary
- Skills: Claude Code SKILL.md prompt 文件
- Storage: ~/.finstack/ (git-tracked journal + JSON state)
- Cache: TTL-based, version-stamped, graceful degradation

## Data Flow
[每个 skill 如何调用 engine，engine 如何调用数据源]

## Storage Schema
[每个 JSON 文件的结构和用途]

## Network Reliability
[超时、重试、降级策略]

## Security Model
[API key 存储、文件权限、日志脱敏]

## Testing Strategy
[三层测试：单元 / 集成 / E2E skill]
```

### 3.4 操作学习系统

**新增文件**：
- `engine/src/commands/learn.ts` — 学习管理命令
- `engine/src/data/learnings.ts` — 学习存储层

**存储**：`~/.finstack/learnings.jsonl`（append-only）

```typescript
interface Learning {
  id: string;              // 自增 ID
  timestamp: string;       // ISO 时间
  skill: string;           // 哪个 skill 产生的
  type: 'error' | 'workaround' | 'insight';
  summary: string;         // 一句话描述
  detail: string;          // 详细上下文
  tags: string[];          // 便于检索
}
```

**CLI**：

```bash
finstack learn search "yahoo crumb"     # 搜索历史学习
finstack learn search --skill sense     # 按 skill 过滤
finstack learn recent --limit 5         # 最近 5 条
finstack learn add "yahoo API 需要新 UA" --skill sense --type workaround
```

**Skill 集成**：每个 SKILL.md 的末尾添加"学习沉淀"步骤：

```markdown
## Step N: 学习沉淀（自动执行）

回顾本次执行中遇到的：
- 数据源错误或降级
- 非预期的输出格式
- 用户纠正的判断

如果有值得记录的，调用：
$F learn add "<summary>" --skill <当前skill> --type <error|workaround|insight>
```

**加载**：每个 skill 启动时（Step 1 数据收集阶段），调用 `$F learn search --skill <当前skill> --limit 3` 获取最近 3 条相关学习，作为上下文。

### 3.5 E2E Skill 测试框架

**新增目录**：`test/skill-e2e/`

**设计**：

```
test/skill-e2e/
├── runner.ts           # 通过 claude -p 执行 skill，解析 NDJSON
├── sense.test.ts       # /sense E2E 测试
├── judge.test.ts       # /judge E2E 测试
├── screen.test.ts      # /screen E2E 测试
└── fixtures/           # 测试用的固定数据
    ├── portfolio.json
    ├── watchlist.json
    └── theses.json
```

**Runner 核心**：

```typescript
async function runSkill(skillName: string, prompt: string, opts?: {
  timeout?: number;      // 默认 5 分钟
  fixtures?: string;     // fixture 目录路径
}): Promise<SkillResult> {
  // 1. 创建临时 ~/.finstack-test/ 目录
  // 2. 复制 fixtures 到临时目录
  // 3. 设置 FINSTACK_HOME 环境变量指向临时目录
  // 4. 执行 claude -p --output-format stream-json "/${skillName} ${prompt}"
  // 5. 解析 NDJSON 输出
  // 6. 返回结构化结果
  // 7. 清理临时目录
}

interface SkillResult {
  success: boolean;
  transcript: string;          // 完整对话文本
  toolCalls: ToolCall[];       // 所有工具调用记录
  engineCommands: string[];    // 提取的 $F 命令列表
  journalEntries: string[];   // 写入 journal 的文件
  duration: number;
  cost: { input: number; output: number; usd: number };
}
```

**测试示例**：

```typescript
// sense.test.ts
import { test, expect } from 'bun:test';
import { runSkill } from './runner';

test('/sense 读取 watchlist 并检查 alerts', async () => {
  const result = await runSkill('sense', '', {
    fixtures: 'test/skill-e2e/fixtures',
    timeout: 300_000,
  });
  
  expect(result.success).toBe(true);
  expect(result.engineCommands).toContain('watchlist');
  expect(result.engineCommands).toContain('alerts');
  expect(result.journalEntries.length).toBeGreaterThan(0);
}, { timeout: 360_000 });
```

**门控**：

```bash
bun test                    # 仅单元测试 + 集成测试（快，免费）
EVALS=1 bun test           # 包含 E2E skill 测试（慢，消耗 API）
```

### 3.6 Phase 2 测试清单

- `screen.test.ts`：筛选语法解析、预设合并、universe 过滤、批量并发控制
- `calendar.test.ts`：日期范围计算、多来源聚合、排序
- `learn.test.ts`：JSONL append、搜索匹配、按 skill 过滤
- `universe.test.ts`：去重、自定义 universe 解析

---

## 4. Phase 3：可视化 + 安全加固（v0.5.0）

### 4.1 HTML 报告引擎

**新增文件**：
- `engine/src/commands/report.ts` — 报告生成命令
- `engine/src/report/templates.ts` — HTML 模板函数
- `engine/src/report/charts.ts` — Chart.js 数据转换

**设计原则**：
- 零外部依赖：HTML 模板是 TypeScript 模板字符串，不用模板引擎
- CDN 引入：Tailwind CSS（CDN）+ Chart.js（CDN）内联在 HTML 中
- 单文件输出：每个报告是一个独立的 .html 文件，无外部资源依赖
- 自动打开：生成后调用 `open`（macOS）/ `xdg-open`（Linux）

**CLI**：

```bash
finstack report sense                   # 今日信号报告
finstack report track                   # 组合绩效报告
finstack report track NVDA              # 单个 ticker 决策报告
finstack report reflect                 # 行为回顾报告
finstack report cascade <event-slug>    # cascade 分析报告
finstack report --no-open               # 生成但不自动打开
```

**输出目录**：`~/.finstack/reports/`

**文件命名**：`{type}-{date}.html`（如 `track-2026-04-07.html`）

**报告内容**：

| 报告类型 | 图表 | 数据表 |
|----------|------|--------|
| sense | 持仓热力图（涨跌色块）、提醒时间线 | watchlist 状态、alerts 列表 |
| track | 组合收益曲线 vs SPY（折线图）、sector 权重饼图、alpha 分解柱状图 | 持仓明细、论文状态 |
| track {ticker} | 价格走势 + 买卖点标注 | 决策时间线、偏差记录 |
| reflect | 行为模式雷达图、运气/技能四象限散点图 | 模式列表、决策复盘 |
| cascade | 因果链树状图（多层级）、确定性色带 | 链条明细、组合暴露 |

**模板结构**（以 track 报告为例）：

```typescript
function renderTrackReport(data: TrackReportData): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>finstack — Portfolio Track Report ${data.date}</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
</head>
<body class="bg-gray-950 text-gray-100 p-8 font-mono">
  <header>...</header>
  <section id="alpha">
    <canvas id="alphaChart"></canvas>
    <script>
      new Chart(document.getElementById('alphaChart'), ${JSON.stringify(data.alphaChartConfig)});
    </script>
  </section>
  ...
</body>
</html>`;
}
```

**Skill 集成**：每个相关 skill 在输出末尾调用报告生成：

```markdown
## Step N: 生成报告

$F report <type>
告知用户报告已生成并在浏览器中打开。
```

### 4.2 相关性矩阵

**新增文件**：`engine/src/commands/correlate.ts`

```bash
finstack correlate                    # 持仓间相关性（默认 90 天）
finstack correlate --period 180       # 自定义周期
finstack correlate --include-watchlist  # 包含 watchlist ticker
```

**算法**：

```typescript
function pearsonCorrelation(x: number[], y: number[]): number {
  // 标准 Pearson 相关系数
  // 输入：两个 ticker 的日收益率序列（收盘价的日变化率）
  // 输出：-1 到 1 的相关系数
}

function correlationMatrix(tickers: string[], period: number): CorrelationResult {
  // 1. 对每个 ticker 获取历史收盘价（finstack history）
  // 2. 计算日收益率
  // 3. 对齐日期（取交集）
  // 4. 计算 N×N 相关系数矩阵
  // 返回矩阵 + 高相关对警告（|r| > 0.8）
}
```

**与 `/act` 集成**：`/act` 在做仓位决策时调用 `$F correlate`，如果新仓位与现有持仓相关性 > 0.8，输出警告：

```
⚠ 相关性警告：NVDA 与你的持仓 AMD 相关性为 0.87
这意味着它们会同涨同跌，增加集中风险。
```

**HTML 报告集成**：在 track 报告中渲染为热力图（红色=高正相关，蓝色=负相关，白色=无相关）。

### 4.3 安全回归测试

**新增文件**：`engine/test/security.test.ts`

```typescript
// API key 不泄露
test('keys.json 权限为 0600', () => { ... });
test('错误日志不包含 API key', () => { ... });
test('缓存文件不包含 API key', () => { ... });

// 路径安全
test('watchlist ticker 不能包含路径字符', () => { ... });
test('cache key 不能包含 ../', () => { ... });

// 输入验证
test('ticker 仅允许 A-Z0-9.-', () => { ... });
test('JSON 解析失败返回 fallback 而非崩溃', () => { ... });

// 原子写入验证
test('写入中断不会产生损坏的 JSON 文件', () => { ... });
```

### 4.4 CONTRIBUTING.md

**新增文件**：项目根目录 `CONTRIBUTING.md`

```markdown
# Contributing to finstack

## Development Setup
1. Clone the repo
2. bun install
3. bun run build
4. ./setup（注册 skills）

## Running Tests
- bun test（单元 + 集成）
- EVALS=1 bun test（含 E2E skill 测试，需要 Claude API）

## Adding a New Engine Command
1. 创建 engine/src/commands/{name}.ts
2. 在 cli.ts 中注册
3. 添加 engine/test/commands/{name}.test.ts
4. 更新 README.md 命令列表

## Adding a New Skill
1. 创建 {skill-name}/SKILL.md
2. 在 setup 脚本的 SKILLS 数组中添加
3. 可选：添加 test/skill-e2e/{skill}.test.ts

## Adding a New Data Source
1. 创建 engine/src/data/{source}.ts
2. 所有 fetch 使用 fetchWithRetry()
3. 在相关 command 的降级链中添加
4. 添加 engine/test/data/{source}.test.ts

## Code Standards
- 所有持久化写入使用 atomicWriteJSON()
- 错误使用 FinstackError（包含 suggestion 字段）
- API key 不出现在日志或错误信息中
- ticker 输入必须验证（仅 A-Z0-9.-）
```

### 4.5 CHANGELOG.md

**新增文件**：项目根目录 `CHANGELOG.md`

从 v0.2.0 起追溯记录，此后每个版本严格记录变更。

```markdown
# Changelog

## [0.3.0] — 2026-xx-xx
### Added
- 网络可靠性层：超时控制、指数退避重试
- 原子写入：所有 JSON 状态文件断电安全
- 可操作错误信息：每个错误附带诊断建议
- 数据源降级链：Yahoo → Polygon → 缓存
- Watchlist 管理命令
- 提醒系统（聚合 watchlist + thesis + earnings 日期）
- /sense 集成 watchlist 和 alerts
- 版本校验警告
- 缓存版本号和降级读取

### Changed
- 所有数据源请求经过 net.ts（超时 + 重试）
- Yahoo crumb 加 TTL + UA 轮换
- 错误输出格式：从纯文本到结构化 JSON

## [0.2.0] — 2026-04-07
### Added
- Cognitive Alpha Engine（shadow portfolio + alpha 计算）
- Thesis Falsification（论文生命周期管理）
- /track（审计层）
- Risk gate（持仓集中度检查 + position sizing）
- Portfolio risk dashboard

## [0.1.0] — 初始版本
### Added
- 7 个核心 skill：/sense、/research、/judge、/act、/cascade、/track、/reflect
- Engine 数据层：Yahoo、FRED、SEC EDGAR、Alpha Vantage、Polygon
- 论文条件系统（earnings + event 条件）
- Shadow portfolio 机制
- TTL 缓存系统
```

### 4.6 文档新鲜度校验

**新增文件**：`scripts/check-docs.ts`

```typescript
// 从 cli.ts 提取注册的命令列表
// 从 README.md 提取文档中的命令列表
// 对比，不一致则 exit(1) 并输出差异

// 从各 SKILL.md 提取引用的 $F 命令
// 验证每个引用的命令在 cli.ts 中确实存在
```

在 `package.json` 中添加脚本：

```json
"scripts": {
  "check:docs": "bun run scripts/check-docs.ts"
}
```

### 4.7 Phase 3 测试清单

- `report.test.ts`：HTML 生成有效性、Chart.js 配置正确性、文件输出路径
- `correlate.test.ts`：Pearson 计算准确性（用已知数据验证）、日期对齐逻辑
- `security.test.ts`：上述全部安全测试
- `check-docs.test.ts`：文档校验脚本本身的测试

---

## 5. Phase 4：高阶分析 + 工程完善（v0.6.0）

### 5.1 回测框架

**新增文件**：`engine/src/commands/backtest.ts`

**定义**：finstack 的回测不是传统量化回测（回测交易策略），而是"论文复盘"——检验过去的认知判断。

```bash
finstack backtest                     # 回测所有已关闭/已死的 thesis
finstack backtest --thesis t_abc      # 回测特定论文
finstack backtest --period 180        # 最近 180 天的论文
```

**流程**：

```typescript
async function backtestThesis(thesis: Thesis): Promise<BacktestResult> {
  // 1. 获取论文创建日到关闭日的历史价格
  const prices = await fetchHistory(thesis.ticker, thesis.createdAt, thesis.closedAt || today());
  
  // 2. 提取 shadow portfolio 中对应的仓位
  const shadow = findShadowEntry(thesis.id);
  
  // 3. 计算关键指标
  return {
    thesisId: thesis.id,
    ticker: thesis.ticker,
    thesis: thesis.thesis,
    verdict: thesis.verdict,
    holdingPeriod: daysBetween(shadow.entryDate, shadow.exitDate || today()),
    entryPrice: shadow.stagedPlan[0].price,
    exitPrice: shadow.exitPrice || currentPrice,
    returnPct: (exitPrice - entryPrice) / entryPrice * 100,
    maxDrawdown: calculateMaxDrawdown(prices, shadow.entryDate),
    spyReturn: await fetchSPYReturn(shadow.entryDate, shadow.exitDate || today()),
    alpha: returnPct - spyReturn,
    // 论文准确性
    conditionResults: thesis.conditions.map(c => ({
      condition: c.description,
      expected: c.operator + c.threshold,
      actual: c.resolvedValue,
      correct: c.resolved && c.met,
    })),
    // 执行纪律
    followedPlan: shadow.filledShares === shadow.totalShares,
    honoredStop: shadow.stopLoss ? checkStopHonored(prices, shadow) : null,
  };
}
```

**输出**：JSON + 可选 HTML 报告（`finstack report backtest`）。

### 5.2 情景分析

**新增文件**：`engine/src/commands/scenario.ts`

```bash
finstack scenario "rates+100bp"       # 利率上升 100 基点
finstack scenario "spy-20pct"         # 市场下跌 20%
finstack scenario "oil+30pct"         # 油价上涨 30%
finstack scenario custom --factors '{"SPY":-0.2,"USO":0.3}'  # 自定义因子
```

**实现**：

```typescript
// 预设情景
const scenarios: Record<string, ScenarioConfig> = {
  'rates+100bp':  { description: '利率上升100bp', factors: { SPY: -0.08, TLT: -0.15, GLD: 0.05, XLF: 0.03 } },
  'rates-100bp':  { description: '利率下降100bp', factors: { SPY: 0.05, TLT: 0.12, GLD: -0.03, XLF: -0.02 } },
  'spy-20pct':    { description: '市场下跌20%',  factors: { SPY: -0.20 } },
  'spy+20pct':    { description: '市场上涨20%',  factors: { SPY: 0.20 } },
  'oil+30pct':    { description: '油价上涨30%',  factors: { USO: 0.30, XLE: 0.15, SPY: -0.03 } },
  'recession':    { description: '经济衰退',     factors: { SPY: -0.30, TLT: 0.20, GLD: 0.15, XLU: 0.05 } },
};

async function analyzeScenario(config: ScenarioConfig): Promise<ScenarioResult> {
  const portfolio = readPortfolio();
  
  // 对每个持仓：
  // 1. 计算其历史 beta（相对 SPY，用 90 天数据）
  // 2. 基于 beta 和情景因子估算影响
  // 3. 如果持仓 ticker 直接在 factors 中，使用直接因子
  
  return {
    scenario: config.description,
    portfolioImpact: totalImpactDollars,
    portfolioImpactPct: totalImpactPct,
    positions: positionImpacts.sort((a, b) => a.impact - b.impact),  // 最受冲击的排前面
    hedgeSuggestions: generateHedgeSuggestions(positionImpacts),
  };
}
```

**限制说明**（诚实标注）：
- 基于历史 beta 估算，不是精确的风险模型
- 情景因子是经验值，不保证在实际危机中的准确性
- 目的是方向性参考，不是精确预测

### 5.3 周/月报

**新增文件**：
- `engine/src/commands/review.ts` — 报告数据汇总
- `review/SKILL.md` — `/review` skill（如果用户配置了 prefix 则是 `/finstack-review`）

```bash
finstack review --period week         # 过去 7 天
finstack review --period month        # 过去 30 天
finstack review --from 2026-03-01 --to 2026-03-31  # 自定义范围
```

**数据汇总**：

```typescript
interface ReviewData {
  period: { from: string; to: string };
  // 决策统计
  decisions: {
    newTheses: number;
    closedTheses: number;
    threatenedTheses: number;
    judgeCount: number;
    actCount: number;
  };
  // 绩效
  performance: {
    portfolioReturn: number;
    spyReturn: number;
    analyticalAlpha: number;
    executionDrag: number;
    netAlpha: number;
  };
  // 行为
  behavioral: {
    patternsTriggered: string[];
    deviations: Deviation[];
    newPatternsDetected: string[];
  };
  // 学习
  learnings: Learning[];
}
```

**Skill**：`/review` 会读取 `finstack review` 的 JSON 输出，生成叙述性周报/月报，并存入 journal。可选生成 HTML 报告。

### 5.4 多会话感知

**实现**：`engine/src/session.ts`

```typescript
const SESSION_DIR = join(FINSTACK_HOME, 'sessions');
const SESSION_FILE = join(SESSION_DIR, `${process.ppid}.json`);
const SESSION_TTL = 2 * 60 * 60 * 1000;  // 2 小时

function registerSession(skill: string) {
  mkdirSync(SESSION_DIR, { recursive: true });
  atomicWriteJSON(SESSION_FILE, {
    pid: process.pid,
    ppid: process.ppid,
    skill,
    startedAt: new Date().toISOString(),
  });
}

function getActiveSessions(): SessionInfo[] {
  // 读取 sessions/ 下所有文件
  // 过滤掉超过 TTL 的（清理过期文件）
  // 返回活跃会话列表
}

function cleanStaleSessions() {
  // 删除超过 TTL 的 session 文件
}
```

每个 engine 命令启动时调用 `registerSession()`。Skill 可以通过 `$F sessions` 查看并发情况。

### 5.5 CI 门控

在 `package.json` 中添加：

```json
"scripts": {
  "test": "bun test",
  "test:gate": "bun test && bun run check:docs",
  "test:periodic": "EVALS=1 bun test && bun run check:docs",
  "check:docs": "bun run scripts/check-docs.ts"
}
```

### 5.6 Phase 4 测试清单

- `backtest.test.ts`：回报计算、max drawdown、SPY 对比、条件验证
- `scenario.test.ts`：beta 计算、因子应用、预设情景正确性
- `review.test.ts`：周期计算、journal 文件解析、统计汇总
- `session.test.ts`：注册/清理/并发检测

---

## 6. 新增文件总览

### Phase 1（v0.3.0）
```
engine/src/net.ts                     # 网络可靠性层
engine/src/fs.ts                      # 原子写入
engine/src/errors.ts                  # FinstackError 类
engine/src/paths.ts                   # FINSTACK_HOME + 统一路径常量
engine/src/commands/watchlist.ts      # Watchlist 命令
engine/src/commands/alerts.ts         # 提醒系统
engine/src/data/fmp.ts                # Financial Modeling Prep 数据源
engine/test/commands/watchlist.test.ts
engine/test/commands/alerts.test.ts
engine/test/net.test.ts
engine/test/fs.test.ts
engine/test/errors.test.ts
```

### Phase 2（v0.4.0）
```
engine/src/commands/screen.ts         # 筛选器
engine/src/commands/calendar.ts       # Earnings calendar
engine/src/commands/learn.ts          # 操作学习
engine/src/data/universe.ts           # 内置 ticker 列表
engine/src/data/presets.ts            # 筛选预设
engine/src/data/learnings.ts          # 学习存储层
screen/SKILL.md                       # /screen skill
ARCHITECTURE.md                       # 架构文档
test/skill-e2e/runner.ts             # E2E 测试运行器
test/skill-e2e/sense.test.ts
test/skill-e2e/fixtures/
engine/test/commands/screen.test.ts
engine/test/commands/calendar.test.ts
engine/test/commands/learn.test.ts
```

### Phase 3（v0.5.0）
```
engine/src/commands/report.ts         # 报告生成
engine/src/commands/correlate.ts      # 相关性矩阵
engine/src/report/templates.ts        # HTML 模板
engine/src/report/charts.ts           # Chart.js 配置
scripts/check-docs.ts                # 文档校验
CONTRIBUTING.md
CHANGELOG.md
engine/test/commands/report.test.ts
engine/test/commands/correlate.test.ts
engine/test/security.test.ts
```

### Phase 4（v0.6.0）
```
engine/src/commands/backtest.ts       # 回测
engine/src/commands/scenario.ts       # 情景分析
engine/src/commands/review-cmd.ts     # 周/月报数据
engine/src/session.ts                 # 多会话感知
review/SKILL.md                       # /review skill
engine/test/commands/backtest.test.ts
engine/test/commands/scenario.test.ts
engine/test/commands/review.test.ts
engine/test/session.test.ts
```

### 修改的现有文件（贯穿所有 Phase）
```
engine/src/cli.ts                     # 注册新命令
engine/src/cache.ts                   # 版本号 + 降级读取
engine/src/data/yahoo.ts              # 加固 crumb + fetchWithRetry
engine/src/data/fred.ts               # fetchWithRetry
engine/src/data/edgar.ts              # fetchWithRetry
engine/src/data/alphavantage.ts       # fetchWithRetry
engine/src/data/polygon.ts            # fetchWithRetry
engine/src/data/keys.ts               # atomicWriteJSON
engine/src/data/thesis.ts             # atomicWriteJSON
engine/src/data/shadow.ts             # atomicWriteJSON
engine/src/commands/portfolio.ts      # atomicWriteJSON + 降级链
engine/src/commands/quote.ts          # 降级链
engine/src/commands/financials.ts     # 降级链
engine/src/commands/history.ts        # 降级链
engine/src/commands/earnings.ts       # --upcoming + 降级链
engine/src/commands/regime.ts         # atomicWriteJSON
engine/src/commands/risk.ts           # 相关性警告集成
engine/src/commands/keys.ts           # atomicWriteJSON
sense/SKILL.md                        # 集成 watchlist + alerts
act/SKILL.md                          # 集成 correlate 警告
track/SKILL.md                        # HTML 报告生成
reflect/SKILL.md                      # HTML 报告生成
cascade/SKILL.md                      # HTML 报告生成
setup                                 # 注册新 skills
package.json                          # 新脚本
README.md                             # 更新命令列表和功能描述
```

---

## 7. 不做的事情（YAGNI）

以下需求明确排除，避免范围蔓延：

1. **不做交易执行**——finstack 是研究部，不是交易台
2. **不做实时数据流**——CLI 工具，不需要 WebSocket
3. **不做多交易所**——A 股、港股不在范围内
4. **不做期权分析**——greeks、implied vol 需要专业定价库
5. **不做推送通知**——没有常驻进程，提醒在 /sense 中检查
6. **不做 Web UI**——CLI + HTML 报告足够
7. **不做 abstract DataProvider 接口**——13 个命令不需要插件架构
8. **不做 13F 机构持仓**——数据源复杂，收益不确定
9. **不做自然语言筛选**——Skill 层可以翻译，engine 接受结构化语法
10. **不做全市场 universe**——约 600 只大中盘股覆盖核心需求

---

## 8. 成功标准

每个 Phase 交付后，必须满足：

1. `bun test` 全部通过（包括新增测试）
2. `bun run check:docs` 通过（Phase 3 起）
3. 现有 7 个 skill 功能不回退
4. README.md 更新反映新功能
5. CHANGELOG.md 记录本版本变更
6. 新功能有对应的单元测试覆盖

Phase 2 起额外：
- `EVALS=1 bun test` 的 E2E skill 测试通过

Phase 3 起额外：
- 安全回归测试通过
- 文档新鲜度校验通过
