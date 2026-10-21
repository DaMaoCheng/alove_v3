# Google 登录待办记录

更新时间：2026-06-22

## 当前结论

- Google 登录代码链路已经接入并部署到线上。
- 线上 Google callback 已经不再展示裸 JSON `fetch failed`，失败时会展示英文 HTML 失败页。
- 真实 Google 登录暂时还不能完成，原因是服务器当前无法出站访问 Google OAuth API。

## 已完成

- 登录、注册、忘记密码页面的用户可见 auth 错误已统一为英文。
- Google OAuth start/callback 已接入：
  - 校验 state。
  - 保留发起登录时的 `siteSlug`。
  - Google 新账号入库。
  - 写入账号站点归属。
  - 激活对应站点前台。
  - 成功后回到对应站点登录路径，由前端进入登录后落点。
- Google callback 错误展示已修复：
  - provider error 会显示失败页。
  - state 过期会显示失败页。
  - 服务端 token/profile 请求失败会显示失败页。
  - 临时 OAuth cookie 会被清理。
- 已新增自检：`scripts/google-auth-error-ui-self-check.mjs`。
- 已记录到：
  - `logs/updates/2026-06-22.md`
  - `logs/bugs/2026-06-22.md`
  - `docs/releases/2026-06-22-google-auth-error-ui.md`
- 已部署线上 release：`/srv/alove-new/releases/2026-06-22-google-auth-error-ui-20260622172449`。

## 当前阻塞

- 线上服务器没有配置出站代理。
- 服务器可以解析 Google 域名，但无法建立 HTTPS 连接：
  - `oauth2.googleapis.com:443` 超时。
  - `www.googleapis.com:443` 超时。
- 强制 IPv4 访问也超时，所以不是单纯 IPv6 优先问题。

## 后续待办

- 获取一个可用的 HTTP/HTTPS 出站代理，或调整服务器网络出口，让服务器能访问 Google API。
- 在线上 `.env.local` 配置代理环境变量，优先使用：
  - `HTTPS_PROXY=...`
  - 必要时补 `HTTP_PROXY=...` 或 `ALL_PROXY=...`
- 重启 `alove-new.service`。
- 复测服务器连通性：
  - `curl -I --max-time 8 https://oauth2.googleapis.com/token`
  - `curl -I --max-time 8 https://www.googleapis.com/oauth2/v3/userinfo`
- 连通后，真实跑一遍 Google 邮箱登录：
  - 新账号是否入库。
  - 是否绑定当前站点。
  - 是否激活对应前台。
  - 是否落到对应站点页面。
  - 是否进入正确登录后落点。

## 注意事项

- 不要把 Google client secret、代理密码或服务器密码写进日志、release 文档或前端代码。
- 不要再为这个问题改 OAuth 业务逻辑，除非网络连通后出现新的明确错误。
- 当前代码已经支持 `HTTPS_PROXY`、`HTTP_PROXY`、`ALL_PROXY`，入口在 `server/network-proxy.js`。
