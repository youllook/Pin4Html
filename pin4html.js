/* Pin4Html — right-click annotate any HTML report, hand the feedback to your AI.
 * https://github.com/youllook/Pin4Html  (MIT)
 *
 * 右鍵：選取文字→文字標記；未選取→位置圖釘；在標記上→編輯/改類型/解決/刪除
 * Alt+D = 框選區域；Shift+右鍵 = 瀏覽器原生選單；Alt+R = 側欄；Alt+H = 隱藏/顯示標記
 *
 * 兩種儲存模式：
 *  - 伺服器模式（pin4html.py serve）：每次改動自動寫入報告旁的 <name>.pins.json，AI 直接讀檔
 *  - 本機模式（直接開檔 / inject / CDN）：存 localStorage，可匯出 Markdown / JSON
 */
(function () {
  'use strict';
  if (window.__pin4html) return;
  window.__pin4html = true;

  const SCRIPT = document.currentScript;
  const SERVER = (SCRIPT && SCRIPT.dataset.server) || null; // 例如 "/__pin4html/"
  const FILE = decodeURIComponent(location.pathname);
  const KEY = 'pin4html:' + FILE;

  // ---------- i18n ----------
  // 優先序：?p4hlang= > 使用者在側欄切換（localStorage）> <script data-lang> > 瀏覽器語言
  const LANG_KEY = 'pin4html:pref:lang';
  const LANG = (() => {
    let l = new URLSearchParams(location.search).get('p4hlang');
    try { l = l || localStorage.getItem(LANG_KEY); } catch (e) {}
    l = l || (SCRIPT && SCRIPT.dataset.lang) || navigator.language || 'en';
    return /^zh/i.test(l) ? 'zh' : 'en';
  })();
  const ZH = {
    types: {
      comment: ['留言', '一般意見'], rewrite: ['改寫', '換個說法', '改為'], delete: ['刪除', '整段拿掉'],
      add: ['補充', '這裡要加內容', '補充內容'], verify: ['查證', '數據／出處待確認'], question: ['疑問', '看不懂／為什麼'],
      style: ['版面', '排版／圖表／格式'],
    },
    sync: {
      local: '僅存在此瀏覽器（用「複製給 AI」或匯出 JSON 交回）', connecting: '連線中…', saving: '儲存中…',
      synced: '已自動同步到檔案，AI 可直接讀取', offline: '伺服器離線，改動暫存在頁面，恢復後自動補存',
    },
    lsFail: '無法寫入 localStorage，請記得匯出 JSON',
    gotReply: '收到 AI 回覆', pinsUpdated: '標記已更新', htmlChanged: '報告已更新', working: 'AI 正在修改', workDone: 'AI 改完了', workAsk: (k) => 'AI 處理完・' + k + ' 則要您回覆', close: '關閉', inProgress: '處理中', reloadNew: '重新載入看新版',
    clickToView: '，點標記查看', dot: '・', colon: '：', lq: '「', rq: '」',
    fabTitle: '審閱標記（Alt+R）', fabLabel: '標記', hiddenTag: '（已隱藏）', dragHint: '（可拖曳移動）',
    drawTip: '拖曳框出要標記的區域（Esc 取消）', tooSmall: '區域太小，已取消',
    headText: (q) => '標記選取：「' + q + '」', headRegion: (t) => '標記框選區域（' + t + ' 內）',
    headPin: (t) => '在此處釘一個標記（虛線框＝會附著的元素 ' + t + '）',
    toRegion: '改成框選區域…', openList: '開啟標記清單',
    edit: '編輯…', changeTo: (l) => '改成「' + l + '」', unmust: '改成稍後處理', setMust: '改成立即處理',
    reopen: '改回待處理', setResolved: '標為已處理', reanchorRange: '重新框選範圍', delAnn: '刪除標記',
    quickAdded: (l, n) => '已新增「' + l + '」#' + n + '（點標記可補說明）', addNote: '補說明',
    deleted: (n) => '已刪除標記 #' + n, undo: '復原',
    notePh: (hint) => hint + '…（Ctrl+Enter 儲存，Esc 取消）',
    orphanLong: '頁面上找不到原文（內容可能已被修改），可用「重新框選」重新定位',
    note: '說明', aiReply: 'AI 回覆：', must: '立即處理', later: '稍後', resolved: '已處理', pending: '待處理', status: '狀態',
    del: '刪除', reanchorBtn: '重新框選', reanchorTitle: '選取新的文字範圍來重新定位', cancel: '取消', save: '儲存',
    added: (n) => '已新增 #' + n, reanchorTip: (n) => '請選取新的文字範圍來定位 #' + n + '（Esc 取消）',
    sideTitle: '審閱標記', stats: (o, m, d) => '待處理 ' + o + ' 則（立即處理 ' + m + '）・已處理 ' + d + ' 則',
    all: '全部', showResolved: '顯示已處理', hideMarks: '隱藏頁面標記',
    empty: ['還沒有標記', '選取文字後按右鍵，或直接在任意位置按右鍵', 'Shift+右鍵 = 原生選單'],
    detail: '輸出詳細度', levels: { brief: '精簡', std: '標準', full: '詳細' },
    levelTips: { brief: '一則一行，省 token', std: '原文＋位置＋說明', full: '再加上下文、選擇器、時間（定位最穩）' },
    copy: '複製給 AI', copyTitle: '複製 Markdown 審閱意見，貼到 AI 對話即可', jsonTitle: '下載 JSON（AI 可直接讀檔）',
    importBtn: '匯入', clear: '清空', clearConfirm: (n) => '確定清空全部 ' + n + ' 則標記？（建議先匯出 JSON）',
    orphanShort: '找不到原文', regionIn: '區域 in <',
    copied: (n) => '已複製 ' + n + ' 則意見，貼到 AI 對話即可', imported: (n) => '已匯入 ' + n + ' 則', importFail: '匯入失敗：',
    welcome: '審閱模式：選取文字或直接按右鍵新增標記（Alt+R 開清單）',
    langBtn: 'EN', langTitle: 'Switch to English',
    md: {
      title: '# 審閱意見：', count: (n) => '（' + n + ' 則）', region: '區域', point: '位置', top: '開頭',
      file: '- 檔案：', exported: '- 匯出：', summary: (o, m, d) => '- 待處理 ' + o + ' 則（立即處理 ' + m + '）；已處理 ' + d + ' 則',
      laterTag: '（稍後處理）', orphan: '（頁面上已找不到原文）', loc: '- 位置：', beforeFirst: '（第一個標題之前）',
      quote: '- 原文：', context: '- 上下文：', selector: '- 選擇器：', content: '內容', note: '- 說明：', reply: '- AI 回覆：',
      regionLine: (t, s, x, y, w, h) => '- 框選區域：`<' + t + '>`「' + s + '」內，左 ' + x + '、上 ' + y + '、寬 ' + w + '、高 ' + h,
      pinLine: (t, s) => '- 標記點：`<' + t + '>`「' + s + '」',
      meta: (id, c, u) => '- id：`' + id + '`・建立 ' + c + (u ? '・更新 ' + u : ''), resolvedHead: '### 已處理（僅供參考）',
    },
  };
  const EN = {
    types: {
      comment: ['Comment', 'General feedback'], rewrite: ['Rewrite', 'Say it differently', 'Replace with'],
      delete: ['Delete', 'Remove this'], add: ['Add', 'Add content here', 'Content to add'],
      verify: ['Verify', 'Check data / source'], question: ['Question', 'Unclear / why?'],
      style: ['Layout', 'Layout / chart / format'],
    },
    sync: {
      local: 'Stored in this browser only (use "Copy for AI" or export JSON)', connecting: 'Connecting…', saving: 'Saving…',
      synced: 'Auto-saved to file — your AI can read it', offline: 'Server offline — changes kept here, will retry',
    },
    lsFail: 'Cannot write to localStorage — remember to export JSON',
    gotReply: 'AI replied', pinsUpdated: 'Pins updated', htmlChanged: 'Report updated', working: 'AI is editing', workDone: 'AI finished', workAsk: (k) => 'AI done · ' + k + ' need your input', close: 'Close', inProgress: 'In progress', reloadNew: 'Reload',
    clickToView: ' — click a pin to view', dot: ' · ', colon: ': ', lq: '"', rq: '"',
    fabTitle: 'Annotations (Alt+R)', fabLabel: 'Notes', hiddenTag: ' (hidden)', dragHint: '(drag to move)',
    drawTip: 'Drag to box an area (Esc to cancel)', tooSmall: 'Area too small — cancelled',
    headText: (q) => 'Annotate selection: "' + q + '"', headRegion: (t) => 'Annotate boxed area (inside ' + t + ')',
    headPin: (t) => 'Drop a pin here (dashed box = attached element ' + t + ')',
    toRegion: 'Box an area instead…', openList: 'Open annotation list',
    edit: 'Edit…', changeTo: (l) => 'Change to "' + l + '"', unmust: 'Move to later', setMust: 'Fix now',
    reopen: 'Mark pending', setResolved: 'Mark done', reanchorRange: 'Re-select range', delAnn: 'Delete annotation',
    quickAdded: (l, n) => 'Added "' + l + '" #' + n + ' (click it to add a note)', addNote: 'Add note',
    deleted: (n) => 'Deleted #' + n, undo: 'Undo',
    notePh: (hint) => hint + '… (Ctrl+Enter to save, Esc to cancel)',
    orphanLong: 'Original text not found on the page (it may have changed). Use "Re-select" to re-anchor.',
    note: 'Note', aiReply: 'AI reply: ', must: 'Fix now', later: 'Later', resolved: 'Done', pending: 'Pending', status: 'Status',
    del: 'Delete', reanchorBtn: 'Re-select', reanchorTitle: 'Select new text to re-anchor', cancel: 'Cancel', save: 'Save',
    added: (n) => 'Added #' + n, reanchorTip: (n) => 'Select new text to re-anchor #' + n + ' (Esc to cancel)',
    sideTitle: 'Annotations', stats: (o, m, d) => o + ' pending (' + m + ' fix now) · ' + d + ' done',
    all: 'All', showResolved: 'Show done', hideMarks: 'Hide on page',
    empty: ['No annotations yet', 'Select text and right-click, or right-click anywhere', 'Shift+right-click = browser menu'],
    detail: 'Export detail', levels: { brief: 'Brief', std: 'Standard', full: 'Full' },
    levelTips: { brief: 'One line each — fewer tokens', std: 'Quote + location + note', full: 'Adds context, selector, timestamps (most robust)' },
    copy: 'Copy for AI', copyTitle: 'Copy review notes as Markdown and paste into your AI chat', jsonTitle: 'Download JSON (your AI can read the file)',
    importBtn: 'Import', clear: 'Clear', clearConfirm: (n) => 'Delete all ' + n + ' annotations? (Export JSON first if unsure)',
    orphanShort: 'Text not found', regionIn: 'Area in <',
    copied: (n) => 'Copied ' + n + ' notes — paste them into your AI chat', imported: (n) => 'Imported ' + n, importFail: 'Import failed: ',
    welcome: 'Review mode: select text or right-click anywhere to annotate (Alt+R for the list)',
    langBtn: '中', langTitle: '切換成中文',
    md: {
      title: '# Review notes: ', count: (n) => ' (' + n + ')', region: 'area', point: 'pin', top: 'top',
      file: '- File: ', exported: '- Exported: ', summary: (o, m, d) => '- ' + o + ' pending (' + m + ' fix now); ' + d + ' done',
      laterTag: ' (later)', orphan: ' (original text no longer found)', loc: '- Location: ', beforeFirst: '(before the first heading)',
      quote: '- Quote: ', context: '- Context: ', selector: '- Selector: ', content: 'Content', note: '- Note: ', reply: '- AI reply: ',
      regionLine: (t, s, x, y, w, h) => '- Area: inside `<' + t + '>` "' + s + '", left ' + x + ', top ' + y + ', width ' + w + ', height ' + h,
      pinLine: (t, s) => '- Pin: `<' + t + '>` "' + s + '"',
      meta: (id, c, u) => '- id: `' + id + '` · created ' + c + (u ? ' · updated ' + u : ''), resolvedHead: '### Done (for reference)',
    },
  };
  const T = LANG === 'zh' ? ZH : EN;
  function setLang(l) {
    try { localStorage.setItem(LANG_KEY, l); } catch (e) {}
    const u = new URL(location.href);
    u.searchParams.delete('p4hlang');
    location.replace(u.href);
  }

  const TYPES = {
    // 4 組語意色：留言/疑問=藍、改寫/補充/版面=琥珀、刪除=紅、查證=紫
    comment:  { color: '#2f7bcb' },
    rewrite:  { color: '#b7701a' },
    delete:   { color: '#d03b3a', quick: true },
    add:      { color: '#b7701a' },
    verify:   { color: '#6a5fd0' },
    question: { color: '#2f7bcb' },
    style:    { color: '#b7701a' },
  };
  for (const k in TYPES) { const [label, hint, field] = T.types[k]; Object.assign(TYPES[k], { label, hint, field }); }
  const ORDER = Object.keys(TYPES);

  let state = load();
  let hidden = false, showResolved = true, sideOpen = false, reanchorId = null, filterType = null;
  let menuEl = null, editorEl = null, toastTimer = null;
  const PREF = 'pin4html:pref:detail';
  let detail = 'std';
  try { detail = localStorage.getItem(PREF) || 'std'; } catch (e) {}

  // ---------- 儲存 ----------
  function load() {
    let local = null, seed = null;
    try { local = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) {}
    const el = document.getElementById('pin4html-data');
    if (el) { try { seed = JSON.parse(el.textContent); } catch (e) {} }
    let s = local;
    if (seed && (!local || (seed.savedAt || 0) > (local.savedAt || 0))) s = seed;
    return normalize(s);
  }
  function normalize(s) {
    if (!s || !Array.isArray(s.annotations)) s = Object.assign({}, s, { annotations: [] });
    if (!Array.isArray(s.deleted)) s.deleted = [];
    s.rev = s.rev || 0;
    for (const a of s.annotations) if (a.type === 'keep') a.type = 'comment';  // 「保留」已移除（v1.3）
    return s;
  }
  const strip_ = (k, v) => (k[0] === '_' ? undefined : v);
  function snapshot(extra) {
    return Object.assign({}, extra, state, { annotations: state.annotations.map((a) => Object.assign({}, a, { n: a._n })) });
  }
  function serialize(extra) { return JSON.stringify(snapshot(extra), strip_, 2); }
  function save() {
    state.savedAt = Date.now();
    if (!SERVER) {
      try { localStorage.setItem(KEY, serialize()); }
      catch (e) { toast(T.lsFail); }
    }
    scheduleSync();
  }

  // ---------- 伺服器同步 ----------
  // 樂觀鎖：POST 帶 baseRev，檔案被別人（例如 AI 寫回覆）改過會回 409，逐則合併後重送
  let sync = SERVER ? 'connecting' : 'local', dirty = false, inflight = false, syncTimer = 0, htmlStamp = null;
  const SYNC_COLOR = { local: '#9ca3af', connecting: '#d97706', saving: '#d97706', synced: '#16a34a', offline: '#dc2626' };
  const syncDot = () => h('span', { class: 'dot', style: '--c:' + SYNC_COLOR[sync] });
  const pinsUrl = () => SERVER + 'pins?file=' + encodeURIComponent(FILE);
  function setSync(s) { sync = s; renderFab(); const el = ui.querySelector('.sync'); if (el) el.replaceChildren(syncDot(), T.sync[s]); }
  function stamp(r) {
    const m = r.headers.get('X-Pin4html-Html-Mtime');
    if (!m) return;
    if (htmlStamp === null) htmlStamp = m;
    else if (m !== htmlStamp) { htmlStamp = m; htmlChanged = true; }
  }
  let htmlChanged = false;
  async function pull() {
    const r = await fetch(pinsUrl(), { cache: 'no-store' });
    if (!r.ok) throw new Error(r.status);
    stamp(r);
    return normalize(await r.json());
  }
  // 逐則合併：較新的 updated 勝出；但 AI 回覆（replyAt）另外比，避免使用者同時編輯同一則時把回覆蓋掉
  function mergeOne(x, y) {
    const [win, lose] = (x.updated || x.created || 0) > (y.updated || y.created || 0) ? [x, y] : [y, x];
    if ((lose.replyAt || 0) <= (win.replyAt || 0)) return win;
    // 原地改 win：若 win 是頁面上的物件，開著的編輯器仍持有同一個參照
    Object.assign(win, { reply: lose.reply, replyAt: lose.replyAt });
    if ('replyResolved' in lose) Object.assign(win, { resolved: lose.replyResolved, replyResolved: lose.replyResolved });
    else delete win.replyResolved;
    return win;
  }
  function merge(a, b) {
    const del = new Set([...a.deleted, ...b.deleted]), map = new Map();
    for (const x of [...a.annotations, ...b.annotations]) {
      if (del.has(x.id)) continue;
      const y = map.get(x.id);
      map.set(x.id, y ? mergeOne(x, y) : x);
    }
    return Object.assign({}, a, { annotations: [...map.values()], deleted: [...del], rev: Math.max(a.rev, b.rev), working: b.working });
  }
  function scheduleSync() {
    if (!SERVER) return;
    dirty = true; setSync('saving');
    clearTimeout(syncTimer); syncTimer = setTimeout(push, 300);
  }
  async function push() {
    if (inflight) { syncTimer = setTimeout(push, 200); return; }
    inflight = true; dirty = false;
    try {
      const r = await fetch(pinsUrl(), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseRev: state.rev, data: snapshot() }, strip_),
      });
      if (r.status === 409) {
        const cur = normalize(await r.json());
        state = merge(state, cur); state.rev = cur.rev;
        inflight = false; render(); return push();
      }
      if (!r.ok) throw new Error(r.status);
      state.rev = (await r.json()).rev;
      setSync(dirty ? 'saving' : 'synced');
    } catch (e) {
      dirty = true; setSync('offline');
      clearTimeout(syncTimer); syncTimer = setTimeout(push, 3000);
    }
    inflight = false;
  }
  async function poll() {
    if (!SERVER || document.hidden || dirty || inflight) return;
    try {
      const cur = await pull();
      if (sync !== 'synced') setSync('synced');
      // 檔案版本倒退（壞檔被移到 .corrupt-*、或被刪掉）→ 用頁面上的標記補存回去
      if (cur.rev < state.rev && state.annotations.length) { scheduleSync(); return; }
      let msg = '';
      if (cur.rev > state.rev && !menuEl && !editorEl && !dirty && !inflight) {
        const hadReply = cur.annotations.some((a) => a.reply && a.reply !== (byId(a.id) || {}).reply);
        state = cur; render();
        msg = hadReply ? T.gotReply : T.pinsUpdated;
      }
      if (htmlChanged && !menuEl && !editorEl) {  // 正在編輯就等下一輪
        htmlChanged = false;
        await liveRefresh();
        toast((msg ? msg + T.dot : '') + T.htmlChanged);
      } else if (msg) toast(msg + T.clickToView);
    } catch (e) { setSync('offline'); }
  }
  // 報告檔被改 → 直接換上新內容、保留捲動位置，不用手動重新載入。
  // 報告自帶 <script>（圖表等）時換內容不會重跑腳本，改成整頁重載並還原捲動位置。
  const SCROLL_KEY = 'pin4html:scroll:' + FILE;
  async function liveRefresh() {
    const r = await fetch(location.href, { cache: 'no-store' });
    if (!r.ok) throw new Error(r.status);
    const doc = new DOMParser().parseFromString(await r.text(), 'text/html');
    doc.querySelectorAll('script[data-server]').forEach((e) => e.remove());
    if (doc.querySelector('script')) {
      try { sessionStorage.setItem(SCROLL_KEY, String(scrollY)); } catch (e) {}
      location.reload();
      return;
    }
    const y = scrollY;
    const old = [...document.head.querySelectorAll('style:not(#pin4html-style), link[rel="stylesheet"]')];
    for (const e of doc.head.querySelectorAll('style, link[rel="stylesheet"]')) document.head.appendChild(document.importNode(e, true));
    old.forEach((e) => e.remove());
    document.title = doc.title;
    for (const at of [...document.body.attributes]) document.body.removeAttribute(at.name);
    for (const at of doc.body.attributes) document.body.setAttribute(at.name, at.value);
    document.body.replaceChildren(...[...doc.body.childNodes].map((n) => document.importNode(n, true)));
    render();
    scrollTo(0, y);
  }
  if (SERVER) {
    setInterval(poll, 2000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
    addEventListener('beforeunload', () => {
      if (dirty && navigator.sendBeacon)
        navigator.sendBeacon(pinsUrl(), JSON.stringify({ baseRev: state.rev, data: snapshot() }, strip_));
    });
  }
  const byId = (id) => state.annotations.find((a) => a.id === id);
  const uid = () => 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  // ---------- 文字索引 ----------
  const SKIP = /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|TEXTAREA|SELECT|OPTION)$/;
  function textIndex() {
    const nodes = [], starts = []; let total = 0;
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        for (let p = n.parentNode; p && p !== document.body; p = p.parentNode)
          if (SKIP.test(p.nodeName)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    let n;
    while ((n = w.nextNode())) { nodes.push(n); starts.push(total); total += n.data.length; }
    return { nodes, starts, total, text: nodes.map((x) => x.data).join('') };
  }
  function boundary(idx, c, o) {
    if (c.nodeType === 3) {
      const i = idx.nodes.indexOf(c);
      if (i >= 0) return idx.starts[i] + Math.min(o, c.data.length);
    }
    const r = document.createRange();
    try { r.setStart(c, o); } catch (e) { return idx.total; }
    for (let i = 0; i < idx.nodes.length; i++) if (r.comparePoint(idx.nodes[i], 0) >= 0) return idx.starts[i];
    return idx.total;
  }
  function rangeToAnchor(r) {
    if (!document.body.contains(r.commonAncestorContainer)) return null;
    const idx = textIndex();
    const s = boundary(idx, r.startContainer, r.startOffset), e = boundary(idx, r.endContainer, r.endOffset);
    const raw = idx.text.slice(s, e);
    if (!raw.trim()) return null;
    const S = s + (raw.length - raw.trimStart().length), E = e - (raw.length - raw.trimEnd().length);
    return {
      kind: 'text', quote: idx.text.slice(S, E),
      prefix: idx.text.slice(Math.max(0, S - 40), S), suffix: idx.text.slice(E, E + 40),
      pos: S, heading: headingFor(r.startContainer),
    };
  }
  function commonSuffix(a, b) { let i = 0; while (i < a.length && i < b.length && a[a.length - 1 - i] === b[b.length - 1 - i]) i++; return i; }
  function commonPrefix(a, b) { let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++; return i; }
  function locate(a, text) {
    if (!a.quote) return null;
    let best = null, bestScore = -Infinity, i = text.indexOf(a.quote);
    while (i !== -1) {
      const pre = text.slice(Math.max(0, i - (a.prefix || '').length), i);
      const suf = text.slice(i + a.quote.length, i + a.quote.length + (a.suffix || '').length);
      const sc = commonSuffix(pre, a.prefix || '') + commonPrefix(suf, a.suffix || '') - Math.abs(i - (a.pos || 0)) / 1e5;
      if (sc > bestScore) { bestScore = sc; best = i; }
      i = text.indexOf(a.quote, i + 1);
    }
    return best === null ? null : [best, best + a.quote.length];
  }

  // ---------- 文字高亮 ----------
  const BAD_PARENT = /^(TABLE|TBODY|THEAD|TFOOT|TR|UL|OL|DL|COLGROUP)$/;
  const XHTML = 'http://www.w3.org/1999/xhtml';
  function wrapRange(s, e, a) {
    const { nodes, starts } = textIndex();
    const marks = [];
    for (let i = 0; i < nodes.length; i++) {
      let n = nodes[i]; const ns = starts[i], ne = ns + n.data.length;
      if (ne <= s) continue;
      if (ns >= e) break;
      const p = n.parentNode;
      if (!n.data.trim() || BAD_PARENT.test(p.nodeName) || p.namespaceURI !== XHTML) continue;
      const a0 = Math.max(s, ns) - ns, a1 = Math.min(e, ne) - ns;
      if (a1 <= a0) continue;
      if (a1 < n.data.length) n.splitText(a1);
      if (a0 > 0) n = n.splitText(a0);
      const m = document.createElement('mark');
      m.className = 'p4h-hl p4h-t-' + a.type + (a.resolved ? ' p4h-resolved' : '') + (a.priority === 'must' ? '' : ' p4h-later');
      m.dataset.p4h = a.id;
      if (a.note) m.title = a.note;
      n.parentNode.insertBefore(m, n);
      m.appendChild(n);
      marks.push(m);
    }
    return marks;
  }
  function unwrapAll() {
    document.querySelectorAll('mark.p4h-hl').forEach((m) => {
      const p = m.parentNode;
      while (m.firstChild) p.insertBefore(m.firstChild, m);
      p.removeChild(m);
      p.normalize();
    });
  }

  // ---------- 位置圖釘 ----------
  function cssPath(el) {
    while (el && el.matches && el.matches('mark.p4h-hl')) el = el.parentElement;
    const parts = [];
    while (el && el.nodeType === 1 && el !== document.body && el !== document.documentElement) {
      if (el.id && /^[A-Za-z][\w-]*$/.test(el.id) && document.querySelectorAll('#' + el.id).length === 1) {
        parts.unshift('#' + el.id); break;
      }
      let i = 1, s = el;
      while ((s = s.previousElementSibling)) if (s.nodeName === el.nodeName && !(s.matches && s.matches('mark.p4h-hl'))) i++;
      parts.unshift(el.nodeName.toLowerCase() + ':nth-of-type(' + i + ')');
      el = el.parentElement;
    }
    if (!parts.length || parts[0][0] !== '#') parts.unshift('body');
    return parts.join(' > ');
  }
  function pointAnchor(el, x, y) {
    if (el.nodeType !== 1) el = el.parentElement;
    while (el && el.matches('mark.p4h-hl')) el = el.parentElement;
    if (!el || el === document.documentElement) el = document.body;
    const r = el.getBoundingClientRect();
    const clamp = (v) => Math.max(0, Math.min(1, v));
    return {
      kind: 'pin', path: cssPath(el),
      rx: r.width ? clamp((x - r.left) / r.width) : 0, ry: r.height ? clamp((y - r.top) / r.height) : 0,
      tag: el.nodeName.toLowerCase(),
      snippet: (el.textContent || el.getAttribute('alt') || '').replace(/\s+/g, ' ').trim().slice(0, 60),
      heading: headingFor(el),
    };
  }
  function pinTarget(a) { try { return document.querySelector(a.path); } catch (e) { return null; } }
  function headingFor(node) {
    let h = null;
    for (const x of document.body.querySelectorAll('h1,h2,h3,h4')) {
      if (x === node || x.contains(node) || x.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) h = x;
      else break;
    }
    return h ? h.textContent.replace(/\s+/g, ' ').trim().slice(0, 80) : '';
  }

  // ---------- Shadow UI ----------
  const UI_CSS = `
  :host{all:initial}
  *{box-sizing:border-box;font-family:system-ui,-apple-system,"Segoe UI","Microsoft JhengHei","PingFang TC",sans-serif}
  .pins{position:absolute;left:0;top:0;overflow:clip;pointer-events:none}.pins>*{pointer-events:auto}.pins>.region{pointer-events:none}
  .ui,.pins{--bg:#fff;--fg:#1f2328;--mut:#6b7280;--bd:#e5e7eb;--hov:#f3f4f6;--acc:#2563eb;color:var(--fg);font-size:13px;line-height:1.45}
  @media (prefers-color-scheme:dark){.ui,.pins{--bg:#1f2329;--fg:#e6e8eb;--mut:#9aa1ab;--bd:#3a414b;--hov:#2a3038;--acc:#60a5fa}}
  .pin{position:absolute;min-width:18px;height:18px;margin-top:-18px;padding:0 5px;border-radius:9px 9px 9px 2px;background:var(--c);color:#fff;
    font:600 11px/18px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;text-align:center;cursor:grab;box-shadow:0 0 0 1.5px #fff,0 1px 3px rgba(0,0,0,.2);user-select:none;touch-action:none;white-space:nowrap}
  .pin.res{opacity:.45}.pin.later{opacity:.6}.pin.drag{cursor:grabbing;opacity:.8}
  .pin.flash,.region.flash{animation:fl .5s 3}
  .region{position:absolute;border:1px solid var(--c);background:color-mix(in srgb,var(--c) 5%,transparent);border-radius:2px;pointer-events:none}
  .region.res{opacity:.45;border-style:dashed}.region.later{border-style:dotted}.region.later .rl{opacity:.6}
  .region .rl{position:absolute;left:-1px;top:-18px;height:18px;padding:0 5px;border-radius:2px 2px 2px 0;background:var(--c);color:#fff;
    font:600 11px/18px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;white-space:nowrap;cursor:pointer;pointer-events:auto}
  .target{position:absolute;outline:1px dashed var(--acc);outline-offset:2px;border-radius:2px;background:color-mix(in srgb,var(--acc) 5%,transparent);pointer-events:none}
  .drawov{position:fixed;inset:0;cursor:crosshair;background:rgba(0,0,0,.06);z-index:5}
  .drawov .box{position:absolute;border:2px dashed var(--acc);background:color-mix(in srgb,var(--acc) 12%,transparent);border-radius:6px}
  .drawov .tip{position:fixed;top:14px;left:50%;transform:translateX(-50%);background:#111827;color:#fff;padding:6px 12px;border-radius:8px;font-size:13px}
  .seg{display:flex;border:1px solid var(--bd);border-radius:6px;overflow:hidden;font-size:12px}
  .seg button{border:0;background:none;color:var(--fg);padding:4px 8px;cursor:pointer}.seg button.on{background:var(--acc);color:#fff}
  @keyframes fl{50%{transform:scale(1.5)}}
  .pop{position:fixed;background:var(--bg);border:1px solid var(--bd);border-radius:10px;box-shadow:0 12px 32px rgba(0,0,0,.22);z-index:3}
  .menu{min-width:230px;padding:6px}
  .hd{padding:4px 8px 6px;color:var(--mut);font-size:12px;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .item{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:6px;cursor:pointer}
  .item:hover{background:var(--hov)}
  .item .k{margin-left:auto;color:var(--mut);font-size:11px;padding-left:12px}
  .item .ic{width:14px;display:flex;justify-content:center}
  .dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--c);flex:none;vertical-align:middle}.chip .dot,.sync .dot{margin-right:6px}.fab .dot{margin-right:8px}
  .sep{height:1px;background:var(--bd);margin:4px 2px}
  .row{display:flex;gap:4px;padding:4px 6px;flex-wrap:wrap;max-width:300px}
  .ed{width:380px;max-width:calc(100vw - 16px);padding:12px;display:flex;flex-direction:column;gap:8px}
  .chips{display:flex;flex-wrap:wrap;gap:4px}
  .chip{border:1px solid var(--bd);border-radius:999px;padding:2px 8px;cursor:pointer;background:transparent;color:var(--fg);font-size:12px}
  .chip.on{border-color:var(--c);background:color-mix(in srgb,var(--c) 18%,transparent);font-weight:600}
  .lbl{font-size:12px;color:var(--mut)}
  textarea{width:100%;min-height:60px;resize:vertical;border:1px solid var(--bd);border-radius:6px;padding:6px 8px;background:var(--bg);color:var(--fg);font-size:13px;line-height:1.5}
  textarea:focus{outline:2px solid var(--acc);outline-offset:-1px}
  .quote{border-left:3px solid var(--c);padding:4px 8px;color:var(--mut);max-height:84px;overflow:auto;white-space:pre-wrap;background:var(--hov);border-radius:0 6px 6px 0;font-size:12px}
  .reply{border:1px dashed var(--acc);border-radius:6px;padding:6px 8px;font-size:12px;white-space:pre-wrap}
  .flags{display:flex;gap:14px;font-size:12px;align-items:center}.flags .sp{flex:1}.flags label{display:flex;gap:4px;align-items:center;cursor:pointer}
  .btns{display:flex;gap:6px;align-items:center}.btns .sp{flex:1}
  .btn{border:1px solid var(--bd);background:var(--bg);color:var(--fg);border-radius:6px;padding:5px 10px;cursor:pointer;font-size:12px}
  .btn:hover{background:var(--hov)}
  .btn.pri{background:var(--acc);border-color:var(--acc);color:#fff}
  .btn.dan{color:#dc2626}
  .fab{position:fixed;right:18px;bottom:18px;height:36px;padding:0 14px;border-radius:18px;display:flex;align-items:center;border:1px solid var(--bd);background:var(--bg);color:var(--fg);
    box-shadow:0 6px 18px rgba(0,0,0,.2);cursor:pointer;font-size:13px;font-weight:500;z-index:1}
  .fab .m{margin-left:8px;background:#d03b3a;color:#fff;border-radius:9px;padding:1px 6px;font-size:11px}
  .side{position:fixed;top:0;right:0;width:370px;max-width:100vw;height:100vh;display:flex;flex-direction:column;background:var(--bg);border-left:1px solid var(--bd);box-shadow:-8px 0 24px rgba(0,0,0,.15);z-index:2}
  .sh{padding:12px 14px;border-bottom:1px solid var(--bd);display:flex;flex-direction:column;gap:8px}
  .st{display:flex;align-items:center;font-weight:700;font-size:15px}.st .x{margin-left:auto}
  .sub{color:var(--mut);font-size:12px}
  .list{flex:1;overflow:auto;padding:10px}
  .card{border:1px solid var(--bd);border-left:4px solid var(--c);border-radius:8px;padding:8px 10px;margin-bottom:8px;cursor:pointer}
  .card:hover{background:var(--hov)}.card.res{opacity:.5}
  .ct{display:flex;gap:6px;align-items:center;font-size:12px;font-weight:600}
  .ct .n{color:var(--c);font:600 11px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}.ct .n::before{content:"#"}
  .ct .st-pend,.ct .st-done,.ct .st-work,.ct .later{border-radius:3px;padding:0 5px;font-size:11px;font-weight:500}.ct .st-pend{background:#fff4e5;color:#b45309}.ct .st-work{background:#dbeafe;color:#1d4ed8}.ct .st-done{background:#e7f6ec;color:#15803d}.ct .later{border:1px solid var(--bd);color:var(--mut)}.ct .orph{color:#d97706;font-weight:400}
  .ct .loc{margin-left:auto;color:var(--mut);font-weight:400;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .cq{color:var(--mut);font-size:12px;margin-top:4px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
  .cn{font-size:13px;margin-top:4px;white-space:pre-wrap}
  .empty{color:var(--mut);text-align:center;padding:30px 10px;line-height:1.8}
  .sf{padding:10px 14px;border-top:1px solid var(--bd);display:flex;flex-wrap:wrap;gap:6px}
  .toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:#111827;color:#fff;padding:8px 14px;border-radius:8px;font-size:13px;
    box-shadow:0 8px 20px rgba(0,0,0,.3);display:flex;gap:10px;align-items:center;z-index:4}
  .toast button{background:none;border:0;color:#93c5fd;cursor:pointer;font-size:13px;font-weight:600}
  .busy{position:fixed;top:16px;right:16px;z-index:3;width:320px;max-width:calc(100vw - 32px);border-radius:12px;overflow:hidden;
    background:#1d4ed8;color:#fff;box-shadow:0 8px 24px rgba(29,78,216,.35);animation:bz 2s ease-in-out infinite}
  .busy.ok{background:#15803d;box-shadow:0 8px 24px rgba(21,128,61,.3);animation:none}
  .busy.ask{background:#b45309;box-shadow:0 8px 24px rgba(180,83,9,.3);animation:none}
  .busy .bx{border:0;background:none;color:#fff;font-size:18px;line-height:1;cursor:pointer;padding:0 0 0 4px;opacity:.85}
  .qm{flex:none;width:16px;height:16px;border-radius:50%;background:#fff;color:#b45309;font:700 11px/16px system-ui;text-align:center}
  .qm.sm{width:14px;height:14px;line-height:14px;background:#fef3c7;color:#b45309}
  .busy .bh{display:flex;align-items:center;gap:10px;padding:10px 14px;font-size:14px;font-weight:600}
  .busy .cnt{margin-left:auto;font:600 12px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;opacity:.85}
  .busy .bl{background:var(--bg);color:var(--fg);padding:4px 0;max-height:240px;overflow:auto}
  .busy .bi{display:flex;align-items:center;gap:8px;padding:6px 14px;font-size:13px;cursor:pointer}
  .busy .bi:hover{background:var(--hov)}
  .busy .bi .n{color:var(--c);font:600 12px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;flex:none}
  .busy .bi .t{color:var(--c);font-weight:600;flex:none}
  .busy .bi .q{color:var(--mut);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .busy .bi.done .q{opacity:.6}
  .ui.side-open .busy{right:386px}
  .spin{flex:none;width:14px;height:14px;border:2px solid rgba(255,255,255,.35);border-top-color:#fff;border-radius:50%;animation:sp .8s linear infinite}
  .chk{flex:none;width:6px;height:11px;margin:0 3px 3px;border:solid #fff;border-width:0 2px 2px 0;transform:rotate(45deg)}
  .spin.sm{width:12px;height:12px;border-color:color-mix(in srgb,var(--acc) 25%,transparent);border-top-color:var(--acc)}
  .chk.sm{width:5px;height:10px;border-color:#16a34a}
  @keyframes sp{to{transform:rotate(360deg)}}
  @keyframes bz{50%{box-shadow:0 8px 30px rgba(29,78,216,.65)}}
  @media print{.ui,.pins{display:none}}
  `;
  function docCss() {
    // C 極簡線條風：不填底色，細底線＋上標 [n]；稍後處理＝點線、編號淡；已處理＝虛線
    // 只疊加、不佔位：編號絕對定位浮在字尾右上，不改變原報告的換行與寬度
    let css = `mark.p4h-hl{position:relative;background:transparent;color:inherit;padding:0 0 1px;border-radius:0;cursor:pointer;-webkit-box-decoration-break:clone;box-decoration-break:clone;transition:background-color .15s}
    mark.p4h-hl:hover{background:color-mix(in srgb,var(--p4h-c) 12%,transparent)}
    mark.p4h-hl[data-n]::after{content:'[' attr(data-n) ']';position:absolute;left:100%;top:-.55em;margin-left:1px;padding:0 1px;border-radius:2px;
      background:rgba(255,255,255,.85);color:var(--p4h-c);white-space:nowrap;
      font:600 10px/1.2 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;text-indent:0;letter-spacing:0;text-decoration:none}
    mark.p4h-hl.p4h-num{border:0!important;padding:0!important;background:none!important;text-decoration:none!important}
    mark.p4h-hl.p4h-later{border-bottom-style:dotted!important}
    mark.p4h-hl.p4h-later[data-n]::after{opacity:.55}
    mark.p4h-hl.p4h-resolved{border-bottom-style:dashed!important;text-decoration:none!important}
    mark.p4h-hl.p4h-resolved[data-n]::after{opacity:.45}
    mark.p4h-hl.p4h-flash{animation:p4h-fl .5s 3}
    @keyframes p4h-fl{50%{background:color-mix(in srgb,var(--p4h-c) 30%,transparent)}}
    @media print{mark.p4h-hl{background:none!important;border:0!important;text-decoration:none!important}mark.p4h-hl::after{display:none!important}}`;
    for (const k of ORDER) {
      const c = TYPES[k].color;
      css += `\nmark.p4h-hl.p4h-t-${k}{--p4h-c:${c};border-bottom:1.5px solid ${c}}`;
    }
    css += `\nmark.p4h-hl.p4h-t-delete{text-decoration:line-through;text-decoration-color:${TYPES.delete.color};text-decoration-thickness:1.5px}`;
    return css;
  }

  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    if (props) for (const k in props) {
      const v = props[k];
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style') el.style.cssText = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat()) {
      if (c == null || c === false) continue;
      el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return el;
  }

  const host = document.createElement('div');
  host.id = 'pin4html-root';
  host.style.cssText = 'position:absolute;top:0;left:0;width:0;height:0;z-index:2147483646;';
  const root = host.attachShadow({ mode: 'open' });
  const pinLayer = h('div', { class: 'pins' });
  const ui = h('div', { class: 'ui' });
  root.append(h('style', null, UI_CSS), pinLayer, ui);
  const fab = h('button', { class: 'fab', title: T.fabTitle, onclick: () => toggleSide() });
  const side = h('div', { class: 'side', style: 'display:none' });
  const busy = h('div', { class: 'busy', style: 'display:none', role: 'status' });
  ui.append(fab, side, busy);

  // ---------- 繪製 ----------
  function sorted() {
    return state.annotations.slice().sort((a, b) => (a._pos ?? 1e12) - (b._pos ?? 1e12) || a.created - b.created);
  }
  function render() {
    closeMenu();
    unwrapAll();
    const idx = textIndex();
    for (const a of state.annotations) {
      a._orphan = false; a._range = null; a._pos = null;
      if (a.kind === 'text') {
        // 改寫已處理後原文不在了 → 改用替換文字定位，標記跟著新內容走
        const r = locate(a, idx.text) || (a.resolved && a.replacement ? locate(Object.assign({}, a, { quote: a.replacement }), idx.text) : null);
        if (r) { a._range = r; a._pos = r[0]; } else a._orphan = true;
      } else {
        const el = pinTarget(a);
        if (el) { a._pos = boundary(idx, el, 0); } else a._orphan = true;
      }
    }
    sorted().forEach((a, i) => (a._n = i + 1));
    const visible = (a) => !hidden && (showResolved || !a.resolved);
    for (const a of state.annotations) {
      if (a.kind !== 'text' || !a._range || !visible(a)) continue;
      const marks = wrapRange(a._range[0], a._range[1], a);
      if (!marks.length) a._orphan = true;
      else {
        // 編號掛在最後一個字後面的空 mark（寬度 0），跨行的標記編號才會在句尾、不會跑到開頭
        const last = marks[marks.length - 1], num = document.createElement('mark');
        num.className = last.className + ' p4h-num';
        num.dataset.p4h = a.id; num.dataset.n = a._n;
        if (last.title) num.title = last.title;
        last.after(num);
      }
    }
    pinLayer.textContent = '';
    for (const a of state.annotations) {
      if (a.kind === 'text' || a._orphan || !visible(a)) continue;
      const t = TYPES[a.type] || TYPES.comment;
      if (a.kind === 'region') {
        const lab = h('div', { class: 'rl', text: String(a._n), title: t.label + (a.note ? T.colon + a.note : '') });
        lab.dataset.p4h = a.id;
        lab.addEventListener('click', (e) => openEditor(a, e.clientX, e.clientY));
        const box = h('div', { class: 'region' + (a.resolved ? ' res' : '') + (a.priority === 'must' ? '' : ' later'), style: '--c:' + t.color }, lab);
        box.dataset.p4h = a.id;
        pinLayer.appendChild(box);
        continue;
      }
      const p = h('div', {
        class: 'pin' + (a.resolved ? ' res' : '') + (a.priority === 'must' ? '' : ' later'),
        style: '--c:' + t.color, title: (t.label + (a.note ? T.colon + a.note : '')) + '\n' + T.dragHint,
        text: String(a._n),
      });
      p.dataset.p4h = a.id;
      bindPinDrag(p, a);
      pinLayer.appendChild(p);
    }
    renderBusy();
    positionPins();
    renderSide();
    renderFab();
  }
  // AI 處理中提示（右上角）：watch 交出標記時寫入 working，reply 逐則清掉；超過 15 分鐘視為中斷不再顯示。
  // 清單在開始時記下（編號、類型、片段），改完編號可能重排也不影響；回覆一則就打勾一則。
  let busyIds = [], busyItems = [], busyTimer = 0;
  function renderBusy() {
    const w = state.working;
    const ids = w && Array.isArray(w.ids) && Date.now() - (w.since || 0) < 15 * 60000 ? w.ids.filter(byId) : [];
    if (ids.length && !busyIds.length) busyItems = [];  // 上一輪已結束、新一輪開始 → 換一張新清單
    for (const id of ids) {
      if (busyItems.some((x) => x.id === id)) continue;
      const a = byId(id), t = TYPES[a.type] || TYPES.comment;
      const what = a.kind === 'text' ? T.lq + a.quote + T.rq : a.note || a.snippet || '<' + a.tag + '>';
      busyItems.push({ id, n: a._n, label: t.label, color: t.color,
        snip: (what + (a.replacement ? ' → ' + a.replacement : '')).replace(/\s+/g, ' ') });
    }
    busyIds = ids;
    if (!busyItems.length) return;
    // 每則三種結果：處理中（轉圈）／已改好（綠勾）／已回覆但要使用者回答（琥珀 ?）
    const stateOf = (x) => ids.includes(x.id) ? 'work' : (byId(x.id) || {}).resolved ? 'ok' : 'ask';
    const left = busyItems.filter((x) => stateOf(x) === 'work').length, all = !left;
    const ask = busyItems.filter((x) => stateOf(x) === 'ask').length;
    const hide = () => { busy.style.display = 'none'; busyItems = []; };
    clearTimeout(busyTimer);
    busy.className = 'busy' + (all ? (ask ? ' ask' : ' ok') : '');
    busy.replaceChildren(
      h('div', { class: 'bh' }, h('span', { class: all ? (ask ? 'qm' : 'chk') : 'spin', text: all && ask ? '?' : null }),
        all ? (ask ? T.workAsk(ask) : T.workDone) : T.working,
        h('span', { class: 'cnt', text: (busyItems.length - left) + '/' + busyItems.length }),
        all ? h('button', { class: 'bx', text: '×', title: T.close, onclick: hide }) : null),
      h('div', { class: 'bl' }, busyItems.map((x) => {
        const st = stateOf(x);
        return h('div', { class: 'bi' + (st === 'work' ? '' : ' done'), style: '--c:' + x.color, title: x.snip,
          onclick: () => { const a = byId(x.id); if (a) focusAnn(a); } },
        h('span', { class: 'n', text: '#' + x.n }), h('span', { class: 't', text: x.label }),
        h('span', { class: 'q', text: x.snip }),
        h('span', { class: st === 'work' ? 'spin sm' : st === 'ok' ? 'chk sm' : 'qm sm', text: st === 'ask' ? '?' : null }));
      })));
    busy.style.display = '';
    if (all && !ask) busyTimer = setTimeout(hide, 2000);  // 全部改好 2 秒後消失；有要使用者回答的就留著，等他關
  }

  function positionPins() {
    // 圖層裁切在文件原本的大小內：靠右的圖釘／框選不會撐出橫向捲軸
    pinLayer.style.width = pinLayer.style.height = '0';
    const de = document.documentElement, W = de.scrollWidth, H = de.scrollHeight;
    pinLayer.style.width = W + 'px';
    pinLayer.style.height = H + 'px';
    for (const p of pinLayer.children) {
      const a = byId(p.dataset.p4h), el = a && pinTarget(a);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      p.style.display = r.width || r.height ? '' : 'none';
      let x = r.left + scrollX + a.rx * r.width, y = r.top + scrollY + a.ry * r.height;
      if (a.kind === 'region') {
        p.style.width = Math.min(a.rw * r.width, W - x) + 'px';
        p.style.height = a.rh * r.height + 'px';
        p.firstChild.style.top = y < 18 ? '0' : '';  // 貼著頁面頂端時標籤放進框內，免得被裁掉
      } else {
        x = Math.min(x, W - p.offsetWidth);  // 靠邊的圖釘往內收，整顆看得到
        y = Math.max(y, p.offsetHeight);
      }
      p.style.left = x + 'px';
      p.style.top = y + 'px';
    }
  }
  function renderFab() {
    const open = state.annotations.filter((a) => !a.resolved);
    fab.textContent = T.fabLabel + ' ' + open.length;
    fab.title = T.fabTitle + '\n' + T.sync[sync];
    if (sync !== 'local') fab.prepend(syncDot());
    if (hidden) fab.appendChild(h('span', { style: 'margin-left:6px;opacity:.6', text: T.hiddenTag }));
  }

  // ---------- 拖曳圖釘 ----------
  function bindPinDrag(p, a) {
    p.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const sx = e.clientX, sy = e.clientY, ox = parseFloat(p.style.left), oy = parseFloat(p.style.top);
      let moved = false;
      p.setPointerCapture(e.pointerId);
      const mv = (ev) => {
        const dx = ev.clientX - sx, dy = ev.clientY - sy;
        if (!moved && Math.hypot(dx, dy) < 4) return;
        moved = true; p.classList.add('drag');
        p.style.left = ox + dx + 'px'; p.style.top = oy + dy + 'px';
      };
      const up = (ev) => {
        p.removeEventListener('pointermove', mv); p.removeEventListener('pointerup', up);
        p.classList.remove('drag');
        if (!moved) { openEditor(a, ev.clientX, ev.clientY); return; }
        // 錨點在泡泡左下角
        const x = ev.clientX - (sx - (ox - scrollX)), y = ev.clientY - (sy - (oy - scrollY));
        host.style.display = 'none';
        const el = document.elementFromPoint(x, y);
        host.style.display = '';
        if (el) Object.assign(a, pointAnchor(el, x, y), { kind: 'pin', updated: Date.now() });
        render(); save();
      };
      p.addEventListener('pointermove', mv); p.addEventListener('pointerup', up);
    });
  }

  // ---------- 右鍵選單 ----------
  function place(el, x, y) {
    ui.appendChild(el);
    const r = el.getBoundingClientRect();
    el.style.left = Math.max(8, Math.min(x, innerWidth - r.width - 8)) + 'px';
    el.style.top = Math.max(8, Math.min(y, innerHeight - r.height - 8)) + 'px';
  }
  function closeMenu() {
    if (menuEl) { menuEl.remove(); menuEl = null; }
    pinLayer.querySelectorAll('.target').forEach((t) => t.remove());
  }
  function showTarget(anchor) {
    let L, T, W, H;
    if (anchor.kind === 'region') {
      const el = pinTarget(anchor); if (!el) return;
      const r = el.getBoundingClientRect();
      L = r.left + anchor.rx * r.width; T = r.top + anchor.ry * r.height; W = anchor.rw * r.width; H = anchor.rh * r.height;
    } else if (anchor.kind === 'pin') {
      const el = pinTarget(anchor); if (!el || el === document.body) return;
      const r = el.getBoundingClientRect(); L = r.left; T = r.top; W = r.width; H = r.height;
    } else return;
    pinLayer.appendChild(h('div', { class: 'target', style: `left:${L + scrollX}px;top:${T + scrollY}px;width:${W}px;height:${H}px` }));
  }

  // ---------- 區域框選 ----------
  function regionAnchor(x1, y1, x2, y2) {
    const L = Math.min(x1, x2), T = Math.min(y1, y2), R = Math.max(x1, x2), B = Math.max(y1, y2);
    host.style.display = 'none';
    let el = document.elementFromPoint((L + R) / 2, (T + B) / 2);
    host.style.display = '';
    while (el && el !== document.body) {
      const r = el.getBoundingClientRect();
      if (!el.matches('mark.p4h-hl') && r.left <= L + 1 && r.top <= T + 1 && r.right >= R - 1 && r.bottom >= B - 1) break;
      el = el.parentElement;
    }
    el = el || document.body;
    const r = el.getBoundingClientRect(), base = pointAnchor(el, L, T);
    return Object.assign(base, {
      kind: 'region',
      rx: (L - r.left) / (r.width || 1), ry: (T - r.top) / (r.height || 1),
      rw: (R - L) / (r.width || 1), rh: (B - T) / (r.height || 1),
    });
  }
  function startDraw() {
    closeMenu(); closeEditor();
    const box = h('div', { class: 'box', style: 'display:none' });
    const ov = h('div', { class: 'drawov' }, box, h('div', { class: 'tip', text: T.drawTip }));
    let sx = 0, sy = 0, on = false;
    ov.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      on = true; sx = e.clientX; sy = e.clientY; ov.setPointerCapture(e.pointerId);
      Object.assign(box.style, { display: '', left: sx + 'px', top: sy + 'px', width: '0', height: '0' });
    });
    ov.addEventListener('pointermove', (e) => {
      if (!on) return;
      Object.assign(box.style, {
        left: Math.min(sx, e.clientX) + 'px', top: Math.min(sy, e.clientY) + 'px',
        width: Math.abs(e.clientX - sx) + 'px', height: Math.abs(e.clientY - sy) + 'px',
      });
    });
    ov.addEventListener('pointerup', (e) => {
      if (!on) return;
      on = false; ov.remove(); drawCancel = null;
      if (Math.abs(e.clientX - sx) < 8 || Math.abs(e.clientY - sy) < 8) { toast(T.tooSmall); return; }
      openCreateMenu(e.clientX, e.clientY, regionAnchor(sx, sy, e.clientX, e.clientY));
    });
    ov.addEventListener('contextmenu', (e) => { e.preventDefault(); ov.remove(); drawCancel = null; });
    drawCancel = () => { ov.remove(); drawCancel = null; };
    ui.appendChild(ov);
  }
  let drawCancel = null;
  function closeEditor() { if (editorEl) { editorEl.remove(); editorEl = null; } }

  function openCreateMenu(x, y, anchor) {
    closeMenu(); closeEditor();
    const head = anchor.kind === 'text'
      ? T.headText(anchor.quote.slice(0, 24) + (anchor.quote.length > 24 ? '…' : ''))
      : anchor.kind === 'region' ? T.headRegion(anchor.tag) : T.headPin(anchor.tag);
    menuEl = h('div', { class: 'pop menu' }, h('div', { class: 'hd', text: head }),
      ORDER.map((k, i) => {
        const t = TYPES[k];
        return h('div', { class: 'item', onclick: () => create(k, anchor, x, y) },
          h('span', { class: 'ic' }, h('span', { class: 'dot', style: '--c:' + t.color })), h('span', { text: t.label }),
          h('span', { class: 'k', text: t.hint + ' · ' + (i + 1) }));
      }),
      h('div', { class: 'sep' }),
      anchor.kind === 'region' ? null : h('div', { class: 'item', onclick: startDraw },
        h('span', { class: 'ic' }), h('span', { text: T.toRegion }), h('span', { class: 'k', text: 'Alt+D' })),
      h('div', { class: 'item', onclick: () => { closeMenu(); toggleSide(true); } },
        h('span', { class: 'ic' }), h('span', { text: T.openList }), h('span', { class: 'k', text: 'Alt+R' })));
    menuEl._keys = (e) => { const i = +e.key - 1; if (i >= 0 && i < ORDER.length) { create(ORDER[i], anchor, x, y); return true; } };
    place(menuEl, x, y);
    showTarget(anchor);
  }
  function openExistingMenu(x, y, a) {
    closeMenu(); closeEditor();
    const t = TYPES[a.type] || TYPES.comment;
    const item = (label, fn, cls) => h('div', { class: 'item' + (cls ? ' ' + cls : ''), onclick: () => { closeMenu(); fn(); } },
      h('span', { text: label }));
    menuEl = h('div', { class: 'pop menu' },
      h('div', { class: 'hd', text: '#' + a._n + ' ' + t.label + (a.note ? T.colon + a.note : '') }),
      item(T.edit, () => openEditor(a, x, y)),
      h('div', { class: 'row chips' }, ORDER.map((k) => h('button', {
        class: 'chip' + (k === a.type ? ' on' : ''), title: T.changeTo(TYPES[k].label), style: '--c:' + TYPES[k].color,
        onclick: () => { closeMenu(); a.type = k; touch(a); },
      }, h('span', { class: 'dot' }), TYPES[k].label))),
      h('div', { class: 'sep' }),
      item(a.priority === 'must' ? T.unmust : T.setMust, () => { a.priority = a.priority === 'must' ? 'should' : 'must'; touch(a); }),
      item(a.resolved ? T.reopen : T.setResolved, () => { a.resolved = !a.resolved; touch(a); }),
      item(T.reanchorRange, () => startReanchor(a)),
      h('div', { class: 'sep' }),
      item(T.delAnn, () => remove(a), 'dan'));
    place(menuEl, x, y);
  }
  function touch(a) { a.updated = Date.now(); render(); save(); }

  function create(type, anchor, x, y) {
    closeMenu();
    const a = Object.assign({ id: uid(), type, note: '', replacement: '', priority: 'must', resolved: false, created: Date.now() }, anchor);
    window.getSelection().removeAllRanges();
    if (TYPES[type].quick) {
      state.annotations.push(a); render(); save();
      toast(T.quickAdded(TYPES[type].label, a._n), T.addNote, () => openEditor(a, x, y));
    } else openEditor(a, x, y, true);
  }
  function remove(a) {
    const i = state.annotations.indexOf(a);
    if (i < 0) return;
    state.annotations.splice(i, 1); state.deleted.push(a.id); render(); save(); closeEditor();
    toast(T.deleted(a._n), T.undo, () => {
      state.annotations.splice(i, 0, a); state.deleted = state.deleted.filter((d) => d !== a.id);
      a.updated = Date.now(); render(); save();
    });
  }

  // ---------- 編輯器 ----------
  function openEditor(a, x, y, isNew) {
    closeMenu(); closeEditor();
    const draft = { type: a.type, note: a.note || '', replacement: a.replacement || '', priority: a.priority, resolved: a.resolved };
    const ed = h('div', { class: 'pop ed' });
    const draw = () => {
      const t = TYPES[draft.type];
      ed.style.setProperty('--c', t.color);
      ed.textContent = '';
      const note = h('textarea', { placeholder: T.notePh(t.hint) });
      note.value = draft.note; note.oninput = () => (draft.note = note.value);
      let rep = null;
      if (t.field) {
        rep = h('textarea', { placeholder: t.field + '…' });
        rep.value = draft.replacement; rep.oninput = () => (draft.replacement = rep.value);
      }
      ed.append(...[
        h('div', { class: 'chips' }, ORDER.map((k) => h('button', {
          class: 'chip' + (k === draft.type ? ' on' : ''), style: '--c:' + TYPES[k].color,
          onclick: () => { draft.type = k; draw(); },
        }, h('span', { class: 'dot' }), TYPES[k].label))),
        a.kind === 'text'
          ? h('div', { class: 'quote', text: a.quote })
          : h('div', { class: 'quote', text: (a.heading ? '§ ' + a.heading + ' — ' : '') + '<' + a.tag + '> ' + (a.snippet || '') }),
        a._orphan ? h('div', { class: 'lbl', style: 'color:#d97706', text: T.orphanLong }) : null,
        rep ? h('div', { class: 'lbl', text: t.field }) : null, rep,
        h('div', { class: 'lbl', text: T.note }), note,
        a.reply ? h('div', { class: 'reply', text: T.aiReply + a.reply }) : null,
        h('div', { class: 'flags' },
          h('label', null, h('input', { type: 'checkbox', checked: draft.priority === 'must', onchange: (e) => (draft.priority = e.target.checked ? 'must' : 'should') }), T.must),
          h('span', { class: 'sp' }), h('span', { class: 'lbl', text: T.status }),
          h('div', { class: 'seg' }, [false, true].map((v) => h('button', {
            class: draft.resolved === v ? 'on' : '', text: v ? T.resolved : T.pending,
            onclick: () => { draft.resolved = v; draw(); },
          })))),
        h('div', { class: 'btns' },
          isNew ? null : h('button', { class: 'btn dan', text: T.del, onclick: () => remove(a) }),
          isNew ? null : h('button', { class: 'btn', text: T.reanchorBtn, title: T.reanchorTitle, onclick: () => startReanchor(a) }),
          h('span', { class: 'sp' }),
          h('button', { class: 'btn', text: T.cancel, onclick: closeEditor }),
          h('button', { class: 'btn pri', text: T.save, onclick: commit }))].filter(Boolean));
      (rep && !draft.replacement && draft.type === 'rewrite' ? rep : note).focus();
    };
    const commit = () => {
      Object.assign(a, draft, { updated: Date.now() });
      if (isNew) state.annotations.push(a);
      closeEditor(); render(); save();
      if (isNew) toast(T.added(a._n));
    };
    ed._keys = (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { commit(); return true; } };
    editorEl = ed;
    place(ed, x + 6, y + 6);
    draw();
    const r = ed.getBoundingClientRect();
    if (r.bottom > innerHeight - 8) ed.style.top = Math.max(8, innerHeight - r.height - 8) + 'px';
  }

  // ---------- 重新框選 ----------
  function startReanchor(a) {
    closeEditor(); closeMenu();
    reanchorId = a.id;
    toast(T.reanchorTip(a._n), T.cancel, () => { reanchorId = null; }, 60000);
  }
  document.addEventListener('mouseup', (e) => {
    if (!reanchorId || e.composedPath().includes(host)) return;
    setTimeout(() => {
      const sel = getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) return;
      const anc = rangeToAnchor(sel.getRangeAt(0));
      const a = byId(reanchorId);
      reanchorId = null;
      if (!anc || !a) return;
      for (const k of ['path', 'rx', 'ry', 'rw', 'rh', 'tag', 'snippet']) delete a[k];
      Object.assign(a, anc, { updated: Date.now() });
      sel.removeAllRanges(); render(); save(); hideToast();
      const m = document.querySelector('mark.p4h-hl[data-p4h="' + a.id + '"]');
      const r = m ? m.getBoundingClientRect() : { left: e.clientX, bottom: e.clientY };
      openEditor(a, r.left, r.bottom);
    }, 0);
  }, true);

  // ---------- 側欄 ----------
  function toggleSide(force) {
    sideOpen = force ?? !sideOpen;
    ui.classList.toggle('side-open', sideOpen);
    side.style.display = sideOpen ? '' : 'none';
    fab.style.display = sideOpen ? 'none' : '';
    renderSide();
  }
  function renderSide() {
    if (!sideOpen) return;
    side.textContent = '';
    const all = sorted();
    const open = all.filter((a) => !a.resolved), must = open.filter((a) => a.priority === 'must').length;
    const list = all.filter((a) => (showResolved || !a.resolved) && (!filterType || a.type === filterType));
    const chk = (label, val, fn) => h('label', { style: 'display:flex;gap:4px;align-items:center;cursor:pointer' },
      h('input', { type: 'checkbox', checked: val, onchange: (e) => fn(e.target.checked) }), label);
    side.append(
      h('div', { class: 'sh' },
        h('div', { class: 'st' }, T.sideTitle,
          h('button', { class: 'btn x', text: T.langBtn, title: T.langTitle, onclick: () => setLang(LANG === 'zh' ? 'en' : 'zh') }),
          h('button', { class: 'btn', style: 'margin-left:6px', text: '×', onclick: () => toggleSide(false) })),
        h('div', { class: 'sub', text: T.stats(open.length, must, all.length - open.length) }),
        h('div', { class: 'sub sync' }, syncDot(), T.sync[sync]),
        h('div', { class: 'chips' },
          h('button', { class: 'chip' + (!filterType ? ' on' : ''), style: '--c:#6b7280', text: T.all, onclick: () => { filterType = null; renderSide(); } }),
          ORDER.filter((k) => all.some((a) => a.type === k)).map((k) => h('button', {
            class: 'chip' + (filterType === k ? ' on' : ''), style: '--c:' + TYPES[k].color,
            onclick: () => { filterType = filterType === k ? null : k; renderSide(); },
          }, h('span', { class: 'dot' }), TYPES[k].label + ' ' + all.filter((a) => a.type === k).length))),
        h('div', { class: 'flags' },
          chk(T.showResolved, showResolved, (v) => { showResolved = v; render(); }),
          chk(T.hideMarks, hidden, (v) => { hidden = v; render(); }))),
      h('div', { class: 'list' }, list.length ? list.map(card) : h('div', { class: 'empty' },
        T.empty[0], h('br'), T.empty[1], h('br'), T.empty[2])),
      h('div', { class: 'sf' },
        h('div', { style: 'display:flex;align-items:center;gap:6px;width:100%' },
          h('span', { class: 'lbl', text: T.detail }),
          h('div', { class: 'seg' }, ['brief', 'std', 'full'].map((k) => h('button', {
            class: detail === k ? 'on' : '', text: T.levels[k], title: T.levelTips[k],
            onclick: () => { detail = k; try { localStorage.setItem(PREF, k); } catch (e) {} renderSide(); },
          })))),
        h('button', { class: 'btn pri', text: T.copy, title: T.copyTitle, onclick: copyMd }),
        h('button', { class: 'btn', text: 'JSON', title: T.jsonTitle, onclick: downloadJson }),
        h('button', { class: 'btn', text: T.importBtn, onclick: importJson }),
        h('button', { class: 'btn dan', text: T.clear, onclick: () => {
          if (!state.annotations.length || !confirm(T.clearConfirm(state.annotations.length))) return;
          state.deleted.push(...state.annotations.map((a) => a.id)); state.annotations = []; render(); save();
        } })));
  }
  function card(a) {
    const t = TYPES[a.type] || TYPES.comment;
    return h('div', { class: 'card' + (a.resolved ? ' res' : ''), style: '--c:' + t.color, onclick: (e) => focusAnn(a) },
      h('div', { class: 'ct' },
        h('span', { class: 'n', text: a._n }), t.label,
        a.resolved ? h('span', { class: 'st-done', text: T.resolved })
          : busyIds.includes(a.id) ? h('span', { class: 'st-work', text: T.inProgress })
          : h('span', { class: 'st-pend', text: T.pending }),
        a.priority === 'must' ? null : h('span', { class: 'later', text: T.later }),
        a._orphan && !a.resolved ? h('span', { class: 'orph', text: T.orphanShort }) : null,  // 已處理的找不到原文是預期的
        a.heading ? h('span', { class: 'loc', text: '§ ' + a.heading }) : null),
      h('div', { class: 'cq', text: a.kind === 'text' ? T.lq + a.quote + T.rq : (a.kind === 'region' ? T.regionIn : '<') + a.tag + '> ' + (a.snippet || '') }),
      a.replacement ? h('div', { class: 'cn', text: '→ ' + a.replacement }) : null,
      a.note ? h('div', { class: 'cn', text: a.note }) : null,
      a.reply ? h('div', { class: 'cq', text: T.aiReply + a.reply }) : null);
  }
  function focusAnn(a) {
    let el = a.kind === 'text' ? document.querySelector('mark.p4h-hl[data-p4h="' + a.id + '"]') : pinLayer.querySelector('[data-p4h="' + a.id + '"]');
    if (!el) { openEditor(a, innerWidth / 2 - 190, 120); return; }
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const marks = a.kind === 'text' ? document.querySelectorAll('mark.p4h-hl[data-p4h="' + a.id + '"]') : [el];
    marks.forEach((m) => { m.classList.remove('p4h-flash', 'flash'); void m.offsetWidth; m.classList.add(a.kind === 'text' ? 'p4h-flash' : 'flash'); });
    setTimeout(() => {
      const r = el.getBoundingClientRect();
      openEditor(a, Math.min(r.left, innerWidth - 400 - (sideOpen ? 370 : 0)), r.bottom);
    }, 450);
  }

  // ---------- 匯出 / 匯入 ----------
  function fileName() { return decodeURIComponent(location.pathname.split('/').pop() || 'report.html'); }
  function toMarkdown(level) {
    level = level || detail;
    const all = sorted(), open = all.filter((a) => !a.resolved), done = all.filter((a) => a.resolved);
    const must = open.filter((a) => a.priority === 'must').length;
    const M = T.md, q = (s) => T.lq + s + T.rq, ws = (s) => (s || '').replace(/\s+/g, ' ');
    if (level === 'brief') {
      const L = [M.title + (document.title || fileName()) + M.count(open.length)];
      for (const a of open) {
        const t = TYPES[a.type] || TYPES.comment;
        const where = a.kind === 'text' ? q(ws(a.quote).slice(0, 60)) : '[' + (a.kind === 'region' ? M.region : M.point) + ' § ' + (a.heading || M.top) + ' <' + a.tag + '>]';
        L.push(a._n + '. ' + t.label + (a.priority === 'must' ? '' : M.laterTag) + ' ' + where +
          (a.replacement ? ' → ' + q(a.replacement) : '') + (a.note ? ' — ' + a.note.replace(/\n/g, ' ') : ''));
      }
      return L.join('\n');
    }
    const full = level === 'full';
    const L = [M.title + (document.title || fileName()), '',
      M.file + '`' + decodeURIComponent(location.pathname).replace(/^\/([A-Za-z]:)/, '$1') + '`',
      M.exported + new Date().toLocaleString(),
      M.summary(open.length, must, done.length), ''];
    const one = (a) => {
      const t = TYPES[a.type] || TYPES.comment;
      L.push('## ' + a._n + '. ' + t.label + (a.priority === 'must' ? '' : M.laterTag) + (a._orphan ? M.orphan : ''));
      L.push(M.loc + (a.heading ? '§ ' + a.heading : M.beforeFirst));
      const pct = (v) => Math.round(v * 100) + '%';
      if (a.kind === 'text') {
        L.push(M.quote + q(ws(a.quote)));
        if (full) L.push(M.context + '…' + ws(a.prefix) + '【' + ws(a.quote) + '】' + ws(a.suffix) + '…');
      } else if (a.kind === 'region') {
        L.push(M.regionLine(a.tag, a.snippet || '', pct(a.rx), pct(a.ry), pct(a.rw), pct(a.rh)));
      } else {
        L.push(M.pinLine(a.tag, a.snippet || ''));
      }
      if (full && a.path) L.push(M.selector + '`' + a.path + '`');
      if (a.replacement) L.push('- ' + (t.field || M.content) + T.colon + q(a.replacement));
      if (a.note) L.push(M.note + a.note.replace(/\n/g, '\n  '));
      if (a.reply) L.push(M.reply + a.reply);
      if (full) L.push(M.meta(a.id, new Date(a.created).toLocaleString(), a.updated && new Date(a.updated).toLocaleString()));
      L.push('');
    };
    open.forEach(one);
    if (done.length) { L.push('---', '', M.resolvedHead, ''); done.forEach(one); }
    return L.join('\n');
  }
  async function copyMd() {
    const md = toMarkdown();
    try { await navigator.clipboard.writeText(md); }
    catch (e) {
      const ta = h('textarea', { style: 'position:fixed;left:-9999px' }); ta.value = md;
      document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
    }
    toast(T.copied(state.annotations.filter((a) => !a.resolved).length));
  }
  function downloadJson() {
    const blob = new Blob([serialize({ file: decodeURIComponent(location.pathname), title: document.title, exportedAt: new Date().toISOString() })], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = h('a', { href: url, download: fileName().replace(/\.html?$/i, '') + '.annotations.json' });
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  function importJson() {
    const inp = h('input', { type: 'file', accept: '.json,application/json', style: 'display:none' });
    inp.onchange = async () => {
      try {
        const data = JSON.parse(await inp.files[0].text());
        let n = 0;
        for (const a of data.annotations || []) {
          const i = state.annotations.findIndex((x) => x.id === a.id);
          if (i >= 0) state.annotations[i] = a; else state.annotations.push(a);
          n++;
        }
        render(); save(); toast(T.imported(n));
      } catch (e) { toast(T.importFail + e.message); }
    };
    ui.appendChild(inp); inp.click(); inp.remove();
  }

  // ---------- Toast ----------
  function hideToast() { const t = ui.querySelector('.toast'); if (t) t.remove(); }
  function toast(msg, actLabel, act, ms) {
    hideToast(); clearTimeout(toastTimer);
    const t = h('div', { class: 'toast' }, h('span', { text: msg }),
      actLabel ? h('button', { text: actLabel, onclick: () => { hideToast(); act(); } }) : null);
    ui.appendChild(t);
    toastTimer = setTimeout(hideToast, ms || 4000);
  }

  // ---------- 全域事件 ----------
  document.addEventListener('contextmenu', (e) => {
    if (e.shiftKey || hidden) return;
    const path = e.composedPath();
    if (path.includes(host)) {
      const pin = path.find((n) => n.dataset && n.dataset.p4h);
      if (pin) { e.preventDefault(); openExistingMenu(e.clientX, e.clientY, byId(pin.dataset.p4h)); }
      return;
    }
    e.preventDefault();
    const mark = e.target.closest && e.target.closest('mark.p4h-hl');
    const sel = getSelection();
    const hasSel = sel && !sel.isCollapsed && sel.rangeCount;
    if (mark && !hasSel) { openExistingMenu(e.clientX, e.clientY, byId(mark.dataset.p4h)); return; }
    const anc = (hasSel && rangeToAnchor(sel.getRangeAt(0))) || pointAnchor(e.target, e.clientX, e.clientY);
    openCreateMenu(e.clientX, e.clientY, anc);
  }, true);

  document.addEventListener('click', (e) => {
    if (e.composedPath().includes(host)) return;
    const mark = e.target.closest && e.target.closest('mark.p4h-hl');
    if (mark && getSelection().isCollapsed && !e.target.closest('a')) {
      const a = byId(mark.dataset.p4h);
      if (a) openEditor(a, e.clientX, e.clientY);
    }
  }, true);

  document.addEventListener('mousedown', (e) => {
    const p = e.composedPath();
    if (menuEl && !p.includes(menuEl)) closeMenu();
    if (editorEl && !p.includes(editorEl) && e.button === 0 && !p.some((n) => n.dataset && n.dataset.p4h)) closeEditor();
  }, true);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (drawCancel) { drawCancel(); e.preventDefault(); return; }
      if (reanchorId) { reanchorId = null; hideToast(); }
      if (menuEl || editorEl) { closeMenu(); closeEditor(); e.preventDefault(); }
      return;
    }
    if (menuEl && menuEl._keys && menuEl._keys(e)) { e.preventDefault(); return; }
    if (editorEl && editorEl._keys && editorEl._keys(e)) { e.preventDefault(); return; }
    if (e.altKey && !e.ctrlKey && (e.key === 'r' || e.key === 'R')) { e.preventDefault(); toggleSide(); }
    if (e.altKey && !e.ctrlKey && (e.key === 'h' || e.key === 'H')) { e.preventDefault(); hidden = !hidden; render(); }
    if (e.altKey && !e.ctrlKey && (e.key === 'd' || e.key === 'D') && !hidden) { e.preventDefault(); startDraw(); }
  }, true);

  let raf = 0;
  const repos = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(positionPins); };
  addEventListener('resize', repos);
  addEventListener('scroll', repos, true);
  if (window.ResizeObserver) new ResizeObserver(repos).observe(document.body);

  // ---------- 啟動 ----------
  async function init() {
    document.head.appendChild(h('style', { id: 'pin4html-style' }, docCss()));
    document.documentElement.appendChild(host);
    if (SERVER) {
      try { state = await pull(); setSync('synced'); }
      catch (e) { setSync('offline'); }
    }
    render();
    addEventListener('load', () => {
      render();
      try {  // liveRefresh 整頁重載後還原捲動位置
        const y = sessionStorage.getItem(SCROLL_KEY);
        if (y !== null) { sessionStorage.removeItem(SCROLL_KEY); scrollTo(0, +y); }
      } catch (e) {}
    });
    if (!state.annotations.length) toast(T.welcome, null, null, 6000);
  }
  window.pin4html = { get state() { return state; }, get sync() { return sync; }, lang: LANG, setLang, toMarkdown, render, open: () => toggleSide(true) };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
