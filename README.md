# 小棋盘围棋规则服务（5/9/13 路）

双人本地围棋后端，只做**落子合法性、提子、单劫、停一手与对局回放**。
提供 HTTP API 与命令行（CLI）两种使用方式。

- 技术栈：TypeScript + Node.js（内置 `node:sqlite`，**零运行时第三方依赖**，无需 Docker/WSL）
- 存储：项目内 `data/go.sqlite`（WAL 模式），合法落子事务原子提交，重启后按保存动作重放继续对局
- 平台：Windows 本地直接运行（Node.js ≥ 22.5，开发机实测 v25.5.0）

## 明确不做的范围

- 不实现 AI、联网对战、账号系统
- 不计算贴目、终局数目、棋力评级
- **连续两次停一手只把对局标记为结束（`over=true, endReason="two-passes"`），不判定任何一方获胜**，响应中不存在 `winner` 字段
- 只实现固定的简单单劫（见下），**不实现全局同形禁着（Superko）**，不区分中日韩等地区规则的其他差异
- 不支持撤销、分支棋谱

## 规则与坐标约定

- 棋盘尺寸仅支持 **5、9、13**。
- 坐标为 **1 基整数**：`row` 行从上到下 `1..size`，`col` 列从左到右 `1..size`；文档、API、CLI 完全一致。
- 棋子：`"B"` 黑、`"W"` 白、`null` 空点。黑先（测试棋盘可用 `firstPlayer` 显式指定白先）。
- 相邻仅指**横竖四个方向**，不含对角。

### 棋串与气

从空点落子后，按顺序判定：

1. 越界（`OUT_OF_BOUNDS`）或点已占用（`POINT_OCCUPIED`）直接拒绝；
2. 在空位放子，检查四个相邻点上的**对方棋串**；无气的对方棋串同时移除；
3. 一个对方棋串可能从多个方向接触新子——棋串按种子去重，**不会被重复提取或重复计数**；多个互不相连的对方棋串可在同一手被一起提走；
4. 提子完成后再检查己方新棋串：有气则合法；仍无气则为自杀（`SUICIDE`），拒绝且不留任何痕迹；
5. 单劫检查（`KO`）：落子后的棋盘不能等于“该手之前上上个局面”，即禁止立即还原到对方上一手落子前的棋盘。别处走一手或停一手后该限制自然解除。

### 停一手（pass）

- 停一手也记录为一步并切换行棋方，按普通一步推进局面历史（棋盘内容不变），从而**经过一次停手即可打破立即提回限制**；
- 停手本身棋盘未变，**不触发单劫检查**；
- 连续两次停一手：对局结束（不判胜负）。

### 测试棋盘

创建对局时可从空盘开始，也可传入显式初始棋盘（`grid`）与 `firstPlayer`。
服务会校验：尺寸合法、单元值仅为 `B/W/null`、每个已有棋串至少有一口气；
**不推断该棋盘的历史落子是否合法**（不检查其历史劫态）。重放历史时沿用创建时冻结的规则版本 `rulesVersion` 与初始棋盘。

## 错误码

| HTTP | code | 含义 |
| --- | --- | --- |
| 400 | `VALIDATION` | 参数缺失或格式错误 |
| 404 | `NOT_FOUND` | 对局不存在 / 未知接口 |
| 409 | `CONFLICT` | `expectedMove` 与当前步号不一致（过期请求） |
| 422 | `OUT_OF_BOUNDS` | 落子越界 |
| 422 | `POINT_OCCUPIED` | 落点已有棋子 |
| 422 | `SUICIDE` | 自杀落子 |
| 422 | `KO` | 违反简单单劫 |
| 422 | `NOT_YOUR_TURN` | 轮次不属于该方 |
| 422 | `GAME_OVER` | 对局已因两次停手结束 |

非法落子在数据库事务内整体回滚，棋盘、轮次、提子计数、历史均不变。

## 构建、测试、启动、演示

