# 港美股行情速报

静态网站 + 自动行情抓取脚本。部署在 GitHub Pages 上，手机、电脑浏览器随时可看；数据由 GitHub Actions 每天香港时间 08:52 在云端自动更新，不依赖本地电脑开机。

## 手机/外网访问

直接打开：<https://grace4201.github.io/hk-us-market-brief/>

## 本地打开

最简单：双击 `打开网页.command`，会自动起本地服务并用浏览器打开。**不要直接双击 `index.html`**——那样地址栏是 `file://` 开头，历史速报切换会因为浏览器限制读不到数据。

也可以手动起服务：

```bash
cd ~/hk-us-market-brief
python3 -m http.server 4173
```

然后打开：`http://localhost:4173`

## 手动跑一次自动更新

```bash
cd ~/hk-us-market-brief
node scripts/update-market-brief.mjs
```

脚本会从 Yahoo Finance chart API 拉取主要指数和重点股票，生成：

- `data/latest.json` / `data/latest.js`
- `data/history/*.json`（每次运行存一份历史）
- `data/history-index.json` / `.js`（历史索引，供页面下拉框和走势图使用）

网页读取 `data/latest.js`，不需要人工改 HTML。

## 关注的股票/指数配置

`config/watchlist.json` 分两组：

- `core`：速报固定版面用到的指数和股票（道指、标普、纳指、费半、恒指、恒生科技、英特尔/超微/台积电/辉达/Meta，以及 Web3 卡片的比特币/以太坊/BNB/Circle）。**这些 key 是 `scripts/update-market-brief.mjs` 里写死引用的，删掉会导致生成失败**，只能改 `yahoo` 代码替换，不能删 key。
- `custom`：额外自选股，格式同 `core`（`key`/`label`/`yahoo`/`market`），随便加。加进去的会出现在页面「自选股」卡片里，不会影响固定版面。

## 休市提示

脚本每次运行会把这次抓到的美股/港股最新收盘时间戳和上一次比较，如果一样（说明市场没开盘，比如周末/假期），会在 `latest.json` 里标记 `marketStatus`，页面顶部会出现「休市提示」横幅，避免误以为没更新。

## 近期走势图

页面新增「近期涨跌幅走势」图表，用 `data/history-index.json` 里积累的历史涨跌幅画折线图（道指/纳指/恒指）。数据攒够 2 天以上才会显示，历史数据不够时会显示提示文案。

## 每天自动更新（云端）

定时任务在 GitHub Actions 上跑，配置文件：`.github/workflows/update.yml`。

- 每天 `00:52 UTC`（= 香港时间 08:52）自动抓行情、提交新数据，GitHub Pages 随之自动重新发布。
- 改时间：编辑 workflow 里的 `cron`（注意写的是 UTC 时间，比香港慢 8 小时）。
- 手动触发一次：GitHub 仓库页面 → Actions → 「每日更新行情数据」→ Run workflow。
- 如果某天抓取失败，GitHub 会给账号邮箱发失败通知邮件；本地手动跑失败时还会弹 macOS 系统通知。

本地电脑不再需要定时任务，关机不影响网站更新。
