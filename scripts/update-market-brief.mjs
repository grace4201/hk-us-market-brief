import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const dataDir = path.join(root, "data");
const historyDir = path.join(dataDir, "history");
const logsDir = path.join(root, "logs");
const configPath = path.join(root, "config", "watchlist.json");

const UPDATE_HOUR = 8;
const UPDATE_MINUTE = 52;

async function loadWatchlist() {
  const raw = await readFile(configPath, "utf8");
  const parsed = JSON.parse(raw);
  const core = Array.isArray(parsed.core) ? parsed.core : [];
  const custom = Array.isArray(parsed.custom) ? parsed.custom : [];
  return { core, custom, all: [...core, ...custom] };
}

const fmt = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 });
const pct = new Intl.NumberFormat("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function formatDateParts(date = new Date()) {
  const hkParts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Hong_Kong",
    month: "numeric",
    day: "numeric"
  }).formatToParts(date);
  const month = hkParts.find((part) => part.type === "month")?.value;
  const day = hkParts.find((part) => part.type === "day")?.value;
  return { month, day, label: `${month}月${day}日` };
}

function marketDateLabel(timestamp) {
  if (!timestamp) return "最新";
  const date = new Date(timestamp * 1000);
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Hong_Kong",
    month: "numeric",
    day: "numeric"
  }).format(date).replace("/", "/");
}

function latestNumber(values = []) {
  return [...values].reverse().find((value) => Number.isFinite(Number(value)));
}

