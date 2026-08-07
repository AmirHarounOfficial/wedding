/* ════════════════════════════════════════════════════════════════
   دعوة زفاف سوسن و أمير — small server
   ────────────────────────────────────────────────────────────────
   Serves the invitation AND collects RSVPs + congratulations so
   you can see them all in one place (admin.html).

   RUN IT:      node server.js
   INVITATION:  http://localhost:3000/
   YOUR PAGE:   http://localhost:3000/admin.html?key=sawsan-amir

   Guests on your Wi-Fi can open it at  http://<your-ip>:3000/
   To reach guests anywhere, host this folder on any Node host
   (Render, Railway, Glitch…) — everything is plain Node, no deps.

   Data is stored in  data.json  next to this file. Back that up.
   ════════════════════════════════════════════════════════════════ */

const http = require('http');
const fs   = require('fs');
const path = require('path');

const PORT      = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || 'sawsan-amir';   // change me
const ROOT      = __dirname;
const DB        = path.join(ROOT, 'data.json');

/* files that must never be downloadable over the web */
const BLOCKED = new Set([
  'server.js', 'package.json', 'package-lock.json', 'readme.md', 'ecosystem.config.js'
]);

const TYPES = {
  '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8',   '.json':'application/json; charset=utf-8',
  '.mp3':'audio/mpeg', '.wav':'audio/wav', '.ogg':'audio/ogg', '.m4a':'audio/mp4',
  '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg',
  '.svg':'image/svg+xml', '.webp':'image/webp', '.ico':'image/x-icon',
  '.woff':'font/woff', '.woff2':'font/woff2', '.mp4':'video/mp4'
};

/* ── tiny json store ───────────────────────────────────────────── */
function read(){
  try { return JSON.parse(fs.readFileSync(DB, 'utf8')); }
  catch { return { rsvps: [], wishes: [] }; }
}
function write(db){
  const tmp = DB + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB);                      // atomic-ish, avoids truncation
}
const clean = (s, max) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, max);

/* ── helpers ───────────────────────────────────────────────────── */
const json = (res, code, obj) => {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8',
                        'Cache-Control': 'no-store',
                        'Content-Length': Buffer.byteLength(body) });
  res.end(body);
};
function body(req, limit = 8 * 1024){
  return new Promise((resolve, reject) => {
    let n = 0, chunks = [], done = false;
    req.on('data', c => {
      if (done) return;
      n += c.length;
      if (n > limit){                 // answer properly, don't just drop the socket
        done = true;
        req.pause();
        const e = new Error('too big'); e.code = 413;
        reject(e);
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (done) return;
      done = true;
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch { reject(new Error('bad json')); }
    });
    req.on('error', reject);
  });
}

/* ── server ────────────────────────────────────────────────────── */
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;

  try {
    /* ---- guests post their RSVP ---- */
    if (req.method === 'POST' && p === '/api/rsvp'){
      const b = await body(req);
      const name = clean(b.name, 80);
      if (!name) return json(res, 400, { ok:false, error:'name required' });
      const entry = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
        name,
        guests: Math.max(0, Math.min(20, parseInt(b.guests, 10) || 0)),
        attending: b.attending === true || b.attending === 'yes',
        at: new Date().toISOString()
      };
      const db = read();
      // same name replying again updates their answer instead of duplicating
      const i = db.rsvps.findIndex(r => r.name.toLowerCase() === name.toLowerCase());
      if (i >= 0) db.rsvps[i] = { ...db.rsvps[i], ...entry, id: db.rsvps[i].id };
      else db.rsvps.push(entry);
      write(db);
      return json(res, 200, { ok:true });
    }

    /* ---- guests post a congratulation ---- */
    if (req.method === 'POST' && p === '/api/wish'){
      const b = await body(req);
      const name = clean(b.name, 80), msg = clean(b.msg, 600);
      if (!name || !msg) return json(res, 400, { ok:false, error:'name and message required' });
      const db = read();
      db.wishes.push({
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
        name, msg, at: new Date().toISOString()
      });
      write(db);
      return json(res, 200, { ok:true });
    }

    /* ---- everyone can read the congratulations wall ---- */
    if (req.method === 'GET' && p === '/api/wishes'){
      const db = read();
      return json(res, 200, { ok:true, wishes: db.wishes.map(w => ({ name:w.name, msg:w.msg, at:w.at })) });
    }

    /* ---- only you: the full picture ---- */
    if (req.method === 'GET' && p === '/api/admin'){
      if (url.searchParams.get('key') !== ADMIN_KEY)
        return json(res, 401, { ok:false, error:'bad key' });
      const db = read();
      const yes = db.rsvps.filter(r => r.attending);
      return json(res, 200, {
        ok: true,
        totals: {
          attending: yes.length,
          heads: yes.reduce((s, r) => s + 1 + r.guests, 0),
          declined: db.rsvps.filter(r => !r.attending).length,
          wishes: db.wishes.length
        },
        rsvps: db.rsvps, wishes: db.wishes
      });
    }

    /* ---- only you: delete a bad entry ---- */
    if (req.method === 'POST' && p === '/api/delete'){
      if (url.searchParams.get('key') !== ADMIN_KEY)
        return json(res, 401, { ok:false, error:'bad key' });
      const b = await body(req);
      const db = read();
      if (b.kind === 'rsvp') db.rsvps = db.rsvps.filter(r => r.id !== b.id);
      if (b.kind === 'wish') db.wishes = db.wishes.filter(w => w.id !== b.id);
      write(db);
      return json(res, 200, { ok:true });
    }

    /* ---- static files ---- */
    if (req.method !== 'GET' && req.method !== 'HEAD')
      return json(res, 405, { ok:false, error:'method not allowed' });

    let rel = decodeURIComponent(p);
    if (rel === '/') rel = '/invitation.html';
    const file = path.join(ROOT, rel);

    // stay inside the folder
    if (file !== ROOT && !file.startsWith(ROOT + path.sep)){
      res.writeHead(403); return res.end('forbidden');
    }
    // never hand out the guest list or the source (server.js holds ADMIN_KEY).
    // lowercased because Windows/macOS filesystems are case-insensitive.
    const rest = file.slice(ROOT.length).toLowerCase();
    const base = path.basename(rest);
    const hidden =
      base.startsWith('data.json') ||                 // incl. the .tmp write file
      BLOCKED.has(base) ||
      rest.split(/[\\/]/).some(seg => seg.startsWith('.'));   // .env, .claude, .git…
    if (hidden){
      res.writeHead(404, {'Content-Type':'text/plain; charset=utf-8'});
      return res.end('not found');
    }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()){
      res.writeHead(404, {'Content-Type':'text/plain; charset=utf-8'});
      return res.end('not found');
    }

    const stat = fs.statSync(file);
    const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const range = req.headers.range;
    if (range && /^bytes=/.test(range)){            // so audio can seek
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      const start = m[1] ? parseInt(m[1], 10) : 0;
      const end   = m[2] ? parseInt(m[2], 10) : stat.size - 1;
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': end - start + 1,
        'Content-Type': type
      });
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': stat.size, 'Accept-Ranges': 'bytes' });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);

  } catch (err) {
    json(res, err.code === 413 ? 413 : 400, { ok:false, error: err.message });
  }
}).listen(PORT, () => {
  console.log(`\n  دعوة سوسن و أمير\n`);
  console.log(`  invitation  →  http://localhost:${PORT}/`);
  console.log(`  your page   →  http://localhost:${PORT}/admin.html?key=${ADMIN_KEY}\n`);
});
