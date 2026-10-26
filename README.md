# PuTV

基于 [LibreTV](https://github.com/LibreSpark/LibreTV) 的影视聚合搜索与观看平台，支持电影、剧集、动漫和 IPTV 直播，可通过浏览器在电脑、手机和平板上使用。

## 功能

- 跨源搜索、同名影片聚合、播放源切换和测速。
- 电影周榜、热门、最新、经典、高分及地区分类，支持加载更多；动漫提供 Bangumi 每日放送。
- 首页精选和推荐片单，展示当前已启用点播源中找到匹配条目及播放地址的内容。
- 继续观看、分集进度跨设备同步；离线时保存记录，联网后自动同步。
- 邀请码注册、独立账号、家庭观看档案与自定义头像。
- IPTV / M3U 直播、节目单、频道分组、收藏及最近观看。
- 自动连播、续播、片头片尾跳过及广告切片过滤。
- 深色、浅色和跟随系统主题，支持触摸、键盘与方向键操作。
- 安卓横向视频全屏和控制栏自动隐藏；横屏效果取决于浏览器支持。

PuTV 不内置视频源，也不存储视频文件。请在设置中添加你有权使用的第三方点播或直播接口。

## 部署

默认使用 **8080** 端口；如果已有其他服务使用该端口，请先停止旧服务或按下方说明换端口。Docker 与源码部署选择一种即可；同一台机器同时运行两份 PuTV 时需使用不同端口。

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

同时通过公网和局域网访问时，将 `APP_ORIGIN` 设为公网 HTTPS 地址，`APP_ALLOWED_ORIGINS` 填入局域网地址（如 `http://192.168.1.100:8080`），并设置 `ALLOW_INSECURE_HTTP=true`。公网登录仍使用 Secure Cookie；局域网地址必须与浏览器地址栏中的协议、IP 和端口一致。

通过 `APP_ORIGIN` 设置的 HTTPS 地址访问。仅在可信局域网测试时，设置 `APP_ORIGIN=http://机器局域网IP:8080`、`ALLOW_INSECURE_HTTP=true`；这会关闭传输加密，应使用专门的测试密码。

```sh
docker compose logs -f putv
docker compose down
```

对外端口由 `.env` 中的 `PUTV_PORT` 控制，容器内部仍使用 8080。账号、会话、观看记录与头像持久化在 `putv-data` 命名卷的 `/app/data`，不要执行 `docker compose down -v`，除非确认要删除账号、观看记录及头像。浏览器继续保留离线缓存。

目前请使用源码构建 Docker 镜像，暂无预构建镜像。

### 方式二：源码构建部署

需要 **Node.js 22.13+** 和 npm。

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

`.env` 仅保存在部署机器上，不要提交到 Git 或分享。常用选项如下，完整选项见 [.env.example](.env.example)。

| 变量 | 说明 |
| --- | --- |
| `PASSWORD` | 注册邀请码，仅服务端使用；已有用户登录无需它 |
| `APP_ORIGIN` | 浏览器访问的完整源，例如 `https://putv.example.com`；生产环境需要 HTTPS |
| `APP_ALLOWED_ORIGINS` | 可选的其他可信访问地址，以逗号分隔，需包含协议和端口；不支持通配符 |
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

升级前备份完整持久化目录，停止服务后复制 SQLite 和头像；不要只复制正在写入的主数据库文件而漏掉 WAL。升级时自动更新数据库结构，已有数据会保留。备份应妥善保护，其中包含密码哈希和私人头像。

### 观看档案与同步

登录后从右上角头像切换或管理观看档案。同一账号可以为家庭成员分别创建档案，每个档案独立保存观看历史和分集进度。登录其他设备并选择同一档案，即可继续观看。

首页「继续观看」显示最近 12 项未看完内容；看完的电影会移出，剧集可继续下一集。更多记录可从顶部的观看历史入口查看、删除或清空。

从旧版升级时，本机观看历史不会自动上传。检测到旧记录后，可以选择目标档案再确认导入。收藏、搜索历史、下载和部分设备设置仍保存在当前浏览器。

账号、观看记录和头像保存在服务器的数据目录；浏览器同时保留离线缓存。退出或切换账号后，其他账号的记录不会继续显示。

### 浏览内容

电影页可以切换周榜、热门、最新、经典、高分及地区分类，并继续加载更多影片。电影页的筛选不影响首页推荐设置，分类推荐也不要求已有片源。

首页推荐会检查当前已启用的点播源，排除明确标注的预告和待上映内容，并确认详情中存在播放地址；没有查到的内容不会展示。第三方源可能随时更新或失效，搜索和播放时仍以当时的结果为准。

## 参与项目

欢迎通过 Issue 报告问题或通过 Pull Request 提交修改。请附上复现步骤、浏览器和设备信息，不要上传密码、Cookie、私有源凭据或个人观看记录。

开发、测试、跟随上游更新与发布说明见 [开发文档](docs/DEVELOPMENT.md)。

## 开源与来源

PuTV 基于 [LibreSpark/LibreTV](https://github.com/LibreSpark/LibreTV)，感谢原项目及贡献者。上游版权、许可证与提交历史均保留。

本项目以 **AGPL-3.0-or-later** 发布，见 [LICENSE](LICENSE)。分发修改版时需保留相关版权及许可声明，标明修改；通过网络提供修改版服务时，需提供对应版本完整源码的获取方式。

本项目不作任何担保。第三方源的可用性、内容及授权不由 PuTV 维护者控制。
