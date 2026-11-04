<?php
/**
 * POST /api/form.php?kind=<newsletter|early-access|demo|contact> — every website form.
 * Works with and without JavaScript: fetch callers (Accept: application/json) get JSON; plain form
 * posts are redirected back with ?sent=<kind> (or ?error=…) so the page shows its success state.
 * Each lead is emailed to config.php's lead_email, and the visitor gets a thank-you email
 * (with a calendar invite for demos). Spam: honeypot, timing, per-IP rate limit, optional Turnstile.
 * Runs on PHP 7.4+ (Namecheap shared hosting).
 */
declare(strict_types=1);

$CFG = require __DIR__ . '/config.php';
// Hosts without the mbstring extension.
if (!function_exists('mb_strlen')) {
  function mb_strlen(string $s): int { return (int)preg_match_all('/./us', $s); }
  function mb_substr(string $s, int $start, int $len): string { return implode('', array_slice(preg_split('//u', $s, -1, PREG_SPLIT_NO_EMPTY) ?: [], $start, $len)); }
}
header('X-Robots-Tag: noindex');
header('Cache-Control: no-store');

const HONEYPOT = 'company_website';
const META_KEYS = ['page', 'vertical', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'referrer'];

// [label, required, max length, type, options]; type is text, email, enum or datetime.
$FORMS = [
  'newsletter' => [
    'list' => 'Newsletter',
    'fields' => ['email' => ['Email', true, 200, 'email'], 'source' => ['Form location', false, 40, 'text']],
    'thanks' => ['You’re on the Rent Hatch newsletter', [
      'Thanks for subscribing. Once a month we send one useful email for rental operators: pricing ideas, seasonal checklists and what changed in Rent Hatch.',
      'No spam, and every email has a one-click unsubscribe.',
    ]],
  ],
  'early-access' => [
    'list' => 'Cars early access',
    'fields' => [
      'email' => ['Email', true, 200, 'email'], 'name' => ['Name', false, 120, 'text'], 'fleet_size' => ['Fleet size', false, 40, 'text'],
      'current_tool' => ['Current tool', false, 120, 'text'], 'source' => ['Form location', false, 40, 'text'],
    ],
    'thanks' => ['You’re on the list for Rent Hatch car rental', [
      'Thanks for joining early access to Rent Hatch for car and vehicle rental.',
      'We’re onboarding fleets in small groups. We’ll email you before your spot opens, with launch pricing locked in for early-access members.',
      'Reply to this email any time to tell us about your fleet. It helps us shape the launch.',
    ]],
  ],
  'demo' => [
    'list' => 'Demo requests',
    'fields' => [
      'name' => ['Name', true, 120, 'text'], 'email' => ['Email', true, 200, 'email'], 'company' => ['Company', true, 160, 'text'],
      'phone' => ['Phone', false, 40, 'text'], 'rents' => ['What they rent', true, 60, 'text'], 'size' => ['Business size', false, 60, 'text'],
      'current_tool' => ['Current tool', false, 120, 'text'], 'slot' => ['Time (UTC)', true, 40, 'datetime'], 'timezone' => ['Their time zone', false, 60, 'text'],
    ],
    'thanks' => ['Your Rent Hatch demo is booked', [
      'Thanks for booking a demo. A calendar invite is attached; the video link follows from the person running your call.',
      'Bring a real order or two you’ve struggled with. We’ll build them live in Rent Hatch so you can see the numbers for your business.',
    ]],
  ],
  'contact' => [
    'list' => 'Contact',
    'fields' => [
      'topic' => ['Topic', true, 20, 'enum', ['sales', 'support', 'partners', 'press', 'jobs']], 'name' => ['Name', true, 120, 'text'],
      'email' => ['Email', true, 200, 'email'], 'company' => ['Company', false, 160, 'text'], 'rents' => ['What they rent', false, 60, 'text'],
      'message' => ['Message', true, 5000, 'text'],
    ],
    'thanks' => ['We got your message', ['Thanks for writing to Rent Hatch. A real person reads every message, and we usually reply within one business day.']],
  ],
];

