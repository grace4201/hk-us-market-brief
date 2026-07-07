const FALLBACK_BRIEF = {
  generatedAt: "2026-07-03T04:00:00.000Z",
  reportDate: "7月3日",
  updateTime: "08:30 HKT",
  nextUpdateHour: 8,
  nextUpdateMinute: 30,
  headline: "美股高位震荡，港股弱势反弹",
  deck: "半导体获利了结信号明显，港股 23000 点附近反复争夺。短线以风险控制和板块轮动观察为主。",
  tape: ["DJIA +1.14%", "S&P 500 -0.22%", "NASDAQ -0.66%", "HSI +174", "SOX -6.27%"],
  signals: [
    { label: "美股主线", value: "科技与半导体高位降温" },
    { label: "港股主线", value: "反弹力度偏弱，解禁压力升温" },
    { label: "操作基调", value: "短期谨慎，等待新方向确认" }
  ],
  us: { title: "7/2 收盘", items: [], signal: "上半年科技股/半导体涨太猛，7月开始出现板块轮动 + 获利了结。" },
  hk: { title: "7/2 七一假期后复市", items: [], signal: "港股反弹力度弱，23000关口反复争夺，7月解禁潮是压力。" },
  summary: "美股高位震荡，半导体见顶信号明显；港股弱势反弹，短期谨慎为主。"
};

let briefData = window.MARKET_BRIEF || FALLBACK_BRIEF;
const historyItems = window.MARKET_HISTORY || [];

const text = (selector, value) => {
  const node = document.querySelector(selector);
  if (node) node.textContent = value || "--";
};

function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;"
  }[char]));
}

const renderList = (selector, items = []) => {
  const node = document.querySelector(selector);
  if (!node) return;
  node.innerHTML = items.map((item) => `
    <li>
      <b>${escapeHtml(item.name)}</b>
      <span>${escapeHtml(item.value)}</span>
      ${item.note ? `<em>${escapeHtml(item.note)}</em>` : ""}
    </li>
  `).join("");
};

const renderSignals = () => {
  const node = document.querySelector("#signalStrip");
  if (!node) return;
  node.innerHTML = (briefData.signals || []).map((signal) => `
    <article><span>${escapeHtml(signal.label)}</span><strong>${escapeHtml(signal.value)}</strong></article>
  `).join("");
};

const renderTape = () => {
  const node = document.querySelector("#marketTape");
  if (!node) return;
  node.innerHTML = (briefData.tape || []).map((item) => `<span>${escapeHtml(item)}</span>`).join("");
};

const renderMarketStatus = () => {
  const node = document.querySelector("#marketStatusBanner");
  if (!node) return;
  const note = briefData.marketStatus?.note;
  if (!note) {
    node.hidden = true;
    node.textContent = "";
    return;
  }
  node.hidden = false;
  node.textContent = `休市提示：${note}`;
};

