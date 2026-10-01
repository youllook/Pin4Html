#!/usr/bin/env python3
"""Pin4Html — right-click annotate any HTML report, hand the feedback to your AI.

Zero dependencies (Python 3.8+ standard library only).

  serve  <report.html>   Serve the report with the annotator injected on the fly.
                         Every change auto-saves to <report>.pins.json next to it,
                         so your AI agent can read it directly. The original file is never modified.
  inject <report.html>   Write <report>.review.html with the annotator inlined (offline, no server;
                         annotations live in browser localStorage). --cdn references jsDelivr instead.
  strip  <file.html>     Remove an injected annotator.
  show   <report.html>   Print the pins as a compact list (what the AI reads).
  reply  <report.html> --file replies.json
                         Write AI replies back: {"<n or id>": {"reply": "...", "resolved": true}}.
                         The open page picks them up within ~2 s.
"""
import argparse
import json
import os
import re
import socket
import sys
import threading
import time
import webbrowser
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, unquote, urlparse

HERE = Path(__file__).resolve().parent
JS = HERE / 'pin4html.js'
CDN = 'https://cdn.jsdelivr.net/gh/youllook/Pin4Html@1/pin4html.js'
START, END = '<!-- pin4html:start -->', '<!-- pin4html:end -->'
BLOCK_RE = re.compile(re.escape(START) + r'.*?' + re.escape(END) + r'\s*', re.S)
TYPES = {
    'comment': 'comment', 'rewrite': 'rewrite', 'delete': 'delete', 'add': 'add',
    'verify': 'verify', 'question': 'question', 'style': 'layout', 'keep': 'keep',
}


def lang_attr(lang):
    return f' data-lang="{lang}"' if lang else ''
LOCK = threading.Lock()


# ---------- helpers ----------
def read_text(p: Path) -> str:
    raw = p.read_bytes()
    for enc in ('utf-8-sig', 'utf-8', 'cp950', 'big5', 'gb18030'):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            pass
    return raw.decode('utf-8', errors='replace')


def insert_before_body_end(html: str, block: str) -> str:
    m = list(re.finditer(r'</body\s*>', html, re.I))
    return html[:m[-1].start()] + block + html[m[-1].start():] if m else html + '\n' + block


def sidecar(html_path: Path) -> Path:
    stem = re.sub(r'\.review$', '', html_path.stem)
    return html_path.with_name(stem + '.pins.json')


def load_pins(p: Path) -> dict:
    if not p.exists():
        return {'annotations': [], 'deleted': [], 'rev': 0}
    try:
        return json.loads(read_text(p))
    except json.JSONDecodeError:
        return {'annotations': [], 'deleted': [], 'rev': 0}


def write_json(p: Path, data: dict):
    tmp = p.with_name(p.name + '.tmp')
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
    for _ in range(20):  # Windows: target may be briefly locked by a reader
        try:
            os.replace(tmp, p)
            return
        except PermissionError:
            time.sleep(0.05)
    os.replace(tmp, p)


