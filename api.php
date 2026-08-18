<?php
/* ════════════════════════════════════════════════════════════════
   دعوة زفاف أمير و سوسن — backend
   ────────────────────────────────────────────────────────────────
   PHP فقط. لا Node ولا بورت ولا reverse proxy.
   ارفع الملفات في مجلد الموقع وخلاص.

   الردود بتتخزن في  data.php  جنب الملف ده.
   أول سطر فيه  <?php exit; ?>  فلو حد فتحه من المتصفح مباشرة
   مش هيشوف حاجة.

   ⚠  غيّر ADMIN_KEY تحت قبل ما ترفع.
   ════════════════════════════════════════════════════════════════ */

declare(strict_types=1);

// ── غيّر دي ─────────────────────────────────────────────────────
const ADMIN_KEY = 'sawsan-amir';
// ────────────────────────────────────────────────────────────────

const STORE    = __DIR__ . '/data.php';
const GUARD    = "<?php exit; ?>\n";
const MAX_BODY = 8192;
const MAX_ROWS = 5000;          // حد أقصى عشان الملف ما يكبرش بلا نهاية

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

/* ── helpers ──────────────────────────────────────────────────── */

function out(int $code, array $o): void {
    http_response_code($code);
    echo json_encode($o, JSON_UNESCAPED_UNICODE);
    exit;
}

/** trim + collapse whitespace + strip control chars + length cap */
function clean($v, int $max): string {
    $s = is_string($v) ? $v : '';
    if ($s === '' || !preg_match('//u', $s)) return '';        // reject invalid UTF-8
    $s = preg_replace('/[\x{0000}-\x{001F}\x{007F}]+/u', ' ', $s) ?? '';
    $s = trim(preg_replace('/\s+/u', ' ', $s) ?? '');
    return function_exists('mb_substr') ? mb_substr($s, 0, $max, 'UTF-8') : substr($s, 0, $max);
}

function lc(string $s): string {
    return function_exists('mb_strtolower') ? mb_strtolower($s, 'UTF-8') : strtolower($s);
}

function body(): array {
    $raw = file_get_contents('php://input');
    if ($raw === false) return [];
    if (strlen($raw) > MAX_BODY) out(413, ['ok' => false, 'error' => 'too big']);
    $d = json_decode($raw, true);
    if (is_array($d)) return $d;
    return is_array($_POST) ? $_POST : [];                     // form fallback
}

function parse_store(string $raw): array {
    $nl   = strpos($raw, "\n");
    $json = ($nl === false) ? '' : substr($raw, $nl + 1);
    $d    = json_decode($json, true);
    if (!is_array($d)) $d = [];
    $d['rsvps']  = (isset($d['rsvps'])  && is_array($d['rsvps']))  ? array_values($d['rsvps'])  : [];
    $d['wishes'] = (isset($d['wishes']) && is_array($d['wishes'])) ? array_values($d['wishes']) : [];
    return $d;
}

/** read + change + write, all under one exclusive lock */
function mutate(callable $fn): array {
    $fp = @fopen(STORE, 'c+');
    if (!$fp) out(500, ['ok' => false,
        'error' => 'data.php غير قابل للكتابة — صلّح صلاحيات المجلد (chown -R www:www)']);
    if (!flock($fp, LOCK_EX)) { fclose($fp); out(500, ['ok'=>false, 'error'=>'lock failed']); }

    $raw  = stream_get_contents($fp);
    $data = $fn(parse_store($raw === false ? '' : $raw));

    ftruncate($fp, 0);
    rewind($fp);
    fwrite($fp, GUARD . json_encode($data, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));
    fflush($fp);
    flock($fp, LOCK_UN);
    fclose($fp);
    return $data;
}

function read_store(): array {
    if (!file_exists(STORE)) return ['rsvps' => [], 'wishes' => []];
    $fp = @fopen(STORE, 'r');
    if (!$fp) return ['rsvps' => [], 'wishes' => []];
    flock($fp, LOCK_SH);
    $raw = stream_get_contents($fp);
    flock($fp, LOCK_UN);
    fclose($fp);
    return parse_store($raw === false ? '' : $raw);
}

function newid(): string {
    return dechex(time()) . bin2hex(random_bytes(3));
}

function need_key(): void {
    $k = $_GET['key'] ?? '';
    if (!is_string($k) || !hash_equals(ADMIN_KEY, $k))
        out(401, ['ok' => false, 'error' => 'bad key']);
}

/* ── routes ───────────────────────────────────────────────────── */

