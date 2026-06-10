const APP_VERSION = "v0.1.8";
console.log("CHUNI PUSH TOOL", APP_VERSION);

const DB_FILE = "./chart_database.csv";

const EXCLUDED_TYPES = new Set(["標準", "全體難", "最後不能鬆懈"]);

const SONG_ALIASES = new Map([
  ["re:end of a dream", "re:end of a dream"],
  ["re:endofadream", "re:endofadream"],

  ["赤壁大炎上", "赤壁大炎上"],

  ["回帰scherzoフォルトゥーナの悪戯", "回帰scherzoフォルトゥーナの悪戯"],
  ["回帰scherzo", "回帰scherzoフォルトゥーナの悪戯"],

  ["ビッグブリッヂの死闘シアトリズムffacarrangefromffv", "ビッグブリッヂの死闘シアトリズムffacarrangefromffv"],

  ["献身paradoxofchoice", "献身paradoxofchoice"],
  ["献身", "献身paradoxofchoice"]
]);

let lastRecommendations = [];

const $ = (id) => document.getElementById(id);

$("analyzeBtn").addEventListener("click", analyze);
$("downloadResultBtn").addEventListener("click", () => {
  if (lastRecommendations.length === 0) return;
  const rows = [
    ["排名", "推薦區間", "歌名", "難度", "譜面定數", "推薦分數", "主分類", "副分類", "技巧標籤", "玩家已有成績", "目標成績", "推薦理由"],
    ...lastRecommendations.map((r, i) => [
      i + 1,
      r.recommendZone,
      r.song,
      r.difficulty,
      r.constant,
      r.recommendScore.toFixed(2),
      r.mainType,
      r.subTypesText,
      r.skillTags,
      r.playerRecordText,
      r.targetScoreText,
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

    const validationMessage = validateConstantInputs(settings);
    if (validationMessage) {
      setStatus(validationMessage, "bad");
      alert(validationMessage);
      return;
    }
    
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
    recommendCount: readNumber("recommendCount", 50),
    challengeCount: readNumber("challengeCount", 15),
    targetPushConstant: readOptionalNumber("targetPushConstant"),
    challengeMinConstant: readOptionalNumber("challengeMinConstant"),
    challengeMaxConstant: readOptionalNumber("challengeMaxConstant")
  };
}

function validateConstantInputs(settings) {
  const items = [
    ["目標推分定數", settings.targetPushConstant],
    ["挑戰定數下限", settings.challengeMinConstant],
    ["挑戰定數上限", settings.challengeMaxConstant]
  ];

  for (const [label, value] of items) {
    if (value == null) continue;

    if (value < 1 || value > 15.7) {
      return `${label} 輸入錯誤：請輸入 1.0～15.7 之間的數字。`;
    }
  }

  if (
    settings.challengeMinConstant != null &&
    settings.challengeMaxConstant != null &&
    settings.challengeMinConstant > settings.challengeMaxConstant
  ) {
    return "挑戰定數下限不能大於挑戰定數上限。";
  }

  return "";
}

function readOptionalNumber(id) {
  const input = $(id);
  if (!input) return null;

  const raw = input.value;
  if (raw === "" || raw == null) return null;

  const value = Number(raw);
  if (!Number.isFinite(value)) return null;

  // 無條件捨去到小數點後一位：15.34 → 15.3
  const floored = Math.floor(value * 10) / 10;

  input.value = floored.toFixed(1);
  return floored;
}

function readNumber(id, fallback) {
  const value = Number($(id).value);
  return Number.isFinite(value) ? value : fallback;
}

function hideResults() {
  $("summarySection").classList.add("hidden");
  $("typeSection").classList.add("hidden");
  $("recommendSection").classList.add("hidden");
  $("challengeSection").classList.add("hidden");
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

  const all1Rating = sortedScores.length > 0 ? sortedScores[0].rating : 0;
  const all30Rating = top30.length >= 30
    ? top30[29].rating
    : sortedScores[sortedScores.length - 1].rating;

  const minUsefulConstant = roundToOne(all30Rating - settings.ratingOffset);

  const comfortConstant = calculateComfortConstant(sortedScores, settings);
  const mainRecommendMinConstant = roundToOne(Math.max(minUsefulConstant, comfortConstant - 0.1));
  const mainRecommendMaxConstant = roundToOne(Math.max(minUsefulConstant, comfortConstant + 0.1));

  const autoTargetPushConstant = roundToOne(all1Rating - 1.9);
  const targetPushConstant = settings.targetPushConstant == null
    ? null
    : roundToOne(settings.targetPushConstant);
  
  if (
    targetPushConstant != null &&
    targetPushConstant >= roundToOne(autoTargetPushConstant + 0.2)
  ) {
    const ok = confirm(
      `你輸入的目標推分定數是 ${targetPushConstant.toFixed(1)}，比系統建議的 ${autoTargetPushConstant.toFixed(1)} 高不少。\n\n` +
      `這個定數比較像「挑戰歌曲」範圍。是否要先回去重新設定？\n\n` +
      `按「確定」：回到原畫面重新輸入。\n` +
      `按「取消」：維持目前設定並繼續分析。`
    );
  
    if (ok) {
      throw new Error("已取消分析，請重新設定目標推分定數或挑戰定數範圍。");
    }
  }

  const autoChallengeMinConstant = roundToOne(comfortConstant + 0.2);
  const autoChallengeMaxConstant = roundToOne(comfortConstant + 0.4);

  updateAutoPlaceholders({
    targetPushConstant: autoTargetPushConstant,
    challengeMinConstant: autoChallengeMinConstant,
    challengeMaxConstant: autoChallengeMaxConstant
  });

  let challengeMinConstant = settings.challengeMinConstant == null
    ? autoChallengeMinConstant
    : roundToOne(settings.challengeMinConstant);

  let challengeMaxConstant = settings.challengeMaxConstant == null
    ? autoChallengeMaxConstant
    : roundToOne(settings.challengeMaxConstant);

  if (targetPushConstant != null && targetPushConstant < minUsefulConstant) {
    throw new Error(
      `目標推分定數不可小於最低推分定數。\n` +
      `目前最低推分定數是 ${minUsefulConstant.toFixed(1)}，你輸入的是 ${targetPushConstant.toFixed(1)}。`
    );
  }
  
  if (challengeMinConstant < comfortConstant || challengeMaxConstant < comfortConstant) {
    throw new Error(
      `挑戰定數不可小於舒適定數。\n` +
      `目前舒適定數是 ${comfortConstant.toFixed(1)}，請把挑戰定數範圍設定在 ${comfortConstant.toFixed(1)} 以上。`
    );
  }
  
  if (challengeMinConstant < minUsefulConstant) {
    challengeMinConstant = minUsefulConstant;
  }
  
  if (challengeMaxConstant < challengeMinConstant) {
    throw new Error("挑戰定數下限不能大於挑戰定數上限。");
  }

  const selectedScores = sortedScores
    .slice(0, settings.sampleSize)
    .filter(r => r.score >= settings.scoreThreshold);

  const excludedTopSongs = new Set(
    sortedScores.slice(0, 15).map(r => normalizeSongName(r.song))
  );

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
  const playerRecordIndex = buildPlayerRecordIndex(scoreRows);

  const usefulCharts = chartRows.filter(c =>
    Number.isFinite(c.constant) &&
    c.constant >= minUsefulConstant &&
    c.constant <= challengeMaxConstant
  );

  const scoredCharts = usefulCharts
    .filter(chart => !excludedTopSongs.has(chart.normSong))
    .map(chart => {
      const typeMatch = calculateChartTypeMatch(chart, typeStats);
      const confidenceScore = typeMatch.confidence;
      const risk = calculateRiskPenalty(chart, typeStats);
      const playerRecord = findPlayerRecordForChart(chart, playerRecordIndex);
      const provenBonus = calculateProvenPerformanceBonus(playerRecord, all30Rating);
      
      const recommendZone = (
        chart.constant >= challengeMinConstant &&
        chart.constant <= challengeMaxConstant
      ) ? "挑戰" : "主推";

      let recommendScore;

      if (recommendZone === "主推") {
        if (targetPushConstant != null) {
          const targetFit = calculateProgressionFit(chart.constant, targetPushConstant);

          recommendScore = Math.max(0, Math.min(100,
            typeMatch.score * 62 +
            confidenceScore * 13 +
            targetFit * 20 +
            provenBonus -
            risk
          ));
        } else {
          recommendScore = Math.max(0, Math.min(100,
            typeMatch.score * 75 +
            confidenceScore * 17 +
            provenBonus -
            risk
          ));
        }
      } else {
        recommendScore = Math.max(0, Math.min(100,
          typeMatch.score * 75 +
          confidenceScore * 17 +
          provenBonus -
          risk
        ));
      }
      
      const targetScore = calculateRequiredScoreForRating(chart.constant, all30Rating);
      const reason = buildReason(chart, typeMatch, recommendZone, playerRecord);
      
      return {
        ...chart,
        recommendScore,
        recommendZone,
        typeMatchScore: typeMatch.score,
        playerRecord,
        playerRecordText: formatPlayerRecord(playerRecord),
        targetScore,
        targetScoreText: formatTargetScore(targetScore),
        reason
      };
    });

  const mainRecommendations = scoredCharts
    .filter(r => r.recommendZone === "主推")
    .sort((a, b) => {
      const aInMainRange = isInRange(a.constant, mainRecommendMinConstant, mainRecommendMaxConstant);
      const bInMainRange = isInRange(b.constant, mainRecommendMinConstant, mainRecommendMaxConstant);

      if (aInMainRange !== bInMainRange) {
        return aInMainRange ? -1 : 1;
      }

      return b.recommendScore - a.recommendScore;
    })
    .slice(0, settings.recommendCount);

  const challengeRecommendations = pickBalancedChallengeRecommendations(
    scoredCharts.filter(r => r.recommendZone === "挑戰"),
    settings.challengeCount
  );

  const recommendations = [...mainRecommendations, ...challengeRecommendations];

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
      all1Rating,
      all30Rating,
      minUsefulConstant,
      comfortConstant,
      mainRecommendMinConstant,
      mainRecommendMaxConstant,
      autoTargetPushConstant,
      targetPushConstant,
      autoChallengeMinConstant,
      autoChallengeMaxConstant,
      challengeMinConstant,
      challengeMaxConstant,
      selectedCount: selectedScores.length,
      matchedSelectedCount: selectedWithCharts.length,
      usefulChartCount: usefulCharts.length,
      mainRecommendCount: mainRecommendations.length,
      challengeRecommendCount: challengeRecommendations.length
    }
  };
}

function pickBalancedChallengeRecommendations(charts, totalCount) {
  const groups = new Map();

  for (const chart of charts) {
    const key = roundToOne(chart.constant).toFixed(1);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(chart);
  }

  const constants = [...groups.keys()].sort((a, b) => Number(a) - Number(b));
  if (constants.length === 0) return [];

  for (const c of constants) {
    groups.get(c).sort((a, b) => b.recommendScore - a.recommendScore);
  }

  const maxPerConstant = Math.max(2, Math.ceil(totalCount / constants.length));
  const picked = [];
  const pickedKeys = new Set();

  // 第一輪：每個定數最多拿 maxPerConstant 首，避免某一個定數洗版
  for (const c of constants) {
    const group = groups.get(c).slice(0, maxPerConstant);

    for (const chart of group) {
      const key = `${chart.difficulty}|${chart.song}`;
      if (!pickedKeys.has(key) && picked.length < totalCount) {
        picked.push(chart);
        pickedKeys.add(key);
      }
    }
  }

  // 第二輪：如果數量不夠，再用總分最高的補滿
  if (picked.length < totalCount) {
    const rest = [...charts].sort((a, b) => b.recommendScore - a.recommendScore);

    for (const chart of rest) {
      const key = `${chart.difficulty}|${chart.song}`;
      if (!pickedKeys.has(key)) {
        picked.push(chart);
        pickedKeys.add(key);
      }

      if (picked.length >= totalCount) break;
    }
  }

  return picked.sort((a, b) => {
    if (a.constant !== b.constant) return a.constant - b.constant;
    return b.recommendScore - a.recommendScore;
  });
}

function calculateComfortConstant(sortedScores, settings) {
  const sample = sortedScores
    .slice(0, settings.sampleSize)
    .filter(r => Number.isFinite(r.constant) && r.score >= settings.scoreThreshold)
    .map(r => roundToOne(r.constant))
    .sort((a, b) => a - b);

  if (sample.length === 0) {
    return roundToOne(sortedScores[0]?.constant || 14.0);
  }

  const index = Math.floor((sample.length - 1) * 0.75);
  return sample[index];
}

function calculateProgressionFit(constant, targetConstant) {
  const distance = Math.abs(roundToOne(constant) - roundToOne(targetConstant));

  // 原本是 0.3，太窄，導致差 0.3 以上都變 0。
  // 現在改成 0.6：
  // 差 0.0 → 1
  // 差 0.2 → 約 0.67
  // 差 0.4 → 約 0.33
  // 差 0.6 以上 → 0
  return clamp(1 - distance / 0.6, 0, 1);
}

function isInRange(value, min, max) {
  return Number.isFinite(value) && value >= min && value <= max;
}

function updateAutoPlaceholders(values) {
  const targetInput = $("targetPushConstant");
  const challengeMinInput = $("challengeMinConstant");
  const challengeMaxInput = $("challengeMaxConstant");

  if (targetInput && targetInput.value === "") {
    targetInput.placeholder = `自動建議 ${roundToOne(values.targetPushConstant).toFixed(1)}，可留空`;
  }

  if (challengeMinInput && challengeMinInput.value === "") {
    challengeMinInput.placeholder = `自動 ${roundToOne(values.challengeMinConstant).toFixed(1)}`;
  }

  if (challengeMaxInput && challengeMaxInput.value === "") {
    challengeMaxInput.placeholder = `自動 ${roundToOne(values.challengeMaxConstant).toFixed(1)}`;
  }
}

function fillAutoConstantInput(id, value) {
  const input = $(id);
  if (!input) return;

  if (input.value === "") {
    input.value = roundToOne(value).toFixed(1);
  }
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
  const scoreKey = normalizeSongName(score.song);
  let candidates = chartIndex.get(scoreKey) || [];

  if (candidates.length === 0) {
    candidates = findFuzzyChartCandidates(scoreKey, chartIndex);
  }

  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  if (Number.isFinite(score.constant)) {
    const sorted = [...candidates]
      .filter(c => Number.isFinite(c.constant))
      .map(c => ({ chart: c, diff: Math.abs(c.constant - score.constant) }))
      .sort((a, b) => a.diff - b.diff);

    if (sorted.length > 0 && sorted[0].diff <= 0.21) {
      return sorted[0].chart;
    }
  }

  return candidates[0];
}

function findFuzzyChartCandidates(scoreKey, chartIndex) {
  const result = [];

  for (const [dbKey, charts] of chartIndex.entries()) {
    if (!scoreKey || !dbKey) continue;

    const shorter = scoreKey.length <= dbKey.length ? scoreKey : dbKey;
    const longer = scoreKey.length > dbKey.length ? scoreKey : dbKey;

    if (shorter.length >= 5 && longer.includes(shorter)) {
      result.push(...charts);
    }
  }

  return result;
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
  const chartKey = chart.normSong;
  let candidates = playerRecordIndex.get(chartKey) || [];

  if (candidates.length === 0) {
    for (const [scoreKey, records] of playerRecordIndex.entries()) {
      const shorter = scoreKey.length <= chartKey.length ? scoreKey : chartKey;
      const longer = scoreKey.length > chartKey.length ? scoreKey : chartKey;

      if (shorter.length >= 5 && longer.includes(shorter)) {
        candidates = records;
        break;
      }
    }
  }

  if (candidates.length === 0) return null;

  const sorted = candidates.map(r => ({
    record: r,
    diff: Number.isFinite(chart.constant) && Number.isFinite(r.constant)
      ? Math.abs(chart.constant - r.constant)
      : 999
  })).sort((a, b) => a.diff - b.diff || b.record.rating - a.record.rating);

  if (sorted[0].diff <= 0.21 || candidates.length === 1) return sorted[0].record;
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

function buildReason(chart, typeMatch, recommendZone = "", playerRecord = null) {
  const zoneText = recommendZone ? `${recommendZone}區間；` : "";

  let reason = "";

  if (typeMatch.matchedTypes.length === 0) {
    reason = `${zoneText}分類參考：${chart.mainType} / ${chart.subTypesText}`;
  } else {
    reason = `${zoneText}符合高分池類型：${typeMatch.matchedTypes.slice(0, 3).join("、")}`;
  }

  if (playerRecord && playerRecord.score >= 1005000) {
    reason += "；已有不錯成績紀錄";
  }

  return reason;
}

function renderAll(result) {
  renderSummary(result);
  renderTypeTable(result.typeStats);

  const mainRecommendations = result.recommendations.filter(r => r.recommendZone === "主推");
  const challengeRecommendations = result.recommendations.filter(r => r.recommendZone === "挑戰");

  renderRecommendTable(mainRecommendations);
  renderChallengeTable(challengeRecommendations);

  lastRecommendations = result.recommendations;
  $("summarySection").classList.remove("hidden");
  $("typeSection").classList.remove("hidden");
  $("recommendSection").classList.remove("hidden");
  $("challengeSection").classList.remove("hidden");
  $("downloadResultBtn").disabled = false;
}

function renderSummary(result) {
  const s = result.summary;

  const targetText = s.targetPushConstant == null
    ? `${s.autoTargetPushConstant.toFixed(1)}`
    : `${s.targetPushConstant.toFixed(1)}`;
    
  const mainRangeText = `${s.mainRecommendMinConstant.toFixed(1)} ～ ${s.mainRecommendMaxConstant.toFixed(1)}`;
  const challengeRangeText = `${s.challengeMinConstant.toFixed(1)} ～ ${s.challengeMaxConstant.toFixed(1)}`;

  const cards = [
    ["玩家 All 筆數", s.scoreCount],
    ["資料庫譜面數", s.chartCount],
    ["All 第 1 名 Rating", s.all1Rating.toFixed(2)],
    ["All 第 30 名 Rating", s.all30Rating.toFixed(2)],
    ["最低推分定數", s.minUsefulConstant.toFixed(1)],
    ["舒適定數", s.comfortConstant.toFixed(1)],
    ["主推定數範圍", mainRangeText],
    ["目標推分定數", targetText],
    ["挑戰定數範圍", challengeRangeText],
    ["入選歌曲", s.selectedCount],
    ["成功匹配資料庫", s.matchedSelectedCount],
    ["有用歌曲數", s.usefulChartCount],
    ["主推輸出", s.mainRecommendCount],
    ["挑戰輸出", s.challengeRecommendCount]
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
  tbody.innerHTML = renderRecommendationRows(recommendations);
}

function renderChallengeTable(recommendations) {
  const tbody = $("challengeTable").querySelector("tbody");
  tbody.innerHTML = renderRecommendationRows(recommendations);
}

function renderRecommendationRows(recommendations) {
  return recommendations.map((r, i) => `
    <tr>
      <td>${i + 1}</td>
      <td><strong>${escapeHtml(r.song)}</strong></td>
      <td>${escapeHtml(r.difficulty)}</td>
      <td>${r.constant.toFixed(1)}</td>
      <td class="score">${r.recommendScore.toFixed(1)}</td>
      <td>${escapeHtml(r.mainType)}</td>
      <td class="tags">${escapeHtml(r.subTypesText)}</td>
      <td class="tags">${escapeHtml(r.skillTags || "")}</td>
      <td>${escapeHtml(r.playerRecordText)}</td>
      <td>${escapeHtml(r.targetScoreText)}</td>
      <td class="reason">${escapeHtml(r.reason)}</td>
    </tr>
  `).join("");
}

function formatPlayerRecord(record) {
  if (!record) return "";
  return `${record.score.toLocaleString()} / ${record.rating.toFixed(2)}${record.grade ? " / " + record.grade : ""}`;
}

function calculateProvenPerformanceBonus(record, all30Rating) {
  if (!record) return 0;

  let bonus = 0;

  // 已有成績只做小補正，避免單曲特例或代打影響整體推薦。
  if (record.score >= 1006000) {
    bonus += 2;
  } else if (record.score >= 1005000) {
    bonus += 1;
  } else if (record.score >= 1000000) {
    bonus += 0.5;
  }

  // 已經接近 All30，代表這首至少有推分潛力，但仍只給小補正。
  if (Number.isFinite(record.rating) && Number.isFinite(all30Rating)) {
    if (record.rating >= all30Rating) {
      bonus += 1;
    } else if (record.rating >= all30Rating - 0.1) {
      bonus += 0.5;
    }
  }

  return Math.min(bonus, 3);
}

function calculateRequiredScoreForRating(constant, targetRating) {
  if (!Number.isFinite(constant) || !Number.isFinite(targetRating)) {
    return null;
  }

  const diff = targetRating - constant;

  // Rating 不可能靠這首推到這麼低，理論上打到 S 以下就夠，但本工具只回傳 S 以上範圍
  if (diff <= 0) return 975000;

  let score = null;

  // S：975000 ～ 989999，rating 約 constant ～ constant + 0.5
  if (diff <= 0.5) {
    score = 975000 + diff / 0.5 * 15000;
  }
  // S+：990000 ～ 999999，rating 約 constant + 0.5 ～ constant + 1.0
  else if (diff <= 1.0) {
    score = 990000 + (diff - 0.5) / 0.5 * 10000;
  }
  // SS：1000000 ～ 1004999，rating 約 constant + 1.0 ～ constant + 1.5
  else if (diff <= 1.5) {
    score = 1000000 + (diff - 1.0) / 0.5 * 5000;
  }
  // SS+：1005000 ～ 1007499，rating 約 constant + 1.5 ～ constant + 2.0
  else if (diff <= 2.0) {
    score = 1005000 + (diff - 1.5) / 0.5 * 2500;
  }
  // SSS：1007500 ～ 1008999，rating 約 constant + 2.0 ～ constant + 2.15
  else if (diff <= 2.15) {
    score = 1007500 + (diff - 2.0) / 0.15 * 1500;
  }
  // SSS+：1009000 ～ 1010000，rating 約 constant + 2.15 ～ constant + 2.30
  else if (diff <= 2.30) {
    score = 1009000 + (diff - 2.15) / 0.15 * 1000;
  } else {
    return null;
  }

  return Math.ceil(score / 10) * 10;
}

function formatTargetScore(score) {
  if (score == null || !Number.isFinite(score)) {
    return "超出可推範圍";
  }

  if (score > 1010000) {
    return "超出可推範圍";
  }

  return Math.round(score).toLocaleString();
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