# ---------- serve ----------
class Handler(SimpleHTTPRequestHandler):
    root: Path = Path('.')
    default: str = ''
    lang: str = ''

    def log_message(self, *args):
        pass

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def _local(self, url_path: str):
        p = (self.root / unquote(url_path).lstrip('/')).resolve()
        return p if p == self.root or self.root in p.parents else None

    def _send(self, code: int, body: bytes, ctype: str, headers=None):
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _json(self, code: int, data, headers=None):
        self._send(code, json.dumps(data, ensure_ascii=False).encode('utf-8'), 'application/json; charset=utf-8', headers)

    def _pins_target(self):
        q = parse_qs(urlparse(self.path).query)
        html = self._local((q.get('file') or [''])[0])
        if not html or html.suffix.lower() not in ('.html', '.htm'):
            self._json(400, {'error': 'bad file'})
            return None
        return html

    def do_GET(self):
        u = urlparse(self.path)
        path = unquote(u.path)
        if path == '/':
            self.send_response(302)
            self.send_header('Location', '/' + quote(self.default))
            self.end_headers()
            return
        if path == '/__pin4html/pin4html.js':
            self._send(200, JS.read_bytes(), 'text/javascript; charset=utf-8')
            return
        if path == '/__pin4html/pins':
            html = self._pins_target()
            if html:
                mtime = str(html.stat().st_mtime_ns) if html.exists() else '0'
                self._json(200, load_pins(sidecar(html)), {'X-Pin4html-Html-Mtime': mtime})
            return
        local = self._local(path)
        if local and local.is_file() and local.suffix.lower() in ('.html', '.htm'):
            html = BLOCK_RE.sub('', read_text(local))
            tag = f'<script src="/__pin4html/pin4html.js" data-server="/__pin4html/"{lang_attr(self.lang)}></script>\n'
            self._send(200, insert_before_body_end(html, tag).encode('utf-8'), 'text/html; charset=utf-8')
            return
        super().do_GET()

    def do_POST(self):
        if urlparse(self.path).path != '/__pin4html/pins':
            self._json(404, {'error': 'not found'})
            return
        html = self._pins_target()
        if not html:
            return
        try:
            body = json.loads(self.rfile.read(int(self.headers.get('Content-Length') or 0)) or b'{}')
        except json.JSONDecodeError:
            self._json(400, {'error': 'bad json'})
            return
        p = sidecar(html)
        with LOCK:
            cur = load_pins(p)
            if body.get('baseRev', 0) != cur.get('rev', 0):
                self._json(409, cur)
                return
            data = body.get('data') or {}
            data['rev'] = cur.get('rev', 0) + 1
            data['file'] = str(html)
            data['title'] = data.get('title') or ''
            write_json(p, data)
        self._json(200, {'rev': data['rev']})


def free_port(preferred: int) -> int:
    for port in [preferred] + list(range(preferred + 1, preferred + 50)):
        with socket.socket() as s:
            try:
                s.bind(('127.0.0.1', port))
                return port
            except OSError:
                continue
    return 0


def cmd_serve(a):
    html = Path(a.html).resolve()
    if not html.exists():
        sys.exit(f'File not found: {html}')
    Handler.root = html.parent
    Handler.default = html.name
    Handler.lang = a.lang or ''
    port = free_port(a.port)
    srv = ThreadingHTTPServer(('127.0.0.1', port), partial(Handler, directory=str(html.parent)))
    url = f'http://127.0.0.1:{srv.server_port}/{quote(html.name)}'
    print(f'Pin4Html serving: {url}')
    print(f'Pins auto-save to: {sidecar(html)}')
    print('Ctrl+C to stop', flush=True)
    if not a.no_open:
        webbrowser.open(url)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


# ---------- inject / strip ----------
def cmd_inject(a):
    src = Path(a.html).resolve()
    html = BLOCK_RE.sub('', read_text(src))
    block = START + '\n'
    if a.data:
        payload = json.dumps(json.loads(read_text(Path(a.data))), ensure_ascii=False).replace('</', '<\\/')
        block += f'<script type="application/json" id="pin4html-data">{payload}</script>\n'
    if a.cdn:
        block += f'<script src="{CDN}"{lang_attr(a.lang)}></script>\n'
    else:
        block += f'<script{lang_attr(a.lang)}>\n' + JS.read_text(encoding='utf-8').replace('</script', '<\\/script') + '\n</script>\n'
    block += END + '\n'
    html = insert_before_body_end(html, block)
    out = src if a.inplace else Path(a.out).resolve() if a.out else src.with_name(
        re.sub(r'\.review$', '', src.stem) + '.review' + src.suffix)
    out.write_text(html, encoding='utf-8')
    print(f'Review copy written: {out}')


def cmd_strip(a):
    src = Path(a.html).resolve()
    out = Path(a.out).resolve() if a.out else src
    out.write_text(BLOCK_RE.sub('', read_text(src)), encoding='utf-8')
    print(f'Annotator removed: {out}')