async function fetchChartQuote(meta) {
  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(meta.yahoo)}`);
  url.searchParams.set("range", "5d");
  url.searchParams.set("interval", "1d");

  const response = await fetch(url, {
    headers: {
      "accept": "application/json",
      "user-agent": "Mozilla/5.0 hk-us-market-brief/1.0"
    }
  });

  if (!response.ok) {
    throw new Error(`Yahoo Finance chart request failed for ${meta.yahoo}: ${response.status} ${response.statusText}`);
  }

  const payload = await response.json();
  const result = payload?.chart?.result?.[0];
  const metaData = result?.meta || {};
  const timestamps = result?.timestamp || [];
  const closes = result?.indicators?.quote?.[0]?.close || [];
  const previousClose = Number(metaData.chartPreviousClose || metaData.previousClose || closes.at(-2) || 0);
  const price = Number(metaData.regularMarketPrice || latestNumber(closes) || 0);
  const change = price - previousClose;
  const changePercent = previousClose ? (change / previousClose) * 100 : 0;

  return normalizeQuote(meta, {
    symbol: metaData.symbol || meta.yahoo,
    shortName: metaData.shortName || meta.yahoo,
    regularMarketPrice: price,
    regularMarketChange: change,
    regularMarketChangePercent: changePercent,
    regularMarketTime: metaData.regularMarketTime || timestamps.at(-1)
  });
}

async function fetchQuotes(symbols) {
  const entries = await Promise.all(symbols.map(async (item) => [item.key, await fetchChartQuote(item)]));
  return Object.fromEntries(entries);
}

// 拉 BTC 近一年日线，算距一年内最高收盘价的回撤幅度，用作周期位置参考
async function fetchBtcYearContext(currentPrice) {
  try {
    const url = new URL("https://query1.finance.yahoo.com/v8/finance/chart/BTC-USD");
    url.searchParams.set("range", "1y");
    url.searchParams.set("interval", "1d");
    const response = await fetch(url, {
      headers: { "accept": "application/json", "user-agent": "Mozilla/5.0 hk-us-market-brief/1.0" }
    });
    if (!response.ok) return null;
    const payload = await response.json();
    const closes = (payload?.chart?.result?.[0]?.indicators?.quote?.[0]?.close || []).filter((v) => Number.isFinite(v));
    if (!closes.length) return null;
    const yearHigh = Math.max(...closes, currentPrice);
    const drawdownPercent = ((currentPrice - yearHigh) / yearHigh) * 100;
    return { yearHigh, drawdownPercent };
  } catch {
    return null;
  }
}

// 上一次比特币减半：2024年4月20日；历史上前三轮牛市都在减半后 12~18 个月见顶
const LAST_HALVING_UTC = Date.UTC(2024, 3, 20);

function halvingCyclePhase() {
  const months = Math.round((Date.now() - LAST_HALVING_UTC) / (30.44 * 24 * 36e5));
  const phase = months < 6
    ? "历史上多为减半后的蓄势期"
    : months < 18
      ? "历史上的主升浪窗口，注意节奏但不必过度悲观"
      : months < 30
        ? "历史上牛市见顶转熊的高风险窗口，建议控制仓位、逐步落袋"
        : "距下次减半渐近，历史上的熊市筑底/分批吸筹阶段";
  return { months, phase };
}

function normalizeQuote(meta, quote = {}) {
  const price = Number(quote.regularMarketPrice ?? 0);
  const change = Number(quote.regularMarketChange ?? 0);
  const changePercent = Number(quote.regularMarketChangePercent ?? 0);
  return {
    ...meta,
    price,
    change,
    changePercent,
    marketTime: quote.regularMarketTime,
    sourceName: quote.shortName || quote.symbol || meta.yahoo
  };
}

function directionWord(changePercent) {
  if (changePercent > 0.05) return "涨";
  if (changePercent < -0.05) return "跌";
  return "微平";
}

function signedNumber(value, suffix = "") {
  const sign = value > 0 ? "+" : "";
  return `${sign}${fmt.format(value)}${suffix}`;
}

function signedPercent(value, withPlus = true) {
  const sign = value > 0 && withPlus ? "+" : "";
  return `${sign}${pct.format(value)}%`;
}

function changePercentText(value) {
  return pct.format(Math.abs(value)) + "%";
}

function quoteLine(quote, unit = "点") {
  if (Math.abs(quote.changePercent) < 0.05) {
    return `${fmt.format(quote.price)}${unit}，微平（${signedNumber(quote.change, unit)}）`;
  }
  return `${fmt.format(quote.price)}${unit}，${directionWord(quote.changePercent)}${changePercentText(quote.changePercent)}（${signedNumber(quote.change, unit)}）`;
}

function stockMoveLine(quotes) {
  return quotes.map((quote) => `${quote.label}${signedPercent(quote.changePercent)}`).join("、");
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function trendWord(value) {
  if (value > 3) return "大涨";
  if (value > 0.8) return "上涨";
  if (value > -0.8) return "震荡走平";
  if (value > -3) return "回落";
  return "大跌";
}

function chipCommentary(soxPercent, chipAvg) {
  if (soxPercent < -5 || chipAvg < -4) return "半导体重挫仍是主导风险";
  if (soxPercent < -2 || chipAvg < -2) return "半导体降温压制风险偏好";
  if (soxPercent > 5 || chipAvg > 4) return "半导体强势领涨支撑风险偏好";
  if (soxPercent > 2 || chipAvg > 2) return "半导体走强对情绪有支撑";
  return "半导体波动有限，非主导变量";
}

function cryptoCommentary(cryptoAvg, btcPercent) {
  if (cryptoAvg > 5 || btcPercent > 6) return "币圈放量普涨、情绪偏热：不建议追高，逢急拉分批止盈更稳妥，杠杆仓注意波动放大。";
  if (cryptoAvg > 2) return "币圈明显走强：持有为主，新仓分批建、控制杠杆，跌破短期支撑再考虑减仓。";
  if (cryptoAvg > -2) return "币圈震荡整理：观望或定投为主，不建议重仓押方向，等待放量突破信号。";
  if (cryptoAvg > -5) return "币圈回调降温：先等企稳信号，分批低吸比一次抄底稳，注意美股科技股联动风险。";
  return "币圈大幅下挫：以控制风险为先，空仓观望不丢人，别急着接飞刀。";
}

// 收盘时间距现在超过 30 小时才算休市（周末/假期跳过了交易日）；
// 正常交易日美股收盘约 4~5 小时后、港股收盘约 17 小时后就会跑更新，都远小于该阈值
const STALE_HOURS = 30;

function marketStatusNote(quotes) {
  const ageHours = (marketTime) => marketTime ? (Date.now() - marketTime * 1000) / 36e5 : Infinity;
  const usStale = ageHours(quotes.dow.marketTime) > STALE_HOURS;
  const hkStale = ageHours(quotes.hsi.marketTime) > STALE_HOURS;
  const note = usStale && hkStale
    ? "美股、港股均在休市（周末/假期），显示的是最近一个交易日的收盘数据。"
    : usStale
      ? "美股休市中（周末/假期），显示的是最近一个交易日的收盘数据。"
      : hkStale
        ? "港股休市中（周末/假期），显示的是最近一个交易日的收盘数据。"
        : null;
  return { usStale, hkStale, note };
}

function buildBrief(quotes, { customSymbols = [], btcYearContext = null } = {}) {
  const reportDate = formatDateParts();
  const usDate = marketDateLabel(quotes.dow.marketTime);
  const hkDate = marketDateLabel(quotes.hsi.marketTime);
  const chipMoves = [quotes.intel, quotes.amd, quotes.tsm, quotes.nvidia];
  const weakChips = chipMoves.filter((quote) => quote.changePercent < -2).length;
  const strongChips = chipMoves.filter((quote) => quote.changePercent > 2).length;
  const hkWeak = quotes.hsi.changePercent < 0 || quotes.hstech.changePercent < 0;

  const usAvg = average([quotes.dow.changePercent, quotes.sp500.changePercent, quotes.nasdaq.changePercent]);
  const hkAvg = average([quotes.hsi.changePercent, quotes.hstech.changePercent]);
  const cryptoAvg = average([quotes.btc.changePercent, quotes.eth.changePercent, quotes.bnb.changePercent]);
  const chipAvg = average(chipMoves.map((quote) => quote.changePercent));
  const chipsNote = chipCommentary(quotes.sox.changePercent, chipAvg);

  const usSignal = `美股三大指数平均${signedPercent(usAvg)}，${weakChips >= 2 || quotes.sox.changePercent < -2
    ? "半导体板块明显承压，AI/芯片链出现获利了结迹象，短线关注资金是否继续从高位科技股撤出。"
    : strongChips >= 2 || quotes.sox.changePercent > 2
      ? "半导体板块重新走强，风险偏好回到成长主线，但仍需观察高位追涨压力。"
      : "科技与半导体暂未给出单边信号，短线继续观察板块轮动。"}`;

  const hkSignal = `恒指、恒生科技平均${signedPercent(hkAvg)}，${hkWeak
    ? "港股反弹力度偏弱，恒指与科技指数仍在关键位附近反复，短线以防守和确认支撑为主。"
    : "港股延续反弹，恒指与科技指数同步走高，但仍需观察成交和持续性。"}`;

  const headline = `美股${trendWord(usAvg)}${changePercentText(usAvg)}，港股${trendWord(hkAvg)}${changePercentText(hkAvg)}，${chipsNote}`;

  const summary = `${headline}；操作上${weakChips >= 2 || hkWeak ? "建议短期谨慎，控制仓位" : "可逢低分批，注意追高风险"}。`;

  return {
    generatedAt: new Date().toISOString(),
    reportDate: reportDate.label,
    updateTime: `${String(UPDATE_HOUR).padStart(2, "0")}:${String(UPDATE_MINUTE).padStart(2, "0")} HKT`,
    nextUpdateHour: UPDATE_HOUR,
    nextUpdateMinute: UPDATE_MINUTE,
    headline,
    deck: `${usDate} 美股收盘数据与 ${hkDate} 港股最新数据自动汇总。内容基于行情变动生成，不自动编写未经验证的传闻。`,
    tape: [quotes.dow, quotes.sp500, quotes.nasdaq, quotes.hsi, quotes.sox, quotes.btc].map((quote) => `${quote.tape} ${signedPercent(quote.changePercent)}`),
    signals: [
      { label: "美股主线", value: `${trendWord(usAvg)}${changePercentText(usAvg)}，${chipsNote}` },
      { label: "港股主线", value: `${trendWord(hkAvg)}${changePercentText(hkAvg)}，${hkWeak ? "反弹力度偏弱" : "反弹持续性待确认"}` },
      { label: "操作基调", value: weakChips >= 2 || hkWeak ? "短期谨慎，控制仓位" : "等待趋势确认后再加仓" }
    ],
    us: {
      title: `${usDate} 收盘`,
      items: [
        { name: "道指", value: quoteLine(quotes.dow) },
        { name: "标普500", value: quoteLine(quotes.sp500) },
        { name: "纳指", value: quoteLine(quotes.nasdaq) },
        { name: "费半", value: `${directionWord(quotes.sox.changePercent)}${changePercentText(quotes.sox.changePercent)}（${signedNumber(quotes.sox.change, "点")}）`, note: quotes.sox.changePercent < -2 ? "半导体链高位获利了结压力较重" : "观察AI/芯片主线能否继续扩散" },
        { name: "芯片股", value: stockMoveLine(chipMoves) },
        { name: "Meta", value: `${signedPercent(quotes.meta.changePercent)}（收 ${fmt.format(quotes.meta.price)} 美元）` }
      ],
      signal: usSignal
    },
    hk: {
      title: `${hkDate} 最新`,
      items: [
        { name: "恒生指数", value: quoteLine(quotes.hsi) },
        { name: "恒生科技", value: quoteLine(quotes.hstech) },
        { name: "盘面节奏", value: hkWeak ? "指数承压，反弹持续性不足" : "指数走高，科技方向回暖" },
        { name: "关键位置", value: `${fmt.format(Math.round(quotes.hsi.price / 100) * 100)} 点附近反复争夺` },
        { name: "风险点", value: "关注解禁、成交额和南向资金变化" }
      ],
      signal: hkSignal
    },
    web3: {
      title: "24小时行情",
      items: [
        { name: "比特币", value: quoteLine(quotes.btc, " 美元") },
        { name: "以太坊", value: quoteLine(quotes.eth, " 美元") },
        { name: "BNB", value: quoteLine(quotes.bnb, " 美元") },
        { name: "Circle", value: `${signedPercent(quotes.crcl.changePercent)}（收 ${fmt.format(quotes.crcl.price)} 美元）`, note: "稳定币 USDC 发行商，Web3 合规化风向标" },
        {
          name: "周期参考",
          value: `距 2024年4月 减半约 ${halvingCyclePhase().months} 个月，${halvingCyclePhase().phase}${btcYearContext ? `；BTC 现价较一年内高点（${fmt.format(btcYearContext.yearHigh)} 美元）回撤 ${pct.format(Math.abs(btcYearContext.drawdownPercent))}%` : ""}`,
          note: "四年减半周期是历史规律而非必然，ETF 时代节奏可能改变，仅供仓位节奏参考"
        }
      ],
      signal: `BTC、ETH、BNB 平均${signedPercent(cryptoAvg)}，${cryptoCommentary(cryptoAvg, quotes.btc.changePercent)}`
    },
    summary,
    sources: ["Yahoo Finance chart API"],
    marketStatus: marketStatusNote(quotes),
    watchlist: customSymbols.map((meta) => ({
      name: meta.label,
      value: `${quoteLine(quotes[meta.key], meta.market === "hk" ? "点" : "美元")}`
    })),
    rawQuotes: Object.fromEntries(Object.entries(quotes).map(([key, quote]) => [key, {
      symbol: quote.yahoo,
      price: quote.price,
      change: quote.change,
      changePercent: quote.changePercent,
      marketTime: quote.marketTime
    }]))
  };
}

function historyFileName(date = new Date()) {
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(date);
  const value = (type) => parts.find((part) => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}-${value("hour")}${value("minute")}.json`;
}

