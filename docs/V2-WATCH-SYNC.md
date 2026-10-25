# V2 第二阶段：观看历史与播放进度同步

第一阶段已于 2026-10-25 验收并提交 `a64c4fd`（添加账号与观看档案）。本阶段沿用账号/档案/会话、V1 UI 与原播放器，不开发首页「继续观看」。2026-10-25 第二阶段已人工验收通过；用户确认手机登录同一账号可看到同步历史。

## 改动范围与现有数据流

原播放器每隔数秒调用 `saveProgress` / `updateHistoryProgress`，暂停、隐藏、退出也保存，播放结束调用 `clearProgress`；历史抽屉调用 `removeHistory` / `clearAllHistory`。本阶段在这些共享入口内加入与数据同事务的持久化队列，不替换 ArtPlayer / hls.js 或改写搜索、广告过滤、自动连播、换源、IPTV 解析。

- `src/server/database.ts`：现有 SQLite migration 2。
- `src/server/watch.ts`：记录校验、递增版本、幂等处理、冲突、墓碑与清空屏障。
- `src/app/api/watch/route.ts`：分页拉取与批量提交。
- `src/app/api/watch/import/route.ts`：确认导入及逐项计数。
- `src/server/http.ts`：请求读取器增加可选大小上限，原认证接口仍为 8KB。
- `src/lib/watch-types.ts`：纯数据类型与稳定身份键。
- `src/lib/db.ts`：Dexie v4、原数据安全升级、历史/进度与队列同事务保存。
- `src/lib/watch-sync.ts`：同步调度、离线重试、确认、冲突副本与恢复。
- `src/lib/watch-legacy.ts`：只读扫描原库、显式导入和导入检查点。
- `src/components/watch-sync.tsx`：轻量旧记录提示、同步状态与冲突确认。
- `src/components/auth.tsx`：当前账号和档案确认后启动/停止同步。
- `src/app/watch/page.tsx`：复用原回调，暂停及时提交、续播前有界检查同步。
- `src/components/history-panel.tsx`：沿用抽屉、主题与原删除/撤销操作，增加同步状态和完成提示。
- `src/lib/client-api.ts`：同源、当前档案上下文及请求取消/超时。
- 新增 server/watch、watch-local、watch-sync 测试；更新原迁移/隔离测试及 Docker 集成脚本。

## SQLite 迁移

沿用 `SQLITE_PATH`，在既有 migration 事务内按 `schema_migrations` 只执行一次版本 2，不删除 accounts/profiles/sessions，不新建另一套服务器数据库。

| 表 | 作用 |
| --- | --- |
| watch_records | 复合主键 `(profile_id, kind, record_key)`。kind 为 history / progress / clear；经过校验的结构化 JSON 保存原影片、片源与集数信息，另存操作 ID、删除状态、客户端更新时间、服务端时间及 revision。索引 `(profile_id, revision)`。 |
| watch_clock | SQLite AUTOINCREMENT 全局修改序号。每次成功操作分配唯一递增版本，毫秒相同也不会漏项。 |
| watch_operations | 复合主键 `(profile_id, op_id)`，保存幂等结果与时间，90 天保留；过期重试仍受记录版本和删除屏障约束。 |

历史与进度采用同一记录表的不同 kind，共用权限、版本及墓碑规则，避免两套同步流程。历史唯一键为 `[原 sourceKey, sourceUrl, 原 vodId]`，分集进度再追加原集数索引。不会按标题合并，也不会把不同 URL 下相同的自定义短 ID 合并。集数索引沿用原解析结果，依赖上游保持原有排序；不增加元数据接口推测剧集身份。

## API 与权限

所有端点先验证真实会话、active 账号及已选择且属于该账号的档案。`X-PuTV-Context` 必须等于当前 `accountId:profileId`，仅作为防止旧任务错投的上下文校验，实际数据归属始终来自服务端会话。普通用户和管理员权限相同，没有读取任意其他档案的历史接口。切换档案后仍使用旧上下文的在途请求返回 409。

