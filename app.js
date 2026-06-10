const DB_FILE = "./chart_database.csv";

const EXCLUDED_TYPES = new Set(["標準", "全體難", "最後不能鬆懈"]);

let lastRecommendations = [];

const $ = (id) => document.getElementById(id);

$("analyzeBtn").addEventListener("click", analyze);
$("downloadResultBtn").addEventListener("click", () => {
  if (lastRecommendations.length === 0) return;
  const rows = [
    ["排名", "歌名", "難度", "譜面定數", "推薦區間", "推薦分數", "主分類", "副分類", "技巧標籤", "玩家已有成績", "推薦理由"],
    ...lastRecommendations.map((r, i) => [
      i + 1,
      r.song,
      r.difficulty,
      r.constant,
      r.recommendZone,
      r.recommendScore.toFixed(2),
      r.mainType,
      r.subTypesText,
      r.skillTags,
      r.playerRecordText,
      r.reason
    ])
  ];
  downloadCsv(rows, "chunithm_recommendations.csv");
});

function setStatus(message, kind = "") {
  const el = $("status");
  el.textContent = message;
  el.className = `status ${kind}`;
}

async function analyze() {
  try {
    setStatus("讀取資料中...");
    hideResults();

    const scoreFile = $("scoreFile").files[0];
    if (!scoreFile) {
      setStatus("請先選擇玩家分表 CSV。", "bad");
      return;
    }

    const settings = getSettings();
    const scoreText = await readFileText(scoreFile);
    const scoreRows = normalizeScoreRows(parseCsv(scoreText));

    if (scoreRows.length === 0) {
      setStatus("玩家分表 CSV 沒有讀到有效資料。", "bad");
      return;
    }

    const dbText = await loadDatabaseText();
    const chartRows = normalizeChartRows(parseCsv(dbText));

    if (chartRows.length === 0) {
      setStatus("譜面資料庫沒有讀到有效資料。", "bad");
      return;
    }

    const result = runAnalysis(scoreRows, chartRows, settings);
    renderAll(result);
    setStatus("分析完成。", "good");
  } catch (err) {
    console.error(err);
    setStatus(`發生錯誤：${err.message}`, "bad");
  }
}

function getSettings() {
  return {
    sampleSize: readNumber("sampleSize", 50),
    scoreThreshold: readNumber("scoreThreshold", 1006000),
    ratingOffset: readNumber("ratingOffset", 2.1),
    recommendCount: readNumber("recommendCount", 50)
  };
}

function readNumber(id, fallback) {
  const value = Number($(id).value);
  return Number.isFinite(value) ? value : fallback;
}

function hideResults() {
  $("summarySection").classList.add("hidden");
  $("typeSection").classList.add("hidden");
  $("recommendSection").classList.add("hidden");
  $("downloadResultBtn").disabled = true;
  lastRecommendations = [];
}

function readFileText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("檔案讀取失敗"));
    reader.readAsText(file, "utf-8");
  });
}

async function loadDatabaseText() {
  const dbFile = $("dbFile").files[0];
  if (dbFile) return await readFileText(dbFile);

  const res = await fetch(DB_FILE, { cache: "no-store" });
  if (!res.ok) {
    throw new Error("讀不到 chart_database.csv。若是在本機直接開 HTML，請改用 Live Server，或手動上傳資料庫 CSV。");
  }
  return await res.text();
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  const src = String(text || "").replace(/^\uFEFF/, "");

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    const next = src[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (ch === "\r") {
      // ignore
    } else {
      cell += ch;
    }
  }

  row.push(cell);
  rows.push(row);

  if (rows.length === 0) return [];

  const headers = rows[0].map(cleanText);
  return rows.slice(1)
    .filter(r => r.some(c => cleanText(c) !== ""))
    .map(r => {
      const obj = {};
      headers.forEach((h, i) => obj[h] = cleanText(r[i] || ""));
      return obj;
    });
}

function normalizeScoreRows(rows) {
  const allSectionRows = extractAllSectionRows(rows);

  return allSectionRows.map(row => {
    const song = row["曲名"] || row["title"] || row["song"] || "";
    const constant = toNumber(row["譜面定數"] || row["定數"] || row["constant"]);
    const score = Math.trunc(toNumber(row["成績"] || row["score"]));
    const rating = toNumber(row["單曲Rating"] || row["評分"] || row["rating"]);
    return {
      rank: row["排名"] || row["#"] || "",
      song: cleanText(song),
      constant,
      grade: row["評級"] || row["grade"] || "",
      score,
      rating,
      combo: row["AJ/FC"] || row["AJ"] || row["combo"] || ""
    };
  }).filter(r => r.song && Number.isFinite(r.score) && Number.isFinite(r.rating));
}

