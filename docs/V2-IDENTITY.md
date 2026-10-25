# V2 第一阶段：账号与观看档案

本阶段保留 V1 页面、搜索聚合、推荐、详情弹窗、ArtPlayer / hls.js 和 IPTV 业务，仅升级认证并增加家庭档案。**2026-10-25 已人工验收通过。** 不包含服务端历史、继续观看或跨设备同步。

## 文件范围

- `src/server/database.ts`：Node 内置 SQLite、迁移、事务与连接配置。
- `src/server/identity.ts`：校验、密码哈希、注册、会话、档案归属、管理员操作及持久化限流。
- `src/server/http.ts`：同源校验、请求大小与字段校验、统一错误、身份与 Cookie。
- `src/server/avatars.ts`：真实图片解码、裁剪、WebP 重编码、私有文件读写与替换清理。
- `src/lib/auth.ts`、`api-guard.ts`：所有旧受保护媒体 API 共用真实账号会话；旧站点密码认证入口停止工作。
- `src/app/api/auth/**`、`profiles/**`、`admin/accounts/**`：新增账号、档案及管理接口；`status/route.ts` 保留版本和预置配置字段。
- `src/components/auth.tsx`、`account-screens.tsx`、`header.tsx`、`providers.tsx`：认证门控、登录注册、档案选择管理、头像裁剪、密码与账号管理；延续 V1 主题。
- `src/lib/client-api.ts`、`types.ts`：客户端接口和身份类型；401 继续统一回到登录。
- `src/lib/db.ts`、`persist-storage.ts`、`history-panel.tsx`：按已验证账号和档案隔离本地数据库与配置，提示旧记录兼容状态。Dexie 原有 v1–v3 表结构保持不变。
- `scripts/create-admin.ts`：服务器内部管理员初始化；`scripts/test-docker.mjs`：生产容器集成检查。
- Dockerfile、Compose、环境示例、依赖锁定、Next 配置及发布工作流：持久化与生产部署支持。
- `src/lib/auth.test.ts`：独立身份与权限测试；原媒体路由测试改用真实账号会话 fixture。

## 数据结构

| 表 | 字段与约束 |
| --- | --- |
| `accounts` | UUID `id`，不区分大小写的唯一 `username`，`password_hash`，`role`（admin/user），`status`（active/disabled），创建/更新时间 |
| `profiles` | UUID `id`，`account_id` 外键，`name`，`avatar`，`is_default`，创建/更新时间；每账号至多一个默认档案 |
| `sessions` | UUID `id`，`account_id` 外键，唯一 `token_hash`，到期/撤销/创建/最近使用时间，`selected_profile_id`，`device_id`，截断的 `user_agent`；档案外键及触发器阻止跨账号选择 |
| `auth_attempts` | SHA-256 桶标识、次数、重置时间；限流在进程重启后仍有效 |
| `schema_migrations` | 已应用版本与时间；启动首次请求或 CLI 连接时在事务中检查迁移，不重复建库 |

ID 为服务端生成的 UUID；时间为毫秒时间戳。默认档案、会话令牌、账号/设备、到期时间和档案归属有相应索引。SQLite 启用 WAL、foreign_keys 与 5000ms busy_timeout；多表写入使用 `BEGIN IMMEDIATE` 事务。数据库文件权限 0600，默认数据目录 0700。使用单实例和本地持久化磁盘，不在共享网络文件系统上并发运行多个副本。

头像字段仅存 `preset:<颜色>` 或 `upload:<48位随机十六进制>.webp`。文件保存在数据库同级的 `avatars/`，不是 public 目录。备份与恢复必须同时包含数据库、WAL（运行中存在时）与头像。

## 认证流程

