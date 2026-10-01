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
  const TYPES = {
    comment:  { label: '留言', icon: '💬', color: '#3b82f6', hint: '一般意見' },
    rewrite:  { label: '改寫', icon: '✏️', color: '#f59e0b', hint: '換個說法', field: '改為' },
    delete:   { label: '刪除', icon: '✂️', color: '#ef4444', hint: '整段拿掉', quick: true },
    add:      { label: '補充', icon: '➕', color: '#10b981', hint: '這裡要加內容', field: '補充內容' },
    verify:   { label: '查證', icon: '🔍', color: '#8b5cf6', hint: '數據／出處待確認' },
    question: { label: '疑問', icon: '❓', color: '#0ea5e9', hint: '看不懂／為什麼' },
    style:    { label: '版面', icon: '🎨', color: '#ec4899', hint: '排版／圖表／格式' },
    keep:     { label: '保留', icon: '👍', color: '#22c55e', hint: '這段好，別動', quick: true },
  };
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
      catch (e) { toast('⚠️ 無法寫入 localStorage，請記得匯出 JSON'); }
    }
    scheduleSync();
  }

  // ---------- 伺服器同步 ----------
  // 樂觀鎖：POST 帶 baseRev，檔案被別人（例如 AI 寫回覆）改過會回 409，逐則合併後重送
  let sync = SERVER ? 'connecting' : 'local', dirty = false, inflight = false, syncTimer = 0, htmlStamp = null;
  const SYNC_LABEL = {
    local: ['⚪', '僅存在此瀏覽器（用「複製給 Claude」或匯出 JSON 交回）'],
    connecting: ['🟡', '連線中…'], saving: ['🟡', '儲存中…'],
    synced: ['🟢', '已自動同步到檔案，AI 可直接讀取'],
    offline: ['🔴', '伺服器離線，改動暫存在頁面，恢復後自動補存'],
  };
  const pinsUrl = () => SERVER + 'pins?file=' + encodeURIComponent(FILE);
  function setSync(s) { sync = s; renderFab(); const el = ui.querySelector('.sync'); if (el) el.textContent = SYNC_LABEL[s].join(' '); }
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
  function merge(a, b) {
    const del = new Set([...a.deleted, ...b.deleted]), map = new Map();
    for (const x of [...a.annotations, ...b.annotations]) {
      if (del.has(x.id)) continue;
      const y = map.get(x.id);
      if (!y || (x.updated || x.created || 0) > (y.updated || y.created || 0)) map.set(x.id, x);
    }
    return Object.assign({}, a, { annotations: [...map.values()], deleted: [...del], rev: Math.max(a.rev, b.rev) });
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
      let msg = '';
      if (cur.rev > state.rev && !menuEl && !editorEl && !dirty && !inflight) {
        const hadReply = cur.annotations.some((a) => a.reply && a.reply !== (byId(a.id) || {}).reply);
        state = cur; render();
        msg = hadReply ? '🤖 收到 AI 回覆' : '🔄 標記已更新';
      }
      if (htmlChanged) {
        htmlChanged = false;
        toast((msg ? msg + '・' : '') + '📄 報告內容已修改', '重新載入看新版', () => location.reload(), 600000);
      } else if (msg) toast(msg + '，點標記查看');
    } catch (e) { setSync('offline'); }
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
      m.className = 'p4h-hl p4h-t-' + a.type + (a.resolved ? ' p4h-resolved' : '') + (a.priority === 'must' ? ' p4h-must' : '');
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
  .ui,.pins{--bg:#fff;--fg:#1f2328;--mut:#6b7280;--bd:#e5e7eb;--hov:#f3f4f6;--acc:#2563eb;color:var(--fg);font-size:13px;line-height:1.45}
  @media (prefers-color-scheme:dark){.ui,.pins{--bg:#1f2329;--fg:#e6e8eb;--mut:#9aa1ab;--bd:#3a414b;--hov:#2a3038;--acc:#60a5fa}}
  .pin{position:absolute;min-width:22px;height:22px;margin-top:-22px;padding:0 5px;border-radius:11px 11px 11px 2px;background:var(--c);color:#fff;
    font:600 11px/22px system-ui;text-align:center;cursor:grab;box-shadow:0 2px 6px rgba(0,0,0,.3);user-select:none;touch-action:none;white-space:nowrap}
  .pin.res{opacity:.45}.pin.must{outline:2px solid #dc2626;outline-offset:1px}.pin.drag{cursor:grabbing;opacity:.8}
  .pin.flash,.region.flash{animation:fl .5s 3}
  .region{position:absolute;border:2px dashed var(--c);background:color-mix(in srgb,var(--c) 8%,transparent);border-radius:6px;pointer-events:none}
  .region.res{opacity:.4}.region.must{border-style:solid}
  .region .rl{position:absolute;left:-2px;top:-22px;height:20px;padding:0 6px;border-radius:6px 6px 6px 0;background:var(--c);color:#fff;
    font:600 11px/20px system-ui;white-space:nowrap;cursor:pointer;pointer-events:auto;box-shadow:0 2px 6px rgba(0,0,0,.25)}
  .target{position:absolute;outline:2px dashed var(--acc);outline-offset:2px;border-radius:4px;background:color-mix(in srgb,var(--acc) 7%,transparent);pointer-events:none}
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
  .item .ic{width:18px;text-align:center}
  .sep{height:1px;background:var(--bd);margin:4px 2px}
  .row{display:flex;gap:4px;padding:2px 4px;flex-wrap:wrap}
  .ib{border:1px solid transparent;background:none;border-radius:6px;padding:3px 5px;cursor:pointer;font-size:15px}
  .ib:hover{background:var(--hov);border-color:var(--bd)}
  .ed{width:380px;max-width:calc(100vw - 16px);padding:12px;display:flex;flex-direction:column;gap:8px}
  .chips{display:flex;flex-wrap:wrap;gap:4px}
  .chip{border:1px solid var(--bd);border-radius:999px;padding:2px 8px;cursor:pointer;background:transparent;color:var(--fg);font-size:12px}
  .chip.on{border-color:var(--c);background:color-mix(in srgb,var(--c) 18%,transparent);font-weight:600}
  .lbl{font-size:12px;color:var(--mut)}
  textarea{width:100%;min-height:60px;resize:vertical;border:1px solid var(--bd);border-radius:6px;padding:6px 8px;background:var(--bg);color:var(--fg);font-size:13px;line-height:1.5}
  textarea:focus{outline:2px solid var(--acc);outline-offset:-1px}
  .quote{border-left:3px solid var(--c);padding:4px 8px;color:var(--mut);max-height:84px;overflow:auto;white-space:pre-wrap;background:var(--hov);border-radius:0 6px 6px 0;font-size:12px}
  .reply{border:1px dashed var(--acc);border-radius:6px;padding:6px 8px;font-size:12px;white-space:pre-wrap}
  .flags{display:flex;gap:14px;font-size:12px}.flags label{display:flex;gap:4px;align-items:center;cursor:pointer}
  .btns{display:flex;gap:6px;align-items:center}.btns .sp{flex:1}
  .btn{border:1px solid var(--bd);background:var(--bg);color:var(--fg);border-radius:6px;padding:5px 10px;cursor:pointer;font-size:12px}
  .btn:hover{background:var(--hov)}
  .btn.pri{background:var(--acc);border-color:var(--acc);color:#fff}
  .btn.dan{color:#dc2626}
  .fab{position:fixed;right:18px;bottom:18px;height:40px;padding:0 14px;border-radius:20px;border:1px solid var(--bd);background:var(--bg);color:var(--fg);
    box-shadow:0 6px 18px rgba(0,0,0,.2);cursor:pointer;font-size:14px;font-weight:600;z-index:1}
  .fab .m{color:#dc2626;margin-left:4px}
  .side{position:fixed;top:0;right:0;width:370px;max-width:100vw;height:100vh;display:flex;flex-direction:column;background:var(--bg);border-left:1px solid var(--bd);box-shadow:-8px 0 24px rgba(0,0,0,.15);z-index:2}
  .sh{padding:12px 14px;border-bottom:1px solid var(--bd);display:flex;flex-direction:column;gap:8px}
  .st{display:flex;align-items:center;font-weight:700;font-size:15px}.st .x{margin-left:auto}
  .sub{color:var(--mut);font-size:12px}
  .list{flex:1;overflow:auto;padding:10px}
  .card{border:1px solid var(--bd);border-left:4px solid var(--c);border-radius:8px;padding:8px 10px;margin-bottom:8px;cursor:pointer}
  .card:hover{background:var(--hov)}.card.res{opacity:.5}
  .ct{display:flex;gap:6px;align-items:center;font-size:12px;font-weight:600}
  .ct .n{background:var(--c);color:#fff;border-radius:8px;padding:0 6px;font-size:11px}
  .ct .must{color:#dc2626}.ct .orph{color:#d97706;font-weight:400}
  .ct .loc{margin-left:auto;color:var(--mut);font-weight:400;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .cq{color:var(--mut);font-size:12px;margin-top:4px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
  .cn{font-size:13px;margin-top:4px;white-space:pre-wrap}
  .empty{color:var(--mut);text-align:center;padding:30px 10px;line-height:1.8}
  .sf{padding:10px 14px;border-top:1px solid var(--bd);display:flex;flex-wrap:wrap;gap:6px}
  .toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:#111827;color:#fff;padding:8px 14px;border-radius:8px;font-size:13px;
    box-shadow:0 8px 20px rgba(0,0,0,.3);display:flex;gap:10px;align-items:center;z-index:4}
  .toast button{background:none;border:0;color:#93c5fd;cursor:pointer;font-size:13px;font-weight:600}
  @media print{.ui,.pins{display:none}}
  `;
  function docCss() {
    let css = `mark.p4h-hl{background:transparent;color:inherit;padding:0;border-radius:2px;cursor:pointer;-webkit-box-decoration-break:clone;box-decoration-break:clone}
    mark.p4h-hl[data-n]::after{content:attr(data-n);display:inline-block;min-width:16px;height:16px;padding:0 4px;margin-left:2px;border-radius:8px;
      background:var(--p4h-c);color:#fff;font:600 10px/16px system-ui,sans-serif;text-align:center;vertical-align:super;text-indent:0;letter-spacing:0;text-decoration:none}
    mark.p4h-hl.p4h-must[data-n]::after{box-shadow:0 0 0 2px #dc2626}
    mark.p4h-hl.p4h-resolved{background:transparent!important;border-bottom-style:dashed!important;text-decoration:none!important}
    mark.p4h-hl.p4h-resolved[data-n]::after{opacity:.45}
    mark.p4h-hl.p4h-flash{animation:p4h-fl .5s 3}
    @keyframes p4h-fl{50%{background:var(--p4h-c);color:#fff}}
    @media print{mark.p4h-hl{background:none!important;border:0!important;text-decoration:none!important}mark.p4h-hl::after{display:none!important}}`;
    for (const k of ORDER) {
      const c = TYPES[k].color;
      css += `\nmark.p4h-hl.p4h-t-${k}{--p4h-c:${c};background:${c}2e;border-bottom:2px solid ${c}}`;
    }
    css += `\nmark.p4h-hl.p4h-t-delete{text-decoration:line-through;text-decoration-color:#ef4444;text-decoration-thickness:2px}`;
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
  const fab = h('button', { class: 'fab', title: '審閱標記（Alt+R）', onclick: () => toggleSide() });
  const side = h('div', { class: 'side', style: 'display:none' });
  ui.append(fab, side);

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
        const r = locate(a, idx.text);
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
      else marks[marks.length - 1].dataset.n = a._n;
    }
    pinLayer.textContent = '';
    for (const a of state.annotations) {
      if (a.kind === 'text' || a._orphan || !visible(a)) continue;
      const t = TYPES[a.type] || TYPES.comment;
      if (a.kind === 'region') {
        const lab = h('div', { class: 'rl', text: t.icon + ' ' + a._n, title: t.label + (a.note ? '：' + a.note : '') });
        lab.dataset.p4h = a.id;
        lab.addEventListener('click', (e) => openEditor(a, e.clientX, e.clientY));
        const box = h('div', { class: 'region' + (a.resolved ? ' res' : '') + (a.priority === 'must' ? ' must' : ''), style: '--c:' + t.color }, lab);
        box.dataset.p4h = a.id;
        pinLayer.appendChild(box);
        continue;
      }
      const p = h('div', {
        class: 'pin' + (a.resolved ? ' res' : '') + (a.priority === 'must' ? ' must' : ''),
        style: '--c:' + t.color, title: (t.label + (a.note ? '：' + a.note : '')) + '\n（可拖曳移動）',
        text: t.icon + ' ' + a._n,
      });
      p.dataset.p4h = a.id;
      bindPinDrag(p, a);
      pinLayer.appendChild(p);
    }
    positionPins();
    renderSide();
    renderFab();
  }
  function positionPins() {
    for (const p of pinLayer.children) {
      const a = byId(p.dataset.p4h), el = a && pinTarget(a);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      p.style.display = r.width || r.height ? '' : 'none';
      p.style.left = r.left + scrollX + a.rx * r.width + 'px';
      p.style.top = r.top + scrollY + a.ry * r.height + 'px';
      if (a.kind === 'region') {
        p.style.width = a.rw * r.width + 'px';
        p.style.height = a.rh * r.height + 'px';
      }
    }
  }
  function renderFab() {
    const open = state.annotations.filter((a) => !a.resolved);
    const must = open.filter((a) => a.priority === 'must').length;
    fab.textContent = '📝 ' + open.length;
    fab.title = '審閱標記（Alt+R）\n' + SYNC_LABEL[sync].join(' ');
    if (sync !== 'local') fab.prepend(h('span', { style: 'margin-right:6px;font-size:10px;vertical-align:middle', text: SYNC_LABEL[sync][0] }));
    if (must) fab.appendChild(h('span', { class: 'm', text: '●' + must }));
    if (hidden) fab.appendChild(h('span', { style: 'margin-left:6px;opacity:.6', text: '（已隱藏）' }));
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
    const ov = h('div', { class: 'drawov' }, box, h('div', { class: 'tip', text: '🔲 拖曳框出要標記的區域（Esc 取消）' }));
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
      if (Math.abs(e.clientX - sx) < 8 || Math.abs(e.clientY - sy) < 8) { toast('區域太小，已取消'); return; }
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
      ? '標記選取：「' + anchor.quote.slice(0, 24) + (anchor.quote.length > 24 ? '…' : '') + '」'
      : anchor.kind === 'region' ? '標記框選區域（' + anchor.tag + ' 內）'
      : '在此處釘一個標記（虛線框＝會附著的元素 ' + anchor.tag + '）';
    menuEl = h('div', { class: 'pop menu' }, h('div', { class: 'hd', text: head }),
      ORDER.map((k, i) => {
        const t = TYPES[k];
        return h('div', { class: 'item', onclick: () => create(k, anchor, x, y) },
          h('span', { class: 'ic', text: t.icon }), h('span', { text: t.label }),
          h('span', { class: 'k', text: t.hint + ' · ' + (i + 1) }));
      }),
      h('div', { class: 'sep' }),
      anchor.kind === 'region' ? null : h('div', { class: 'item', onclick: startDraw },
        h('span', { class: 'ic', text: '🔲' }), h('span', { text: '改成框選區域…' }), h('span', { class: 'k', text: 'Alt+D' })),
      h('div', { class: 'item', onclick: () => { closeMenu(); toggleSide(true); } },
        h('span', { class: 'ic', text: '📋' }), h('span', { text: '開啟標記清單' }), h('span', { class: 'k', text: 'Alt+R' })));
    menuEl._keys = (e) => { const i = +e.key - 1; if (i >= 0 && i < ORDER.length) { create(ORDER[i], anchor, x, y); return true; } };
    place(menuEl, x, y);
    showTarget(anchor);
  }
  function openExistingMenu(x, y, a) {
    closeMenu(); closeEditor();
    const t = TYPES[a.type] || TYPES.comment;
    const item = (ic, label, fn, cls) => h('div', { class: 'item' + (cls ? ' ' + cls : ''), onclick: () => { closeMenu(); fn(); } },
      h('span', { class: 'ic', text: ic }), h('span', { text: label }));
    menuEl = h('div', { class: 'pop menu' },
      h('div', { class: 'hd', text: '#' + a._n + ' ' + t.icon + ' ' + t.label + (a.note ? '：' + a.note : '') }),
      item('📝', '編輯…', () => openEditor(a, x, y)),
      h('div', { class: 'row' }, ORDER.map((k) => h('button', {
        class: 'ib', title: '改成「' + TYPES[k].label + '」', text: TYPES[k].icon,
        onclick: () => { closeMenu(); a.type = k; touch(a); },
      }))),
      h('div', { class: 'sep' }),
      item(a.priority === 'must' ? '⚪' : '🔴', a.priority === 'must' ? '取消必改' : '標為必改', () => { a.priority = a.priority === 'must' ? 'should' : 'must'; touch(a); }),
      item(a.resolved ? '↩️' : '✅', a.resolved ? '重新開啟' : '標為已解決', () => { a.resolved = !a.resolved; touch(a); }),
      item('🎯', '重新框選範圍', () => startReanchor(a)),
      h('div', { class: 'sep' }),
      item('🗑️', '刪除標記', () => remove(a), 'dan'));
    place(menuEl, x, y);
  }
  function touch(a) { a.updated = Date.now(); render(); save(); }

  function create(type, anchor, x, y) {
    closeMenu();
    const a = Object.assign({ id: uid(), type, note: '', replacement: '', priority: 'should', resolved: false, created: Date.now() }, anchor);
    window.getSelection().removeAllRanges();
    if (TYPES[type].quick) {
      state.annotations.push(a); render(); save();
      toast(TYPES[type].icon + ' 已新增「' + TYPES[type].label + '」#' + a._n + '（點標記可補說明）', '補說明', () => openEditor(a, x, y));
    } else openEditor(a, x, y, true);
  }
  function remove(a) {
    const i = state.annotations.indexOf(a);
    if (i < 0) return;
    state.annotations.splice(i, 1); state.deleted.push(a.id); render(); save(); closeEditor();
    toast('🗑️ 已刪除標記 #' + a._n, '復原', () => {
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
      const note = h('textarea', { placeholder: t.hint + '…（Ctrl+Enter 儲存，Esc 取消）' });
      note.value = draft.note; note.oninput = () => (draft.note = note.value);
      let rep = null;
      if (t.field) {
        rep = h('textarea', { placeholder: t.field + '…' });
        rep.value = draft.replacement; rep.oninput = () => (draft.replacement = rep.value);
      }
      ed.append(...[
        h('div', { class: 'chips' }, ORDER.map((k) => h('button', {
          class: 'chip' + (k === draft.type ? ' on' : ''), style: '--c:' + TYPES[k].color, text: TYPES[k].icon + ' ' + TYPES[k].label,
          onclick: () => { draft.type = k; draw(); },
        }))),
        a.kind === 'text'
          ? h('div', { class: 'quote', text: a.quote })
          : h('div', { class: 'quote', text: (a.kind === 'region' ? '🔲 ' : '📍 ') + (a.heading ? '§ ' + a.heading + ' — ' : '') + '<' + a.tag + '> ' + (a.snippet || '') }),
        a._orphan ? h('div', { class: 'lbl', style: 'color:#d97706', text: '⚠️ 頁面上找不到原文（內容可能已被修改），可用「重新框選」重新定位' }) : null,
        rep ? h('div', { class: 'lbl', text: t.field }) : null, rep,
        h('div', { class: 'lbl', text: '說明' }), note,
        a.reply ? h('div', { class: 'reply', text: '🤖 Claude 回覆：' + a.reply }) : null,
        h('div', { class: 'flags' },
          h('label', null, h('input', { type: 'checkbox', checked: draft.priority === 'must', onchange: (e) => (draft.priority = e.target.checked ? 'must' : 'should') }), '🔴 必改'),
          h('label', null, h('input', { type: 'checkbox', checked: draft.resolved, onchange: (e) => (draft.resolved = e.target.checked) }), '✅ 已解決')),
        h('div', { class: 'btns' },
          isNew ? null : h('button', { class: 'btn dan', text: '刪除', onclick: () => remove(a) }),
          isNew ? null : h('button', { class: 'btn', text: '🎯 重新框選', title: '選取新的文字範圍來重新定位', onclick: () => startReanchor(a) }),
          h('span', { class: 'sp' }),
          h('button', { class: 'btn', text: '取消', onclick: closeEditor }),
          h('button', { class: 'btn pri', text: '儲存', onclick: commit }))].filter(Boolean));
      (rep && !draft.replacement && draft.type === 'rewrite' ? rep : note).focus();
    };
    const commit = () => {
      Object.assign(a, draft, { updated: Date.now() });
      if (isNew) state.annotations.push(a);
      closeEditor(); render(); save();
      if (isNew) toast((TYPES[a.type].icon) + ' 已新增 #' + a._n);
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
    toast('🎯 請選取新的文字範圍來定位 #' + a._n + '（Esc 取消）', '取消', () => { reanchorId = null; }, 60000);
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
        h('div', { class: 'st' }, '📝 審閱標記', h('button', { class: 'btn x', text: '✕', onclick: () => toggleSide(false) })),
        h('div', { class: 'sub', text: '未解決 ' + open.length + ' 則（必改 ' + must + '）・已解決 ' + (all.length - open.length) + ' 則' }),
        h('div', { class: 'sub sync', text: SYNC_LABEL[sync].join(' ') }),
        h('div', { class: 'chips' },
          h('button', { class: 'chip' + (!filterType ? ' on' : ''), style: '--c:#6b7280', text: '全部', onclick: () => { filterType = null; renderSide(); } }),
          ORDER.filter((k) => all.some((a) => a.type === k)).map((k) => h('button', {
            class: 'chip' + (filterType === k ? ' on' : ''), style: '--c:' + TYPES[k].color,
            text: TYPES[k].icon + ' ' + all.filter((a) => a.type === k).length,
            onclick: () => { filterType = filterType === k ? null : k; renderSide(); },
          }))),
        h('div', { class: 'flags' },
          chk('顯示已解決', showResolved, (v) => { showResolved = v; render(); }),
          chk('隱藏頁面標記', hidden, (v) => { hidden = v; render(); }))),
      h('div', { class: 'list' }, list.length ? list.map(card) : h('div', { class: 'empty' },
        '還沒有標記', h('br'), '選取文字後按右鍵，或直接在任意位置按右鍵', h('br'), 'Shift+右鍵 = 原生選單')),
      h('div', { class: 'sf' },
        h('div', { style: 'display:flex;align-items:center;gap:6px;width:100%' },
          h('span', { class: 'lbl', text: '輸出詳細度' }),
          h('div', { class: 'seg' }, [['brief', '精簡'], ['std', '標準'], ['full', '詳細']].map(([k, l]) => h('button', {
            class: detail === k ? 'on' : '', text: l,
            title: { brief: '一則一行，省 token', std: '原文＋位置＋說明', full: '再加上下文、選擇器、時間（定位最穩）' }[k],
            onclick: () => { detail = k; try { localStorage.setItem(PREF, k); } catch (e) {} renderSide(); },
          })))),
        h('button', { class: 'btn pri', text: '📋 複製給 Claude', title: '複製 Markdown 審閱意見，貼到對話即可', onclick: copyMd }),
        h('button', { class: 'btn', text: '⬇️ JSON', title: '下載 JSON（Claude 可直接讀檔）', onclick: downloadJson }),
        h('button', { class: 'btn', text: '⬆️ 匯入', onclick: importJson }),
        h('button', { class: 'btn dan', text: '清空', onclick: () => {
          if (!state.annotations.length || !confirm('確定清空全部 ' + state.annotations.length + ' 則標記？（建議先匯出 JSON）')) return;
          state.deleted.push(...state.annotations.map((a) => a.id)); state.annotations = []; render(); save();
        } })));
  }
  function card(a) {
    const t = TYPES[a.type] || TYPES.comment;
    return h('div', { class: 'card' + (a.resolved ? ' res' : ''), style: '--c:' + t.color, onclick: (e) => focusAnn(a) },
      h('div', { class: 'ct' },
        h('span', { class: 'n', text: '#' + a._n }), t.icon + ' ' + t.label,
        a.priority === 'must' ? h('span', { class: 'must', text: '必改' }) : null,
        a.resolved ? h('span', { text: '✅' }) : null,
        a._orphan ? h('span', { class: 'orph', text: '⚠️ 找不到原文' }) : null,
        a.heading ? h('span', { class: 'loc', text: '§ ' + a.heading }) : null),
      h('div', { class: 'cq', text: a.kind === 'text' ? '「' + a.quote + '」' : (a.kind === 'region' ? '🔲 區域 in <' : '📍 <') + a.tag + '> ' + (a.snippet || '') }),
      a.replacement ? h('div', { class: 'cn', text: '→ ' + a.replacement }) : null,
      a.note ? h('div', { class: 'cn', text: a.note }) : null,
      a.reply ? h('div', { class: 'cq', text: '🤖 ' + a.reply }) : null);
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
    if (level === 'brief') {
      const L = ['# 審閱意見：' + (document.title || fileName()) + '（' + open.length + ' 則）'];
      for (const a of open) {
        const t = TYPES[a.type] || TYPES.comment;
        const where = a.kind === 'text' ? '「' + a.quote.replace(/\s+/g, ' ').slice(0, 60) + '」' : '[' + (a.kind === 'region' ? '區域' : '位置') + ' § ' + (a.heading || '開頭') + ' <' + a.tag + '>]';
        L.push(a._n + '. ' + t.icon + t.label + (a.priority === 'must' ? '❗' : '') + ' ' + where +
          (a.replacement ? ' → 「' + a.replacement + '」' : '') + (a.note ? ' — ' + a.note.replace(/\n/g, ' ') : ''));
      }
      return L.join('\n');
    }
    const full = level === 'full';
    const L = ['# 審閱意見：' + (document.title || fileName()), '',
      '- 檔案：`' + decodeURIComponent(location.pathname).replace(/^\/([A-Za-z]:)/, '$1') + '`',
      '- 匯出：' + new Date().toLocaleString(),
      '- 未解決 ' + open.length + ' 則（必改 ' + must + '）；已解決 ' + done.length + ' 則', ''];
    const one = (a) => {
      const t = TYPES[a.type] || TYPES.comment;
      L.push('## ' + a._n + '. ' + t.icon + ' ' + t.label + (a.priority === 'must' ? '【必改】' : '') + (a._orphan ? '（⚠️ 頁面上已找不到原文）' : ''));
      L.push('- 位置：' + (a.heading ? '§ ' + a.heading : '（第一個標題之前）'));
      const pct = (v) => Math.round(v * 100) + '%';
      if (a.kind === 'text') {
        L.push('- 原文：「' + a.quote.replace(/\s+/g, ' ') + '」');
        if (full) L.push('- 上下文：…' + (a.prefix || '').replace(/\s+/g, ' ') + '【' + a.quote.replace(/\s+/g, ' ') + '】' + (a.suffix || '').replace(/\s+/g, ' ') + '…');
      } else if (a.kind === 'region') {
        L.push('- 框選區域：`<' + a.tag + '>`「' + (a.snippet || '') + '」內，左 ' + pct(a.rx) + '、上 ' + pct(a.ry) + '、寬 ' + pct(a.rw) + '、高 ' + pct(a.rh));
      } else {
        L.push('- 標記點：`<' + a.tag + '>`「' + (a.snippet || '') + '」');
      }
      if (full && a.path) L.push('- 選擇器：`' + a.path + '`');
      if (a.replacement) L.push('- ' + (t.field || '內容') + '：「' + a.replacement + '」');
      if (a.note) L.push('- 說明：' + a.note.replace(/\n/g, '\n  '));
      if (a.reply) L.push('- Claude 回覆：' + a.reply);
      if (full) L.push('- id：`' + a.id + '`・建立 ' + new Date(a.created).toLocaleString() + (a.updated ? '・更新 ' + new Date(a.updated).toLocaleString() : ''));
      L.push('');
    };
    open.forEach(one);
    if (done.length) { L.push('---', '', '### 已解決（僅供參考）', ''); done.forEach(one); }
    return L.join('\n');
  }
  async function copyMd() {
    const md = toMarkdown();
    try { await navigator.clipboard.writeText(md); }
    catch (e) {
      const ta = h('textarea', { style: 'position:fixed;left:-9999px' }); ta.value = md;
      document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
    }
    toast('📋 已複製 ' + state.annotations.filter((a) => !a.resolved).length + ' 則意見，貼到 Claude 對話即可');
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
        render(); save(); toast('⬆️ 已匯入 ' + n + ' 則');
      } catch (e) { toast('⚠️ 匯入失敗：' + e.message); }
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
    addEventListener('load', render);
    if (!state.annotations.length) toast('📝 審閱模式：選取文字或直接按右鍵新增標記（Alt+R 開清單）', null, null, 6000);
  }
  window.pin4html = { get state() { return state; }, get sync() { return sync; }, toMarkdown, render, open: () => toggleSide(true) };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
