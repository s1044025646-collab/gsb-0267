# 小棋盘围棋提子与单劫后端

双人小棋盘围棋规则服务：TypeScript + Node.js + SQLite，仅提供 **HTTP API 与 CLI**，
不包含 AI、联网对战、贴目、终局数目与棋力评级。

## 规则取舍（本题范围）

- 棋盘：5 / 9 / 13 路，仅横竖四邻接。
- 坐标：`row`、`col` 均为 **1 基**；`row` 从上到下递增，`col` 从左到右递增。
  文档、API 与 CLI 完全一致。
- 落子：落到空点后，先同时移除所有因此无气的对方棋串（同一棋串从多个方向
  接触新子时只提取一次、只计数一次），再检查己方新棋串；提子后有气即合法，
  提子后仍无气的自杀落子拒绝。
- 单劫：固定的简单单劫——落子后的棋盘不得等于该手之前上上个局面
  （即禁止立即还原到对方上一手落子前的棋盘）。不实现全局同形禁着等其他规则。
- 停一手：记录为普通一手并切换行棋方，按普通一步更新比较历史
  （因此经过一次停手可以打破立即提回限制）；停手本身不触发单劫检查。
- 结束：连续两次停一手将对局标记为 `ended`，**不据此判定胜负**。
- 非法落子不改变棋盘、轮次、提子计数与历史。
- 测试棋盘：创建时可指定初始盘与先行方；仅校验尺寸、单元值（0/1/2）与
  已有棋串至少一口气，不推断其历史合法性。
- 回放：按创建时冻结的规则与初始盘重新执行保存的动作；历史查询为只读，
  不覆盖当前局面；不提供撤销与分支棋谱。

## 环境要求

- Windows 本地，Node.js >= 22.5（使用内置 `node:sqlite`，无需 Docker/WSL/外部服务）。
- 依赖仅 `typescript` 与 `@types/node`（开发依赖）。

## 常用命令

```powershell
npm install     # 安装依赖
npm run build   # 编译到 dist/
npm test        # 构建并运行全部测试
npm start       # 启动 HTTP 服务（默认自动选择空闲端口）
npm run demo    # 5 路小盘规则演示（提多串/自杀/单劫/停手结束）
```

端口配置：`--port 8080` 或环境变量 `PORT`；缺省为 0（操作系统分配空闲端口）。
数据目录：项目内 `data/`（可用 `DATA_DIR` / `DB_PATH` 环境变量覆盖），重启后继续对局。

## HTTP API

所有响应为 JSON；错误统一为 `{ "error": { "code", "message" } }`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/games` | 创建对局 `{size, initialBoard?, initialTurn?}` |
| GET | `/games` | 列出对局 |
| GET | `/games/:id` | 查看当前状态 |
| GET | `/games/:id/groups` | 查看全部棋串及去重后的气 |
| POST | `/games/:id/preview` | 预览落子 `{row,col}`，不写入 |
| POST | `/games/:id/moves` | 确认落子 `{row,col,expectedSeq}` |
| POST | `/games/:id/pass` | 停一手 `{expectedSeq}` |
| GET | `/games/:id/replay?to=N` | 回放到第 N 手（缺省最新），只读 |
| GET | `/games/:id/export` | 导出棋谱 JSON |

`expectedSeq` 为期望的下一手步号（当前手数 + 1）；不一致返回 `409 SEQ_CONFLICT`。

### 错误码

`INVALID_SIZE` `INVALID_BOARD` `BAD_REQUEST` `OUT_OF_BOUNDS` `OCCUPIED`
`SUICIDE` `KO` `GAME_OVER` `SEQ_CONFLICT`(409) `NOT_FOUND`(404) `REPLAY_FAILED`

### 示例

```powershell
# 创建 9 路对局（黑先行）
curl -X POST http://127.0.0.1:8080/games -H "Content-Type: application/json" -d '{"size":9}'
# 黑落 (4,4)，期望第 1 手
curl -X POST http://127.0.0.1:8080/games/<id>/moves -H "Content-Type: application/json" -d '{"row":4,"col":4,"expectedSeq":1}'
```

棋盘在 API 中用长度 `size*size` 的一维数组表示（行优先，`0` 空 / `1` 黑 / `2` 白），
单元 `(row,col)` 对应下标 `(row-1)*size + (col-1)`。

## CLI

```powershell
node dist/src/cli.js create 9                 # 创建 9 路对局
node dist/src/cli.js list                     # 列出对局
node dist/src/cli.js show <id>                # 查看棋盘
node dist/src/cli.js groups <id>              # 查看棋串与气
node dist/src/cli.js preview <id> 4 4         # 预览落子（不写入）
node dist/src/cli.js move <id> 4 4 1          # 确认落子（期望步号 1）
node dist/src/cli.js pass <id> 2              # 停一手
node dist/src/cli.js replay <id> 3            # 回放到第 3 手
node dist/src/cli.js export <id>              # 导出棋谱 JSON
```

显示中 `X`=黑，`O`=白；行列号均为 1 基。

## 项目结构

```
src/engine.ts   规则引擎（棋串/气/提子/自杀/单劫，纯函数）
src/store.ts    SQLite 持久化（games + moves，合法落子事务提交）
src/service.ts  对局服务（创建/预览/确认/停手/回放/导出）
src/api.ts      HTTP API（node:http）
src/cli.ts      命令行界面
src/demo.ts     可手工核对的 5 路演示
test/           node:test 测试
data/           SQLite 数据目录（运行时生成）
```

## 限制

- 不判定胜负、不数子/数目、无贴目；连续两停仅标记对局结束。
- 仅简单单劫，无全局同形禁着。
- 无撤销、无分支棋谱；单进程服务，未做并发锁（依靠 SQLite 事务保证原子性）。