function extractAllSectionRows(rows) {
  const result = [];
  let seenFirstRankOne = false;

  for (const row of rows) {
    const rankText = cleanText(row["排名"] || row["#"] || row["rank"] || "");
    const rank = Number(rankText);

    if (rank === 1) {
      if (seenFirstRankOne && result.length > 0) {
        break;
      }
      seenFirstRankOne = true;
    }

    if (seenFirstRankOne) {
      result.push(row);
    }
  }

  return result.length > 0 ? result : rows;
}

function normalizeChartRows(rows) {
  return rows.map(row => {
    const song = row["歌名"] || "";
    const difficulty = normalizeDifficulty(row["難度"] || "");
    const constant = toNumber(row["譜面定數"] || row["定數"]);
    return {
      song: cleanText(song),
      normSong: normalizeSongName(song),
      difficulty,
      constant,
      mainType: cleanText(row["主分類"] || ""),
      subTypesText: cleanText(row["副分類"] || ""),
      subTypes: splitLabels(row["副分類"] || ""),
      skillTags: cleanText(row["技巧標籤"] || ""),
      uncertainty: cleanText(row["不確定度"] || ""),
      note: cleanText(row["備註"] || "")
    };
  }).filter(r => r.song && r.difficulty);
}

function runAnalysis(scoreRows, chartRows, settings) {
  const sortedScores = [...scoreRows].sort((a, b) => b.rating - a.rating);
  const top30 = sortedScores.slice(0, 30);
  const all30Rating = top30.length >= 30 ? top30[29].rating : sortedScores[sortedScores.length - 1].rating;

  const minUsefulConstant = roundToOne(all30Rating - settings.ratingOffset);

  const stableUpperConstant = calculateStableUpperConstant(sortedScores, all30Rating);
  const challengeUpperConstant = roundToOne(stableUpperConstant + 0.2);
  const insuranceUpperConstant = roundToOne(all30Rating - 1.0);
  let maxUsefulConstant = roundToOne(Math.min(challengeUpperConstant, insuranceUpperConstant));

  if (maxUsefulConstant < minUsefulConstant) {
    maxUsefulConstant = minUsefulConstant;
  }

  const selectedScores = sortedScores
    .slice(0, settings.sampleSize)
    .filter(r => r.score >= settings.scoreThreshold);

  const chartIndex = buildChartIndex(chartRows);
  const selectedWithCharts = [];
  const unmatchedScores = [];

  for (const score of selectedScores) {
    const chart = findBestChartMatch(score, chartIndex);
    if (chart) {
      selectedWithCharts.push({ score, chart });
    } else {
      unmatchedScores.push(score);
    }
  }

  const typeStats = calculateTypeStats(selectedWithCharts, all30Rating);

  const usefulCharts = chartRows.filter(c =>
    Number.isFinite(c.constant) &&
    c.constant >= minUsefulConstant &&
    c.constant <= maxUsefulConstant
  );

  const playerRecordIndex = buildPlayerRecordIndex(scoreRows);

  const recommendations = usefulCharts.map(chart => {
    const typeMatch = calculateChartTypeMatch(chart, typeStats);
    const potential = clamp((chart.constant - minUsefulConstant) / Math.max(0.1, maxUsefulConstant - minUsefulConstant), 0, 1);
    const confidenceScore = typeMatch.confidence;
    const risk = calculateRiskPenalty(chart, typeStats);

    const recommendZone = chart.constant <= stableUpperConstant ? "主推" : "挑戰";

    const recommendScore = Math.max(0, Math.min(100,
      potential * 35 +
      typeMatch.score * 50 +
      confidenceScore * 15 -
      risk
    ));

    const playerRecord = findPlayerRecordForChart(chart, playerRecordIndex);
    const reason = buildReason(chart, typeMatch, recommendZone);

    return {
      ...chart,
      recommendScore,
      recommendZone,
      typeMatchScore: typeMatch.score,
      playerRecord,
      playerRecordText: formatPlayerRecord(playerRecord),
      reason
    };
  })
  .sort((a, b) => {
    if (a.recommendZone !== b.recommendZone) {
      return a.recommendZone === "主推" ? -1 : 1;
    }
    return b.recommendScore - a.recommendScore;
  })
  .slice(0, settings.recommendCount);

  return {
    scoreRows,
    chartRows,
    sortedScores,
    selectedScores,
    selectedWithCharts,
    unmatchedScores,
    typeStats,
    recommendations,
    summary: {
      scoreCount: scoreRows.length,
      chartCount: chartRows.length,
      all30Rating,
      minUsefulConstant,
      stableUpperConstant,
      challengeUpperConstant,
      insuranceUpperConstant,
      maxUsefulConstant,
      selectedCount: selectedScores.length,
      matchedSelectedCount: selectedWithCharts.length,
      usefulChartCount: usefulCharts.length
    }
  };
}

