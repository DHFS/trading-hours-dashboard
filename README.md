# 交易时段看板（北京时间）

一个「打开即知」的全球交易时段看板。以北京时间为基准，实时显示 A股、港股、日经、韩股、美股、加密货币（BTC）与布伦特原油的开休市状态、倒计时和行情，并正确处理节假日、美股夏令时与提前收盘日。

线上地址：<https://dhfs.github.io/trading-hours-dashboard/>

设计为 iPhone 横屏桌面时钟（PWA）优化：全屏、纯黑画布、巨大 Float 数字、按位差分滚动，可在约 1 米距离辨认关键数字。

## 特性

- 北京时间基准（`Asia/Shanghai`），与访问者所在时区无关。
- 7 个市场：A股、港股、日经、韩股、美股、加密货币（仅 BTC）、布伦特原油。
- 7 种状态：交易中、午间休市、盘前、盘后、隔夜休市、周末休市、休市（节假日）。
- 普通多卡片模式：加密货币置顶，其余市场按距下一次开盘时间动态升序排列。
- 全屏时钟模式：hash 切换市场，点击/左右滑动切换；分页圆点仅在切换后短暂显示。
- BTC 接入 Binance WebSocket 实时推送，价格按位差分滚动；指数类行情 5 分钟轮询以规避数据源风控。
- 美股隔夜/周末/节假日显示「距开盘」倒计时；盘前/盘中/盘后显示纳斯达克指数整数。
- PWA 支持：主屏图标、独立显示、Service Worker 网络优先缓存，改版后无需手动强刷。
- 纯静态，无后端、无框架、无构建步骤，可直接部署 GitHub Pages。

## 设计标准

完整视觉与动效规范见 [DESIGN.md](DESIGN.md)，包括：

- Float v3 三层数字结构与按位差分滚动规则
- 纯黑画布、多色预设、错落倾斜、呼吸动画
- 实时字体测量与右侧防截断策略
- BTC / 美股全屏卡片细则
- PWA 缓存与验收清单

项目从零重建所需的提示词见 [PROMPT.md](PROMPT.md)。

## 文件结构

```text
index.html   页面结构、动态资源版本号、Service Worker 注册
style.css    暗色主题、普通卡片与全屏 Float 时钟样式
app.js       时段判定、倒计时、行情、WebSocket、渲染与差分动画
data.js      节假日数据、市场配置、状态元信息
sw.js        Service Worker：同源资源 network-first
manifest.json PWA 清单（含版本化 start_url）
icon-*.png   PWA 图标
DESIGN.md    设计标准（Float v3）
PROMPT.md    项目提示词
README.md    本文件
```

## 使用方式

### 普通网页

打开线上地址即可。页面默认展示多卡片看板，桌面浏览器中也可使用。

### iPhone 横屏桌面时钟

1. 用 Safari 打开线上地址。
2. 分享 → 添加到主屏幕。
3. 从主屏图标打开，横屏使用。
4. 点击屏幕或左右滑动切换市场；URL hash 会同步当前市场。

> 如果 `manifest.json` 的 `start_url` 版本号发生变化，需要删除主屏图标后重新添加，以绕开 iOS 主屏 PWA 的旧缓存条目。正常运行期间由 Service Worker 负责自动获取新版本。

## 数据源

| 数据 | 主源 | 兜底 |
|------|------|------|
| A股 / 港股 / 美股指数 | 腾讯 `qt.gtimg.cn` | 东方财富 |
| 日经 / KOSPI | 东方财富 `stock/get` | 腾讯 ETF 按昨收基准估算 |
| BTC | Binance WebSocket `data-stream.binance.vision` | Binance REST 镜像 |
| 布伦特原油 | 东方财富 `112.B00Y` | 无 |

东方财富对高频请求和部分家庭宽带 IP 有风控，因此指数轮询间隔保持 5 分钟。行情失败时显示 `--`，不展示误导性旧值。

涨跌色当前实现为：涨 `#22C55E`（绿），跌 `#EF4444`（红）；状态色与涨跌色是两套语义，详见 [DESIGN.md](DESIGN.md)。

## 数据更新

节假日数据集中在 `data.js` 顶部的 `HOLIDAYS` 对象中，按市场分类：

- `aShare`：A股休市区间（`[起, 止]` 闭区间，含周末）
- `hk` / `hkHalf`：港股休市日 / 半日市
- `jp` / `kr`：日经与韩股休市日
- `us` / `usEarly`：美股全休市日 / 提前收盘日

当前 `DATA_YEAR = 2026`。每年末需根据各交易所官方公告更新下一年的数据并同步修改 `DATA_YEAR`。若当前日期超出覆盖范围，页面顶部会提示需更新数据。

## 本地预览

```bash
cd trading-hours-dashboard
python3 -m http.server 8080
# 打开 http://localhost:8080
```

## 部署

仓库 `DHFS/trading-hours-dashboard` 已开启 GitHub Pages。推送到 `main` 后由 Pages 自动构建发布。

如遇本地代理失效导致推送失败，可直连推送：

```bash
git -c http.proxy= -c https.proxy= push
```

线上验证静态资源时建议绕过本地代理与浏览器缓存，避免误判部署未生效：

```bash
curl --noproxy '*' https://dhfs.github.io/trading-hours-dashboard/app.js
```

## 免责声明

本页面行情与时段信息仅供参考，可能存在延迟或误差，不构成任何投资建议。