1. 未登录时加载 `/api/status`，显示登录或注册；私有预置源只在已登录时下发。
2. 注册：检查同源、大小/字段、持久化限流、注册开关、邀请码安全比较及服务端参数校验。用户名 3–32 位字母/数字/中文/下划线/短横线，统一为小写；密码 8–128 字符。注册不能提供 role 或 accountId。
3. 密码采用随机 16 字节盐的 scrypt（N=131072，r=8，p=1，64 字节输出）；每进程最多并发两次慢哈希，繁忙返回 429。账号和同名默认档案在事务中创建。
4. 注册或正常用户名/密码登录后生成 32 字节随机不透明令牌；SQLite 只存 SHA-256。登录签发前重新确认账号状态与验证时的密码哈希，避免密码重置竞态。
5. `putv_session` Cookie 使用 HttpOnly、SameSite=Lax、Path=/、Max-Age 和适当的 Secure；默认 30 天，关浏览器后仍有效。令牌不进入 localStorage。
6. 每次受保护请求查询服务端有效会话并确认账号 active。到期、撤销或禁用返回 401；角色/档案越权返回 403。退出撤销当前会话；修改密码保留当前会话并撤销其他设备；管理员重置密码或禁用账号撤销该账号全部会话。
7. `putv_device` 为 HttpOnly 随机设备标识，仅用于恢复这个账号在本设备上次选择的档案，不是登录凭证。首次多档案登录必须选择；单档案自动进入；账号切换不会继承别人的选择。
8. 旧 `ltv_session` 忽略，旧 POST `/api/auth` 返回 410。PASSWORD 仅为邀请码，PROXY_SECRET 不参与新的密码和会话，轮换二者不影响已有账号。

所有状态变更请求（含原媒体 POST）要求 Origin 与 APP_ORIGIN 完全一致，并拒绝 Sec-Fetch-Site=cross-site。反向代理须保留 Cookie、Origin，不将身份接口缓存；只允许设置的站点源操作，不启用通配 CORS。公共海报 CDN 的原有有限图片代理白名单保留，不放宽媒体代理认证。

限流不信任 X-Forwarded-For 等请求头：每 10 分钟注册全站 20 次，其他敏感操作每类全站 100 次，同时每类每账号 10 次。邀请验证包含在注册额度内；没有公开独立的邀请码查询接口。此配置面向家庭单实例，公开大规模部署应在可信反向代理增加连接级限流；全局额度可被持续请求消耗。

## 接口

| 接口 | 要求 |
| --- | --- |
| POST `/api/auth/register` | username/password/confirmPassword/invitation；开关开启、正确邀请码 |
| POST `/api/auth/login` | username/password；已有 active 账号 |
| POST `/api/auth/logout` | 同源；撤销当前会话，可重复调用 |
| GET `/api/auth/me` | 当前账号、自己的档案与选择；未登录 verified=false |
| POST `/api/auth/change-password` | currentPassword/password；撤销其他会话 |
| GET / POST `/api/profiles` | 获取自己的列表 / name 与可选预设 avatar 创建，默认最多 8 个 |
| PATCH `/api/profiles/:id` | name/avatar/isDefault；必须属于当前账号，avatar 仅预设 |
| POST `/api/profiles/select` | profileId；服务器校验归属并更新当前会话 |
| GET / POST `/api/profiles/:id/avatar` | 仅所属账号读图 / multipart 上传裁剪 |
| GET `/api/admin/accounts` | admin，列表不返回密码哈希或会话令牌 |
| PATCH `/api/admin/accounts/:id` | admin，仅普通账号 status=active/disabled |
| POST `/api/admin/accounts/:id/reset-password` | admin，仅普通账号 password |
| POST `/api/admin/accounts/:id/revoke-sessions` | admin，指定账号（含管理员自身），撤销全部会话 |

请求不信任 accountId。JSON 请求流上限 8KB，拒绝未知字段；头像表单上限 2MB + 16KB 开销，原文件上限 2MB。头像检查 MIME、实际解码格式（JPEG/PNG/WebP）、静态单帧与最多 1600 万像素，应用 EXIF 方向后正方形裁剪为 256×256 WebP，去除源元数据。裁剪 zoom=1–4，x/y=0–1，均检查有限数值。随机文件名由服务端生成；不接受路径。每进程同时最多处理两张图片，繁忙返回 429。文件先落盘再事务更新引用，更新失败删除新文件，替换成功清理未引用旧文件。进程在文件写入后异常终止可能留下未引用孤儿文件，当前没有后台扫描服务。

## 部署与环境

需要 Node 22.13+。SQLite 为 Node 内置模块（Node 22 会显示 experimental 提示），避免新增原生数据库编译链；sharp 固定为现有 Next 依赖版本 0.35.4，生产镜像使用其 Alpine / musl 二进制。

