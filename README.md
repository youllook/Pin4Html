# Pin4Html

Right-click to annotate an HTML report. Notes go to `<report>.pins.json` next to it. Your AI reads that file, edits the report, replies — the page updates in place.

![Pin4Html screenshot](docs/screenshot-en.jpg)

[繁體中文說明 ↓](#繁體中文)

One JS file, one Python script, standard library only. The report file itself is never touched by the annotator.

## Quick start

```bash
python pin4html.py serve report.html
```

Want to look first: `python pin4html.py serve examples/showcase-en.html` (every annotation type already placed).

| Action | Result |
|---|---|
| Select text → right-click | Text annotation; press 1–7 to pick a type |
| Right-click (no selection) | Pin (dashed box shows the element it sticks to) |
| `Alt+D` | Box an area |
| Click / drag a pin | Edit / move |
| Right-click an annotation | Change type, fix now / later, pending / done, re-select, delete (undoable) |
| `Alt+R` / `Alt+H` | List / hide all |
| `Shift` + right-click | Browser menu |

Types: Comment, Rewrite, Delete, Add, Verify, Question, Layout.
Status: Pending or Done. Not fixed right? Mark it again.

## Fix now

"Fix now" is checked by default. With an agent running `watch`, those get fixed while you keep reading:

```bash
python pin4html.py watch report.html      # waits for fix-now pins + ~3 s of quiet, prints them, exits
```

The agent edits the report, replies, runs `watch` again. Top right of the page shows what it's working on, ticks items off, then disappears. Items it couldn't settle (needs data from you, etc.) get a "?" and stay until you close the box.

Unchecked = later. Say "go ahead" when you're done and the agent handles the rest.

## Agent side

```bash
python pin4html.py show report.html                       # read pins (compact, numbered, with context)
python pin4html.py reply report.html --file replies.json  # write replies back
```

`replies.json`:

```json
{ "1": { "reply": "Changed to 12% YoY", "resolved": true },
  "3": "Removed — it duplicated the table" }
```

Page and agent can write at the same time; nothing gets lost. Annotations float on top and don't change the report's layout.

## Claude Code skill

```bash
git clone https://github.com/youllook/Pin4Html ~/.claude/skills/pin4html
```

Then "review this report". Claude starts the server and `watch`, fixes fix-now pins as they come in, the rest when you say so.

## No server

```bash
python pin4html.py inject report.html          # → report.review.html with the script inlined
python pin4html.py inject report.html --cdn    # reference the CDN instead
python pin4html.py strip report.review.html    # remove it again
```

Or one line in any page:

```html
<script src="https://cdn.jsdelivr.net/gh/youllook/Pin4Html@1/pin4html.js"></script>
```

Annotations stay in localStorage then. No live fixing. Hand them over with "Copy for AI" or "JSON".

## Language

`zh*` browser → 繁體中文, else English. Override (first wins):

1. URL parameter `?p4hlang=en` / `?p4hlang=zh`
2. The EN / 中 button in the panel
3. `<script … data-lang="en">`, or `--lang en|zh` on `serve` / `inject`

## `.pins.json` format

See [`examples/demo-en.pins.json`](examples/demo-en.pins.json). Each annotation:

| Field | Meaning |
|---|---|
| `n` / `id` | Number shown on the page / stable id |
| `type` | `comment` `rewrite` `delete` `add` `verify` `question` `style` |
| `kind` | `text` · `pin` · `region` |
| `quote` `prefix` `suffix` | Quoted text and surrounding context (used to re-anchor) |
| `path` `rx` `ry` `rw` `rh` | CSS selector and relative position/size for pins and areas |
| `heading` | Nearest heading above |
| `note` `replacement` | Note; replacement / content to add |
| `priority` `resolved` `reply` | `must` = fix now / `should` = later, done flag, AI reply |
| `replyAt` `replyResolved` | Set by `reply` so a reply survives a simultaneous edit on the page |

Top level `working` = pins the agent is on right now (set by `watch`, cleared by `reply`).

---

## 繁體中文

![Pin4Html 截圖](docs/screenshot-zh.jpg)

HTML 報告上右鍵就能標。標記存在報告旁的 `.pins.json`，AI 讀檔、改報告、回覆，頁面直接更新。

```bash
python pin4html.py serve report.html
```

- 先看範例：`python pin4html.py serve examples/showcase.html`
- 操作：選字＋右鍵＝文字標記；空白處右鍵＝圖釘；`Alt+D` 框區域；`Alt+R` 清單；`Alt+H` 隱藏；`Shift`＋右鍵＝原生選單
- 類型：留言、改寫、刪除、補充、查證、疑問、版面
- 狀態：待處理／已處理。改得不對就再標一次
- 「立即處理」預設勾。AI 端跑著 `watch` 的話，標完停手幾秒它就開始改，右上角會列出正在改哪幾則、改好打勾；它沒辦法自己決定的會打「?」，等你回
- 沒勾的是「稍後」，標完說「改吧」再一起處理
- 標記浮在上面，不會動到報告原本的排版
- Claude Code skill：`git clone https://github.com/youllook/Pin4Html ~/.claude/skills/pin4html`，然後說「我要審閱這份報告」
- 沒有伺服器：`inject`、`inject --cdn`、`strip`，或加上面那行 CDN。標記存在瀏覽器，沒有即時改
- 語言跟瀏覽器；`?p4hlang=zh`、側欄 EN／中、`data-lang`、`--lang` 可改

## Credits

Some interaction ideas (element preview, area boxing, tiered export) came from [onUI](https://github.com/onllm-dev/onUI). The code is a separate implementation.

## License

MIT
