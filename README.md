# 时序 StudyOS — v1.0（iOS Safari PWA + 多人学习小组）

专为 iPhone 打造的苹果原生质感每日学习任务、考试倒计时与多人学习小组平台。零第三方依赖，开箱即运行。

## 核心能力（第一版已完整交付）
- **苹果原生级视觉与动效**：遵循 Apple HIG 浅色/深色 OLED 双外观、滚动折叠毛玻璃顶栏、底部弹出 Sheet、弹簧勾选动效与 Dynamic-Island 风格实时通知胶囊。
- **每日学习任务 & 专注计时**：支持任务创建/分类/时长/每日自动重复、一键打卡、内置 25/45/60 分钟专注计时器。
- **考试与目标倒计时**：支持置顶首页与锁屏倒计时，内置考研/国考/雅思/CPA/法考/高考一键预设。
- **多人学习小组（实时协作）**：支持创建小组、6 位邀请码或链接（`/?join=KY2027`）一键入组、组员今日进度环墙、点击头像「拍一拍催学 / 点赞鼓励」、实时打卡动态流（SSE 秒级同步）。
- **iOS 桌面与锁屏展示（免 App 方案）**：
  - 完整 iOS Safari PWA（`manifest.webmanifest` + `sw.js` + `180×180` 苹果高清桌面图标 + 微信内置浏览器自动引导）；
  - 一键导出 **1170×2532 高清锁屏倒计时壁纸 PNG**，并附带动态壁纸地址 `/api/wallpaper.svg` 适配苹果自带「快捷指令」每日自动刷新；
  - 一键生成个人专属 **Scriptable 实时桌面小组件代码**（`/api/widget/scriptable` + `/api/widget/data`）。

## 本地启动
```bash
npm start
# 默认监听 http://localhost:3080
```

## 5 分钟公网部署上线（推荐香港/海外服务器免备案快速交付）
### 方式 1：Docker 部署（推荐）
```bash
docker build -t shixu-web .
docker run -d --name shixu-web -p 3080:3080 -v $(pwd)/data:/app/data --restart unless-stopped shixu-web
```
### 方式 2：PM2 / Node 直接运行
```bash
PORT=3080 node server.js
```
> **iOS Safari PWA 提示**：公网交付给客户用 iPhone 真机测试时，建议配合 Caddy / Nginx / Cloudflare 配置 **HTTPS 证书**（iOS Safari 仅在 HTTPS 环境下启用完整 Service Worker 与离线缓存）。
