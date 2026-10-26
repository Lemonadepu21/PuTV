# 开发与维护

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

分类入口使用 `/?category=movie`、`/?category=tv`、`/?category=anime`，搜索仍使用 `/?s=片名`。电影分类独立提供豆瓣标签、周榜和分页；剧集保留原榜单与标签，动漫复用 Bangumi 日历。浏览分类不会修改首页来源偏好，首页推荐开关只控制首页展示。

实现和验证记录见 [界面改造](IMPLEMENTATION.md)、[账号系统](V2-IDENTITY.md)、[观看记录同步](V2-WATCH-SYNC.md) 和 [继续观看](V2-CONTINUE-WATCHING.md)。

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


## 电影浏览与首页片源检查

电影页独立提供豆瓣标签、周榜和分页；分页以 50 条请求，展示时按 ID 去重，空页或没有新增条目后停止。分类页不进行查源，不改变首页推荐偏好。

首页复用既有搜索与详情 API，按当前账号、档案、启用来源和过滤设置缓存检查结果 60 秒；每批最多检查三部，已确认的内容立即展示。只有匹配片名、无明确预告/解说/待上映标记、详情包含 HTTP(S) 播放地址的内容才展示。查源结果不是影片内容鉴定，不下载视频判断时长，也不能识别源站未标注的错误内容；未改变现有搜索、播放器或数据库。

2026-10-25 实际执行：lint、typecheck、生产构建通过；49 个测试文件、696 项通过。独立 Chromium 验证首页预告/无记录/空详情/失败过滤、最多三部并发、站内导航缓存和原搜索入口；电影分页 50 条、失败自动/手动重试、追加去重到 90 条、末页停止、标签切换、分类不查源、375px 双列布局与浅色主题。模拟数据和账号仅进入临时测试数据库，未写入真实账号。现有豆瓣接口实测热门、最新、经典、高分各返回 50 条，热门第二页另有 50 条不重复数据。

这次没有重新构建 Docker，也没有进行手机或电视硬件测试。

## Funnel 与局域网并用

`APP_ORIGIN` 配置公网 HTTPS 源，`APP_ALLOWED_ORIGINS` 显式列出其他可信源（逗号分隔，不支持路径、凭据或通配符）。HTTP 地址必须同时开启 `ALLOW_INSECURE_HTTP`。所有状态变更请求仍要求 Origin 精确匹配，拒绝 cross-site，不依赖可伪造的转发头放行。会话 Cookie 根据通过校验的访问源设置 Secure，因此 HTTPS 反向代理和明确放行的 HTTP 局域网可以并用。

2026-10-26：复现 Funnel 登录返回来源校验 403，原因是常驻服务只配置了局域网 APP_ORIGIN。新增双源、无效源、错误端口、伪造代理头、跨站和会话 Cookie 测试；lint、typecheck 及 49 个文件的 699 项测试通过。

修复部署到 8080 后，通过真实 Funnel 和局域网发送空登录请求，均从来源拒绝进入正常参数校验（400）；未配置来源和 cross-site 仍为 403。两端首页均返回 200。用户已确认通过公网成功登录；未使用用户密码代登。最终仅运行 8080，8082/8085 已停止，清理回滚副本、测试临时目录及构建缓存，保留生产构建、运行依赖和数据目录。
