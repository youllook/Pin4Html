# Pin4Html

**Pin, highlight or box anything on an HTML report — then hand it to your AI.**

在 HTML 報告上直接右鍵標註，標記即時存成檔案，AI 讀檔修改並逐條回覆。

![Pin4Html screenshot](docs/screenshot.jpg)

AI agents increasingly produce reports as HTML. Reviewing them usually means screenshots and "the third paragraph under section 2…".
Pin4Html lets you right-click to annotate the page itself, auto-saves every annotation to a `<report>.pins.json`
next to the report, and lets the agent write replies back that show up on the page — a closed review loop.

- **Zero dependencies** — one JS file + one Python script (standard library only)
- **Never touches your report** — the annotator is injected on the fly while serving
- **Agent-friendly** — `show` prints a compact, numbered list; `reply` writes answers back
- Works as a **Claude Code skill** out of the box (but any agent that can run a command and read a file can use it)

> UI language: Traditional Chinese (繁體中文) for now.

---

## 快速開始

```bash
python pin4html.py serve report.html
```

瀏覽器會自動開啟報告。開始標記：

| 操作 | 效果 |
|---|---|
| 選取文字 → 右鍵 | 文字標記（高亮＋編號），選單按 1–8 快選類型 |
| 未選取 → 右鍵 | 釘一個圖釘（虛線框預覽會附著的元素） |
| `Alt+D` | 拖曳框選一塊區域（圖表局部、版面） |
| 左鍵點標記 / 拖曳圖釘 | 編輯 / 移動 |
| 右鍵已有標記 | 改類型、必改、已解決、重新框選、刪除（可復原） |
| `Alt+R` / `Alt+H` | 標記清單 / 隱藏全部標記 |
| `Shift` + 右鍵 | 瀏覽器原生選單 |

### 標記類型

💬 留言 · ✏️ 改寫（附「改為」）· ✂️ 刪除 · ➕ 補充 · 🔍 查證 · ❓ 疑問 · 🎨 版面 · 👍 保留

另有 🔴 必改、✅ 已解決 兩個旗標。

### 交給 AI

每次改動都會寫入 `report.pins.json`（右下角 🟢 = 已同步）。AI 端：

```bash
python pin4html.py show report.html                     # 讀標記（精簡、帶編號與上下文）
python pin4html.py reply report.html --file replies.json  # 寫回覆
```

`replies.json`：

```json
{ "1": { "reply": "已改為同比 12%", "resolved": true },
  "3": "這句刪了，與表格重複" }
```

開著的頁面約 2 秒內就會顯示「🤖 收到 AI 回覆」；若報告本身也被改了，會提示重新載入。
你和 AI 同時修改時以樂觀鎖＋逐則合併處理，不會互相覆蓋。

## 作為 Claude Code skill 安裝

```bash
git clone https://github.com/youllook/Pin4Html ~/.claude/skills/pin4html
```

之後對 Claude 說「我要審閱這份報告」，它會自動啟動伺服器；標完說「改吧」，它就讀檔、修改、逐條回覆。

## 沒有伺服器時（離線 / 分享給別人）

```bash
python pin4html.py inject report.html          # → report.review.html（腳本內嵌，可離線）
python pin4html.py inject report.html --cdn    # 改用 CDN 引用
python pin4html.py strip report.review.html    # 移除注入
```

或直接在任何 HTML 加一行：

```html
<script src="https://cdn.jsdelivr.net/gh/youllook/Pin4Html@1/pin4html.js"></script>
```

此模式標記存在瀏覽器 localStorage，用清單底部的「📋 複製給 Claude」（Markdown，可選精簡／標準／詳細）或「⬇️ JSON」交回。

## `.pins.json` 格式

見 [`examples/demo.pins.json`](examples/demo.pins.json)。每則標記：

| 欄位 | 說明 |
|---|---|
| `n` / `id` | 頁面上的編號 / 穩定 id |
| `type` | `comment` `rewrite` `delete` `add` `verify` `question` `style` `keep` |
| `kind` | `text`（文字）· `pin`（圖釘）· `region`（區域） |
| `quote` `prefix` `suffix` | 文字標記的原文與前後文（用於重新定位） |
| `path` `rx` `ry` `rw` `rh` | 圖釘／區域的 CSS selector 與相對位置比例 |
| `heading` | 最近的上層標題 |
| `note` `replacement` | 說明、改寫／補充內容 |
| `priority` `resolved` `reply` | `must`/`should`、是否已解決、AI 回覆 |

## 致謝

互動設計參考了 [onUI](https://github.com/onllm-dev/onUI)（元素預覽、區域框選、分級輸出）；程式碼為獨立實作。

## License

MIT
