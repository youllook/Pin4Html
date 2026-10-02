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
  watch  <report.html>   Block until there are "fix now" pins the AI hasn't handled yet and the reviewer
                         has paused for a few seconds, print them like `show`, then exit.
                         Run it in the background, fix + `reply`, run it again.
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
from contextlib import contextmanager
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
    'verify': 'verify', 'question': 'question', 'style': 'layout',
}


LOCK = threading.Lock()
LOCAL_HOSTS = ('127.0.0.1', 'localhost', '::1')


def lang_attr(lang):
    return f' data-lang="{lang}"' if lang else ''


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


def empty_pins() -> dict:
    return {'annotations': [], 'deleted': [], 'rev': 0}


def set_aside(p: Path) -> Path:
    """Move a corrupt pins file out of the way (never delete it), so the next save starts clean."""
    bak = p.with_name(p.name + time.strftime('.corrupt-%Y%m%d-%H%M%S'))
    os.replace(p, bak)
    print(f'Warning: {p.name} is not valid pins JSON — moved to {bak.name}. '
          'An open review page will re-save its annotations automatically.', file=sys.stderr, flush=True)
    return bak


def load_pins(p: Path) -> dict:
    for i in range(20):  # Windows: reads fail briefly while write_json swaps the file in
        if not p.exists():
            return empty_pins()
        try:
            data = json.loads(read_text(p))
            if isinstance(data, dict) and isinstance(data.get('annotations', []), list):
                return data
            raise ValueError('unexpected structure')
        except PermissionError:
            if i == 19:
                raise
            time.sleep(0.05)
        except ValueError:  # JSONDecodeError is a ValueError
            try:
                set_aside(p)
            except FileNotFoundError:  # another request already moved it
                pass
            return empty_pins()


@contextmanager
def pins_lock(p: Path, timeout=5.0, stale=30.0):
    """Cross-process lock on a .pins.json (the server and `reply` run as separate processes)."""
    lock = p.with_name(p.name + '.lock')
    deadline = time.time() + timeout
    with LOCK:
        while True:
            try:
                os.close(os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY))
                break
            except FileExistsError:
                try:
                    if time.time() - lock.stat().st_mtime > stale:  # left behind by a crashed process
                        lock.unlink()
                        continue
                except FileNotFoundError:
                    continue
                if time.time() > deadline:
                    raise TimeoutError(f'{lock} is held by another process')
                time.sleep(0.02)
        try:
            yield
        finally:
            try:
                lock.unlink()
            except FileNotFoundError:
                pass


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

    def _get(self):
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

    def _trusted(self, write=False) -> bool:
        # Host check blocks DNS rebinding; Origin / Sec-Fetch-Site block other sites POSTing to localhost
        # (a text/plain POST needs no CORS preflight). Requests without these headers (curl, scripts) pass.
        host = self.headers.get('Host', '')
        if urlparse('//' + host).hostname not in LOCAL_HOSTS:
            return False
        if write:
            origin = self.headers.get('Origin')
            if origin and urlparse(origin).netloc != host:
                return False
            if self.headers.get('Sec-Fetch-Site') not in (None, 'same-origin', 'none'):
                return False
        return True

    def do_HEAD(self):
        if not self._trusted():
            self._json(403, {'error': 'forbidden'})
            return
        super().do_HEAD()

    def do_GET(self):
        if not self._trusted():
            self._json(403, {'error': 'forbidden'})
            return
        self._get()

    def do_POST(self):
        if not self._trusted(write=True):
            self._json(403, {'error': 'forbidden'})
            return
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
        with pins_lock(p):
            cur = load_pins(p)
            if body.get('baseRev', 0) != cur.get('rev', 0):
                self._json(409, cur)
                return
            data = body.get('data') or {}
            data['rev'] = cur.get('rev', 0) + 1
            data['file'] = html.name  # relative: the sidecar always sits next to the report
            data['title'] = data.get('title') or ''
            if cur.get('working'):  # owned by watch / reply, never by the page
                data['working'] = cur['working']
            else:
                data.pop('working', None)
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
def html_for(pins: Path) -> Path:
    base = pins.name[:-len('.pins.json')]
    for ext in ('.html', '.htm'):
        if (pins.parent / (base + ext)).exists():
            return pins.parent / (base + ext)
    return pins.parent / (base + '.html')