| 变量 | 默认与用途 |
| --- | --- |
| PASSWORD | 注册邀请码，仅服务端；缺失时关闭 UI 注册，已有账号可登录 |
| REGISTRATION_ENABLED | true；false 关闭注册，不影响登录 |
| APP_ORIGIN | 生产环境配置浏览器使用的 HTTPS 源，例如 https://putv.example.com |
| SQLITE_PATH | 源码 ./data/putv.sqlite；Docker /app/data/putv.sqlite |
| SESSION_DAYS | 30，限制 1–365 天 |
| MAX_PROFILES | 8，限制 1–32 |
| COOKIE_SECURE | true 可强制 Secure；HTTPS 与默认生产模式始终 Secure |
| ALLOW_INSECURE_HTTP | false；仅可信局域网测试显式设 true，并设置对应 HTTP APP_ORIGIN |
| NEXT_DIST_DIR | 默认 .next；可用独立目录构建待验收版本，避免覆盖运行中构建 |

保留 DEFAULT_SOURCES、DEFAULT_LIVE_SOURCES、DEFAULT_SUBSCRIPTIONS、PROXY_SECRET 及原有媒体配置。生产经 HTTPS 反向代理或 Funnel 接入，不直接在公网使用 HTTP。只启用 HTTP 例外时 COOKIE_SECURE=false 才可使用非 Secure Cookie；密码和 Cookie 此时不加密。

Docker 使用 `putv-data:/app/data` 命名卷，镜像内运行用户 UID/GID=1001，目录预设归其所有。绑定宿主目录时，先由部署者在服务器创建目录并设置 UID/GID 1001、0700 权限（rootless Docker 还需按其 UID 映射调整）；只挂空目录而未赋写权限会返回明确 503，不会假装保存成功。不要用 chmod 777。

```sh
docker compose up -d --build
docker compose exec putv npm run admin:create
```

源码：从项目目录运行 `npm ci && npm run build && npm start`，另一个终端执行 `npm run admin:create`。CLI 读取 .env / .env.local，交互密码不回显；自动化可从受保护标准输入传入 `{ "username": "...", "password": "..." }`，不要把真实密码写入命令参数、仓库或日志。重复初始化发现管理员即拒绝，不覆盖账号。无公共初始化接口。

更新前停止应用并备份完整 data 目录/命名卷，再更新构建并启动。不要在已有 SQLite 数据上回退到不兼容 schema 的版本；回滚使用配套完整备份。Docker down 保留命名卷，down -v 删除持久化数据。standalone 发布包保留 sharp，按 Linux glibc x64/arm64 分开，其他平台用源码或 Docker 构建。

## 本地数据兼容

旧 `libretv` 数据库与旧 localStorage 配置不删除、不迁移、不自动导入。不改 Dexie schema；已验证账号/档案使用 `putv-<accountId>-<profileId>` 独立数据库，设置使用对应前缀。历史、收藏、播放进度、搜索记录、下载任务仍为本设备数据，无服务端记录表。主题 libretv-theme 和少量设备偏好保持共享。登录、退出和切换档案后重载；其他同站标签页收到仅含失效时间戳的 storage 信号也重载，不传令牌。会话每分钟复查，媒体 API 始终实时验证。

切换身份不会自动展示旧账号本地缓存；旧记录导入及同步留待下一阶段。管理员无普通记录跨账号读取接口，也没有任何服务端观看历史接口。

## 验证记录

2026-10-25 实际执行：

- `npm run lint`：通过，无 lint 错误。
- `npm run typecheck`：通过。Compose 与 standalone 工作流 YAML 语法检查通过。
- `npm test`：44 个文件、645 项通过。身份测试 22 项，覆盖注册、大小写唯一、邀请码轮换、关闭注册、旧 Cookie、会话过期/撤销、禁用、密码修改、管理员权限、跨账号档案、并发头像替换、HTTPS Secure、CSRF、限流、超限与伪装上传；本地隔离另有 2 项测试。
- `NEXT_DIST_DIR=.next-v2 npm run build`：生产构建通过，不覆盖运行中的 V1 `.next`。
- Docker：实际构建 Node **22.23.4 Alpine / amd64** 镜像并以 UID 1001 运行。`npm run test:docker` 验证管理员 CLI/重复初始化、注册登录、跨账号隔离、撤销/禁用/重置、头像 WebP、容器 restart/recreate 与命名卷数据保留、轮换邀请码、关闭注册、不可写数据库，以及受控 IPTV/M3U、XMLTV/EPG、HLS 清单改写和分片鉴权。
- 独立无窗口 Chromium 141（临时 Playwright，不增加仓库浏览器依赖）：注册、刷新登录、档案创建/切换、头像裁剪上传、三态主题、320/375/768/1440/1920px 无横向溢出、方向键/Enter、跨标签页退出及管理员界面通过；截图已检查。另在真实 IndexedDB 中写入旧库记录及账号 A 记录，验证旧库/旧 localStorage 保留、账号 B 看不到 A 的记录，以及浅色主题刷新保持。
- 真实上游：非凡源“三体”搜索 HTTP 200、3 条结果；详情 HTTP 200、15 集；HLS 代理 HTTP 200 且正确改写清单；豆瓣推荐 HTTP 200、5 条结果。

