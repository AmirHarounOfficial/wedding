/* ════════════════════════════════════════════════════════════════
   دعوة زفاف أمير و سوسن — Vercel serverless function
   ────────────────────────────────────────────────────────────────
   Vercel's filesystem is read-only, so replies can't live in a file
   the way they do in the PHP version. They go into Upstash Redis —
   free, and created from inside the Vercel dashboard:

       Vercel → your project → Storage → Create → Upstash for Redis

   That injects KV_REST_API_URL / KV_REST_API_TOKEN automatically.
   Nothing to install: this file uses plain fetch, zero dependencies.

   Then add one more env var:  ADMIN_KEY = <your key>

   Endpoints (all on /api/guests):
     ?action=wishes            GET   the congratulations wall
     ?action=rsvp              POST  {name, guests, attending}
     ?action=wish              POST  {name, msg}
     ?action=admin&key=…       GET   everything (yours only)
     ?action=delete&key=…      POST  {kind, id}
     ?action=check&key=…       GET   diagnostics
   ════════════════════════════════════════════════════════════════ */

const RSVPS  = 'wedding:rsvps';    // hash: lowercased name -> entry json
const WISHES = 'wedding:wishes';   // hash: id -> entry json

/* ── env ──────────────────────────────────────────────────────── */
const pick = (...names) => {
  for (const n of names) if (process.env[n]) return process.env[n];
  return '';
};
const storeUrl   = () => pick('KV_REST_API_URL',   'UPSTASH_REDIS_REST_URL',   'REDIS_REST_URL');
const storeToken = () => pick('KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_TOKEN', 'REDIS_REST_TOKEN');
const adminKey   = () => process.env.ADMIN_KEY || 'sawsan-amir';

/* ── redis over REST ──────────────────────────────────────────── */
async function redis(...cmd){
  const url = storeUrl(), token = storeToken();
  if (!url || !token){
    const e = new Error('no_store'); e.code = 'no_store'; throw e;
  }
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd)
  });
  let j = {};
  try { j = await r.json(); } catch {}
  if (!r.ok || j.error) throw new Error(j.error || ('store http ' + r.status));
  return j.result;
}

/** Upstash returns HGETALL as a flat [f,v,f,v] array; be tolerant of objects too */
function entries(result){
  if (!result) return [];
  if (Array.isArray(result)){
    const out = [];
    for (let i = 0; i + 1 < result.length; i += 2) out.push([result[i], result[i + 1]]);
    return out;
  }
  return (typeof result === 'object') ? Object.entries(result) : [];
}

const parseAll = vals => (vals || [])
  .map(v => { try { return JSON.parse(v); } catch { return null; } })
  .filter(Boolean)
  .sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')));   // oldest → newest

/* ── input hygiene ────────────────────────────────────────────── */
function clean(v, max){
  let s = typeof v === 'string' ? v : '';
  s = s.replace(/[\x00-\x1F\x7F]+/g, ' ').replace(/\s+/g, ' ').trim();
  return s.slice(0, max);
}
const lc = s => String(s).toLowerCase();
const newid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

function body(req){
  const b = req.body;
  if (!b) return {};
  if (typeof b === 'string'){ try { return JSON.parse(b) || {}; } catch { return {}; } }
  return typeof b === 'object' ? b : {};
}

const send = (res, code, obj) => { res.status(code).json(obj); };