# ---------- show / reply ----------
def resolve_pins(path: str) -> Path:
    p = Path(path).resolve()
    return p if p.name.endswith('.pins.json') else sidecar(p)


def cmd_show(a):
    p = resolve_pins(a.html)
    data = load_pins(p)
    items = sorted(data.get('annotations', []), key=lambda x: (x.get('n') or 1e9, x.get('created', 0)))
    if not a.all:
        items = [x for x in items if not x.get('resolved')]
    print(f'# {p.name}  rev={data.get("rev", 0)}  {len(items)} {"total" if a.all else "open"}')
    for x in items:
        t = TYPES.get(x.get('type'), x.get('type'))
        flag = ' [MUST-FIX]' if x.get('priority') == 'must' else ''
        done = ' [resolved]' if x.get('resolved') else ''
        print(f'\n## #{x.get("n", "?")} {t}{flag}{done}  id={x["id"]}  § {x.get("heading") or "(top)"}')
        if x.get('kind') == 'text':
            print(f'  quote: "{x.get("quote", "")}"')
            print(f'  context: …{x.get("prefix", "")}【{x.get("quote", "")}】{x.get("suffix", "")}…'.replace('\n', ' '))
        elif x.get('kind') == 'region':
            print(f'  area: <{x.get("tag")}> "{x.get("snippet", "")}" {x.get("path")}  '
                  f'x={x.get("rx", 0):.0%} y={x.get("ry", 0):.0%} w={x.get("rw", 0):.0%} h={x.get("rh", 0):.0%}')
        else:
            print(f'  pin: <{x.get("tag")}> "{x.get("snippet", "")}" {x.get("path")}')
        if x.get('replacement'):
            print(f'  replacement: "{x["replacement"]}"')
        if x.get('note'):
            print(f'  note: {x["note"]}')
        if x.get('reply'):
            print(f'  replied: {x["reply"]}')


def cmd_reply(a):
    p = resolve_pins(a.html)
    replies = json.loads(read_text(Path(a.file)))
    with LOCK:
        data = load_pins(p)
        anns = data.get('annotations', [])
        now = int(time.time() * 1000)
        hit = 0
        for key, val in replies.items():
            ann = next((x for x in anns if x['id'] == key or str(x.get('n')) == str(key).lstrip('#')), None)
            if not ann:
                print(f'Warning: pin not found: {key}')
                continue
            if isinstance(val, str):
                val = {'reply': val}
            for k in ('reply', 'resolved'):
                if k in val:
                    ann[k] = val[k]
            ann['updated'] = now
            hit += 1
        data['rev'] = data.get('rev', 0) + 1
        data['savedAt'] = now
        write_json(p, data)
    print(f'Wrote {hit} replies → {p} (rev {data["rev"]})')


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    ap = argparse.ArgumentParser(description='Pin4Html — annotate HTML reports for your AI')
    sub = ap.add_subparsers(dest='cmd', required=True)
    s = sub.add_parser('serve'); s.add_argument('html'); s.add_argument('--port', type=int, default=8770)
    s.add_argument('--no-open', action='store_true'); s.add_argument('--lang', choices=['zh', 'en'], help='force UI language')
    s.set_defaults(fn=cmd_serve)
    s = sub.add_parser('inject'); s.add_argument('html'); s.add_argument('--out'); s.add_argument('--inplace', action='store_true')
    s.add_argument('--cdn', action='store_true'); s.add_argument('--data'); s.add_argument('--lang', choices=['zh', 'en'])
    s.set_defaults(fn=cmd_inject)
    s = sub.add_parser('strip'); s.add_argument('html'); s.add_argument('--out'); s.set_defaults(fn=cmd_strip)
    s = sub.add_parser('show'); s.add_argument('html'); s.add_argument('--all', action='store_true'); s.set_defaults(fn=cmd_show)
    s = sub.add_parser('reply'); s.add_argument('html'); s.add_argument('--file', required=True); s.set_defaults(fn=cmd_reply)
    a = ap.parse_args()
    a.fn(a)


if __name__ == '__main__':
    main()
