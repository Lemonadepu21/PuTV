# PuTV

基于 [LibreTV](https://github.com/LibreSpark/LibreTV) 的影视聚合搜索与观看平台。使用 Next.js、React、TypeScript 与 Tailwind CSS，播放内核为 ArtPlayer / hls.js。

PuTv 在保留上游功能的基础上调整界面和移动端操作。V1 界面已验收；V2 第一阶段加入独立账号、家庭观看档案和头像管理，已人工验收。当前没有正式发布镜像或运行包；下方两种部署方式均从源码构建。

## 功能与边界

- 邀请码注册、独立账号登录、家庭观看档案、预设与自定义裁剪头像、管理员账号管理。
- 跨源搜索、同名结果聚合、播放源切换与测速。
- 豆瓣、Bangumi、影视榜单推荐，沿用上游获取逻辑。
- 点播源管理、健康度检测、订阅导入与配置导入导出。
- IPTV / M3U 直播、频道分组、EPG、收藏与最近观看。
- 观看历史、续播、搜索历史、自动连播、片段跳过及广告切片过滤。
- 深色、浅色、跟随系统三态主题，支持键盘操作与方向键焦点导航。
- 手机底部导航与安全区适配；点播 / 直播共用触屏控制栏，播放中约三秒无操作隐藏，暂停、拖动和设置时保持可见。
- 安卓横向视频全屏优先尝试锁定横屏，浏览器拒绝时降级为网页旋转全屏；退出恢复。实际效果取决于浏览器，网页全屏可能仍显示浏览器地址栏。
- 电影、剧集、动漫分类网格；顶栏搜索浮层支持 Enter、Esc、Ctrl / ⌘ + K，保留最近搜索及跨源选源。
- 首页全宽精选区、手动切换、横向海报片单，保留原推荐来源及筛选。豆瓣周榜排除明确标记为预告、待上映、院线热映的条目；不逐部查询片源，推荐不代表正片一定可用。

项目不内置视频源，不存储或提供视频文件。观看内容来自部署者自行配置的第三方接口；请确认你有权访问相应内容。

## 部署

默认使用 **8080** 端口；如果已有其他服务使用该端口，请先停止旧服务或按下方说明换端口。Docker 与源码部署选择一种即可；同一台机器同时运行两份 PuTv 时需使用不同端口。

### 方式一：Docker 构建部署

需要 Docker Engine 与 Docker Compose 插件。

```sh
git clone https://github.com/Lemonadepu21/putv.git PuTv
cd PuTv
cp .env.example .env
```

编辑 `.env`：设置私有注册邀请码 `PASSWORD` 和浏览器访问的 HTTPS 地址 `APP_ORIGIN`。由 HTTPS 反向代理或 Tailscale Funnel 转发到 8080，然后启动：

```sh
docker compose up -d --build
```

通过 `APP_ORIGIN` 设置的 HTTPS 地址访问。仅在可信局域网测试时，设置 `APP_ORIGIN=http://机器局域网IP:8080`、`ALLOW_INSECURE_HTTP=true`；这会关闭传输加密，应使用专门的测试密码。

```sh
docker compose logs -f putv
docker compose down
```

对外端口由 `.env` 中的 `PUTV_PORT` 控制，容器内部仍使用 8080。镜像采用多阶段构建，运行进程使用非 root 用户；账号、会话与头像持久化在 `putv-data` 命名卷的 `/app/data`，不要执行 `docker compose down -v`，除非确认要删除账号及头像。观看记录仍保存在浏览器。

以后发布的官方 PuTv 镜像将位于 `ghcr.io/lemonadepu21/putv`。首次正式发布前，请使用上面的本地构建命令，不要拉取 LibreTV 镜像替代 PuTv。

### 方式二：源码构建部署

使用 **Node.js 22.13+** 及 npm；SQLite 使用 Node 内置模块，头像处理使用 sharp。

```sh
git clone https://github.com/Lemonadepu21/putv.git PuTv
cd PuTv
cp .env.example .env
```

编辑 `.env` 中的注册邀请码 `PASSWORD` 和 HTTPS 地址 `APP_ORIGIN` 后执行：

```sh
npm ci
npm run build
npm start
```

默认监听 8080，使用 HTTPS 反向代理或 Tailscale Funnel 接入，通过 `APP_ORIGIN` 访问。源码部署的数据默认在 `./data`，更新源码时必须保留该目录。可信局域网测试的 HTTP 配置见上文。

需要更改源码部署的端口时：

```sh
npx next start --hostname 0.0.0.0 --port 9090
```

开发模式使用 `npm run dev`，同样运行在 8080。生产环境使用上面的构建及启动命令。

### 本机 systemd 服务（可选）

仓库提供 `putv.service`，默认目录为 `~/Coding/PuTv`、Node 路径为 `/usr/bin/node`、端口为 8080；目录或 Node 路径不同时先编辑服务文件。先完成上面的源码构建并配置 `.env`，然后运行：

```sh
mkdir -p ~/.config/systemd/user
ln -s "$PWD/putv.service" ~/.config/systemd/user/putv.service
systemctl --user daemon-reload
systemctl --user enable --now putv
```

查看 / 重启 / 停止：`systemctl --user status putv`、`systemctl --user restart putv`、`systemctl --user stop putv`。默认随用户会话启动；需要无人登录时启动，由部署者按系统策略配置 user lingering。

### 配置

`.env` 仅保存在部署机器上，不要提交到 Git 或分享。常用选项如下；其余可选变量及接口行为沿用 [LibreTV 文档](https://libretv.is-an.org/)。

| 变量 | 说明 |
| --- | --- |
| `PASSWORD` | 注册邀请码，仅服务端使用；已有用户登录无需它 |
| `APP_ORIGIN` | 浏览器访问的完整源，例如 `https://putv.example.com`；生产环境需要 HTTPS |
| `REGISTRATION_ENABLED` | 注册开关，默认 `true`，`false` 仅关闭注册 |
| `SQLITE_PATH` | 源码默认 `./data/putv.sqlite`；Docker 使用 `/app/data/putv.sqlite` |
| `SESSION_DAYS` | 会话有效期，默认 30 天，范围 1–365 |
| `MAX_PROFILES` | 每账号档案上限，默认 8，范围 1–32 |
| `ALLOW_INSECURE_HTTP` | 默认 `false`；仅局域网测试可显式启用 HTTP 例外 |
| `COOKIE_SECURE` | `true` 强制 Secure；HTTPS 和默认生产模式始终使用 Secure |
| `PUTV_PORT` | Docker 对外端口，默认 `8080` |
| `DEFAULT_SOURCES` | 默认点播源 JSON 数组，默认 `[]` |
| `DEFAULT_LIVE_SOURCES` | 默认直播源 JSON 数组，默认 `[]` |
| `DEFAULT_SUBSCRIPTIONS` | 默认数据源订阅 JSON 数组，默认 `[]` |
| `PROXY_SECRET` | 保留兼容配置，不再参与账号密码或会话生成 |

默认点播源示例：

```dotenv
DEFAULT_SOURCES='[{"name":"示例源","url":"https://example.com/api.php/provide/vod"}]'
```

其他源可在网站的「设置 → 源管理」中添加。Compose 已传入表中三个默认源变量；若需额外环境变量，在 `docker-compose.yml` 的 `environment` 中明确添加。仅写在宿主机 `.env` 中的额外变量不会自动传给容器。

### 管理员与升级

普通注册用户始终为普通账号。首次管理员仅在服务器内部创建，密码交互输入不回显：

```sh
# Docker
docker compose exec putv npm run admin:create
# 源码（从项目目录运行，自动读取 .env / .env.local）
npm run admin:create
```

已有管理员时会拒绝重复初始化，不覆盖原账号。管理员通过正常登录页面进入，右上角头像 → 账号管理。管理员可禁用 / 启用普通账号、重置普通账号密码，以及撤销指定账号全部会话。

升级前备份完整持久化目录，停止服务后复制 SQLite 和头像；不要只复制正在写入的主数据库文件而漏掉 WAL。启动后按 `schema_migrations` 自动应用尚未执行的迁移，不重建数据库。备份应妥善保护，其中包含密码哈希和私人头像。完整说明见 [V2 身份系统](docs/V2-IDENTITY.md)。

### 数据与兼容性

账号、档案、会话在服务端 SQLite；头像是同目录 `avatars/` 下的 WebP 文件。历史、进度、收藏和搜索历史仍只在本设备保存，不会上传或跨设备同步。

旧 `libretv` IndexedDB 和 `libretv-settings` 配置保留原样，本阶段不自动导入。登录后的本地数据库和配置按账号、档案分别隔离；切换身份重新载入页面，其他同站标签页也会刷新。历史面板说明旧记录仍保留。主题继续使用 `libretv-theme`，下载、缓存偏好及设置面板标签仍为本设备公共偏好。

升级后旧 `ltv_session` 无效，需要重新注册或由管理员初始化账号。新的登录密码与邀请码完全独立，轮换 `PASSWORD` 或 `PROXY_SECRET` 不会令现有会话失效。旧数据导入和服务端观看记录同步留待下一阶段。

## 开发与验证

```sh
npm ci
npm run dev
```

提交前运行项目现有检查：

```sh
npm run lint
npm run typecheck
npm test
npm run build
```

主要结构：

```text
src/app/                    页面路由、API、全局样式与页面 metadata
src/components/header.tsx   顶部导航与历史、设置等入口
src/components/theme.tsx    三态主题与 libretv-theme 持久化
src/components/douban-section.tsx  推荐来源与展示
src/components/search-dialog.tsx   搜索浮层，复用原搜索历史与焦点管理
src/components/video-card.tsx      影视卡片与结果聚合展示
src/components/detail-modal.tsx    现有影视详情弹窗
src/components/player-shell.tsx    点播播放器
src/components/live-player.tsx     直播播放器
src/lib/                    状态、数据、请求、解析与测试
```

分类入口使用 `/?category=movie`、`/?category=tv`、`/?category=anime`，搜索仍使用 `/?s=片名`。电影 / 剧集在影视榜单偏好下沿用对应榜单，其他偏好下复用豆瓣标签；动漫复用 Bangumi 日历。浏览分类不会修改首页来源偏好，首页推荐开关只控制首页展示。

V1 四个阶段已人工验收，见 [实施记录](docs/IMPLEMENTATION.md)。V2 身份模块、接口、数据兼容与验证记录见 [V2 身份系统](docs/V2-IDENTITY.md)。媒体搜索、推荐、源管理及播放核心继续复用原实现。

## 跟随上游更新

本仓库是 LibreTV 的 Fork，保留其提交历史。首次克隆后添加官方 remote：

```sh
git remote add upstream https://github.com/LibreSpark/LibreTV.git
git fetch upstream --tags
```

先提交或妥善保存本地工作，再创建更新分支，合并需要的稳定版本：

```sh
git switch -c update/libretv-<版本>
git merge v<版本>
```

这里的 `<版本>` 指已获取的 LibreTV 上游版本标签。检查冲突及变更，运行测试和构建，确认后再合入 PuTv 主分支并部署。不要使用覆盖分支的方式同步，否则可能丢失 PuTv 的修改。

播放器或主题文件被上游同时修改时，需要人工处理冲突。合并成功也应复查横屏、控制栏、主题和详情弹窗；同步源码后需要重新构建运行版本。

## 构建与发布

保留上游的两条发布链路，并将目标调整为本仓库：

- `docker-publish`：构建 `linux/amd64` 与 `linux/arm64` 镜像，发布到本仓库的 GHCR。
- `release-standalone`：生成 `putv-<版本>-linux-x64.tar.gz` / `linux-arm64.tar.gz` 和对应校验文件（Linux glibc；Alpine 使用 Docker），可解压后通过 Node 运行。

工作流支持手动执行，也支持推送与 `package.json` 版本一致的 `v*` 标签。Fork 的 Actions 可能需要仓库管理员先启用；GHCR 包供其他人拉取时应设为公开。首次发布前需完成验证，不应仅因 UI 阶段验收通过就发布版本标签。

构建包不应包含 `.env` 或密码。Docker 构建排除环境文件；standalone 发布工作流会删除产物中的环境文件并进行检查。运行已发布 standalone 包时通过环境变量传入密码及端口，例如：

```sh
PASSWORD='你的注册邀请码' APP_ORIGIN='https://putv.example.com' SQLITE_PATH='./data/putv.sqlite' PORT=8080 HOSTNAME=0.0.0.0 node server.js
```

## 开源与来源

PuTv 基于 [LibreSpark/LibreTV](https://github.com/LibreSpark/LibreTV)，感谢原项目及贡献者。上游版权、许可证与提交历史均保留。

本项目以 **AGPL-3.0-or-later** 发布，见 [LICENSE](LICENSE)。分发修改版时需保留相关版权及许可声明，标明修改；通过网络向用户提供修改版服务时，需显著提供该部署版本完整对应源码的获取方式。发布部署版本时请记录对应提交或标签，网站的源码入口应指向可获取该版本源码的位置。

欢迎通过 Issue 报告问题，通过 Pull Request 提交修改。请提供复现步骤、浏览器及设备信息；不要附带密码、Cookie、私有源凭据或个人观看记录。提交应聚焦一个问题，涉及行为变化时同步更新测试。

本项目不作任何担保。第三方源的可用性、内容及授权不由 PuTv 维护者控制。