function calculateStableUpperConstant(sortedScores, all30Rating) {
  const threshold = 1005000;
  const minCount = 3;

  const eligible = sortedScores
    .filter(r => Number.isFinite(r.constant) && r.score >= threshold)
    .map(r => ({
      constant: roundToOne(r.constant),
      song: r.song,
      score: r.score
    }));

  if (eligible.length < minCount) {
    return roundToOne(all30Rating - 1.5);
  }

  const candidateConstants = [...new Set(eligible.map(r => r.constant))]
    .sort((a, b) => b - a);

  for (const c of candidateConstants) {
    const count = eligible.filter(r => r.constant >= c).length;
    if (count >= minCount) {
      return c;
    }
  }

  return roundToOne(all30Rating - 1.5);
}

function buildChartIndex(chartRows) {
  const map = new Map();
  for (const chart of chartRows) {
    const key = chart.normSong;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(chart);
  }
  return map;
}

function findBestChartMatch(score, chartIndex) {
  const candidates = chartIndex.get(normalizeSongName(score.song)) || [];
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  if (Number.isFinite(score.constant)) {
    const sorted = [...candidates]
      .filter(c => Number.isFinite(c.constant))
      .map(c => ({ chart: c, diff: Math.abs(c.constant - score.constant) }))
      .sort((a, b) => a.diff - b.diff);

    if (sorted.length > 0 && sorted[0].diff <= 0.11) {
      return sorted[0].chart;
    }
  }

  return candidates[0];
}

function buildPlayerRecordIndex(scoreRows) {
  const map = new Map();
  for (const score of scoreRows) {
    const key = normalizeSongName(score.song);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(score);
  }
  return map;
}

function findPlayerRecordForChart(chart, playerRecordIndex) {
  const candidates = playerRecordIndex.get(chart.normSong) || [];
  if (candidates.length === 0) return null;

  const sorted = candidates.map(r => ({
    record: r,
    diff: Number.isFinite(chart.constant) && Number.isFinite(r.constant)
      ? Math.abs(chart.constant - r.constant)
      : 999
  })).sort((a, b) => a.diff - b.diff || b.record.rating - a.record.rating);

  if (sorted[0].diff <= 0.11 || candidates.length === 1) return sorted[0].record;
  return null;
}

function calculateTypeStats(selectedWithCharts, all30Rating) {
  const stats = new Map();

  for (const item of selectedWithCharts) {
    const { score, chart } = item;
    const weights = getTypeWeights(chart);
    const scoreNorm = clamp((score.score - 1006000) / 4000, 0, 1);
    const ratingDiffScore = clamp(((score.rating - all30Rating) + 0.3) / 0.6, 0, 1);

    for (const [type, weight] of Object.entries(weights)) {
      if (!stats.has(type)) {
        stats.set(type, {
          type,
          weightedScoreNormSum: 0,
          weightedRatingDiffScoreSum: 0,
          weightedScoreSum: 0,
          weightedRatingSum: 0,
          weightSum: 0,
          songs: new Map()
        });
      }

      const s = stats.get(type);
      s.weightedScoreNormSum += scoreNorm * weight;
      s.weightedRatingDiffScoreSum += ratingDiffScore * weight;
      s.weightedScoreSum += score.score * weight;
      s.weightedRatingSum += score.rating * weight;
      s.weightSum += weight;

      const songKey = `${chart.difficulty}|${chart.song}`;
      if (!s.songs.has(songKey)) s.songs.set(songKey, { song: chart.song, rating: score.rating });
    }
  }

  const result = [...stats.values()].map(s => {
    const count = s.songs.size;
    const avgScoreNorm = safeDiv(s.weightedScoreNormSum, s.weightSum);
    const avgRatingDiffScore = safeDiv(s.weightedRatingDiffScoreSum, s.weightSum);
    const confidence = Math.min(count / 5, 1);
    const typeScore = avgScoreNorm * 45 + avgRatingDiffScore * 40 + confidence * 15;

    return {
      ...s,
      count,
      avgScoreNorm,
      avgRatingDiffScore,
      confidence,
      typeScore,
      avgScore: safeDiv(s.weightedScoreSum, s.weightSum),
      avgRating: safeDiv(s.weightedRatingSum, s.weightSum),
      representativeSongs: [...s.songs.values()]
        .sort((a, b) => b.rating - a.rating)
        .slice(0, 4)
        .map(x => x.song)
    };
  }).sort((a, b) => b.typeScore - a.typeScore);

  return result;
}