const renderWatchlist = () => {
  const section = document.querySelector("#watchlistSection");
  if (!section) return;
  const items = briefData.watchlist || [];
  if (!items.length) {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  renderList("#watchlistList", items);
};

const TREND_LINES = [
  { key: "dow", label: "道指", color: "#c53b2d" },
  { key: "nasdaq", label: "纳指", color: "#b88734" },
  { key: "hsi", label: "恒指", color: "#176b4d" },
  { key: "btc", label: "BTC", color: "#f7931a" }
];

function renderTrendChart() {
  const node = document.querySelector("#trendChart");
  if (!node) return;

  const points = [...historyItems]
    .filter((item) => item.closes)
    .sort((a, b) => new Date(a.generatedAt) - new Date(b.generatedAt));

  if (points.length < 2) {
    node.innerHTML = `<p class="trend-empty">数据积累中，多跑几天自动更新后这里会显示涨跌幅走势。</p>`;
    return;
  }

  const width = 640;
  const height = 200;
  const padX = 20;
  const padY = 20;
  const allValues = points.flatMap((p) => TREND_LINES.map((line) => p.closes[line.key]).filter((v) => Number.isFinite(v)));
  const maxAbs = Math.max(2, ...allValues.map((v) => Math.abs(v)));
  const xStep = (width - padX * 2) / (points.length - 1);
  const yFor = (value) => height / 2 - (value / maxAbs) * (height / 2 - padY);
  const xFor = (index) => padX + index * xStep;

  // 旧历史数据里可能缺某条线（比如后来才加的 BTC），缺的点直接跳过不画
  const paths = TREND_LINES.map((line) => {
    let d = "";
    let started = false;
    points.forEach((p, index) => {
      const value = p.closes[line.key];
      if (!Number.isFinite(value)) { started = false; return; }
      d += `${started ? "L" : "M"}${xFor(index).toFixed(1)},${yFor(value).toFixed(1)} `;
      started = true;
    });
    return d ? `<path d="${d.trim()}" fill="none" stroke="${line.color}" stroke-width="2.5" />` : "";
  }).join("");

  const dots = TREND_LINES.flatMap((line) => points.map((p, index) => {
    const value = p.closes[line.key];
    if (!Number.isFinite(value)) return "";
    return `<circle cx="${xFor(index).toFixed(1)}" cy="${yFor(value).toFixed(1)}" r="3" fill="${line.color}" />`;
  })).join("");

  const labels = points.map((p, index) => `
    <text x="${xFor(index).toFixed(1)}" y="${height - 4}" font-size="11" fill="var(--muted)" text-anchor="middle">${escapeHtml(p.label || "")}</text>
  `).join("");

  const legend = TREND_LINES.map((line) => `
    <span class="trend-legend-item"><i style="background:${line.color}"></i>${escapeHtml(line.label)}</span>
  `).join("");

  node.innerHTML = `
    <div class="trend-legend">${legend}</div>
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="近期涨跌幅走势图">
      <line x1="${padX}" y1="${height / 2}" x2="${width - padX}" y2="${height / 2}" stroke="var(--line)" stroke-dasharray="4 4" />
      ${paths}
      ${dots}
      ${labels}
    </svg>
  `;
}

function getNextUpdateText() {
  const now = new Date();
  const next = new Date(now);
  next.setHours(briefData.nextUpdateHour || 8, briefData.nextUpdateMinute || 30, 0, 0);
  if (now >= next) next.setDate(next.getDate() + 1);

  const diffMs = next - now;
  const hours = Math.floor(diffMs / 36e5);
  const minutes = Math.floor((diffMs % 36e5) / 6e4);
  return `下一次计划更新：约 ${hours} 小时 ${minutes} 分钟后`;
}

function formatGeneratedAt(value) {
  if (!value) return "暂无生成时间";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Hong_Kong",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function fileSafeDate(value) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(new Date(value)).filter((part) => part.type !== "literal").map((part) => part.value).join("-");
}

function exportDateLabel(value) {
  const date = value ? new Date(value) : new Date();
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Hong_Kong",
    month: "numeric",
    day: "2-digit"
  }).formatToParts(date);
  const month = parts.find((part) => part.type === "month")?.value || "";
  const day = parts.find((part) => part.type === "day")?.value || "";
  return `<span>${month}月</span><span>${day}日</span>`;
}

function exportHeadlineHtml(value = "") {
  return escapeHtml(value)
    .replace(/，/g, "，<br>")
    .replace(/；/g, "；<br>");
}

function renderBrief() {
  text("#reportDate", briefData.reportDate);
  text("#updateRule", `每日固定更新 · ${briefData.updateTime || "08:30 HKT"}`);
  text("#headline", briefData.headline);
  document.querySelector("#headline")?.classList.toggle("headline-long", (briefData.headline || "").length > 20);
  text("#deck", briefData.deck);
  text("#usTitle", briefData.us?.title);
  text("#hkTitle", briefData.hk?.title);
  text("#usSignal", briefData.us?.signal);
  text("#hkSignal", briefData.hk?.signal);

  const web3Card = document.querySelector("#web3Card");
  if (web3Card) {
    web3Card.hidden = !briefData.web3;
    if (briefData.web3) {
      text("#web3Title", briefData.web3.title);
      text("#web3Signal", briefData.web3.signal);
      renderList("#web3List", briefData.web3.items);
    }
  }
  text("#summary", briefData.summary);
  text("title", `港美股行情速报｜${briefData.reportDate}`);

  renderTape();
  renderSignals();
  renderList("#usList", briefData.us?.items);
  renderList("#hkList", briefData.hk?.items);
  renderMarketStatus();
  renderWatchlist();
  renderTrendChart();

  const status = document.querySelector("#updateStatus");
  if (status) {
    status.innerHTML = `最新数据生成于 ${escapeHtml(formatGeneratedAt(briefData.generatedAt))}。历史会自动保存在 <code>data/history/</code>，可在上方切换查看。 <strong class="next-update">${escapeHtml(getNextUpdateText())}</strong>`;
  }
}