def resolve_pins(path: str) -> Path:
    p = Path(path).resolve()
    return p if p.name.endswith('.pins.json') else sidecar(p)


def print_pin(x):
    t = TYPES.get(x.get('type'), x.get('type'))
    if x.get('type') == 'keep':  # removed in v1.3; old files may still have it
        t = 'comment'
    flag = '' if x.get('priority') == 'must' else ' [later]'
    done = ' [done]' if x.get('resolved') else ''
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


def by_position(data):
    return sorted(data.get('annotations', []), key=lambda x: (x.get('n') or 1e9, x.get('created', 0)))


def cmd_show(a):
    p = resolve_pins(a.html)
    data = load_pins(p)
    items = by_position(data)
    if not a.all:
        items = [x for x in items if not x.get('resolved')]
    print(f'# {p.name}  rev={data.get("rev", 0)}  {len(items)} {"total" if a.all else "pending"}')
    for x in items:
        print_pin(x)


def needs_ai(x) -> bool:
    """A pending "fix now" pin the reviewer touched after the AI's last reply (or never replied to)."""
    return (x.get('priority') == 'must' and not x.get('resolved')
            and (x.get('updated') or x.get('created') or 0) > (x.get('replyAt') or 0))


def cmd_watch(a):
    p = resolve_pins(a.html)
    print(f'Watching {p.name} for fix-now pins (quiet {a.quiet:g}s)…', file=sys.stderr, flush=True)
    start = time.time()
    seen, stable_since, checked = object(), time.time(), object()
    while True:
        try:
            sig = p.stat().st_mtime_ns
        except FileNotFoundError:
            sig = None
        if sig != seen:
            seen, stable_since = sig, time.time()
        # wait until the reviewer has paused, then look once per file version
        if sig is not None and sig != checked and time.time() - stable_since >= a.quiet:
            checked = sig
            with pins_lock(p):
                data = load_pins(p)
                todo = [x for x in by_position(data) if needs_ai(x)]
                if todo:  # the open page shows "AI is editing #n" until `reply` clears it
                    data['working'] = {'ids': [x['id'] for x in todo], 'since': int(time.time() * 1000)}
                    data['rev'] = data.get('rev', 0) + 1
                    write_json(p, data)
            if todo:
                print(f'# {p.name}  rev={data.get("rev", 0)}  {len(todo)} to fix now')
                print(f'# Report: {html_for(p)}')
                print('# Read the whole report first (at least once per session, again if it changed under you); when a fix')
                print('# touches a fact, figure or term, update every other place it appears. Then `reply` to each')
                print('# (resolved: true when fixed) and run `watch` again.')
                for x in todo:
                    print_pin(x)
                return
        if a.timeout and time.time() - start > a.timeout:
            print('No fix-now pins before timeout.', file=sys.stderr)
            sys.exit(2)
        time.sleep(0.5)


def cmd_reply(a):
    p = resolve_pins(a.html)
    replies = json.loads(read_text(Path(a.file)))
    with pins_lock(p):
        data = load_pins(p)
        anns = data.get('annotations', [])
        now = int(time.time() * 1000)
        hit, replied = 0, set()
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
            # replyAt / replyResolved let the page merge this reply field by field, so an edit the
            # user makes to the same annotation at the same time can't drop it (see merge() in pin4html.js)
            ann['replyAt'] = now
            if 'resolved' in val:
                ann['replyResolved'] = val['resolved']
            else:
                ann.pop('replyResolved', None)
            ann['updated'] = now
            replied.add(ann['id'])
            hit += 1
        w = data.get('working')
        if w:
            left = [i for i in w.get('ids', []) if i not in replied]
            if left:
                w['ids'] = left
            else:
                data.pop('working')
        data['rev'] = data.get('rev', 0) + 1
        data['savedAt'] = now
        write_json(p, data)
    print(f'Wrote {hit} replies → {p} (rev {data["rev"]})')


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')
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
    s = sub.add_parser('watch'); s.add_argument('html')
    s.add_argument('--quiet', type=float, default=3, help='seconds without changes before acting (default 3)')
    s.add_argument('--timeout', type=float, default=0, help='give up after N seconds (0 = wait forever)')
    s.set_defaults(fn=cmd_watch)
    s = sub.add_parser('reply'); s.add_argument('html'); s.add_argument('--file', required=True); s.set_defaults(fn=cmd_reply)
    a = ap.parse_args()
    a.fn(a)


if __name__ == '__main__':
    main()