$kind = (string)($_GET['kind'] ?? '');
$fid = substr(preg_replace('/[^a-z0-9-]/i', '', (string)($_POST['_fid'] ?? '')), 0, 40);
$wantsJson = strpos((string)($_SERVER['HTTP_ACCEPT'] ?? ''), 'application/json') !== false;

/** Answer as JSON, or redirect a plain form post back to its page. */
function reply(int $status, array $body): void {
  global $wantsJson, $kind, $fid;
  if ($wantsJson) {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($body, JSON_UNESCAPED_UNICODE);
    exit;
  }
  $host = (string)($_SERVER['HTTP_HOST'] ?? '');
  $ref = (string)($_SERVER['HTTP_REFERER'] ?? '');
  $back = $ref && parse_url($ref, PHP_URL_HOST) === $host ? ((string)parse_url($ref, PHP_URL_PATH) ?: '/') : '/';
  $q = $body['ok'] ? ['sent' => $kind] : ['error' => $body['error'] ?? 'Something went wrong.'];
  $q['fid'] = $fid;
  header('Location: ' . $back . '?' . http_build_query($q) . ($fid ? '#' . $fid : ''), true, 303);
  exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') { header('Allow: POST'); http_response_code(405); exit('Method not allowed'); }
if (!isset($FORMS[$kind])) reply(404, ['ok' => false, 'error' => 'Unknown form.']);
$form = $FORMS[$kind];
$ip = (string)($_SERVER['REMOTE_ADDR'] ?? 'unknown');

// ---- Spam. Bots get a normal-looking success so they don't learn what tripped them.
if (trim((string)($_POST[HONEYPOT] ?? '')) !== '') reply(200, ['ok' => true]);
$shown = (float)($_POST['_t'] ?? 0);
$age = microtime(true) * 1000 - $shown;
if (!$shown || $age < 2500 || $age > 24 * 3600 * 1000) reply(200, ['ok' => true]);
if (rate_limited($ip)) reply(429, ['ok' => false, 'error' => 'Too many submissions from your network. Please try again in a few minutes.']);
if ($CFG['turnstile_secret'] !== '') {
  $res = post_url('https://challenges.cloudflare.com/turnstile/v0/siteverify', http_build_query(['secret' => $CFG['turnstile_secret'], 'response' => (string)($_POST['cf-turnstile-response'] ?? ''), 'remoteip' => $ip]), 'application/x-www-form-urlencoded');
  $ok = $res !== null && (json_decode($res, true)['success'] ?? false);
  if (!$ok) reply(400, ['ok' => false, 'error' => 'We couldn’t confirm you’re human. Please try again.']);
}

/** At most 8 submissions per IP in 10 minutes (a small file per IP in the temp folder). */
function rate_limited(string $ip, int $max = 8, int $window = 600): bool {
  $file = sys_get_temp_dir() . '/rh-forms-' . md5($ip) . '.json';
  $now = time();
  $hits = is_file($file) ? (json_decode((string)@file_get_contents($file), true) ?: []) : [];
  $hits = array_values(array_filter($hits, function ($t) use ($now, $window) { return $now - $t < $window; }));
  $hits[] = $now;
  @file_put_contents($file, json_encode($hits), LOCK_EX);
  return count($hits) > $max;
}

// ---- Validate.
$data = [];
$errors = [];
foreach ($form['fields'] as $key => $f) {
  [$label, $required, $max, $type] = $f;
  $v = trim(str_replace("\r\n", "\n", (string)($_POST[$key] ?? '')));
  if ($type === 'email') $v = strtolower($v);
  if ($v === '') { if ($required) $errors[$key] = $type === 'datetime' ? 'Pick a time for the call.' : "$label is required."; continue; }
  if (mb_strlen($v) > $max) { $errors[$key] = "$label is too long."; continue; }
  if ($type === 'email' && !filter_var($v, FILTER_VALIDATE_EMAIL)) { $errors[$key] = 'Enter a valid email address.'; continue; }
  if ($type === 'enum' && !in_array($v, $f[4], true)) { $errors[$key] = "Choose a $label."; continue; }
  if ($type === 'datetime' && (strtotime($v) === false || !preg_match('/^\d{4}-\d\d-\d\dT\d\d:\d\d/', $v))) { $errors[$key] = 'Pick a time for the call.'; continue; }
  $data[$key] = $v;
}
if ($errors) reply(422, ['ok' => false, 'error' => array_values($errors)[0], 'fields' => $errors]);

$meta = [];
foreach (META_KEYS as $k) { $v = trim((string)($_POST[$k] ?? '')); if ($v !== '') $meta[$k] = mb_substr($v, 0, 300); }
$rows = [];
foreach ($data as $k => $v) $rows[] = [$form['fields'][$k][0], $k === 'slot' ? gmdate('D, M j Y, H:i', (int)strtotime($v)) . ' UTC' : $v];

// ---- Deliver: the lead to us (this decides success), then the thank-you to the visitor.
$list = $kind === 'contact' ? 'Contact · ' . $data['topic'] : $form['list'];
$subject = '[Website] ' . $list . (isset($data['company']) ? ' · ' . $data['company'] : '') . (isset($data['name']) ? ' · ' . $data['name'] : '');
$metaRows = [];
foreach ($meta as $k => $v) $metaRows[] = [$k, $v];
[$html, $text] = render_email('New ' . strtolower($list) . ' submission', ['From the website (' . ($meta['page'] ?? 'unknown page') . ').'], array_merge($rows, $metaRows));
$reached = send_mail($CFG['lead_email'], $subject, $html, $text, $data['email']);

if ($CFG['crm_webhook_url'] !== '') {
  $crm = post_url($CFG['crm_webhook_url'], (string)json_encode(['form' => $kind, 'list' => $list, 'submittedAt' => gmdate('c'), 'fields' => $data, 'meta' => $meta]), 'application/json');
  $reached = $reached || $crm !== null;
}
if (!$reached) reply(502, ['ok' => false, 'error' => 'We couldn’t send that just now. Please try again, or email ' . $CFG['from_email'] . '.']);

[$tSubject, $tLines] = $form['thanks'];
$tRows = $kind === 'newsletter' ? [] : array_values(array_filter($rows, function ($r) { return $r[0] !== 'Form location'; }));
[$html, $text] = render_email($tSubject, $tLines, $tRows);
send_mail($data['email'], $tSubject, $html, $text, null, $kind === 'demo' ? demo_invite($data['slot'], $data['name'], $data['company']) : null);

reply(200, ['ok' => true]);

// ---- Helpers.

function esc(string $s): string { return htmlspecialchars($s, ENT_QUOTES, 'UTF-8'); }

/** A plain branded email: heading, paragraphs, optional key/value table. Returns [html, text]. */
function render_email(string $title, array $paras, array $rows = []): array {
  $table = '';
  if ($rows) {
    $table = '<table role="presentation" style="width:100%;border-collapse:collapse;margin:8px 0 16px">';
    foreach ($rows as [$k, $v]) $table .= '<tr><td style="padding:8px 0;border-top:1px solid #E3E5DC;color:#535C6B;width:38%;vertical-align:top">' . esc($k) . '</td><td style="padding:8px 0;border-top:1px solid #E3E5DC;white-space:pre-wrap">' . esc($v) . '</td></tr>';
    $table .= '</table>';
  }
  $p = '';
  foreach ($paras as $para) $p .= '<p style="margin:0 0 14px;line-height:1.6;color:#353C48">' . esc($para) . '</p>';
  $html = '<!doctype html><html><body style="margin:0;background:#FAFAF6;font-family:Helvetica,Arial,sans-serif;color:#10131A">'
    . '<div style="max-width:560px;margin:0 auto;padding:32px 20px">'
    . '<div style="font-weight:800;font-size:20px;letter-spacing:-.02em;margin-bottom:24px"><span style="display:inline-block;width:22px;height:22px;border-radius:6px;background:#D4FF3A;vertical-align:-4px;margin-right:8px"></span>Rent Hatch</div>'
    . '<div style="background:#fff;border:1px solid #E3E5DC;border-radius:18px;padding:28px">'
    . '<h1 style="margin:0 0 14px;font-size:22px;line-height:1.25">' . esc($title) . '</h1>' . $p . $table . '</div>'
    . '<p style="font-size:12px;color:#8A93A3;margin:18px 4px 0">Rent Hatch · rental software for event and equipment rental businesses</p>'
    . '</div></body></html>';
  $lines = array_merge([$title, ''], $paras);
  if ($rows) { $lines[] = ''; foreach ($rows as [$k, $v]) $lines[] = "$k: $v"; }
  return [$html, implode("\n", $lines)];
}

/** A 30-minute calendar invite for a booked demo. */
function demo_invite(string $slot, string $name, string $company): array {
  $start = (int)strtotime($slot);
  $f = function (int $t) { return gmdate('Ymd\THis\Z', $t); };
  $ics = implode("\r\n", [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Rent Hatch//Demo//EN', 'METHOD:REQUEST', 'BEGIN:VEVENT',
    'UID:demo-' . $f($start) . '-' . bin2hex(random_bytes(4)) . '@renthatch.org', 'DTSTAMP:' . $f(time()),
    'DTSTART:' . $f($start), 'DTEND:' . $f($start + 1800), 'SUMMARY:Rent Hatch demo · ' . $company,
    'DESCRIPTION:A 30-minute walkthrough of Rent Hatch for ' . $name . '.', 'END:VEVENT', 'END:VCALENDAR',
  ]);
  return ['name' => 'rent-hatch-demo.ics', 'type' => 'text/calendar; method=REQUEST', 'content' => $ics];
}

/** Sends (or, with outbox_dir set, saves) a text + HTML email with an optional attachment. */
function send_mail(string $to, string $subject, string $html, string $text, ?string $replyTo = null, ?array $file = null): bool {
  global $CFG;
  $from = $CFG['from_email'];
  $enc = function (string $s) { return '=?UTF-8?B?' . base64_encode($s) . '?='; };
  $alt = 'alt-' . bin2hex(random_bytes(8));
  $body = "--$alt\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n" . chunk_split(base64_encode($text))
    . "--$alt\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n" . chunk_split(base64_encode($html)) . "--$alt--\r\n";
  $type = "multipart/alternative; boundary=\"$alt\"";
  if ($file) {
    $mix = 'mix-' . bin2hex(random_bytes(8));
    $body = "--$mix\r\nContent-Type: $type\r\n\r\n$body"
      . "--$mix\r\nContent-Type: {$file['type']}; name=\"{$file['name']}\"\r\nContent-Disposition: attachment; filename=\"{$file['name']}\"\r\nContent-Transfer-Encoding: base64\r\n\r\n"
      . chunk_split(base64_encode($file['content'])) . "--$mix--\r\n";
    $type = "multipart/mixed; boundary=\"$mix\"";
  }
  $headers = 'From: ' . $enc($CFG['from_name']) . " <$from>\r\n"
    . ($replyTo ? "Reply-To: $replyTo\r\n" : '')
    . "MIME-Version: 1.0\r\nContent-Type: $type\r\n";
  if ($CFG['outbox_dir'] !== '') {
    @mkdir($CFG['outbox_dir'], 0777, true);
    $name = gmdate('Ymd-His') . '-' . bin2hex(random_bytes(3)) . '-' . preg_replace('/[^a-z0-9@.+-]/i', '_', $to) . '.eml';
    return (bool)file_put_contents($CFG['outbox_dir'] . '/' . $name, "To: $to\r\nSubject: " . $enc($subject) . "\r\n$headers\r\n$body");
  }
  return mail($to, $enc($subject), $body, $headers, '-f' . $from);
}

/** POST a body; returns the response text, or null on failure. */
function post_url(string $url, string $body, string $type): ?string {
  $ctx = stream_context_create(['http' => ['method' => 'POST', 'header' => "Content-Type: $type\r\n", 'content' => $body, 'timeout' => 8, 'ignore_errors' => true]]);
  $res = @file_get_contents($url, false, $ctx);
  $status = isset($http_response_header[0]) && preg_match('/\s(\d{3})\s/', $http_response_header[0], $m) ? (int)$m[1] : 0;
  return $res !== false && $status >= 200 && $status < 300 ? $res : null;
}