function populateHistorySelect() {
  const select = document.querySelector("#historySelect");
  if (!select) return;

  const latestOption = {
    id: briefData.generatedAt || "latest",
    label: `${briefData.reportDate || "最新"} · 最新`,
    generatedAt: briefData.generatedAt,
    file: "data/latest.json"
  };
  const options = [latestOption, ...historyItems.filter((item) => item.file !== latestOption.file && item.id !== latestOption.id)];

  select.innerHTML = options.map((item, index) => `
    <option value="${escapeHtml(item.file)}" ${index === 0 ? "selected" : ""}>
      ${escapeHtml(item.label || "历史速报")} · ${escapeHtml(formatGeneratedAt(item.generatedAt))}
    </option>
  `).join("");
}

function initHistorySelect() {
  const select = document.querySelector("#historySelect");
  if (!select) return;

  populateHistorySelect();

  select.addEventListener("change", async (event) => {
    const file = event.target.value;
    const response = await fetch(file, { cache: "no-store" });
    if (!response.ok) throw new Error(`历史数据读取失败：${response.status}`);
    briefData = await response.json();
    renderBrief();
  });
}

// GitHub Pages/手机浏览器会缓存 data/*.js，打开页面后绕过缓存再拉一次最新数据，有更新就直接换上
async function refreshFromNetwork() {
  try {
    const [latestRes, historyRes] = await Promise.all([
      fetch("data/latest.json", { cache: "no-store" }),
      fetch("data/history-index.json", { cache: "no-store" })
    ]);
    if (!latestRes.ok || !historyRes.ok) return;
    const latest = await latestRes.json();
    const history = await historyRes.json();
    const changed = latest.generatedAt !== briefData.generatedAt
      || history.length !== historyItems.length
      || (history[0]?.id !== historyItems[0]?.id);
    if (!changed) return;
    briefData = latest;
    historyItems.length = 0;
    historyItems.push(...history);
    renderBrief();
    populateHistorySelect();
  } catch {
    // 本地 file:// 打开或断网时静默跳过，页面继续用内嵌数据
  }
}

async function downloadCurrentImage() {
  const button = document.querySelector("#downloadImage");
  const target = document.querySelector("#captureArea");
  if (!target || !window.html2canvas) return;

  button.disabled = true;
  button.textContent = "生成图片中...";
  document.body.classList.add("exporting");
  const reportDateNode = document.querySelector("#reportDate");
  const headlineNode = document.querySelector("#headline");
  const originalReportDate = reportDateNode?.innerHTML;
  const originalHeadline = headlineNode?.innerHTML;
  if (reportDateNode) reportDateNode.innerHTML = exportDateLabel(briefData.generatedAt);
  if (headlineNode) headlineNode.innerHTML = exportHeadlineHtml(briefData.headline);
  try {
    await document.fonts?.ready;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const canvas = await html2canvas(target, {
      backgroundColor: "#f7efe2",
      scale: Math.min(2, window.devicePixelRatio || 1.5),
      useCORS: true,
      logging: false,
      windowWidth: target.scrollWidth,
      windowHeight: target.scrollHeight
    });
    const link = document.createElement("a");
    link.download = `港美股行情速报-${fileSafeDate(briefData.generatedAt || new Date())}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  } finally {
    if (reportDateNode && originalReportDate) reportDateNode.innerHTML = originalReportDate;
    if (headlineNode && originalHeadline) headlineNode.innerHTML = originalHeadline;
    document.body.classList.remove("exporting");
    button.disabled = false;
    button.textContent = "下载当前速报图片";
  }
}

function initDownload() {
  const button = document.querySelector("#downloadImage");
  if (!button) return;
  button.addEventListener("click", downloadCurrentImage);
}

renderBrief();
initHistorySelect();
initDownload();
refreshFromNetwork();