- GET `/api/watch?cursor=<profileId:revision>&limit=100`：同时批量返回历史、分集进度及删除事件。limit 为 1–200，游标必须属于活动档案，返回 cursor / hasMore / context。客户端不逐部影片请求。
- POST `/api/watch`：`{ operations: [...] }`，每批 1–50 项，流式读取请求体上限 256KB。客户端实际按 20 项分批。未知字段、非法数值、标识不匹配及无效 URL 逐项返回 invalid，不让一个坏记录静默吞掉其他合法记录。
- POST `/api/watch/import`：仅在用户确认后调用，同样逐项幂等，额外返回 success / skipped / conflicts / failed。只新增尚不存在的记录，不覆盖已存在或已删除的记录。

状态变更保留 Origin / Sec-Fetch-Site 同源保护。所有 SQL 参数化且使用事务；记录、令牌和完整敏感播放地址不写应用日志。

字段限制：来源标识和影片 ID 各 160 字符、片名 300 字符、HTTP(S) 源/海报 URL 2048 字符；稳定影片 ID 沿用原详情接口的字母/数字/下划线/短横线规则。位置和时长必须有限、非负，时长最多 7 天，位置不可显著超出时长，完成进度归一到片尾。没有稳定影片 ID 的直接播放链接保留本机，不依赖保存临时播放 URL 做跨设备续播。

## 本地缓存与同步

第一阶段的独立数据库名 `putv-<accountId>-<profileId>` 保持不变。Dexie v4 新增 watchQueue、watchVersions、watchConflicts、watchMeta、legacyImports。通过版本升级保留旧表及记录；现有已归属历史改用无歧义影片键，能够匹配的旧进度补齐身份字段，无法匹配的孤立旧进度保留并支持原键读取，不猜测归属。

正常写入把数据和队列放在同一事务。每键只保留最新待提交状态，播放位置没有明显变化时不重复写入；不生成无上限的逐秒队列。服务端成功确认后才移除对应操作。提交期间发生新拖动时，不用旧响应覆盖新本地位置，也不会把较新的待提交操作一起删除。

登录恢复、选档案后启动；约 20 秒批量同步，暂停/切集/结束尽快提交，恢复网络、回到页面和页面隐藏也检查。隐藏/退出为尽力提交，可靠性来自持续落盘与重试，不依赖 beforeunload。单请求 10 秒超时，播放器续播检查最多等待 2 秒，失败继续使用本机缓存，不阻断视频。

读取服务端记录后更新对应本地缓存，仍通过原 Dexie 查询显示历史和读取进度。完成状态单独保存，播放器按原规则不恢复到已完成集的片尾。原 URL position 参数优先级及自动连播/片头片尾跳过行为保留。

切换账号/档案沿用第一阶段重载和缓存隔离，旧任务被取消并持有不可变数据库与上下文；不会把旧队列上传到新身份。

## 冲突与删除

- 版本相同可正常更新，包括主动向前或向后拖动，绝不统一取 max(position)。
- 版本落后时，只允许客户端时间可信、近两分钟产生且晚于服务端当前写入的有效操作优先。时钟偏快、先后不明或过期离线快照采用保守冲突处理。
- 冲突保留当前服务端记录，并把本机操作持久化到 watchConflicts；不会悄悄丢弃。历史抽屉可明确确认「使用本机更改」后重新提交，也可以取消并继续保留双方。
- 单条历史删除与原版一致，保留独立分集进度；清空历史同时清理当前档案进度。
- 删除保存墓碑，旧版本不能复活。清空产生独立事件和版本屏障，连服务端尚未见过的旧离线记录也不能绕过。
- 清空时若其他设备有更新，旧清空操作不无条件覆盖；发生冲突后重新读取服务端记录。本人清空之后产生的新观看通过确认后的屏障版本正常保存。
- 删除墓碑与清空屏障当前不清理。未来只有具备设备全量重建/确认机制后才可考虑压缩；不能依赖「离线若干天」就丢弃删除信息。

## 旧数据导入

登录并选档案后只读扫描同一浏览器源下的旧 `libretv` 与未分配缓存，不声明或升级原 `libretv` schema。轻量提示显示条数和目标档案；暂不导入可正常观看，历史抽屉仍可重新打开导入。

确认后分批提交。检查点保存在既有 `putv-unassigned` 元数据中，只有服务端确认成功/重复/已存在时才记为处理完成；原始记录始终保留。操作 ID 对同一旧记录及内容稳定，失败重试或中断重开不会重复创建。部分失败继续保留待导入项。旧库中无法关联任何影片的孤立进度不猜测身份，原样保留；再次打开对应影片并保存后可携完整标识同步。

