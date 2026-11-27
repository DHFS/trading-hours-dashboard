<div align="center">

# Trading Hours Dashboard · 交易时段看板

**以北京时间（UTC+8）为统一锚点的全球金融市场开休市看板 & iOS StandBy "Float" 风格桌面时钟（PWA）**

[![Version](https://img.shields.io/badge/version-v0.11.1-blue.svg)](https://github.com/DHFS/trading-hours-dashboard/releases/tag/v0.11.1)
[![Stack](https://img.shields.io/badge/stack-HTML%20%2B%20CSS%20%2B%20Vanilla%20JS-informational.svg)](#项目结构)
[![Dependencies](https://img.shields.io/badge/dependencies-zero-brightgreen.svg)](#快速上手)
[![PWA](https://img.shields.io/badge/PWA-iPhone%20StandBy%20Ready-black.svg)](#方式二安装为-iphone-横屏桌面时钟pwa)
[![Live Demo](https://img.shields.io/badge/demo-GitHub%20Pages-success.svg)](https://dhfs.github.io/trading-hours-dashboard/)

[🌐 在线体验 Live Demo](https://dhfs.github.io/trading-hours-dashboard/) · [📱 直达桌面时钟](https://dhfs.github.io/trading-hours-dashboard/#crypto) · [📐 设计规范 (Float v3.1)](DESIGN.md) · [📝 更新日志](#版本日志)

</div>

---

## 项目简介

跨市场交易者最常遇到的困扰之一，是不断在脑中换算东京、首尔、伦敦、纽约的夏/冬令时与官方假期。**Trading Hours Dashboard** 采用 **一套引擎、两种形态** 的设计理念，让全球市场脉搏做到「打开即知」：

| 形态 | 适用场景 | 交互与视觉特征 |
| :--- | :--- | :--- |
| **网页 Bento 看板** | 电脑 / 手机日常查盘 | 桌面端自适应 3 列 Bento 网格一屏尽览 7 大市场；交易中自动置顶，其余按距开盘时间排序；24 小时分段进度条与实时指针；顶部切换涨跌色与连接状态胶囊 |
| **Float 桌面时钟** | iPhone / iPad 横屏摆台（PWA） | 全 7 市场统一的 **iOS StandBy "Float"** 纯黑 OLED 画布；巨大双拼色叠印圆体数字、冷白渐变双圆球冒号、按位差分滚动；交易看主力指数，休市看精确倒计时 |

> **无缝互通**：在网页看板点击任意市场卡片（或顶部「桌面时钟模式」）即可无刷新进入该市场的全屏 Float 时钟；在全屏时钟轻触屏幕呼出控制条点击「返回看板」即可回到总览。

---

## 核心特性

- **北京时间基准（`Asia/Shanghai`）**：无论访问者身处哪个国家或设备时区，全站时间与倒计时均精确锁定北京时间。
- **7 大市场 × 7 种状态**：覆盖 **加密货币（BTC）、A 股、港股、日经、韩股、美股、布伦特原油**，精确区分 `交易中` / `午间休市` / `盘前` / `盘后` / `隔夜休市` / `周末休市` / `休市（节假日）`。
- **单点真理时间轴**：24 小时进度条由逐分钟状态采样自动合并生成，确保任何时刻白色当前时间游标所在色块与状态徽章 100% 一致（完美适配美股提前收盘日与跨午夜边界）。
- **跨年动态夏令时 & 2026–2027 日历**：
  - 美股夏令时（3 月第 2 个周日 – 11 月第 1 个周日）与英国夏令时（3 月最后周日 – 10 月最后周日）按年份动态推算，告别跨年硬编码；
  - 内置 2026–2027 年上交所、港交所（含半日市）、JPX、KRX、NYSE（含提前收盘日）及 ICE Futures Europe 休市日历，超范围自动提示。
- **ICE 布伦特原油官方时段**：开休市判定严格遵循 ICE Futures Europe（伦敦周一至周五 01:00–23:00 交易，每日 23:00–01:00 维护休市，自动随英国夏/冬令时换算至北京时间）；行情使用**中国大陆免 VPN 直连**的腾讯外盘期货 `hf_OIL` 主源与东方财富期货双兜底。
- **全 7 市场 iOS StandBy "Float" 桌面时钟**：
  - 6 套精选配色（经典蔚蓝 + 5 套双拼波普预设）+ 随机配色，支持即时切换与持久化；
  - 独立冷白渐变双圆球冒号（静止不参与彩色混合）+ 低位向高位 40ms 交错差分滚动动画；
  - 运行时真实字体测宽拟合（`fitFloatStage()`）+ 左/右横屏灵动岛安全区双向适配，绝不截断溢出；
  - 内置 **夜间暗红护眼模式**、**省电静默模式**（暂停呼吸动画降低插电发热）、**每 3 分钟 ±4px OLED 防烧屏像素微移**。
- **涨跌色系与多源行情兜底**：默认统一 **绿涨红跌**，看板顶部可一键切换为「红涨绿跌」；指数与原油支持大陆直连（腾讯 30 秒快轮询 / 东方财富 / ETF 估算），BTC 走 Binance 现货镜像 WebSocket，支持 `localStorage` 缓存与状态指示。
- **零构建零依赖**：纯原生 HTML / CSS / JS，无打包步骤、无后端服务器要求，开箱即可托管于任何静态服务器或 GitHub Pages。

---

## 快速上手

### 方式一：直接使用线上版

直接访问官方托管站点：**<https://dhfs.github.io/trading-hours-dashboard/>**

- 首页默认进入 **网页多市场看板**。
- 可通过 URL Hash 直达任意市场的全屏时钟，例如：
  `#crypto` · `#aShare` · `#hk` · `#jp` · `#kr` · `#us` · `#brent`

### 方式二：安装为 iPhone 横屏桌面时钟（PWA）

1. 在 iPhone 上使用 **Safari** 打开 <https://dhfs.github.io/trading-hours-dashboard/>。
2. 点击底部工具栏的 **「分享」** 按钮 → 选择 **「添加到主屏幕」** → 确认添加。
3. 从桌面「交易时钟」图标启动（默认全屏横屏进入 `#crypto`），将手机横置在 MagSafe 支架上即可作为桌面时钟长亮使用。

> [!TIP]
> **升级提示**：从早期版本升级至 `v0.11.1` 时，由于 `manifest.json` 的 `start_url` 已更新版本号（`?v=0.11.1`），请先长按删除旧的主屏幕「交易时钟」图标，再用 Safari 重新「添加到主屏幕」，即可绕过 iOS PWA 旧启动条目缓存。

#### 桌面时钟手势与快捷键速查

| 操作 | 效果 |
| :--- | :--- |
| **左右滑动**（或键盘 `←` / `→`） | 切换市场（`加密货币 → A股 → 港股 → 日经 → 韩股 → 美股 → 布伦特原油`） |
| **轻触屏幕** | 呼出底部玻璃态 **HUD 控制条**（4.5 秒无操作自动隐去；防误触设计，单击不再切走市场） |
| **HUD 控制条功能** | 6 套 Float 配色切换 · 随机配色 · 夜间红光 · 省电静默 · 锁定市场（防误滑） · 返回看板 |
| **键盘 `Esc`** | 退出全屏时钟，返回网页看板总览 |

### 方式三：本地运行与二次开发

无需安装 `npm` 包或任何构建工具，直接用任意静态 HTTP 服务器即可运行（浏览器 ES / Service Worker 需要 HTTP 环境，请勿直接双击 `file://` 打开）：

```bash
# 1. 克隆仓库
git clone https://github.com/DHFS/trading-hours-dashboard.git
cd trading-hours-dashboard

# 2. 启动本地静态服务（Python / Node 均可）
python3 -m http.server 8765
# 或：npx serve -l 8765

# 3. 浏览器打开
open http://localhost:8765
```

运行内置的时段与日历单元测试（需 Node.js ≥ 18）：

```bash
node tests/market-time.test.js
```

### 方式四：一键部署到你自己的 GitHub Pages

1. 点击仓库右上角 **Fork** 到你的 GitHub 账号。
2. 进入你的仓库 **Settings → Pages**。
3. 在 **Build and deployment** 中选择 `Deploy from a branch`，分支选择 `main`、目录选择 `/ (root)`，点击 **Save**。
4. 等待约 30 秒，即可通过 `https://<你的用户名>.github.io/trading-hours-dashboard/` 访问专属看板。

---

## 支持市场、时段与数据源

| 市场 | 交易所 | 交易时段（北京时间 UTC+8） | 行情主源 | 兜底 / 估算机制 |
| :--- | :--- | :--- | :--- | :--- |
| **加密货币** | Binance | 24/7 全年无休 | Binance 现货 WS (`BTCUSDT`) | Binance 现货 REST 镜像 |
| **A 股** | 上交所 / 深交所 | 早盘 `09:30–11:30` · 午盘 `13:00–15:00` | 腾讯财经（上证/深证/创业板） | 东方财富批量接口 |
| **港股** | HKEX | 早盘 `09:30–12:00` · 午盘 `13:00–16:00`（含半日市） | 腾讯财经（恒生指数） | 东方财富批量接口 |
| **日经** | JPX | 早盘 `08:00–10:30` · 午盘 `11:30–14:30` | 东方财富 `stock/get`（日经225） | 腾讯日经 ETF（`sh513880`）涨幅估算 |
| **韩股** | KRX | 连续 `08:00–14:30`（无午休） | 东方财富 `stock/get`（KOSPI） | 腾讯韩股 ETF（`hk03121`）涨幅估算 |
| **美股** | NYSE / Nasdaq | 夏令时盘前 `16:00–21:30` · 盘中 `21:30–04:00` · 盘后 `04:00–08:00`<br>冬令时顺延 1 小时；支持 `13:00 ET` 提前收盘日 | 腾讯财经（标普500 / 纳指 / 道指） | 东方财富批量接口 |
| **布伦特原油** | ICE Futures Europe | 夏令时 `08:00–次日06:00`（`06:00–08:00` 维护休市）<br>冬令时 `09:00–次日07:00`（`07:00–09:00` 维护休市） | 腾讯外盘期货 (`hf_OIL`，30 秒刷新) | 东方财富 `futsseapi` → 东财 `push2delay` |

> **说明**：
> - 全部传统股指与布伦特原油期货数据源在中国大陆均**无需 VPN 可直接访问**；腾讯源无严苛 IP 封控，支持 30 秒独立快轮询，东方财富全量兜底轮询保持 5 分钟以规避风控。
> - BTC 现货采用 Binance 官方公共数据镜像（`data-stream.binance.vision` / `data-api.binance.vision`）。

---

## 项目结构

```text
trading-hours-dashboard/
├── index.html             # 页面入口：看板与时钟视图、动态缓存版本号注入、SW 注册
├── manifest.json          # PWA 应用清单（standalone + 横屏锁定 + 版本化 start_url）
├── sw.js                  # Service Worker（同源静态资源 network-first 策略）
├── css/
│   ├── tokens.css         # 设计令牌：暗色主题、7 状态色、绿涨红跌 / 红涨绿跌变量
│   ├── dashboard.css      # 网页 Bento 多列看板样式（作用域严格隔离）
│   └── float-clock.css    # 全屏 Float 时钟、双圆球冒号、HUD 控制条、夜间红光与省电模式
├── js/
│   ├── data.js            # 2026–2027 交易日历、7 市场配置、6 套 Float 调色盘（支持浏览器与 Node）
│   ├── market-time.js     # 纯函数时段引擎：北京时间、动态 DST、单点采样时间轴（支持浏览器与 Node）
│   ├── quotes.js          # 多源行情拉取 + Binance 双路 WS 实时流 + 本地缓存与时效追踪
│   ├── float-engine.js    # Float 逐位渲染、按位差分滚动、fitFloatStage() 测宽、OLED 防烧屏微移
│   ├── ui-dashboard.js    # 网页看板渲染、排序、局部增量更新与顶部交互
│   ├── ui-clock.js        # 全 7 市场 Float 桌面时钟、滑动手势、HUD 控制层、WakeLock
│   └── main.js            # 双形态路由调度与生命周期管理
├── tests/
│   └── market-time.test.js # 时段引擎与日历回归单元测试（Node.js 原生 assert）
├── icon-180.png / icon-192.png / icon-512.png
├── DESIGN.md              # iOS StandBy Float v3 / v3.1 完整视觉与工程设计标准
├── PROMPT.md              # 早期单文件重构提示词归档
└── README.md              # 项目说明文档
```

---

## 年度日历维护与自定义

所有节假日配置集中在 [`js/data.js`](js/data.js)：

- `DATA_YEARS`：声明当前日历覆盖年份（当前为 `[2026, 2027]`）。若系统日期超出覆盖范围，看板顶部与全屏时钟右上角都会展示「日历需更新」提醒。
- `HOLIDAYS`：
  - `aShare`：A 股休市闭区间（需同步维护 `A_SHARE_HOLIDAY_NAMES`；注：2027 年条目当前基于国务院放假安排推演，待上交所 2026 年 12 月下旬官方公告发布后复核）。
  - `hk` / `hkHalf`：港股休市日与半日市。
  - `jp` / `kr` / `us` / `usEarly` / `brent`：日经、韩股、美股（含提前收盘日）、ICE 布伦特原油休市日。
- 每次发布静态资源重大更新时，同步递增 [`sw.js`](sw.js) 中的 `CACHE_NAME` 与 [`manifest.json`](manifest.json) 中的 `start_url` 版本号。

---

## 版本日志

### `v0.11.1` (2026-11-28)
- **布伦特原油数据源大陆直连化**：移除在中国大陆不开 VPN 会被阻断的 `fstream.binance.com` / `fapi.binance.com`（`BZUSDT`），改用真实 ICE 布伦特原油期货三源自动降级：**腾讯外盘期货 `hf_OIL`（主源）→ 东方财富独立期货接口 `futsseapi`（备源 1）→ 东方财富 `push2delay`（备源 2）**。
- **腾讯源 30 秒快轮询**：将腾讯接口（A 股 / 港股 / 美股股指 + 布伦特原油）拆分为 30 秒独立快轮询，东财全量兜底维持 5 分钟防风控，兼顾实时性与稳定性，消除无 VPN 环境下的后台网络报错。

### `v0.11.0` (2026-11-28)
- **模块化重构**：拆分原有单文件脚本与样式为清晰的 `css/` 与 `js/` 目录，保留零构建与 GitHub Pages 直接发布能力。
- **全 7 市场 Float 时钟统一**：A 股、港股、日经、韩股、布伦特原油正式升级为与 BTC/美股一致的纯黑 OLED "Float" 全屏桌面时钟；引入独立冷白渐变双圆球冒号、6 套调色盘选色器、夜间暗红护眼模式、省电静默模式、OLED 像素微移及左/右横屏安全区双向适配。
- **网页 Bento 看板重塑**：采用桌面端 3 列自适应布局，彻底隔离 Float 样式污染；新增行情状态胶囊、涨跌色一键切换（默认绿涨红跌）以及与全屏时钟的双向无刷新跳转；解决轻触屏幕误切市场痛点。
- **时段引擎与 Bug 修复**：
  - 修复美股夏令时起止日期硬编码问题，改为按年份动态计算；
  - 扩展内置日历至 **2026–2027 年**；
  - 重构布伦特原油为 **ICE Futures Europe 官方时段**并动态随英国夏令时换算至北京时间；
  - 采用单点状态逐分钟采样生成 24 小时时间轴，彻底修复美股提前收盘日及跨午夜时段指针与状态色块不一致问题（附 25 项 Node 单元测试）。

---

## 免责声明

本页面展示的所有交易时段、倒计时及市场行情数据仅供参考，可能存在网络延迟、接口波动或节假日临时调整带来的误差，**不构成任何投资建议**。

欢迎提 Issue 反馈日历遗漏、数据源异常或机型适配问题！