function keyOk(req){
  const given = String((req.query && req.query.key) || '');
  const want  = adminKey();
  // constant-ish time: compare full length always
  if (given.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= given.charCodeAt(i) ^ want.charCodeAt(i);
  return diff === 0;
}

/* ── handler ──────────────────────────────────────────────────── */
module.exports = async function handler(req, res){
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const action = String((req.query && req.query.action) || '');
  const method = req.method || 'GET';
  const mustPost = () => {
    if (method !== 'POST'){ send(res, 405, { ok:false, error:'POST only' }); return false; }
    return true;
  };

  try {
    switch (action){

      case 'rsvp': {
        if (!mustPost()) return;
        const b = body(req);
        const name = clean(b.name, 80);
        if (!name) return send(res, 400, { ok:false, error:'name required' });

        const guests    = Math.max(0, Math.min(20, parseInt(b.guests, 10) || 0));
        const attending = b.attending === true || b.attending === 'yes';
        const field     = lc(name);

        // same name replying again keeps its original id
        let id = newid();
        const prev = await redis('HGET', RSVPS, field);
        if (prev){ try { id = JSON.parse(prev).id || id; } catch {} }

        await redis('HSET', RSVPS, field,
          JSON.stringify({ id, name, guests, attending, at: new Date().toISOString() }));
        return send(res, 200, { ok:true });
      }

      case 'wish': {
        if (!mustPost()) return;
        const b = body(req);
        const name = clean(b.name, 80);
        const msg  = clean(b.msg, 600);
        const isPrivate = Boolean(b.isPrivate || b.private);
        if (!name || !msg) return send(res, 400, { ok:false, error:'name and message required' });

        const id = newid();
        await redis('HSET', WISHES, id,
          JSON.stringify({ id, name, msg, isPrivate, at: new Date().toISOString() }));
        return send(res, 200, { ok:true });
      }

      case 'wishes': {
        const all = parseAll(await redis('HVALS', WISHES));
        const publicWishes = all.filter(w => !w.isPrivate);
        return send(res, 200, {
          ok: true,
          wishes: publicWishes.map(w => ({ name: w.name, msg: w.msg, at: w.at }))
        });
      }

      case 'admin': {
        if (!keyOk(req)) return send(res, 401, { ok:false, error:'bad key' });
        const [rsvps, wishes] = await Promise.all([
          redis('HVALS', RSVPS).then(parseAll),
          redis('HVALS', WISHES).then(parseAll)
        ]);
        const yes = rsvps.filter(r => r.attending);
        const privateCount = wishes.filter(w => w.isPrivate).length;
        return send(res, 200, {
          ok: true,
          totals: {
            attending: yes.length,
            heads: yes.reduce((s, r) => s + 1 + (r.guests || 0), 0),
            declined: rsvps.length - yes.length,
            wishes: wishes.length,
            wishesPrivate: privateCount,
            wishesPublic: wishes.length - privateCount
          },
          rsvps, wishes
        });
      }

      case 'delete': {
        if (!mustPost()) return;
        if (!keyOk(req)) return send(res, 401, { ok:false, error:'bad key' });
        const b  = body(req);
        const id = typeof b.id === 'string' ? b.id : '';
        if (!id) return send(res, 400, { ok:false, error:'id required' });

        if (b.kind === 'wish'){
          await redis('HDEL', WISHES, id);
        } else if (b.kind === 'rsvp'){
          // rsvps are keyed by name, so find the field holding this id
          const found = entries(await redis('HGETALL', RSVPS))
            .find(([, v]) => { try { return JSON.parse(v).id === id; } catch { return false; } });
          if (found) await redis('HDEL', RSVPS, found[0]);
        }
        return send(res, 200, { ok:true });
      }

      case 'toggle_private': {
        if (!mustPost()) return;
        if (!keyOk(req)) return send(res, 401, { ok:false, error:'bad key' });
        const b  = body(req);
        const id = typeof b.id === 'string' ? b.id : '';
        if (!id) return send(res, 400, { ok:false, error:'id required' });

        const wishRaw = await redis('HGET', WISHES, id);
        if (!wishRaw) return send(res, 404, { ok:false, error:'wish not found' });

        let wish = {};
        try { wish = JSON.parse(wishRaw); } catch {}
        if (!wish || !wish.id) return send(res, 400, { ok:false, error:'invalid wish data' });

        wish.isPrivate = typeof b.isPrivate === 'boolean' ? b.isPrivate : !wish.isPrivate;
        await redis('HSET', WISHES, id, JSON.stringify(wish));
        return send(res, 200, { ok:true, isPrivate: wish.isPrivate });
      }

      case 'check': {
        if (!keyOk(req)) return send(res, 401, { ok:false, error:'bad key' });
        const out = {
          ok: true,
          node: process.version,
          storeConfigured: Boolean(storeUrl() && storeToken()),
          adminKeyFromEnv: Boolean(process.env.ADMIN_KEY)
        };
        if (out.storeConfigured){
          try {
            out.storeReachable = (await redis('PING')) === 'PONG';
            out.counts = {
              rsvps:  (await redis('HLEN', RSVPS))  || 0,
              wishes: (await redis('HLEN', WISHES)) || 0
            };
          } catch (e){ out.storeReachable = false; out.storeError = e.message; }
        }
        return send(res, 200, out);
      }

      default:
        return send(res, 404, { ok:false, error:'unknown action',
          hint:'rsvp | wish | wishes | admin | delete | toggle_private | check' });
    }
  } catch (e){
    if (e.code === 'no_store'){
      return send(res, 503, { ok:false, error:'store_not_connected',
        hint:'Vercel → Storage → Create → Upstash for Redis, ثم Redeploy' });
    }
    return send(res, 500, { ok:false, error: String(e.message || e) });
  }
};