async function readHistoryIndex() {
  try {
    const raw = await readFile(path.join(dataDir, "history-index.json"), "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeBriefFiles(brief) {
  const json = JSON.stringify(brief, null, 2);
  const fileName = historyFileName(new Date(brief.generatedAt));
  const historyPath = `data/history/${fileName}`;
  const existingIndex = await readHistoryIndex();
  const nextIndex = [
    {
      id: brief.generatedAt,
      label: brief.reportDate,
      generatedAt: brief.generatedAt,
      file: historyPath,
      headline: brief.headline,
      summary: brief.summary,
      closes: {
        dow: brief.rawQuotes.dow.changePercent,
        nasdaq: brief.rawQuotes.nasdaq.changePercent,
        hsi: brief.rawQuotes.hsi.changePercent,
        btc: brief.rawQuotes.btc.changePercent
      }
    },
    ...existingIndex.filter((item) => item.id !== brief.generatedAt && item.file !== historyPath && item.label !== brief.reportDate)
  ].slice(0, 365);

  await writeFile(path.join(dataDir, "latest.json"), `${json}\n`, "utf8");
  await writeFile(path.join(dataDir, "latest.js"), `window.MARKET_BRIEF = ${json};\n`, "utf8");
  await writeFile(path.join(historyDir, fileName), `${json}\n`, "utf8");
  await writeFile(path.join(dataDir, "history-index.json"), `${JSON.stringify(nextIndex, null, 2)}\n`, "utf8");
  await writeFile(path.join(dataDir, "history-index.js"), `window.MARKET_HISTORY = ${JSON.stringify(nextIndex, null, 2)};\n`, "utf8");
}

function notifyFailure(error) {
  const message = String(error?.message || error)
    .replace(/[\n\r"]/g, " ")
    .replace(/\\/g, "/")
    .slice(0, 200);
  const script = `display notification "${message}" with title "港美股速报更新失败" sound name "Basso"`;
  execFile("osascript", ["-e", script], () => {});
}

async function main() {
  await mkdir(dataDir, { recursive: true });
  await mkdir(historyDir, { recursive: true });
  await mkdir(logsDir, { recursive: true });

  const watchlist = await loadWatchlist();
  const quotes = await fetchQuotes(watchlist.all);
  const btcYearContext = await fetchBtcYearContext(quotes.btc.price);
  const brief = buildBrief(quotes, { customSymbols: watchlist.custom, btcYearContext });
  await writeBriefFiles(brief);
  console.log(`Updated market brief: ${brief.reportDate} ${brief.generatedAt}`);
}

main().catch((error) => {
  console.error(error);
  notifyFailure(error);
  process.exitCode = 1;
});
