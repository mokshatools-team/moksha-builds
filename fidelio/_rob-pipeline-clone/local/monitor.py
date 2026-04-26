import json, logging, queue, threading
from datetime import datetime
from flask import Flask, Response

PORT = 5401
EVENTS: queue.Queue[dict] = queue.Queue()
STAGES = {"pass1": "Pass 1", "pass2": "Pass 2", "sheets": "Sheets", "metadata": "Metadata", "thumbnail": "Thumbnail", "brand": "Brand", "transcribe": "Transcribe", "watcher": "Watcher", "resolve": "Resolve"}


def emit_progress(stem: str, stage: str, status: str = "running", stage_num: int = 0, total: int = 0):
    """Emit a per-file progress event to the monitor UI.

    Args:
        stem:      file stem (e.g. "DRE_YT_SNIPPET") — used as card key
        stage:     human-readable current stage (e.g. "Transcribing")
        status:    "running" | "done" | "error"
        stage_num: current stage index (for progress bar)
        total:     total stage count (for progress bar)
    """
    EVENTS.put({"type": "progress", "stem": stem, "stage": stage, "status": status, "stage_num": stage_num, "total": total})


MONITOR_HTML = """<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Fidelio Pipeline Monitor</title>
  <style>
    :root{--bg:#09111d;--panel:#101926;--panel2:#0d1526;--line:#1d2a3f;--text:#f8fafc;--muted:#8ea0b8;--warn:#f59e0b;--err:#ef4444;--ok:#22c55e}
    *{box-sizing:border-box}
    body{margin:0;background:linear-gradient(180deg,#08111d 0%,#0a1322 100%);color:var(--text);font:13px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;display:flex;flex-direction:column;height:100vh}
    .top,.foot{display:flex;justify-content:space-between;align-items:center;padding:12px 16px;background:#0b1321;flex-shrink:0}
    .top{border-bottom:1px solid var(--line)}
    .foot{border-top:1px solid var(--line);color:var(--muted)}
    .title{font-weight:700;letter-spacing:.02em}
    .badge,.stage{display:inline-flex;align-items:center;border-radius:999px;padding:4px 8px}
    .badge{background:#162236;color:#d1d8e5}
    .live{display:flex;gap:8px;align-items:center}
    .dot{width:9px;height:9px;border-radius:50%;background:var(--ok);animation:pulse 1.2s infinite}
    .prog-wrap{flex-shrink:0;border-bottom:1px solid var(--line);background:rgba(9,17,29,.75)}
    .prog-head{display:flex;justify-content:space-between;align-items:center;padding:8px 14px 4px;color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.06em}
    .prog{display:flex;flex-wrap:wrap;gap:10px;padding:8px 14px 14px;min-height:74px;align-content:flex-start}
    .p-card{background:var(--panel);border-radius:12px;padding:12px 14px 12px;min-width:260px;flex:1;border:1px solid var(--line);animation:fin .2s ease;position:relative;box-shadow:0 8px 24px rgba(0,0,0,.18)}
    .p-dismiss{position:absolute;top:7px;right:9px;cursor:pointer;color:var(--muted);font-size:16px;line-height:1;border:0;background:transparent;padding:0;opacity:.65}
    .p-dismiss:hover{opacity:1}
    .p-name{font-size:11px;color:var(--muted);margin-bottom:8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding-right:16px}
    .p-bar{height:4px;background:#1d2837;border-radius:999px;overflow:hidden}
    .p-fill{height:100%;background:#3b82f6;border-radius:999px;transition:width .35s ease;width:0}
    .p-stages{display:flex;flex-direction:column;gap:3px;margin-top:8px}
    .p-srow{display:flex;align-items:center;gap:8px;font-size:11px;color:var(--muted)}
    .p-srow.done{color:var(--ok)}
    .p-srow.running{color:var(--text)}
    .p-srow.err{color:var(--err)}
    .p-sicon{width:10px;text-align:center;flex-shrink:0;font-size:10px}
    .p-done{border-color:#166534}
    .p-done .p-fill{background:var(--ok)}
    .p-err{border-color:#7f1d1d}
    .p-err .p-fill{background:var(--err)}
    .empty-note{color:var(--muted);font-size:11px;padding:6px 2px;font-style:italic}
    .logs-section{flex:1;overflow:hidden;display:flex;flex-direction:column;min-height:0}
    .logs-toggle{display:flex;justify-content:space-between;align-items:center;padding:7px 16px;border-bottom:1px solid var(--line);cursor:pointer;user-select:none;flex-shrink:0;background:#0d1526}
    .logs-toggle:hover{background:#111f38}
    .logs-label{color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.06em}
    .logs-chevron{color:var(--muted);font-size:12px;transition:transform .2s}
    .logs-collapsed .logs-chevron{transform:rotate(-90deg)}
    .logs-collapsed .filter-bar,.logs-collapsed .feed{display:none}
    .filter-bar{display:flex;gap:6px;padding:6px 12px;border-bottom:1px solid var(--line);flex-shrink:0;background:#0c1422}
    .filter-btn{background:#162236;border:1px solid var(--line);color:var(--muted);border-radius:7px;padding:3px 10px;font:12px ui-monospace,monospace;cursor:pointer}
    .filter-btn.on{background:#1d4ed8;border-color:#3b82f6;color:#fff}
    .feed{flex:1;overflow-y:auto;padding:8px 12px;background:#0a1220}
    .row{display:flex;gap:10px;align-items:flex-start;margin:0 0 6px;padding:8px 10px;border-left:3px solid transparent;border-radius:8px;background:var(--panel);animation:fin .15s ease}
    .row.warn{border-left-color:var(--warn)}
    .row.error{border-left-color:var(--err);background:#1b0d11}
    .row.hidden{display:none}
    .ts{color:var(--muted);min-width:68px;flex-shrink:0}
    .msg{white-space:pre-wrap;color:var(--text);word-break:break-word}
    .lvl{width:14px;text-align:center;flex-shrink:0}
    .s-pass1{background:#3B82F6}.s-pass2{background:#10B981}.s-sheets{background:#8B5CF6}.s-metadata{background:#F59E0B}.s-thumbnail{background:#EC4899}.s-transcribe{background:#06B6D4}.s-brand{background:#84CC16}.s-watcher{background:#6B7280}.s-resolve{background:#F97316}.s-system{background:#374151}
    @keyframes pulse{50%{opacity:.45}}
    @keyframes fin{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:none}}
  </style>
</head>
<body>
  <div class="top">
    <div class="title">Fidelio Pipeline Monitor</div>
    <div style="display:flex;gap:10px;align-items:center">
      <span class="badge">port 5401</span>
      <span class="live"><span class="dot"></span>LIVE</span>
    </div>
  </div>
  <div class="prog-wrap">
    <div class="prog-head">
      <span>Pipeline Cards</span>
      <button class="filter-btn" id="clearBtn" onclick="clearDone()">Clear Done</button>
    </div>
    <div id="prog" class="prog"><span class="empty-note">Waiting for files...</span></div>
  </div>
  <div id="logsSection" class="logs-section logs-collapsed">
    <div class="logs-toggle" onclick="toggleLogs()">
      <span class="logs-label">System Logs</span>
      <span class="logs-chevron">▾</span>
    </div>
    <div class="filter-bar">
      <button class="filter-btn on" id="btnAll" onclick="setFilter('all')">All</button>
      <button class="filter-btn" id="btnWarn" onclick="setFilter('warn')">Warnings</button>
      <button class="filter-btn" id="btnErr" onclick="setFilter('err')">Errors Only</button>
    </div>
    <div id="feed" class="feed"></div>
  </div>
  <div class="foot">Auto-refreshes · fidelio-pipeline · port 5401</div>
  <script>
    const feed = document.getElementById('feed');
    const prog = document.getElementById('prog');
    const logsSection = document.getElementById('logsSection');
    let auto = true, filter = 'all';
    const cards = {};
    const esc = s => String(s ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
    const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const icon = l => l === 'ERROR' ? '✗' : l === 'WARNING' ? '⚠' : '';

    feed.addEventListener('scroll', () => {
      auto = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 50;
    });

    function toggleLogs() {
      logsSection.classList.toggle('logs-collapsed');
    }

    function setFilter(f) {
      filter = f;
      ['all', 'warn', 'err'].forEach(k => {
        document.getElementById('btn' + k.charAt(0).toUpperCase() + k.slice(1)).classList.toggle('on', k === f);
      });
      document.querySelectorAll('.row').forEach(r => {
        const isErr = r.classList.contains('error');
        const isWarn = r.classList.contains('warn');
        r.classList.toggle('hidden', (f === 'err' && !isErr) || (f === 'warn' && !isErr && !isWarn));
      });
    }

    function clearDone() {
      document.querySelectorAll('.p-done,.p-err').forEach(c => {
        const stem = c.dataset.stem;
        c.remove();
        delete cards[stem];
      });
      if (!prog.querySelector('.p-card')) prog.innerHTML = '<span class="empty-note">Waiting for files...</span>';
    }

    function dismissCard(stem) {
      const c = cards[stem];
      if (c) {
        c.remove();
        delete cards[stem];
      }
      if (!prog.querySelector('.p-card')) prog.innerHTML = '<span class="empty-note">Waiting for files...</span>';
    }

    function ensureCard(stem) {
      const empty = prog.querySelector('.empty-note');
      if (empty) empty.remove();
      if (cards[stem]) return cards[stem];
      const c = document.createElement('div');
      c.className = 'p-card';
      c.dataset.stem = stem;
      c.innerHTML = '<button class="p-dismiss" title="Dismiss" onclick="dismissCard(this.parentElement.dataset.stem)">&times;</button><div class="p-name"></div><div class="p-bar"><div class="p-fill"></div></div><div class="p-stages"></div>';
      c.querySelector('.p-name').textContent = stem;
      prog.appendChild(c);
      cards[stem] = c;
      return c;
    }

    function finishRunningRow(card) {
      const row = card.querySelector('.p-srow.running');
      if (!row) return null;
      row.classList.remove('running');
      row.classList.add('done');
      row.querySelector('.p-sicon').textContent = '✓';
      return row;
    }

    function appendStageRow(card, cls, iconChar, label) {
      const row = document.createElement('div');
      row.className = 'p-srow ' + cls;
      row.innerHTML = '<span class="p-sicon">' + iconChar + '</span><span>' + esc(label) + '</span>';
      card.querySelector('.p-stages').appendChild(row);
    }

    function updateProg(e) {
      const card = ensureCard(e.stem);
      const fill = card.querySelector('.p-fill');
      card.classList.remove('p-done');
      if (e.total > 0 && e.status !== 'done') fill.style.width = Math.round(e.stage_num / e.total * 100) + '%';
      if (e.status === 'running') {
        finishRunningRow(card);
        appendStageRow(card, 'running', '›', e.stage);
      } else if (e.status === 'done') {
        finishRunningRow(card);
        fill.style.width = '100%';
        card.classList.add('p-done');
      } else if (e.status === 'error') {
        appendStageRow(card, 'err', '✗', e.stage);
        card.classList.add('p-err');
      }
    }

    function addLog(e) {
      const r = document.createElement('div');
      const isErr = e.level === 'ERROR';
      const isWarn = e.level === 'WARNING';
      r.className = 'row' + (isErr ? ' error' : isWarn ? ' warn' : '') + ((filter === 'err' && !isErr) || (filter === 'warn' && !isErr && !isWarn) ? ' hidden' : '');
      r.innerHTML = '<div class="ts">' + esc(e.timestamp) + '</div><div class="stage s-' + slug(e.stage) + '">' + esc(e.stage) + '</div><div class="lvl" style="color:' + (isErr ? '#ef4444' : isWarn ? '#f59e0b' : '#475569') + '">' + icon(e.level) + '</div><div class="msg">' + esc(e.message) + '</div>';
      feed.insertBefore(r, feed.firstChild);
      while (feed.children.length > 200) feed.removeChild(feed.lastChild);
      if (auto) feed.scrollTop = 0;
    }

    const es = new EventSource('/stream');
    es.onmessage = x => {
      const e = JSON.parse(x.data);
      if (e.type === 'progress') updateProg(e);
      else addLog(e);
    };
  </script>
</body>
</html>"""
app = Flask(__name__)
_handler = None


class MonitorHandler(logging.Handler):
    def emit(self, record):
        key = record.name.rsplit(".", 1)[-1].lower()
        EVENTS.put({"timestamp": datetime.fromtimestamp(record.created).strftime("%H:%M:%S"), "level": record.levelname, "stage": STAGES.get(key, "System"), "message": record.getMessage()})


@app.get("/")
def index():
    return MONITOR_HTML


@app.get("/stream")
def stream():
    def gen():
        while True:
            try:
                yield f"data: {json.dumps(EVENTS.get(timeout=1))}\n\n"
            except queue.Empty:
                yield ": keepalive\n\n"
    return Response(gen(), mimetype="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


def get_monitor_handler():
    return _handler


def start_monitor_server(port=PORT):
    global _handler
    logger = logging.getLogger("fidelio")
    if _handler is None:
        _handler = MonitorHandler()
        logger.addHandler(_handler)
        logger.propagate = True
    if getattr(start_monitor_server, "_started", False):
        return
    threading.Thread(target=lambda: app.run(host="127.0.0.1", port=port, threaded=True, use_reloader=False), daemon=True, name="fidelio-monitor").start()
    start_monitor_server._started = True