```powershell
# 安装开发依赖（仅 typescript 与类型声明；运行时零依赖）
npm install

# 构建（输出到 dist/）
npm run build

# 运行全部测试（规则引擎 13 项 + 存储重放 5 项 + HTTP API 3 项）
npm test

# 启动 HTTP 服务：默认自动选择一个空闲端口，启动时打印实际端口
npm start
# 或指定端口 / 数据目录
$env:PORT="8080"; $env:GO_DATA_DIR="E:\GSB\0267\B\data"; npm start

# 自动演示六个可手工核对的小场景
npm run demo
```

## HTTP API

所有请求/响应均为 JSON。写操作需带 `expectedMove`（客户端看到的当前步号）做乐观并发控制。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/health` | 健康检查 |
| `POST` | `/api/games` | 创建对局 `{size, grid?, firstPlayer?}` |
| `GET` | `/api/games` | 对局列表 |
| `GET` | `/api/games/:id` | 当前局面（棋盘、轮次、提子、是否结束） |
| `GET` | `/api/games/:id/groups` | 全部棋串及各自不重复气 |
| `POST` | `/api/games/:id/preview` | 预览落子，**不写入** |
| `POST` | `/api/games/:id/moves` | 确认落子 `{player, expectedMove, point:{row,col}}` |
| `POST` | `/api/games/:id/pass` | 停一手 `{player, expectedMove}` |
| `GET` | `/api/games/:id/moves/:n` | 查询第 `n` 手后的棋盘（只读，不影响当前局面） |
| `GET` | `/api/games/:id/record` | 导出棋谱 JSON（初始盘、每手动作与提子、终盘） |
| `GET` | `/api/games/:id/verify` | 按保存动作重放并逐手核对局面摘要 |

### PowerShell 调用示例

```powershell
$g = Invoke-RestMethod -Method Post http://127.0.0.1:8080/api/games -ContentType 'application/json' -Body '{"size":5}'
Invoke-RestMethod -Method Post "http://127.0.0.1:8080/api/games/$($g.id)/preview" `
  -ContentType 'application/json' -Body '{"player":"B","point":{"row":1,"col":1}}'
Invoke-RestMethod -Method Post "http://127.0.0.1:8080/api/games/$($g.id)/moves" `
  -ContentType 'application/json' -Body '{"player":"B","expectedMove":0,"point":{"row":1,"col":1}}'
```

## CLI

CLI 直接访问同一服务层与 SQLite 库（默认 `data/go.sqlite`，可用 `GO_DATA_DIR` 覆盖）：

```powershell
npm run cli -- create --size 5
npm run cli -- create-test --size 5 --first B --grid '[[null,"B",null,null,null],...]'
npm run cli -- list
npm run cli -- show <gameId>
npm run cli -- groups <gameId>
npm run cli -- preview <gameId> B 1 1
npm run cli -- place <gameId> B 1 1 --expected 0
npm run cli -- pass <gameId> B --expected 1
npm run cli -- at <gameId> 2          # 第 2 手后的棋盘
npm run cli -- record <gameId> --out record.json
npm run cli -- verify <gameId>
```

棋盘渲染中 `●` 为黑、`○` 为白、`·` 为空点，顶部为列号、左侧为行号。

## 数据库

- `games`：初始盘（紧凑字符串快照）、尺寸、冻结规则版本、初始行棋方、当前步号、轮次、双方提子数、结束标记。
- `moves`：每手动作（落子坐标或停手）、被提坐标数组、落子后局面摘要。

重启加载时不信任缓存状态，而是读取初始盘与动作序列，用同一规则引擎重新执行；
`/verify` 再将重放结果与落库的每手局面摘要逐格比对。

## 关键取舍

- 单劫只比较“上上个局面”，实现固定且可预测；不覆盖循环劫、多劫、长生等同形再现。
- 提子计数按“被移除棋子总数”累计到落子方（`captures.B / captures.W`），不做目数换算。
- 预览接口纯计算，不开启写事务，绝不改变对局。
- 历史局面查询返回副本，不会覆盖当前局面。
