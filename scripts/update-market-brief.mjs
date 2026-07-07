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

function marketStatusNote(quotes, prevRawQuotes) {
  if (!prevRawQuotes) return { usStale: false, hkStale: false, note: null };
  const usStale = Boolean(prevRawQuotes.dow) && prevRawQuotes.dow.marketTime === quotes.dow.marketTime;
  const hkStale = Boolean(prevRawQuotes.hsi) && prevRawQuotes.hsi.marketTime === quotes.hsi.marketTime;
  const note = usStale && hkStale
    ? "美股、港股均处于休市，本次数据与上次一致。"
    : usStale
      ? "美股休市中，美股数据与上次一致。"
      : hkStale
        ? "港股休市中，港股数据与上次一致。"
        : null;
  return { usStale, hkStale, note };
}

function buildBrief(quotes, { customSymbols = [], prevRawQuotes = null } = {}) {
  const reportDate = formatDateParts();
  const usDate = marketDateLabel(quotes.dow.marketTime);
  const hkDate = marketDateLabel(quotes.hsi.marketTime);
  const chipMoves = [quotes.intel, quotes.amd, quotes.tsm, quotes.nvidia];
  const weakChips = chipMoves.filter((quote) => quote.changePercent < -2).length;
  const strongChips = chipMoves.filter((quote) => quote.changePercent > 2).length;
  const hkWeak = quotes.hsi.changePercent < 0 || quotes.hstech.changePercent < 0;

  const usAvg = average([quotes.dow.changePercent, quotes.sp500.changePercent, quotes.nasdaq.changePercent]);
  const hkAvg = average([quotes.hsi.changePercent, quotes.hstech.changePercent]);
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
    tape: [quotes.dow, quotes.sp500, quotes.nasdaq, quotes.hsi, quotes.sox].map((quote) => `${quote.tape} ${signedPercent(quote.changePercent)}`),
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
    summary,
    sources: ["Yahoo Finance chart API"],
    marketStatus: marketStatusNote(quotes, prevRawQuotes),
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
        hsi: brief.rawQuotes.hsi.changePercent
      }
    },
    ...existingIndex.filter((item) => item.id !== brief.generatedAt && item.file !== historyPath)
  ].slice(0, 365);

  await writeFile(path.join(dataDir, "latest.json"), `${json}\n`, "utf8");
  await writeFile(path.join(dataDir, "latest.js"), `window.MARKET_BRIEF = ${json};\n`, "utf8");
  await writeFile(path.join(historyDir, fileName), `${json}\n`, "utf8");
  await writeFile(path.join(dataDir, "history-index.json"), `${JSON.stringify(nextIndex, null, 2)}\n`, "utf8");
  await writeFile(path.join(dataDir, "history-index.js"), `window.MARKET_HISTORY = ${JSON.stringify(nextIndex, null, 2)};\n`, "utf8");
}

async function readPreviousRawQuotes() {
  try {
    const raw = await readFile(path.join(dataDir, "latest.json"), "utf8");
    return JSON.parse(raw)?.rawQuotes || null;
  } catch {
    return null;
  }
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
  const prevRawQuotes = await readPreviousRawQuotes();
  const quotes = await fetchQuotes(watchlist.all);
  const brief = buildBrief(quotes, { customSymbols: watchlist.custom, prevRawQuotes });
  await writeBriefFiles(brief);
  console.log(`Updated market brief: ${brief.reportDate} ${brief.generatedAt}`);
}

main().catch((error) => {
  console.error(error);
  notifyFailure(error);
  process.exitCode = 1;
});
