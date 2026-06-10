# CHUNITHM 推分推薦器 v0.1

## 檔案

- `index.html`：網站首頁
- `style.css`：版面
- `app.js`：分析與推薦邏輯
- `chart_database.csv`：譜面資料庫
- `export-score-csv.js`：你原本的 CSV 匯出書籤腳本可以繼續放在同一個 repo

## 使用方式

1. 把這些檔案放到 GitHub repo。
2. 開啟 GitHub Pages。
3. 進入 `https://你的帳號.github.io/chuni-push-tools/`
4. 上傳從 record-viewer 匯出的 `chunithm_score_table.csv`
5. 按「開始分析」

## 本機測試

不要直接雙擊 `index.html`，因為瀏覽器可能擋掉 `fetch("./chart_database.csv")`。

建議用 VS Code 的 Live Server，或用 Python：

```bash
python -m http.server 8000
