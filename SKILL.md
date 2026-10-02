---
name: pin4html
description: Pin4Html — 在 HTML 報告上右鍵標註（留言/改寫/刪除/補充/查證/疑問/版面、圖釘、區域框選），標記即時寫入報告旁的 .pins.json。勾「立即處理」的標記一標完 AI 就收到並直接改，頁面即時更新；其餘等用戶說「改吧」一次處理。當用戶說「我要審閱這份報告」「幫我嵌標註」「開審閱模式」「我要在報告上標記」「改報告」「/pin4html」，或 Claude 產出 HTML 報告要交給用戶檢視時觸發；用戶說「標好了」「改吧」「照標記改」時處理剩下的標記。Also triggers on "review/annotate this HTML report".
---

# Pin4Html — HTML 報告審閱標註

本 skill 目錄即 repo（https://github.com/youllook/Pin4Html）。以下 `<DIR>` = 本 skill 的 base directory。
`pin4html.py` 只用 Python 標準庫，不需安裝任何東西。

## 開審閱

1. 確認報告路徑（沒講就用最近產出的那份 HTML）。
2. **背景**啟動伺服器（Bash `run_in_background: true`）：
   ```
   python "<DIR>/pin4html.py" serve "<報告.html>"
   ```
   - 自動開瀏覽器；原檔不會被修改（腳本是即時注入的）。標記自動寫入 `<報告>.pins.json`。
   - 預設 port 8770，被占用會往後找。語言跟隨瀏覽器，要固定加 `--lang zh|en`。
3. **背景**啟動 `watch`（即時模式，見下節）：
   ```
   python "<DIR>/pin4html.py" watch "<報告.html>"
   ```
4. 一句話告訴用戶：「選文字或右鍵標記，Alt+D 框區域；勾『立即處理』的我會馬上改，其他的標好說『改吧』」。

## 即時模式：watch 迴圈

`watch` 會等到有「立即處理」且還沒回覆的標記、用戶停手約 3 秒，印出清單後結束。
它一結束（背景任務通知）就：

1. **先讀整份報告**（這個審閱第一次一定讀；報告被別人改過才重讀）。只看 `watch` 給的片段會改出前後矛盾。
2. 照下方「各類型怎麼改」改**原檔**。改到某個數字、事實或用詞時，**搜尋全文**，其他出現的地方一起改，回覆裡說明連帶改了哪裡。
3. 用 `reply` 回覆每一則（見下方）。改好的 `resolved: true`；需要用戶補資料或做決定的只回覆、`resolved: false`。
4. **再背景啟動 `watch`**，回到等待。

頁面右上角會自動顯示「AI 正在修改」清單與進度，`reply` 送出後逐則打勾；報告檔一改，頁面就地更新、不用重整。
用戶說審閱結束時，停掉 `watch` 和伺服器。

## 改吧：處理剩下的標記

用戶說「改吧」「照標記改」時，處理所有待處理標記（包含沒勾立即處理的「稍後」）：

```
python "<DIR>/pin4html.py" show "<報告.html>"
```

同樣先讀全文、改原檔、`reply`，最後在對話中逐條簡報（編號對應），做不到的說明原因。需要完整欄位就讀 `<報告>.pins.json`。

## 各類型怎麼改

定位：文字類用 quote＋context；圖釘/區域用 `§標題`＋`<tag>`＋selector（區域另有 x/y/w/h 比例，通常指圖表或版面某一塊）。

- 改寫 rewrite → 用 replacement；沒給就依 note 改寫
- 刪除 delete → 刪除，別留空容器或孤兒標點
- 補充 add → 在該處加入內容
- 查證 verify → 實際查證；查不到就降級描述並在回覆註明，**不可捏造出處或數字**
- 疑問 question → 內容問題就改寫釐清，單純提問就只回覆
- 版面 layout（style）→ 改 HTML/CSS
- 留言 comment → 依內容判斷
- `[later]` = 用戶沒勾立即處理；`[done]` = 已處理，跳過

## 回覆

用 Write 工具寫 JSON 檔再執行，key 可用編號或 id：
```json
{"1": {"reply": "已改為 31%，數據卡也一併改了", "resolved": true},
 "3": {"reply": "報告裡沒有樣本數，請提供", "resolved": false}}
```
```
python "<DIR>/pin4html.py" reply "<報告.html>" --file replies.json
```
不要直接手改 .pins.json：`reply` 會正確遞增版本並清掉「處理中」狀態，跟頁面同步不會互相覆蓋。

## 備援模式（沒有伺服器時）

- 要離線檔（例如寄給別人）：`python "<DIR>/pin4html.py" inject "<報告.html>"` → `<報告>.review.html`（`--cdn` 改用 jsDelivr）。
  此模式標記存瀏覽器 localStorage，沒有即時模式；用戶按「複製給 AI」貼回，或下載 JSON 給你讀。
- 移除注入：`python "<DIR>/pin4html.py" strip "<檔案.html>"`
