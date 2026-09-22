import http from 'http';

const PORT = process.env.FIXTURE_PORT ? Number(process.env.FIXTURE_PORT) : 8976;

const INDEX_HTML = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>AR Fixture</title></head>
<body>
  <h1>Action Recorder Fixture</h1>
  <button id="submit-btn">Submit</button>
  <div id="click-count">0</div>

  <label>Password</label>
  <input type="password" name="password" id="pw-field">
  <label>API Key</label>
  <input type="text" name="api_key" id="api-key-field">
  <label>Cookie value</label>
  <input type="text" name="cookie_value" id="cookie-field">
  <label>CSRF</label>
  <input type="text" name="csrf_token" id="csrf-field">
  <label>Normal</label>
  <input type="text" name="search" id="search-field">

  <button id="fetch-btn">GET /api/data</button>
  <button id="fetch-post-btn">POST /api/submit</button>
  <button id="xhr-btn">XHR GET /api/xhr</button>

  <button id="btn-a" data-api="/api/a">A</button>
  <button id="btn-b" data-api="/api/b">B</button>
  <button id="btn-c" data-api="/api/c">C</button>

  <button id="btn-large-post">POST large</button>
  <button id="btn-deep-mask">POST deep mask</button>

  <form id="test-form">
    <input type="text" name="name" id="form-name">
    <input type="password" name="password" id="form-pw">
    <button type="submit" id="form-submit">Send</button>
  </form>

  <iframe src="/iframe" id="test-iframe" width="400" height="120"></iframe>

  <div id="shadow-host"></div>

  <script>
    document.getElementById('submit-btn').addEventListener('click', () => {
      const el = document.getElementById('click-count');
      el.textContent = String(Number(el.textContent) + 1);
    });

    document.getElementById('fetch-btn').addEventListener('click', async () => {
      const r = await fetch('/api/data');
      const d = await r.json();
      window.__lastFetch = d;
    });

    document.getElementById('fetch-post-btn').addEventListener('click', async () => {
      const r = await fetch('/api/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer secret-token' },
        body: JSON.stringify({ title: 't', nested: { password: 'leak-me', token: 'tok' } })
      });
      window.__lastPost = await r.json();
    });

    document.getElementById('xhr-btn').addEventListener('click', () => {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', '/api/xhr');
      xhr.onload = () => { window.__lastXhr = xhr.responseText; };
      xhr.send();
    });

    for (const id of ['a', 'b', 'c']) {
      document.getElementById('btn-' + id).addEventListener('click', async () => {
        await fetch('/api/' + id);
      });
    }

    document.getElementById('btn-large-post').addEventListener('click', async () => {
      const body = JSON.stringify({ blob: 'x'.repeat(100 * 1024) });
      await fetch('/api/echo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    });

    document.getElementById('btn-deep-mask').addEventListener('click', async () => {
      await fetch('/api/deep', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user: { name: 'Alice', credentials: { password: 'secret', token: 'abc123' } }
        })
      });
    });

    document.getElementById('test-form').addEventListener('submit', (e) => {
      e.preventDefault();
      window.__formSubmitted = true;
    });

    // Shadow DOM element
    const host = document.getElementById('shadow-host');
    const root = host.attachShadow({ mode: 'open' });
    const btn = document.createElement('button');
    btn.id = 'shadow-btn';
    btn.textContent = 'Shadow';
    root.appendChild(btn);
    btn.addEventListener('click', () => { window.__shadowClicked = true; });

    window.addEventListener('message', (e) => {
      if (e.data && e.data.source === 'ACTION_RECORDER') {
        window.__lastRecorderMsg = e.data;
      }
    });
  </script>
</body>
</html>`;

const IFRAME_HTML = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>Iframe</title></head>
<body>
  <p>iframe content</p>
  <button id="iframe-btn">iframe Button</button>
  <script>
    document.getElementById('iframe-btn').addEventListener('click', () => {
      window.__iframeClicked = true;
    });
  </script>
</body>
</html>`;

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const send = (code, type, body) => {
    res.writeHead(code, { 'Content-Type': type, 'Access-Control-Allow-Origin': '*' });
    res.end(body);
  };

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': '*'
    });
    res.end();
    return;
  }

  if (url.pathname === '/' || url.pathname === '/index.html') {
    return send(200, 'text/html; charset=utf-8', INDEX_HTML);
  }
  if (url.pathname === '/iframe') {
    return send(200, 'text/html; charset=utf-8', IFRAME_HTML);
  }
  if (url.pathname === '/api/data') {
    return send(200, 'application/json', JSON.stringify({ ok: true, name: 'data' }));
  }
  if (url.pathname === '/api/xhr') {
    return send(200, 'application/json', JSON.stringify({ ok: true, source: 'xhr' }));
  }
  if (url.pathname === '/api/a' || url.pathname === '/api/b' || url.pathname === '/api/c') {
    return send(200, 'application/json', JSON.stringify({ path: url.pathname }));
  }
  if (url.pathname === '/api/deep') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => send(200, 'application/json', JSON.stringify({ received: true, echo: safeParse(body) })));
    return;
  }
  if (url.pathname === '/api/echo' || url.pathname === '/api/submit') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => send(200, 'application/json', JSON.stringify({ ok: true, size: body.length })));
    return;
  }
  if (url.pathname === '/api/large') {
    return send(200, 'application/json', JSON.stringify({ blob: 'y'.repeat(300 * 1024) }));
  }
  send(404, 'application/json', JSON.stringify({ error: 'not found' }));
});

function safeParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}

server.listen(PORT, '127.0.0.1', () => {
  console.log(`fixture server on http://127.0.0.1:${PORT}`);
});

export { PORT };
