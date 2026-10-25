# PuTv

基于 [LibreTV](https://github.com/LibreSpark/LibreTV) 的影视聚合搜索与观看平台。使用 Next.js、React、TypeScript 与 Tailwind CSS，播放内核为 ArtPlayer / hls.js。

PuTv 在保留上游功能的基础上调整界面和移动端操作。项目仍处于 V1 界面重构阶段，当前没有正式发布镜像或运行包；下方两种本地构建方式均从本仓库源码生成。

## 功能与边界

- 跨源搜索、同名结果聚合、播放源切换与测速。
- 豆瓣、Bangumi、影视榜单推荐，沿用上游获取逻辑。
- 点播源管理、健康度检测、订阅导入与配置导入导出。
- IPTV / M3U 直播、频道分组、EPG、收藏与最近观看。
- 观看历史、续播、搜索历史、自动连播、片段跳过及广告切片过滤。
- 深色、浅色、跟随系统三态主题，支持键盘操作。
- 首页全宽精选区、手动切换、横向海报片单，保留原推荐来源及筛选。豆瓣周榜排除明确标记为预告、待上映、院线热映的条目；不逐部查询片源，推荐不代表正片一定可用。

项目不内置视频源，不存储或提供视频文件。观看内容来自部署者自行配置的第三方接口；请确认你有权访问相应内容。

## 部署

默认使用 **8081** 端口，可与使用 8080 的 LibreTV 并行运行。Docker 与源码部署选择一种即可；同一台机器同时运行两份 PuTv 时需使用不同端口。

### 方式一：Docker 构建部署

需要 Docker Engine 与 Docker Compose 插件。

```sh
git clone https://github.com/Lemonadepu21/putv.git PuTv
cd PuTv
cp .env.example .env
```

编辑 `.env`，将 `PASSWORD=change-me` 改为自己的访问密码，再启动：

```sh
docker compose up -d --build
```

访问 `http://localhost:8081`；同一局域网的其他设备使用 `http://机器局域网IP:8081`。

```sh
docker compose logs -f putv
docker compose down
```

对外端口由 `.env` 中的 `PUTV_PORT` 控制，容器内部仍使用 8080。镜像采用多阶段构建，运行进程使用非 root 用户；默认无需数据卷，用户数据存放在浏览器。

以后发布的官方 PuTv 镜像将位于 `ghcr.io/lemonadepu21/putv`。首次正式发布前，请使用上面的本地构建命令，不要拉取 LibreTV 镜像替代 PuTv。

### 方式二：源码构建部署

建议使用 **Node.js 22 LTS** 及 npm。

```sh
git clone https://github.com/Lemonadepu21/putv.git PuTv
cd PuTv
cp .env.example .env
```

编辑 `.env` 中的 `PASSWORD` 后执行：

```sh
npm ci
npm run build
npm start
```

访问 `http://localhost:8081`。默认监听所有网络接口；在公网使用时请通过 HTTPS 反向代理或 Tailscale Funnel 接入，并保留密码保护。

需要更改源码部署的端口时：

```sh
npx next start --hostname 0.0.0.0 --port 9090
```

开发模式使用 `npm run dev`，同样运行在 8081。生产环境使用上面的构建及启动命令。

### 配置

`.env` 仅保存在部署机器上，不要提交到 Git 或分享。常用选项如下；其余可选变量及接口行为沿用 [LibreTV 文档](https://libretv.is-an.org/)。

| 变量 | 说明 |
| --- | --- |
| `PASSWORD` | 必填，网站访问密码 |
| `PUTV_PORT` | Docker 对外端口，默认 `8081` |
| `DEFAULT_SOURCES` | 默认点播源 JSON 数组，默认 `[]` |
| `DEFAULT_LIVE_SOURCES` | 默认直播源 JSON 数组，默认 `[]` |
| `DEFAULT_SUBSCRIPTIONS` | 默认数据源订阅 JSON 数组，默认 `[]` |
| `PROXY_SECRET` | 可选，会话及代理签名密钥；不设时从密码派生 |

默认点播源示例：

```dotenv
DEFAULT_SOURCES='[{"name":"示例源","url":"https://example.com/api.php/provide/vod"}]'
```

其他源可在网站的「设置 → 源管理」中添加。Compose 已传入表中三个默认源变量；若需额外环境变量，在 `docker-compose.yml` 的 `environment` 中明确添加。仅写在宿主机 `.env` 中的额外变量不会自动传给容器。

### 数据与兼容性

设置及主题存于 localStorage，历史、观看进度等数据存于 IndexedDB。为兼容上游，保留 `libretv-theme`、已有数据库名称和配置文件格式。PuTv 与 LibreTV 使用不同域名或端口时，浏览器会隔离两者的数据；不会自动迁移历史或实现跨设备同步。

可通过原有配置导出 / 导入功能搬迁受支持的数据。清除网站数据前请先导出需要保留的内容。

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
src/components/video-card.tsx      影视卡片与结果聚合展示
src/components/detail-modal.tsx    现有影视详情弹窗
src/components/player-shell.tsx    点播播放器
src/components/live-player.tsx     直播播放器
src/lib/                    状态、数据、请求、解析与测试
```

V1 的阶段范围与验收记录见 [实施记录](docs/IMPLEMENTATION.md)。推荐、搜索、认证、源管理与播放业务继续复用原实现；界面更新不应增加新的元数据接口。

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
- `release-standalone`：生成 `putv-<版本>-standalone.tar.gz` 和 `SHA256SUMS`，可解压后通过 Node 运行。

工作流支持手动执行，也支持推送与 `package.json` 版本一致的 `v*` 标签。Fork 的 Actions 可能需要仓库管理员先启用；GHCR 包供其他人拉取时应设为公开。首次发布前需完成验证，不应仅因 UI 阶段验收通过就发布版本标签。

构建包不应包含 `.env` 或密码。Docker 构建排除环境文件；standalone 发布工作流会删除产物中的环境文件并进行检查。运行已发布 standalone 包时通过环境变量传入密码及端口，例如：

```sh
PASSWORD='你的访问密码' PORT=8081 HOSTNAME=0.0.0.0 node server.js
```

## 开源与来源

PuTv 基于 [LibreSpark/LibreTV](https://github.com/LibreSpark/LibreTV)，感谢原项目及贡献者。上游版权、许可证与提交历史均保留。

本项目以 **AGPL-3.0-or-later** 发布，见 [LICENSE](LICENSE)。分发修改版时需保留相关版权及许可声明，标明修改；通过网络向用户提供修改版服务时，需显著提供该部署版本完整对应源码的获取方式。发布部署版本时请记录对应提交或标签，网站的源码入口应指向可获取该版本源码的位置。

欢迎通过 Issue 报告问题，通过 Pull Request 提交修改。请提供复现步骤、浏览器及设备信息；不要附带密码、Cookie、私有源凭据或个人观看记录。提交应聚焦一个问题，涉及行为变化时同步更新测试。

本项目不作任何担保。第三方源的可用性、内容及授权不由 PuTv 维护者控制。