浏览器按协议、主机和端口隔离 IndexedDB：8082 验收页无法直接读取原 8080 的旧库；最终在原 8080 地址部署后可检测同源旧记录。不通过跨源绕过浏览器隔离。

## Docker 与升级

继续使用 `putv-data:/app/data`，不新增环境变量或外部服务；SQLite/WAL 与头像仍在原持久化目录。镜像保留 Node 22 Alpine、非 root UID 1001。升级前停止服务备份完整 data 目录，启动时自动执行尚未应用迁移；回滚使用配套备份，不仅回退 JavaScript。

运行 `npm run test:docker` 可在 Linux 的独立测试卷/端口验证旧账号 schema 升级、同步数据与头像跨容器 restart/recreate 保留、权限、删除屏障，以及原 IPTV/EPG/HLS。不向真实账号数据库灌入测试记录。

## 验证记录

2026-10-25 实际执行：

- lint、typecheck：通过；生产源码构建 `.next-v2-sync`：通过。
- 全量 Vitest：47 个文件、681 项通过。新增 36 项覆盖服务端权限、分页/幂等/删除屏障/时钟异常；Dexie 升级与离线队列、部分导入失败；两份独立本地缓存连接真实 SQLite 的双向同步、响应丢失、提交期间的新操作、冲突恢复、清空后重新观看，以及跨设备片源 ID 碰撞。
- 真实 Docker：Node 22.23.4 Alpine / amd64 镜像构建通过。非 root UID 1001；实际模拟只含 migration 1 的账号数据库升级；账号/档案/会话仍可使用；历史/分集进度、删除屏障、头像在容器 restart/recreate 后保留。原认证、注册开关、IPTV/M3U、EPG、HLS 清单与分片代理及不可写目录错误检查通过。
- 独立 Chromium 141：使用自生成 VP9/fMP4 HLS 真实解码播放。桌面写入后手机视口读取续播、反向续播、不同集进度、离线保存后联网重试、删除阻止离线旧记录复活、旧库确认导入/失败重试/原库保留、档案和账号切换均通过。两端场景只发生 10 次批量提交，没有按每次 timeupdate 独立发请求。
- 历史入口实测：在本机配置同短 ID 的错误来源后，点击同步历史仍使用记录中的正确源 URL，并恢复进度。
- 原播放回归：真实播放到片尾后自动进入下一集，上一集完成状态同步；原快捷键标记片头及重新打开后的自动跳过通过。未修改播放器内核。无窗口浏览器的 H.264 解码不可用，播放样片采用同一 HLS 内核支持的 VP9/fMP4；真实手机编码兼容仍需人工验收。
- 本机升级：已先备份至 `data-backups/v2-stage1-20261025-2130/`；8082 切换 `.next-v2-sync`。真实数据库 migration 2 已应用，原账号/档案/会话 ID 全部保留，foreign_key_check 通过；未登录的历史 API 返回 401。8080 V1 服务继续运行。
- 未推送镜像或代码，未执行 ARM64 实机和电视硬件测试。

新增 `fake-indexeddb` 仅用于开发测试，依照 [Dexie 的 Node 测试说明](https://dexie.org/docs/DexieErrors/Dexie.MissingAPIError)，不进入播放运行链路。

用户已确认：手机访问并登录同一账号后，可以看到同步的观看历史。其余真机专项检查仍包括双向续播、休眠/后台切换、原数据导入目标确认、真实片源换源与跳过片头/自动连播、电视焦点操作；无窗口浏览器不代替这些硬件测试。

## 完整文件清单

```text
.dockerignore
.gitignore
README.md
docs/V2-WATCH-SYNC.md
package-lock.json
package.json
scripts/test-docker.mjs
src/app/api/watch/import/route.ts
src/app/api/watch/route.ts
src/app/watch/page.tsx
src/components/auth.tsx
src/components/history-panel.tsx
src/components/watch-sync.tsx
src/lib/auth.test.ts
src/lib/client-api.ts
src/lib/db.ts
src/lib/identity-storage.test.ts
src/lib/store.test.ts
src/lib/store.ts
src/lib/watch-legacy.ts
src/lib/watch-local.test.ts
src/lib/watch-sync.test.ts
src/lib/watch-sync.ts
src/lib/watch-types.ts
src/server/database.ts
src/server/http.ts
src/server/watch.test.ts
src/server/watch.ts
```
