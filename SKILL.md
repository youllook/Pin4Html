---
name: pin4html
description: Pin4Html — 在 HTML 報告上右鍵標註（留言/改寫/刪除/補充/查證/疑問/版面/保留、圖釘、區域框選），標記即時寫入報告旁的 .pins.json，AI 直接讀檔修改並逐條回覆。當用戶說「我要審閱這份報告」「幫我嵌標註」「開審閱模式」「我要在報告上標記」「改報告」「/pin4html」，或 Claude 產出 HTML 報告要交給用戶檢視時觸發；用戶說「標好了」「改吧」「照標記改」時進入回程。Also triggers on "review/annotate this HTML report".
---

# Pin4Html — HTML 報告審閱標註

本 skill 目錄即 repo（https://github.com/youllook/Pin4Html）。以下 `<DIR>` = 本 skill 的 base directory。
`pin4html.py` 只用 Python 標準庫，不需安裝任何東西。

## 去程：開審閱

1. 確認報告路徑（沒講就用最近產出的那份 HTML）。
2. **背景**啟動伺服器（Bash `run_in_background: true`）：
   ```
   python "<DIR>/pin4html.py" serve "<報告.html>"
   ```
   - 自動用預設瀏覽器開啟；原檔不會被修改（腳本是即時注入的）。
   - 標記每次改動自動寫入 `<報告>.pins.json`（與報告同資料夾）。
   - 預設 port 8770，被占用會自動往後找；同資料夾的其他 .html 也都能標。
3. 一句話告訴用戶：「選文字或直接右鍵標記，Alt+D 框區域；標好跟我說『改吧』」。

## 回程：照標記改

1. 讀標記（精簡、含上下文與編號）：
   ```
   python "<DIR>/pin4html.py" show "<報告.html>"
   ```
   需要完整欄位就直接讀 `<報告>.pins.json`。
2. 改**原檔**。定位：文字類用 `原文`＋`上下文`；圖釘/區域用 `§標題`＋`<tag>`＋selector（區域另有 x/y/w/h 比例，通常指圖表或版面某一塊）。
3. 依類型動作：
   - ✏️改寫 → 用替換文字；沒給就依說明改寫
   - ✂️刪除 → 刪除，別留空容器或孤兒標點
   - ➕補充 → 在該處加入內容
   - 🔍查證 → 實際查證；查不到就降級描述並在回覆註明，**不可捏造出處**
   - ❓疑問 → 內容問題就改寫釐清，單純提問就只回覆
   - 🎨版面 → 改 HTML/CSS
   - 👍保留 → 這段不准動，其他修改波及時也要保住
   - 💬留言 → 依內容判斷
   - 【必改】優先；已解決（✅）跳過
4. 寫回覆（用 Write 工具寫 JSON 檔再執行，key 可用編號或 id）：
   ```json
   {"1": {"reply": "已改為同比 12%，並註明比較基準", "resolved": true},
    "3": "這句刪了，因為與表格重複"}
   ```
   ```
   python "<DIR>/pin4html.py" reply "<報告.html>" --file replies.json
   ```
   開著的頁面約 2 秒內會跳出「🤖 收到 AI 回覆・📄 報告內容已修改 → 重新載入」。
   不要直接手改 .pins.json：`reply` 會正確遞增 rev 與 updated，與頁面上的同步不會互相覆蓋。
5. 在對話中逐條簡報（編號對應），做不到的說明原因。

## 備援模式（沒有伺服器時）

- 用戶在別處（例如寄給別人）要離線檔：`python "<DIR>/pin4html.py" inject "<報告.html>"` → `<報告>.review.html`（加 `--cdn` 改用 jsDelivr 引用）。
  此模式標記存瀏覽器 localStorage，用戶要按「📋 複製給 Claude」貼回，或下載 JSON 給你讀。
- 移除注入：`python "<DIR>/pin4html.py" strip "<檔案.html>"`
- 審閱結束記得停掉背景伺服器。