function getTypeWeights(chart) {
  const weights = {};
  const main = cleanText(chart.mainType);
  const mainValid = main && !EXCLUDED_TYPES.has(main);

  const validSubTypes = chart.subTypes
    .map(cleanText)
    .filter(t => t && !EXCLUDED_TYPES.has(t));

  if (mainValid) {
    weights[main] = (weights[main] || 0) + 1;
    if (validSubTypes.length > 0) {
      const w = 1 / validSubTypes.length;
      for (const t of validSubTypes) weights[t] = (weights[t] || 0) + w;
    }
  } else {
    if (validSubTypes.length > 0) {
      const w = 2 / validSubTypes.length;
      for (const t of validSubTypes) weights[t] = (weights[t] || 0) + w;
    }
  }

  return weights;
}

function calculateChartTypeMatch(chart, typeStats) {
  const weights = getTypeWeights(chart);
  const statMap = new Map(typeStats.map(s => [s.type, s]));

  let scoreSum = 0;
  let confidenceSum = 0;
  let weightSum = 0;
  const matchedTypes = [];

  for (const [type, weight] of Object.entries(weights)) {
    const stat = statMap.get(type);
    if (!stat) continue;
    scoreSum += (stat.typeScore / 100) * weight;
    confidenceSum += stat.confidence * weight;
    weightSum += weight;
    matchedTypes.push(type);
  }

  if (weightSum === 0) {
    return { score: 0.3, confidence: 0, matchedTypes: [] };
  }

  return {
    score: scoreSum / weightSum,
    confidence: confidenceSum / weightSum,
    matchedTypes
  };
}

function calculateRiskPenalty(chart, typeStats) {
  const statMap = new Map(typeStats.map(s => [s.type, s]));
  let risk = 0;

  const main = cleanText(chart.mainType);
  if (main && !EXCLUDED_TYPES.has(main)) {
    const mainStat = statMap.get(main);
    if (mainStat && mainStat.typeScore < 35) risk += 8;
  }

  if (chart.uncertainty === "高") risk += 8;
  if (chart.uncertainty === "中高") risk += 5;

  return risk;
}

function buildReason(chart, typeMatch, recommendZone = "") {
  const zoneText = recommendZone ? `${recommendZone}區間；` : "";

  if (typeMatch.matchedTypes.length === 0) {
    return `${zoneText}分類參考：${chart.mainType} / ${chart.subTypesText}`;
  }

  return `${zoneText}符合高分池類型：${typeMatch.matchedTypes.slice(0, 3).join("、")}`;
}

function renderAll(result) {
  renderSummary(result);
  renderTypeTable(result.typeStats);
  renderRecommendTable(result.recommendations);

  lastRecommendations = result.recommendations;
  $("summarySection").classList.remove("hidden");
  $("typeSection").classList.remove("hidden");
  $("recommendSection").classList.remove("hidden");
  $("downloadResultBtn").disabled = false;
}