容器测试使用独立 rootless Docker、测试端口和临时卷；真实账号、密码、数据库及头像均未加入 Git。未触发 GitHub Actions 或推送镜像。第一阶段已人工验收。ARM64 发布工作流已适配，尚未在 ARM64 实机执行。

人工验收仍需：手机/桌面深浅主题、登录注册与密码管理器、上传裁剪预览、多人档案切换、多标签页、电视遥控器方向键/Enter、真实点播换源/HLS/直播与 EPG。自动化媒体测试使用受控上游，不能替代真实片源和硬件验证。

## 跟随上游

易冲突文件为 auth.ts、api-guard.ts、auth/status 路由、AuthProvider/Providers、client-api.ts、Header、db.ts、persist-storage.ts，以及 Docker/构建配置。合并上游认证改动时必须保留账号身份解析，不恢复站点密码布尔会话；合并本地存储改动时保留按账号/档案隔离及旧库。主题、推荐、播放器与直播解析核心没有改写。

## 本机验收版本

V1 继续运行在 8080。V2 使用独立 8082 端口和 `.next-v2` 构建，供局域网验收；`putv-v2-preview.service` 为临时用户服务，数据保存到项目 `data/putv.sqlite`。该预览显式启用可信局域网 HTTP 例外，正式公网部署请配置 HTTPS APP_ORIGIN。

管理员初始化：在 `~/Coding/PuTv` 执行 `npm run admin:create`，设置自己的管理员用户名和密码；预览不预建默认管理员。使用旧 PASSWORD 作为邀请码可注册普通账号。第一阶段已验收；后续阶段继续使用 8082，8080 保留 V1。

## 完整文件清单

```text
.dockerignore
.env.example
.github/workflows/release-standalone.yml
.gitignore
Dockerfile
README.md
docker-compose.yml
docs/V2-IDENTITY.md
next.config.ts
package-lock.json
package.json
scripts/create-admin.ts
scripts/test-docker.mjs
src/app/api/admin/accounts/[id]/reset-password/route.ts
src/app/api/admin/accounts/[id]/revoke-sessions/route.ts
src/app/api/admin/accounts/[id]/route.ts
src/app/api/admin/accounts/route.ts
src/app/api/auth/change-password/route.ts
src/app/api/auth/login/route.ts
src/app/api/auth/logout/route.ts
src/app/api/auth/me/route.ts
src/app/api/auth/register/route.ts
src/app/api/auth/route.ts
src/app/api/live/probe/route.test.ts
src/app/api/profiles/[id]/avatar/route.ts
src/app/api/profiles/[id]/route.ts
src/app/api/profiles/route.ts
src/app/api/profiles/select/route.ts
src/app/api/publish/route.test.ts
src/app/api/search/route.test.ts
src/app/api/source-list/route.test.ts
src/app/api/status/route.ts
src/components/account-screens.tsx
src/components/auth.tsx
src/components/header.tsx
src/components/history-panel.tsx
src/components/providers.tsx
src/lib/api-guard.ts
src/lib/auth.test.ts
src/lib/auth.ts
src/lib/client-api.ts
src/lib/db.ts
src/lib/identity-storage.test.ts
src/lib/persist-storage.ts
src/lib/types.ts
src/server/avatars.ts
src/server/database.ts
src/server/http.ts
src/server/identity.ts
src/server/test-only-empty.ts
src/server/test-session.ts
tsconfig.json
vitest.config.ts
```
