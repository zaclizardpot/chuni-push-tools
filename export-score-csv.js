(() => {
  const CSV_FILENAME = "chunithm_score_table.csv";

  function cleanText(text) {
    return (text || "")
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function csvEscape(value) {
    const s = String(value ?? "");
    return `"${s.replace(/"/g, '""')}"`;
  }

  function downloadCsv(rows, filename) {
    const csv = rows
      .map(row => row.map(csvEscape).join(","))
      .join("\r\n");

    const blob = new Blob(["\uFEFF" + csv], {
      type: "text/csv;charset=utf-8;"
    });

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function normalizeHeader(h) {
    const text = cleanText(h).toLowerCase();

    if (text === "#" || text.includes("rank") || text.includes("no")) return "rank";
    if (text.includes("曲名") || text.includes("title") || text.includes("song")) return "title";
    if (text.includes("定數") || text.includes("const")) return "constant";
    if (text.includes("評級") || text.includes("grade")) return "grade";
    if (text.includes("成績") || text.includes("score")) return "score";
    if (text.includes("評分") || text.includes("評分") || text.includes("rating")) return "rating";
    if (text.includes("aj") || text.includes("fc")) return "combo";

    return text;
  }

  function extractFromTables() {
    const tables = [...document.querySelectorAll("table")];
    const result = [];

    for (const table of tables) {
      const rows = [...table.querySelectorAll("tr")];
      if (rows.length < 2) continue;

      const headerCells = [...rows[0].querySelectorAll("th,td")];
      const headers = headerCells.map(cell => normalizeHeader(cell.innerText));

      const hasUsefulHeader =
        headers.includes("title") ||
        headers.includes("constant") ||
        headers.includes("score") ||
        headers.includes("rating");

      if (!hasUsefulHeader) continue;

      for (const tr of rows.slice(1)) {
        const cells = [...tr.querySelectorAll("td,th")].map(td => cleanText(td.innerText));
        if (cells.length < 4) continue;

        const obj = {};
        headers.forEach((h, i) => {
          obj[h] = cells[i] ?? "";
        });

        result.push({
          rank: obj.rank || "",
          title: obj.title || "",
          constant: obj.constant || "",
          grade: obj.grade || "",
          score: obj.score || "",
          rating: obj.rating || "",
          combo: obj.combo || ""
        });
      }
    }

    return result;
  }

  function extractFromVisibleRowsFallback() {
    const candidates = [...document.querySelectorAll("tr, .row, [class*='row'], [class*='song']")];
    const result = [];

    for (const el of candidates) {
      const text = cleanText(el.innerText);
      if (!text) continue;

      const scoreMatch = text.match(/\b(10\d{5}|9\d{5}|8\d{5})\b/);
      const ratingMatch = text.match(/\b(1[0-9]\.\d{2})\b/);
      const constantMatch = text.match(/\b(1[0-9]\.\d)\b/);
      const rankMatch = text.match(/^#?\s*(\d{1,2})\b/);

      if (!scoreMatch || !ratingMatch || !constantMatch) continue;

      let title = text
        .replace(/^#?\s*\d{1,2}\s*/, "")
        .replace(/\b(1[0-9]\.\d)\b/g, "")
        .replace(/\b(SSS\+?|SS\+?|S\+?|S|AAA|AA|A)\b/g, "")
        .replace(/\b(10\d{5}|9\d{5}|8\d{5})\b/g, "")
        .replace(/\b(1[0-9]\.\d{2})\b/g, "")
        .replace(/\b(AJ|FC|FULL COMBO|ALL JUSTICE)\b/gi, "")
        .trim();

      result.push({
        rank: rankMatch ? rankMatch[1] : "",
        title,
        constant: constantMatch[1],
        grade: (text.match(/\b(SSS\+?|SS\+?|S\+?|S|AAA|AA|A)\b/) || [""])[0],
        score: scoreMatch[1],
        rating: ratingMatch[1],
        combo: (text.match(/\b(AJ|FC|FULL COMBO|ALL JUSTICE)\b/i) || [""])[0]
      });
    }

    const seen = new Set();
    return result.filter(row => {
      const key = `${row.rank}|${row.title}|${row.score}|${row.rating}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return row.title && row.score;
    });
  }

  function extractScoreRows() {
    let rows = extractFromTables();

    if (rows.length === 0) {
      rows = extractFromVisibleRowsFallback();
    }

    return rows;
  }

  function createDownloadButton() {
    const old = document.getElementById("chuni-csv-download-button");
    if (old) old.remove();

    const btn = document.createElement("button");
    btn.id = "chuni-csv-download-button";
    btn.textContent = "下載 CHUNITHM CSV";
    btn.style.position = "fixed";
    btn.style.top = "16px";
    btn.style.right = "16px";
    btn.style.zIndex = "999999";
    btn.style.padding = "12px 16px";
    btn.style.borderRadius = "10px";
    btn.style.border = "none";
    btn.style.background = "#7c3aed";
    btn.style.color = "white";
    btn.style.fontSize = "16px";
    btn.style.fontWeight = "700";
    btn.style.cursor = "pointer";
    btn.style.boxShadow = "0 4px 12px rgba(0,0,0,.3)";

    btn.addEventListener("click", () => {
      const scoreRows = extractScoreRows();

      if (scoreRows.length === 0) {
        alert("沒有抓到分表資料。可能這個頁面不是 HTML 表格，或資料還沒載入完成。");
        return;
      }

      const csvRows = [
        ["排名", "曲名", "譜面定數", "評級", "成績", "單曲Rating", "AJ/FC"],
        ...scoreRows.map(r => [
          r.rank,
          r.title,
          r.constant,
          r.grade,
          r.score,
          r.rating,
          r.combo
        ])
      ];

      console.table(scoreRows);
      downloadCsv(csvRows, CSV_FILENAME);
    });

    document.body.appendChild(btn);
    console.log("已建立下載按鈕。按右上角「下載 CHUNITHM CSV」即可下載。");
  }

  createDownloadButton();
})();