function renderSummary(result) {
  const s = result.summary;
  const cards = [
    ["玩家 All 筆數", s.scoreCount],
    ["資料庫譜面數", s.chartCount],
    ["All 第 30 名 Rating", s.all30Rating.toFixed(2)],
    ["最低推分定數", s.minUsefulConstant.toFixed(1)],
    ["穩定上限", s.stableUpperConstant.toFixed(1)],
    ["挑戰上限", s.challengeUpperConstant.toFixed(1)],
    ["上限保險", s.insuranceUpperConstant.toFixed(1)],
    ["最高推薦定數", s.maxUsefulConstant.toFixed(1)],
    ["入選歌曲", s.selectedCount],
    ["成功匹配資料庫", s.matchedSelectedCount],
    ["有用歌曲數", s.usefulChartCount],
    ["推薦輸出", result.recommendations.length]
  ];

  $("summaryCards").innerHTML = cards.map(([label, value]) => `
    <div class="summary-card">
      <div class="label">${escapeHtml(label)}</div>
      <div class="value">${escapeHtml(value)}</div>
    </div>
  `).join("");

  const warningItems = [];
  if (result.unmatchedScores.length > 0) {
    warningItems.push(`有 ${result.unmatchedScores.length} 首入選歌曲沒有成功對到資料庫：${result.unmatchedScores.slice(0, 8).map(x => x.song).join("、")}${result.unmatchedScores.length > 8 ? "…" : ""}`);
  }
  if (s.matchedSelectedCount < 10) {
    warningItems.push("成功匹配的入選歌曲偏少，分類適性可能不穩。請檢查歌名是否和資料庫一致。");
  }

  $("warnings").innerHTML = warningItems.map(w => `<div class="warning-item">${escapeHtml(w)}</div>`).join("");
}

function renderTypeTable(typeStats) {
  const tbody = $("typeTable").querySelector("tbody");
  tbody.innerHTML = typeStats.map((s, i) => `
    <tr>
      <td>${i + 1}</td>
      <td><strong>${escapeHtml(s.type)}</strong></td>
      <td class="score">${s.typeScore.toFixed(1)}</td>
      <td>${Math.round(s.avgScore).toLocaleString()}</td>
      <td>${s.avgRating.toFixed(2)}</td>
      <td>${s.count}</td>
      <td class="tags">${escapeHtml(s.representativeSongs.join("、"))}</td>
    </tr>
  `).join("");
}

function renderRecommendTable(recommendations) {
  const tbody = $("recommendTable").querySelector("tbody");
  tbody.innerHTML = recommendations.map((r, i) => `
    <tr>
      <td>${i + 1}</td>
      <td><strong>${escapeHtml(r.song)}</strong></td>
      <td>${escapeHtml(r.difficulty)}</td>
      <td>${r.constant.toFixed(1)}</td>
      <td>${escapeHtml(r.recommendZone)}</td>
      <td class="score">${r.recommendScore.toFixed(1)}</td>
      <td>${escapeHtml(r.mainType)}</td>
      <td class="tags">${escapeHtml(r.subTypesText)}</td>
      <td class="tags">${escapeHtml(r.skillTags || "")}</td>
      <td>${escapeHtml(r.playerRecordText)}</td>
      <td class="reason">${escapeHtml(r.reason)}</td>
    </tr>
  `).join("");
}

function formatPlayerRecord(record) {
  if (!record) return "";
  return `${record.score.toLocaleString()} / ${record.rating.toFixed(2)}${record.grade ? " / " + record.grade : ""}`;
}

function splitLabels(text) {
  return cleanText(text)
    .split(/[,\uFF0C、/／]/)
    .map(s => cleanText(s))
    .filter(Boolean);
}

function cleanText(text) {
  return String(text ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSongName(text) {
  let s = cleanText(text)
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[‐-‒–—―－ーｰ]/g, "-")
    .replace(/[：:]/g, ":")
    .replace(/[！!]/g, "!")
    .replace(/[？?]/g, "?")
    .replace(/[～~〜]/g, "~")
    .replace(/[「」『』【】\[\]（）()]/g, "")
    .replace(/\s+/g, "")
    .replace(/[・･]/g, "")
    .replace(/[＿_]/g, "")
    .replace(/[.,，、]/g, "")
    .trim();

  s = s.replace(/-/g, "");

  return SONG_ALIASES.get(s) || s;
}

function normalizeDifficulty(text) {
  const t = cleanText(text).toLowerCase();
  if (t.startsWith("mas")) return "master";
  if (t.startsWith("ult")) return "ultima";
  if (t.startsWith("exp")) return "expert";
  return t;
}

function toNumber(value) {
  const s = cleanText(value);
  if (!s) return NaN;
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : NaN;
}

function roundToOne(n) {
  return Math.round(n * 10) / 10;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function safeDiv(a, b) {
  return b ? a / b : 0;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function csvEscape(value) {
  const s = String(value ?? "");
  return `"${s.replaceAll('"', '""')}"`;
}

function downloadCsv(rows, filename) {
  const csv = rows.map(r => r.map(csvEscape).join(",")).join("\r\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