$action = isset($_GET['action']) && is_string($_GET['action']) ? $_GET['action'] : '';
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

switch ($action) {

/* الضيف بيأكد حضوره */
case 'rsvp':
    if ($method !== 'POST') out(405, ['ok' => false, 'error' => 'POST only']);
    $b    = body();
    $name = clean($b['name'] ?? '', 80);
    if ($name === '') out(400, ['ok' => false, 'error' => 'name required']);

    $guests = max(0, min(20, (int)($b['guests'] ?? 0)));
    $att    = (($b['attending'] ?? false) === true) || (($b['attending'] ?? '') === 'yes');

    mutate(function (array $d) use ($name, $guests, $att): array {
        $entry = ['id' => newid(), 'name' => $name, 'guests' => $guests,
                  'attending' => $att, 'at' => gmdate('c')];
        foreach ($d['rsvps'] as $i => $r) {              // نفس الاسم = تحديث مش تكرار
            if (isset($r['name']) && lc((string)$r['name']) === lc($name)) {
                $entry['id'] = $r['id'] ?? $entry['id'];
                $d['rsvps'][$i] = $entry;
                return $d;
            }
        }
        if (count($d['rsvps']) < MAX_ROWS) $d['rsvps'][] = $entry;
        return $d;
    });
    out(200, ['ok' => true]);

/* الضيف بيكتب تهنئة */
case 'wish':
    if ($method !== 'POST') out(405, ['ok' => false, 'error' => 'POST only']);
    $b    = body();
    $name = clean($b['name'] ?? '', 80);
    $msg  = clean($b['msg']  ?? '', 600);
    if ($name === '' || $msg === '')
        out(400, ['ok' => false, 'error' => 'name and message required']);

    mutate(function (array $d) use ($name, $msg): array {
        if (count($d['wishes']) < MAX_ROWS)
            $d['wishes'][] = ['id' => newid(), 'name' => $name, 'msg' => $msg, 'at' => gmdate('c')];
        return $d;
    });
    out(200, ['ok' => true]);

/* حائط التهاني — يشوفه كل الضيوف */
case 'wishes':
    $d = read_store();
    $pub = array_map(
        fn($w) => ['name' => $w['name'] ?? '', 'msg' => $w['msg'] ?? '', 'at' => $w['at'] ?? ''],
        $d['wishes']
    );
    out(200, ['ok' => true, 'wishes' => $pub]);

/* صفحتك انت */
case 'admin':
    need_key();
    $d   = read_store();
    $yes = array_values(array_filter($d['rsvps'], fn($r) => !empty($r['attending'])));
    $heads = 0;
    foreach ($yes as $r) $heads += 1 + (int)($r['guests'] ?? 0);
    out(200, [
        'ok' => true,
        'totals' => [
            'attending' => count($yes),
            'heads'     => $heads,
            'declined'  => count($d['rsvps']) - count($yes),
            'wishes'    => count($d['wishes']),
        ],
        'rsvps'  => $d['rsvps'],
        'wishes' => $d['wishes'],
    ]);

/* حذف رد */
case 'delete':
    if ($method !== 'POST') out(405, ['ok' => false, 'error' => 'POST only']);
    need_key();
    $b    = body();
    $kind = $b['kind'] ?? '';
    $id   = is_string($b['id'] ?? null) ? $b['id'] : '';
    if ($id === '') out(400, ['ok' => false, 'error' => 'id required']);
    mutate(function (array $d) use ($kind, $id): array {
        if ($kind === 'rsvp')
            $d['rsvps']  = array_values(array_filter($d['rsvps'],  fn($r) => ($r['id'] ?? '') !== $id));
        if ($kind === 'wish')
            $d['wishes'] = array_values(array_filter($d['wishes'], fn($w) => ($w['id'] ?? '') !== $id));
        return $d;
    });
    out(200, ['ok' => true]);

/* تشخيص — افتحه لو حاجة مش شغالة */
case 'check':
    need_key();
    $d = read_store();
    out(200, ['ok' => true,
        'php'            => PHP_VERSION,
        'store_path'     => STORE,
        'store_exists'   => file_exists(STORE),
        'store_writable' => file_exists(STORE) ? is_writable(STORE) : null,
        'dir_writable'   => is_writable(__DIR__),
        'mbstring'       => function_exists('mb_substr'),
        'counts'         => ['rsvps' => count($d['rsvps']), 'wishes' => count($d['wishes'])],
    ]);

default:
    out(404, ['ok' => false, 'error' => 'unknown action',
              'hint' => 'rsvp | wish | wishes | admin | delete | check']);
}
