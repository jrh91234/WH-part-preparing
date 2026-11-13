// ======================= สถานะ & ตัวช่วย =======================
var S = { token: null, user: null, myActive: null, serverOffset: 0, refreshTimer: null, draft: null, jobFilter: 'active', lineFilter: 'todo' };
var ROLE_LEVEL = { worker: 0, leader: 1, admin: 2 };
var LOC_TH = { '公共区域': 'ส่วนกลาง' };
var WH_TH = { '客供料库': 'คลังวัตถุดิบลูกค้า', '半成品库-待组装': 'คลังกึ่งสำเร็จ-รอประกอบ', 'H9组装-车间库': 'คลังไลน์ H9' };
var ISSUE_REASONS = ['ของไม่พอ / ขาด', 'หาของไม่เจอ', 'ของเสีย / ไม่ได้คุณภาพ', 'ล็อตไม่ตรง', 'อื่นๆ'];

if (window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { return null; } }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function $(sel) { return document.querySelector(sel); }
function can(role) { return S.user && ROLE_LEVEL[S.user.role] >= ROLE_LEVEL[role]; }
function now() { return Date.now() + S.serverOffset; }
function setServerTime(iso) { if (iso) S.serverOffset = new Date(iso).getTime() - Date.now(); }

function toast(msg, isErr) {
  var t = $('#toast'); t.textContent = msg; t.className = 'toast' + (isErr ? ' err' : '');
  clearTimeout(t._h); t._h = setTimeout(function () { t.className = 'toast hidden'; }, isErr ? 4500 : 2200);
}

function authed(fn) { return api.apply(null, [fn, S.token].concat(Array.prototype.slice.call(arguments, 1))); }

/** ปุ่มที่เรียก server: กันกดซ้ำ + แสดงข้อผิดพลาด */
function busy(btn, promise) {
  var old = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>'; }
  return promise.then(function (r) { if (btn) { btn.disabled = false; btn.innerHTML = old; } return r; },
    function (e) { if (btn) { btn.disabled = false; btn.innerHTML = old; } toast(e.message, true); throw e; });
}

function fmtTime(iso) { if (!iso) return '-'; var d = new Date(iso); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }
function fmtDateTime(iso) { if (!iso) return '-'; var d = new Date(iso); return d.getDate() + '/' + (d.getMonth() + 1) + ' ' + fmtTime(iso); }
function fmtMin(m) {
  m = Number(m) || 0;
  if (m < 60) return (Math.round(m * 10) / 10) + ' นาที';
  var h = Math.floor(m / 60); return h + ' ชม. ' + Math.round(m - h * 60) + ' นาที';
}
function fmtClock(ms) { var s = Math.max(0, Math.floor(ms / 1000)); var m = Math.floor(s / 60); s = s % 60; return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s; }
function fmtQty(q) { return Number(q || 0).toLocaleString('th-TH', { maximumFractionDigits: 3 }); }
function ymd(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
function whTh(w) { return WH_TH[w] ? WH_TH[w] : w; }
function locHtml(loc) {
  var th = LOC_TH[loc];
  return '<div class="loc' + (th ? ' common' : '') + '">' + esc(th || loc || '-') + (th ? '<small>' + esc(loc) + '</small>' : '') + '</div>';
}

// นาฬิกาจับเวลา: อัปเดตทุก element ที่มี data-since
setInterval(function () {
  document.querySelectorAll('[data-since]').forEach(function (el) {
    el.textContent = fmtClock(now() - new Date(el.getAttribute('data-since')).getTime());
  });
}, 1000);

// ======================= Routing =======================
window.addEventListener('hashchange', route);
function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }

function route() {
  clearInterval(S.refreshTimer);
  if (!S.token) return renderLogin();
  var h = location.hash.replace(/^#/, '') || 'jobs';
  var parts = h.split('/');
  var page = parts[0];
  if (page === 'job' && parts[1]) return renderJob(parts[1]);
  if (page === 'new' && can('leader')) return renderNewJob();
  if (page === 'dash' && can('leader')) return renderDashboard();
  if (page === 'users' && can('admin')) return renderUsers();
  return renderJobs();
}

function shell(active, content) {
  var nav = [['jobs', '📋', 'งาน', 'worker'], ['new', '➕', 'สร้างจ๊อบ', 'leader'], ['dash', '📊', 'สรุป', 'leader'], ['users', '👥', 'ผู้ใช้', 'admin']]
    .filter(function (n) { return can(n[3]); });
  $('#app').innerHTML =
    '<div class="topbar"><h1>WH Part Picking</h1><div class="who">' + esc(S.user.name) + '<br><span class="small">' + esc(S.user.emp_code) + '</span></div>' +
    '<button onclick="doLogout()">ออก</button></div>' +
    '<div id="activebar"></div>' +
    '<main id="main">' + content + '</main>' +
    (nav.length > 1 ? '<nav class="bottomnav">' + nav.map(function (n) {
      return '<a href="#' + n[0] + '" class="' + (n[0] === active ? 'on' : '') + '"><span class="ic">' + n[1] + '</span>' + n[2] + '</a>';
    }).join('') + '</nav>' : '');
  renderActiveBar();
}

function renderActiveBar() {
  var el = $('#activebar'); if (!el) return;
  var a = S.myActive;
  if (!a) { el.innerHTML = ''; return; }
  el.innerHTML = '<div class="activebar"><div class="info" onclick="go(\'#job/' + esc(a.job_id) + '\')">' +
    '<span class="small">กำลังจัด • ' + esc(LOC_TH[a.from_loc] || a.from_loc) + '</span><b>' + esc(a.part_code) + ' × ' + fmtQty(a.qty) + '</b></div>' +
    '<span class="timer" data-since="' + esc(a.started_at) + '">' + fmtClock(now() - new Date(a.started_at).getTime()) + '</span>' +
    '<button onclick="uiFinish(\'' + esc(a.line_id) + '\', this)">เสร็จ ✓</button></div>';
}

function refreshActive() {
  return authed('getMyActive').then(function (r) { setServerTime(r.serverNow); S.myActive = r.myActive; renderActiveBar(); });
}

// ======================= Login =======================
function renderLogin() {
  $('#app').innerHTML =
    '<div class="login"><div class="logo">📦</div><h1>WH Part Picking</h1>' +
    '<div class="card"><label class="f">รหัสพนักงาน</label>' +
    '<input id="lg-code" class="f" autocomplete="username" autocapitalize="characters" value="' + esc(store('whp_last_code') || '') + '">' +
    '<label class="f">PIN</label><input id="lg-pin" class="f pin" type="password" inputmode="numeric" autocomplete="current-password" maxlength="8">' +
    '<div style="height:14px"></div><button id="lg-btn" class="btn primary big">เข้าสู่ระบบ</button></div></div>';
  var btn = $('#lg-btn');
  function submit() {
    var code = $('#lg-code').value.trim(), pin = $('#lg-pin').value.trim();
    if (!code || !pin) return toast('กรุณาใส่รหัสพนักงานและ PIN', true);
    busy(btn, api('login', code, pin)).then(function (r) {
      S.token = r.token; S.user = r.user; store('whp_token', r.token); store('whp_last_code', code);
      start();
    }).catch(function () {});
  }
  btn.onclick = submit;
  $('#lg-pin').onkeydown = function (e) { if (e.key === 'Enter') submit(); };
  ($('#lg-code').value ? $('#lg-pin') : $('#lg-code')).focus();
}

function doLogout(silent) {
  if (!silent && S.token) api('logout', S.token).catch(function () {});
  S.token = null; S.user = null; S.myActive = null; store('whp_token', null);
  clearInterval(S.refreshTimer);
  renderLogin();
}

function start() {
  refreshActive().catch(function () {});
  route();
}

// ======================= รายการจ๊อบ =======================
function renderJobs() {
  shell('jobs', '<div class="tabs"><button data-f="active">กำลังดำเนินการ</button><button data-f="done">เสร็จแล้ว (3 วันล่าสุด)</button></div><div id="joblist"><div class="muted pad center">กำลังโหลด…</div></div>');
  document.querySelectorAll('.tabs button').forEach(function (b) {
    b.classList.toggle('on', b.getAttribute('data-f') === S.jobFilter);
    b.onclick = function () { S.jobFilter = b.getAttribute('data-f'); renderJobs(); };
  });
  function load() {
    return authed('listJobs', S.jobFilter).then(function (jobs) {
      var el = $('#joblist'); if (!el) return;
      if (!jobs.length) { el.innerHTML = '<div class="card center muted">' + (S.jobFilter === 'done' ? 'ยังไม่มีจ๊อบที่เสร็จ' : 'ยังไม่มีจ๊อบที่ต้องจัด') + (can('leader') && S.jobFilter !== 'done' ? '<br><br><a class="btn primary" href="#new">➕ สร้างจ๊อบใหม่</a>' : '') + '</div>'; return; }
      el.innerHTML = jobs.map(function (j) {
        var closed = j.done + j.issue, pct = j.line_count ? Math.round(closed / j.line_count * 100) : 0;
        return '<div class="card link" onclick="go(\'#job/' + esc(j.job_id) + '\')">' +
          '<div class="row"><h2 class="grow mono">' + esc(j.doc_no) + '</h2>' + statusBadge(j.status) + '</div>' +
          '<div class="small muted">' + esc(j.biz_type) + ' • ' + esc(j.biz_date) + ' • ' + esc(whTh(j.from_wh)) + ' → ' + esc(whTh(j.to_wh)) + '</div>' +
          '<div class="progress"><i style="width:' + pct + '%"></i></div>' +
          '<div class="row small"><span class="grow">เสร็จ ' + closed + '/' + j.line_count + ' รายการ' + (j.picking ? ' • กำลังจัด ' + j.picking : '') + (j.issue ? ' • ⚠ ปัญหา ' + j.issue : '') + '</span>' +
          (j.finished_at ? '<span class="muted">ใช้เวลา ' + fmtMin((new Date(j.finished_at) - new Date(j.started_at)) / 60000) + '</span>' : '') + '</div>' +
          (j.people.length ? '<div>' + j.people.map(function (p) { return '<span class="chip">👤 ' + esc(p) + '</span>'; }).join('') + '</div>' : '') +
          '</div>';
      }).join('');
    }).catch(function (e) { toast(e.message, true); });
  }
  load();
  S.refreshTimer = setInterval(function () { if (!document.hidden) load(); }, 20000);
}

function statusBadge(st) {
  var t = { open: 'รอเริ่ม', in_progress: 'กำลังจัด', done: 'เสร็จ', pending: 'รอจัด', picking: 'กำลังจัด', issue: 'มีปัญหา' }[st] || st;
  return '<span class="badge ' + esc(st) + '">' + t + '</span>';
}

// ======================= รายละเอียดจ๊อบ / จัดพาร์ท =======================
function renderJob(jobId) {
  shell('jobs', '<div id="jobhead"><div class="muted pad center">กำลังโหลด…</div></div><div id="lines"></div>');
  S.currentJob = jobId;
  loadJob(jobId);
  S.refreshTimer = setInterval(function () { if (!document.hidden) loadJob(jobId, true); }, 15000);
}

function loadJob(jobId, quiet) {
  return authed('getJob', jobId).then(function (r) {
    if (S.currentJob !== jobId || !$('#jobhead')) return;
    setServerTime(r.serverNow); S.myActive = r.myActive; renderActiveBar();
    S.jobData = r;
    drawJob();
  }).catch(function (e) { if (!quiet) toast(e.message, true); });
}

function drawJob() {
  var r = S.jobData, j = r.job, lines = r.lines;
  var counts = { todo: 0, picking: 0, done: 0, issue: 0, all: lines.length };
  lines.forEach(function (l) { if (l.status === 'pending') counts.todo++; else counts[l.status]++; });
  var closed = counts.done + counts.issue, pct = lines.length ? Math.round(closed / lines.length * 100) : 0;
  var canDelete = can('admin') && lines.every(function (l) { return l.status === 'pending'; });

  $('#jobhead').innerHTML =
    '<div class="row" style="margin:4px 0 8px"><a href="#jobs" class="btn sm">← กลับ</a><span class="grow"></span>' +
    (j.file_url && can('leader') ? String(j.file_url).split(/\s+/).filter(Boolean).map(function (u, k, all) {
      return '<a class="btn sm" target="_blank" href="' + esc(u) + '">📄 ไฟล์' + (all.length > 1 ? ' ' + (k + 1) : 'ต้นฉบับ') + '</a>';
    }).join('') : '') +
    (canDelete ? '<button class="btn sm danger" onclick="uiDeleteJob(\'' + esc(j.job_id) + '\', this)">ลบจ๊อบ</button>' : '') + '</div>' +
    '<div class="card"><div class="row"><h2 class="grow mono">' + esc(j.doc_no) + '</h2>' + statusBadge(j.status) + '</div>' +
    '<div class="small muted">' + esc(j.biz_type) + ' • ' + esc(j.biz_date) + ' • ' + esc(whTh(j.from_wh)) + ' → ' + esc(whTh(j.to_wh)) + '</div>' +
    '<div class="progress"><i style="width:' + pct + '%"></i></div>' +
    '<div class="small">เสร็จ ' + closed + '/' + lines.length + ' รายการ' +
    (j.started_at ? ' • เริ่ม ' + fmtTime(j.started_at) : '') + (j.finished_at ? ' • จบ ' + fmtTime(j.finished_at) + ' • ใช้เวลา ' + fmtMin((new Date(j.finished_at) - new Date(j.started_at)) / 60000) : '') + '</div>' +
    (j.people.length ? '<div>' + j.people.map(function (p) { return '<span class="chip">👤 ' + esc(p) + '</span>'; }).join('') + '</div>' : '') + '</div>' +
    '<div class="tabs">' + [['todo', 'รอจัด'], ['picking', 'กำลังจัด'], ['done', 'เสร็จ'], ['issue', 'ปัญหา'], ['all', 'ทั้งหมด']].map(function (t) {
      return '<button class="' + (S.lineFilter === t[0] ? 'on' : '') + '" onclick="S.lineFilter=\'' + t[0] + '\';drawJob()">' + t[1] + ' (' + counts[t[0]] + ')</button>';
    }).join('') + '</div>';

  var shown = lines.filter(function (l) {
    if (S.lineFilter === 'all') return true;
    if (S.lineFilter === 'todo') return l.status === 'pending' || (l.status === 'picking' && l.picked_by === S.user.emp_code);
    return l.status === S.lineFilter;
  }).sort(function (a, b) {
    var am = a.status === 'picking' && a.picked_by === S.user.emp_code ? 0 : 1;
    var bm = b.status === 'picking' && b.picked_by === S.user.emp_code ? 0 : 1;
    if (am !== bm) return am - bm;
    var ac = LOC_TH[a.from_loc] ? 1 : 0, bc = LOC_TH[b.from_loc] ? 1 : 0;   // ตำแหน่งชั้นวางก่อน ส่วนกลางทีหลัง
    if (ac !== bc) return ac - bc;
    return String(a.from_loc).localeCompare(String(b.from_loc)) || a.line_no - b.line_no;
  });

  $('#lines').innerHTML = shown.length ? shown.map(lineCard).join('') :
    '<div class="card center muted">' + (S.lineFilter === 'todo' && closed === lines.length ? '🎉 จัดครบทุกรายการแล้ว' : 'ไม่มีรายการ') + '</div>';
}

function lineCard(l) {
  var mine = l.status === 'picking' && l.picked_by === S.user.emp_code;
  var id = esc(l.line_id), act = '';
  if (l.status === 'pending') {
    act = '<button class="btn active grow" onclick="uiClaim(\'' + id + '\', this)">รับงาน ▶</button>';
  } else if (mine) {
    act = '<span class="badge picking">⏱ <span data-since="' + esc(l.started_at) + '"></span></span><span class="grow"></span>' +
      '<button class="btn sm" onclick="uiRelease(\'' + id + '\', this)">ยกเลิก</button>' +
      '<button class="btn sm warn" onclick="issueLine(\'' + id + '\', this)">⚠ ปัญหา</button>' +
      '<button class="btn ok" onclick="uiFinish(\'' + id + '\', this)">เสร็จ ✓</button>';
  } else if (l.status === 'picking') {
    act = '<span class="small">👤 ' + esc(l.picked_name) + ' กำลังจัด • <span data-since="' + esc(l.started_at) + '"></span></span><span class="grow"></span>' +
      (can('leader') ? '<button class="btn sm" onclick="uiRelease(\'' + id + '\', this)">ปลดงาน</button>' : '');
  } else if (l.status === 'done') {
    act = '<span class="small">✓ ' + esc(l.picked_name) + ' • ' + fmtTime(l.started_at) + '–' + fmtTime(l.finished_at) + ' • <b>' + fmtMin(l.minutes) + '</b></span>' +
      (can('leader') ? '<span class="grow"></span><button class="btn sm" onclick="uiReset(\'' + id + '\', this)">เปิดใหม่</button>' : '');
  } else if (l.status === 'issue') {
    act = '<span class="small">⚠ ' + esc(l.picked_name) + ': <b>' + esc(l.issue_note) + '</b> • ' + fmtMin(l.minutes) + '</span>' +
      (can('leader') ? '<span class="grow"></span><button class="btn sm" onclick="uiReset(\'' + id + '\', this)">เปิดให้จัดใหม่</button>' : '');
  }
  return '<div class="card st-' + (mine ? 'mine' : l.status) + '"><div class="line">' + locHtml(l.from_loc) +
    '<div class="body"><div class="row"><span class="code mono grow">' + esc(l.part_code) + '</span><span class="qty">' + fmtQty(l.qty) + '</span></div>' +
    '<div class="name">' + esc(l.part_name) + '</div>' +
    '<div class="meta">' + esc(l.spec) + ' • ล็อต <span class="mono">' + esc(l.batch_no) + '</span> • #' + l.line_no + '</div></div></div>' +
    '<div class="line-status">' + act + '</div></div>';
}

function afterLineChange() {
  if (S.currentJob && $('#lines')) return loadJob(S.currentJob, true);
  return refreshActive();
}
function uiClaim(id, btn) { busy(btn, authed('claimLine', id)).then(function () { toast('เริ่มจับเวลาแล้ว'); afterLineChange(); }).catch(function () { afterLineChange(); }); }
function uiFinish(id, btn) { busy(btn, authed('finishLine', id)).then(function (l) { toast('บันทึกแล้ว • ' + fmtMin(l.minutes)); S.myActive = null; renderActiveBar(); afterLineChange(); }).catch(function () {}); }
function uiRelease(id, btn) { if (!confirm('ยกเลิกการรับงานรายการนี้? (เวลาที่จับไว้จะไม่ถูกบันทึก)')) return; busy(btn, authed('releaseLine', id)).then(afterLineChange).catch(function () {}); }
function uiReset(id, btn) { if (!confirm('เปิดรายการนี้ให้จัดใหม่? (ข้อมูลเวลาเดิมของรายการนี้จะถูกล้าง)')) return; busy(btn, authed('resetLine', id)).then(afterLineChange).catch(function () {}); }
function issueLine(id, btn) {
  var pick = prompt('ปัญหาที่พบ (พิมพ์หมายเลข หรือพิมพ์ข้อความเอง)\n' + ISSUE_REASONS.map(function (r, i) { return (i + 1) + ') ' + r; }).join('\n'));
  if (pick == null || !pick.trim()) return;
  var note = ISSUE_REASONS[Number(pick) - 1] || pick.trim();
  busy(btn, authed('reportIssue', id, note)).then(function () { toast('แจ้งปัญหาแล้ว'); S.myActive = null; renderActiveBar(); afterLineChange(); }).catch(function () {});
}
function uiDeleteJob(id, btn) {
  if (!confirm('ลบจ๊อบนี้ทั้งหมด?')) return;
  busy(btn, authed('deleteJob', id)).then(function () { toast('ลบแล้ว'); go('#jobs'); }).catch(function () {});
}

// ======================= สร้างจ๊อบ (หลายไฟล์ / หลายเอกสาร) =======================
// ไฟล์ที่เลือกจะถูกจัดกลุ่มตามเลขที่เอกสาร: เลขต่างกัน = คนละจ๊อบ, เลขเดียวกัน = รวมเป็นจ๊อบเดียว
S.drafts = S.drafts || [];
S.openDraft = -1;

function renderNewJob() {
  shell('new',
    '<div class="section-title">สร้างจ๊อบจากใบโอนย้าย (直接调拨单)</div>' +
    '<div class="drop"><div class="row wrap" style="justify-content:center">' +
    '<label class="btn primary">📄 เลือกไฟล์ PDF<input id="nj-pdf" type="file" accept="application/pdf" multiple class="hidden"></label>' +
    '<label class="btn">📷 ถ่ายรูป / เลือกรูป<input id="nj-img" type="file" accept="image/*" multiple class="hidden"></label>' +
    '<button class="btn" id="nj-manual">✏️ กรอกเอง</button></div>' +
    '<div class="small muted" style="margin-top:8px">เลือกได้หลายไฟล์พร้อมกัน • ระบบแยกจ๊อบตามเลขที่เอกสารให้อัตโนมัติ (ไฟล์เลขเดียวกันจะรวมเป็นจ๊อบเดียว)<br>PDF จาก Kingdee อ่านได้แม่นยำ • รูปถ่ายใช้ OCR ต้องตรวจทานก่อนบันทึก</div></div>' +
    '<div id="nj-status"></div><div id="nj-form"></div>');
  $('#nj-pdf').onchange = function (e) { var fs = Array.prototype.slice.call(e.target.files); e.target.value = ''; if (fs.length) loadFiles(fs, 'pdf'); };
  $('#nj-img').onchange = function (e) { var fs = Array.prototype.slice.call(e.target.files); e.target.value = ''; if (fs.length) loadFiles(fs, 'ocr'); };
  $('#nj-manual').onclick = function () {
    S.drafts.push({ doc_no: '', biz_type: '', biz_date: ymd(new Date()), rows: [emptyRow()], files: [], source: 'manual' });
    S.openDraft = S.drafts.length - 1; drawDrafts();
  };
  drawDrafts();
}

function emptyRow() { return { part_code: '', part_name: '', spec: '', batch_no: '', qty: 0, from_wh: '', from_loc: '', to_wh: '', to_loc: '' }; }
function njStatus(html) { var el = $('#nj-status'); if (el) el.innerHTML = html ? '<div class="card">' + html + '</div>' : ''; }

function readAsBase64(file) {
  return new Promise(function (res, rej) {
    var fr = new FileReader(); fr.onload = function () { res(String(fr.result).split(',')[1]); }; fr.onerror = rej; fr.readAsDataURL(file);
  });
}

function shrinkImage(file, maxSide) {
  return new Promise(function (res, rej) {
    var img = new Image(); var url = URL.createObjectURL(file);
    img.onload = function () {
      var k = Math.min(1, maxSide / Math.max(img.width, img.height));
      var c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      res(c.toDataURL('image/jpeg', 0.85).split(',')[1]);
    };
    img.onerror = rej; img.src = url;
  });
}

/** อ่านไฟล์ทีละไฟล์ แล้วจัดเข้ากลุ่มตามเลขที่เอกสาร */
function loadFiles(files, kind) {
  var notes = [], lastOcr = null, i = 0;
  function step() {
    if (i >= files.length) {
      njStatus(notes.join('<br>'));
      drawDrafts();
      return;
    }
    var file = files[i++];
    njStatus('<span class="spinner"></span> กำลังอ่านไฟล์ ' + i + '/' + files.length + ': ' + esc(file.name) + (kind === 'ocr' ? ' (OCR อาจใช้ 10-20 วินาที/รูป)' : ''));
    var p = kind === 'pdf' ? readPdfFile(file) : readImageFile(file);
    p.then(function (r) {
      if (!r.res.rows.length && kind === 'pdf') {
        notes.push('⚠ ' + esc(file.name) + ': ไม่พบตารางรายการพาร์ท (อาจเป็น PDF ที่สแกนเป็นรูป) — ลองใช้ "ถ่ายรูป / เลือกรูป"');
        return;
      }
      var d = addToDrafts(r.res, r.file, kind, kind === 'ocr' ? lastOcr : null);
      if (kind === 'ocr') lastOcr = d;
      notes.push((kind === 'pdf' ? '✅ ' : '⚠ ') + esc(file.name) + ' → ' + esc(d.doc_no || '(ไม่พบเลขที่เอกสาร)') + ' อ่านได้ ' + r.res.rows.length + ' รายการ' +
        (kind === 'ocr' ? ' — <b>ต้องตรวจทุกช่อง</b>' : ''));
    }).catch(function (e) {
      notes.push('❌ ' + esc(file.name) + ': ' + esc(e.message));
    }).then(step);
  }
  step();
}

function readPdfFile(file) {
  return file.arrayBuffer().then(function (b) { return parseKingdeePdf(b.slice(0), pdfjsLib); }).then(function (res) {
    return readAsBase64(file).then(function (b64) { return { res: res, file: { name: file.name, mimeType: 'application/pdf', base64: b64 } }; });
  });
}

function readImageFile(file) {
  return shrinkImage(file, 2000).then(function (b64) {
    var f = { name: (file.name || 'photo').replace(/\.\w+$/, '') + '.jpg', mimeType: 'image/jpeg', base64: b64 };
    return authed('ocrImage', f).then(function (text) { return { res: parseKingdeeText(text || ''), file: f }; });
  });
}

/** ใส่ผลการอ่านเข้ากลุ่มเอกสารเดิม (เลขเดียวกัน) หรือสร้างกลุ่มใหม่ */
function addToDrafts(res, file, source, fallback) {
  var key = String(res.doc_no || '').trim();
  var d = key ? S.drafts.filter(function (x) { return x.doc_no.trim() === key; })[0] : null;
  if (!d && !key && fallback) d = fallback;           // รูปหน้าถัดไปที่อ่านเลขเอกสารไม่ได้ → รวมกับรูปก่อนหน้า
  if (d) {
    if (d.files.some(function (f) { return f.name === file.name && f.base64.length === file.base64.length; })) return d; // เลือกไฟล์ซ้ำ
    if (d.rows.length === 1 && !d.rows[0].part_code) d.rows = [];
    d.rows = d.rows.concat(res.rows);
    d.files.push(file);
    if (!d.doc_no && key) d.doc_no = key;
    d.biz_type = d.biz_type || res.biz_type; d.biz_date = d.biz_date || res.biz_date;
    return d;
  }
  d = { doc_no: key, biz_type: res.biz_type || '', biz_date: res.biz_date || ymd(new Date()),
        rows: res.rows.length ? res.rows : [emptyRow()], files: [file], source: source };
  S.drafts.push(d);
  return d;
}

var DRAFT_COLS = [['part_code', 'รหัสพาร์ท'], ['part_name', 'ชื่อ'], ['spec', 'สเปค'], ['batch_no', 'ล็อต'], ['qty', 'จำนวน'], ['from_loc', 'ตำแหน่ง'], ['from_wh', 'คลังต้นทาง'], ['to_wh', 'คลังปลายทาง']];

function drawDrafts() {
  var el = $('#nj-form'); if (!el) return;
  var ds = S.drafts;
  if (!ds.length) { el.innerHTML = ''; return; }
  var totalRows = ds.reduce(function (s, d) { return s + d.rows.length; }, 0);

  el.innerHTML =
    '<div class="row wrap" style="margin:14px 2px 8px"><b class="grow">' + ds.length + ' เอกสาร • ' + totalRows + ' รายการ</b>' +
    '<button class="btn sm" id="nj-clear">ล้างทั้งหมด</button>' +
    '<button class="btn primary" id="nj-save">💾 บันทึก' + (ds.length > 1 ? 'ทั้งหมด ' + ds.length + ' จ๊อบ' : 'จ๊อบ') + '</button></div>' +
    ds.map(draftCard).join('');

  el.querySelectorAll('[data-h]').forEach(function (inp) {
    inp.oninput = function () { ds[+inp.getAttribute('data-d')][inp.getAttribute('data-h')] = inp.value; };
  });
  el.querySelectorAll('[data-r]').forEach(function (inp) {
    inp.oninput = function () {
      var k = inp.getAttribute('data-k');
      ds[S.openDraft].rows[+inp.getAttribute('data-r')][k] = k === 'qty' ? inp.value.replace(/[^\d.]/g, '') : inp.value;
    };
  });
  el.querySelectorAll('[data-toggle]').forEach(function (b) {
    b.onclick = function () { var i = +b.getAttribute('data-toggle'); S.openDraft = S.openDraft === i ? -1 : i; drawDrafts(); };
  });
  el.querySelectorAll('[data-remove]').forEach(function (b) {
    b.onclick = function () {
      var i = +b.getAttribute('data-remove');
      if (!confirm('นำเอกสาร ' + (ds[i].doc_no || '#' + (i + 1)) + ' ออก?')) return;
      ds.splice(i, 1); S.openDraft = -1; drawDrafts();
    };
  });
  el.querySelectorAll('[data-rmfile]').forEach(function (b) {
    b.onclick = function () { var p = b.getAttribute('data-rmfile').split(':'); ds[+p[0]].files.splice(+p[1], 1); drawDrafts(); };
  });
  el.querySelectorAll('[data-del]').forEach(function (b) {
    b.onclick = function () { ds[S.openDraft].rows.splice(+b.getAttribute('data-del'), 1); drawDrafts(); };
  });
  var add = $('#nj-add');
  if (add) add.onclick = function () {
    var d = ds[S.openDraft], last = d.rows[d.rows.length - 1] || emptyRow(), r = emptyRow();
    r.from_wh = last.from_wh; r.to_wh = last.to_wh; d.rows.push(r); drawDrafts();
  };
  $('#nj-clear').onclick = function () { if (!confirm('ล้างเอกสารทั้งหมดที่ยังไม่บันทึก?')) return; S.drafts = []; S.openDraft = -1; njStatus(''); drawDrafts(); };
  $('#nj-save').onclick = function () { saveAllDrafts(this); };
}

function draftCard(d, i) {
  var totalQty = d.rows.reduce(function (s, r) { return s + (Number(r.qty) || 0); }, 0);
  var open = S.openDraft === i;
  var html = '<div class="card"' + (d.error ? ' style="border-color:var(--bad)"' : '') + '>' +
    '<div class="row wrap">' +
    '<div class="grow" style="min-width:200px"><label class="f">เลขที่เอกสาร</label><input class="f mono" data-d="' + i + '" data-h="doc_no" value="' + esc(d.doc_no) + '"></div>' +
    '<div class="grow"><label class="f">ประเภท</label><input class="f" data-d="' + i + '" data-h="biz_type" value="' + esc(d.biz_type) + '"></div>' +
    '<div class="grow"><label class="f">วันที่เอกสาร</label><input class="f" type="date" data-d="' + i + '" data-h="biz_date" value="' + esc(d.biz_date) + '"></div></div>' +
    '<div class="small muted" style="margin-top:8px">' + d.rows.length + ' รายการ • จำนวนรวม ' + fmtQty(totalQty) +
    (d.source === 'ocr' ? ' • <span style="color:var(--warn)">อ่านจากรูป ต้องตรวจทาน</span>' : '') + '</div>' +
    (d.files.length ? '<div style="margin-top:6px">' + d.files.map(function (f, j) {
      return '<span class="chip">📎 ' + esc(f.name) + ' <a href="javascript:void 0" data-rmfile="' + i + ':' + j + '" title="ไม่แนบไฟล์นี้">✕</a></span>';
    }).join('') + '</div>' : '') +
    (d.error ? '<div class="small" style="color:var(--bad);margin-top:6px">❌ ' + esc(d.error) + '</div>' : '') +
    '<div class="row" style="margin-top:10px"><button class="btn sm" data-toggle="' + i + '">' + (open ? '▲ ซ่อนรายการ' : '▼ ดู / แก้ไขรายการ (' + d.rows.length + ')') + '</button>' +
    '<span class="grow"></span><button class="btn sm danger" data-remove="' + i + '">นำออก</button></div></div>';
  if (open) {
    html += '<div class="tablewrap"><table class="edit"><thead><tr><th>#</th>' + DRAFT_COLS.map(function (c) { return '<th>' + c[1] + '</th>'; }).join('') + '<th></th></tr></thead><tbody>' +
      d.rows.map(function (r, k) {
        return '<tr><td class="muted">' + (k + 1) + '</td>' + DRAFT_COLS.map(function (c) {
          return '<td><input data-r="' + k + '" data-k="' + c[0] + '" value="' + esc(r[c[0]]) + '"' + (c[0] === 'qty' ? ' inputmode="decimal" style="width:90px"' : '') + (c[0] === 'part_name' ? ' style="min-width:200px"' : '') + '></td>';
        }).join('') + '<td><button class="btn sm danger" data-del="' + k + '">✕</button></td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<div class="row" style="margin:-2px 0 12px"><button class="btn sm" id="nj-add">+ เพิ่มแถว</button></div>';
  }
  return html;
}

function saveAllDrafts(btn) {
  var ds = S.drafts;
  var problems = [];
  ds.forEach(function (d, i) {
    d.rows = d.rows.filter(function (r) { return String(r.part_code).trim(); });
    var name = d.doc_no || 'เอกสารที่ ' + (i + 1);
    if (!d.doc_no.trim()) problems.push(name + ': ยังไม่ใส่เลขที่เอกสาร');
    else if (!d.rows.length) problems.push(name + ': ไม่มีรายการพาร์ท');
  });
  var seen = {};
  ds.forEach(function (d) { var k = d.doc_no.trim(); if (k && seen[k]) problems.push(k + ': เลขที่เอกสารซ้ำกันในรายการนี้'); seen[k] = 1; });
  if (problems.length) { drawDrafts(); return toast(problems[0], true); }
  var zero = ds.reduce(function (s, d) { return s + d.rows.filter(function (r) { return !(Number(r.qty) > 0); }).length; }, 0);
  if (zero && !confirm('มี ' + zero + ' รายการที่จำนวนเป็น 0 ต้องการบันทึกต่อหรือไม่?')) return;

  var created = [];
  var chain = Promise.resolve();
  ds.forEach(function (d, i) {
    chain = chain.then(function () {
      njStatus('<span class="spinner"></span> กำลังบันทึก ' + esc(d.doc_no) + ' (' + (i + 1) + '/' + ds.length + ')…');
      return authed('createJob', { doc_no: d.doc_no.trim(), biz_type: d.biz_type, biz_date: d.biz_date, rows: d.rows, files: d.files })
        .then(function (r) { created.push(r.job_id); d.saved = true; d.error = ''; },
              function (e) { d.error = e.message; });
    });
  });
  busy(btn, chain.then(function () {
    S.drafts = ds.filter(function (d) { return !d.saved; });
    S.openDraft = -1;
    if (!S.drafts.length) {
      njStatus('');
      toast('สร้างแล้ว ' + created.length + ' จ๊อบ');
      go(created.length === 1 ? '#job/' + created[0] : '#jobs');
    } else {
      njStatus((created.length ? '✅ บันทึกแล้ว ' + created.length + ' จ๊อบ • ' : '') + '❌ ยังบันทึกไม่ได้ ' + S.drafts.length + ' เอกสาร (ดูข้อความสีแดง)');
      drawDrafts();
    }
  })).catch(function () {});
}

// ======================= Dashboard =======================
function renderDashboard() {
  var today = ymd(new Date());
  S.dashFrom = S.dashFrom || today; S.dashTo = S.dashTo || today;
  shell('dash',
    '<div class="card"><div class="row wrap">' +
    '<div class="grow"><label class="f">ตั้งแต่</label><input id="d-from" class="f" type="date" value="' + S.dashFrom + '"></div>' +
    '<div class="grow"><label class="f">ถึง</label><input id="d-to" class="f" type="date" value="' + S.dashTo + '"></div></div>' +
    '<div class="row wrap" style="margin-top:10px"><button class="btn sm" data-q="0">วันนี้</button><button class="btn sm" data-q="6">7 วัน</button><button class="btn sm" data-q="29">30 วัน</button>' +
    '<span class="grow"></span><button class="btn sm primary" id="d-go">แสดง</button></div></div><div id="dash"></div>');
  function load(btn) {
    S.dashFrom = $('#d-from').value; S.dashTo = $('#d-to').value;
    $('#dash').innerHTML = '<div class="muted pad center">กำลังคำนวณ…</div>';
    busy(btn, authed('getDashboard', S.dashFrom, S.dashTo)).then(drawDashboard).catch(function () {});
  }
  document.querySelectorAll('[data-q]').forEach(function (b) {
    b.onclick = function () { var d = new Date(); d.setDate(d.getDate() - Number(b.getAttribute('data-q'))); $('#d-from').value = ymd(d); $('#d-to').value = today; load(); };
  });
  $('#d-go').onclick = function () { load(this); };
  load();
}

function drawDashboard(r) {
  S.dashData = r;
  var t = r.totals, st = r.settings;
  var cap = st.work_minutes_per_shift * st.efficiency;
  var html =
    '<div class="kpis">' +
    kpi(fmtMin(t.man_min), 'Man-hour รวม (เวลาจัดพาร์ทจริง)') +
    kpi(t.lines + (t.issues ? ' <span class="small" style="color:var(--warn)">⚠' + t.issues + '</span>' : ''), 'รายการที่จัดเสร็จ') +
    kpi(t.jobs_done, 'จ๊อบที่เสร็จ') +
    kpi(fmtMin(t.avg_lead_min), 'Lead time เฉลี่ย / จ๊อบ') +
    kpi(fmtMin(t.avg_min_per_line), 'เวลาเฉลี่ย / รายการ') +
    kpi(t.avg_required_per_shift.toFixed(2) + ' คน', 'คนที่ต้องใช้ / กะ (เฉลี่ย)', true) +
    kpi(t.peak_required_per_shift.toFixed(2) + ' คน', 'คนที่ต้องใช้ / กะ (วันที่หนักสุด)', true) +
    kpi(st.headcount_per_shift + ' คน', 'คนที่มีจริง / กะ') +
    '</div>' +
    '<div class="small muted pad">สูตร: คนที่ต้องใช้/กะ = Man-minute ต่อวัน ÷ ' + st.shifts_per_day + ' กะ ÷ (' + st.work_minutes_per_shift + ' นาที × ' + Math.round(st.efficiency * 100) + '%) = Man-minute ÷ ' + Math.round(cap * st.shifts_per_day) + '</div>' +
    '<div class="row"><div class="section-title grow">รายวัน</div><button class="btn sm" onclick="exportCsv()">⬇ ดาวน์โหลด CSV</button></div>' +
    table(['วันที่', 'รายการ', 'Man-hour', 'คนที่มาจัด', 'คนที่ต้องใช้/กะ', 'อัตราใช้งานคน'], r.days.map(function (d) {
      return [d.date, d.lines + (d.issues ? ' (⚠' + d.issues + ')' : ''), fmtMin(d.man_min), d.people, '<b>' + d.required_per_shift.toFixed(2) + '</b>', Math.round(d.utilization * 100) + '%'];
    }), [1, 2, 3, 4, 5]) +
    '<div class="section-title">รายบุคคล</div>' +
    table(['ชื่อ', 'รายการ', 'Man-hour', 'นาที/รายการ', 'รายการ/ชม.', 'ปัญหา'], r.workers.map(function (w) {
      return [esc(w.name) + ' <span class="muted small">' + esc(w.emp_code) + '</span>', w.lines, fmtMin(w.man_min), w.avg_min, w.lines_per_hour, w.issues || ''];
    }), [1, 2, 3, 4, 5]) +
    '<div class="section-title">รายจ๊อบ (ที่เสร็จในช่วงนี้)</div>' +
    table(['เอกสาร', 'รายการ', 'รอเริ่ม', 'Lead time', 'Man-hour', 'จำนวนคน', 'ผู้จัด'], r.jobs.map(function (j) {
      return ['<a href="#job/' + esc(j.job_id) + '" class="mono">' + esc(j.doc_no) + '</a>', j.lines, fmtMin(j.wait_min), '<b>' + fmtMin(j.lead_min) + '</b>', fmtMin(j.man_min), j.people.length, esc(j.people.join(', '))];
    }), [1, 2, 3, 4, 5]);
  if (r.issues.length) {
    html += '<div class="section-title">ปัญหาที่แจ้ง</div>' + table(['เวลา', 'เอกสาร', 'พาร์ท', 'ตำแหน่ง', 'ผู้แจ้ง', 'ปัญหา'], r.issues.map(function (l) {
      return [fmtDateTime(l.finished_at), esc(l.doc_no), esc(l.part_code), esc(l.from_loc), esc(l.picked_name), esc(l.issue_note)];
    }), []);
  }
  if (can('admin')) html += settingsForm(st);
  $('#dash').innerHTML = html;
  var sf = $('#set-save');
  if (sf) sf.onclick = function () {
    var v = {}; document.querySelectorAll('[data-set]').forEach(function (i) { v[i.getAttribute('data-set')] = i.value; });
    busy(sf, authed('saveSettings', v)).then(function () { toast('บันทึกค่าแล้ว'); renderDashboard(); }).catch(function () {});
  };
}

function kpi(v, l, hl) { return '<div class="kpi' + (hl ? ' hl' : '') + '"><div class="v">' + v + '</div><div class="l">' + l + '</div></div>'; }
function table(heads, rows, numCols) {
  if (!rows.length) return '<div class="card center muted small">ไม่มีข้อมูล</div>';
  return '<div class="tablewrap"><table><thead><tr>' + heads.map(function (h, i) { return '<th class="' + (numCols.indexOf(i) >= 0 ? 'num' : '') + '">' + h + '</th>'; }).join('') +
    '</tr></thead><tbody>' + rows.map(function (r) { return '<tr>' + r.map(function (c, i) { return '<td class="' + (numCols.indexOf(i) >= 0 ? 'num' : '') + '">' + c + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>';
}

function settingsForm(st) {
  var f = [['work_minutes_per_shift', 'เวลาทำงานจริงต่อกะ (นาที)'], ['efficiency', 'ประสิทธิภาพเป้าหมาย (0-1)'], ['shifts_per_day', 'จำนวนกะต่อวัน'], ['headcount_per_shift', 'คนจัดพาร์ทต่อกะ (ปัจจุบัน)']];
  return '<div class="section-title">ตั้งค่าการคำนวณ</div><div class="card"><div class="row wrap">' + f.map(function (x) {
    return '<div class="grow" style="min-width:140px"><label class="f">' + x[1] + '</label><input class="f" inputmode="decimal" data-set="' + x[0] + '" value="' + esc(st[x[0]]) + '"></div>';
  }).join('') + '</div><div style="height:10px"></div><button class="btn primary" id="set-save">บันทึกค่า</button></div>';
}

function exportCsv() {
  var r = S.dashData; if (!r) return;
  var cols = ['doc_no', 'line_no', 'part_code', 'part_name', 'spec', 'batch_no', 'qty', 'from_loc', 'status', 'picked_by', 'picked_name', 'started_at', 'finished_at', 'minutes', 'issue_note'];
  var lines = [cols.join(',')].concat(r.lines.map(function (l) {
    return cols.map(function (c) {
      var v = l[c]; if (c === 'started_at' || c === 'finished_at') v = v ? fmtLocalIso(v) : '';
      return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    }).join(',');
  }));
  var blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'wh-picking_' + S.dashFrom + '_' + S.dashTo + '.csv';
  document.body.appendChild(a); a.click(); a.remove();
}
function fmtLocalIso(iso) { var d = new Date(iso); return ymd(d) + ' ' + fmtTime(iso) + ':' + ('0' + d.getSeconds()).slice(-2); }

// ======================= จัดการผู้ใช้ =======================
function renderUsers() {
  shell('users', '<div class="section-title">เพิ่ม / แก้ไขผู้ใช้</div><div class="card" id="u-form"></div><div class="section-title">ผู้ใช้ทั้งหมด</div><div id="u-list"><div class="muted pad center">กำลังโหลด…</div></div>');
  drawUserForm({ emp_code: '', name: '', role: 'worker', active: true }, true);
  loadUsers();
}

function loadUsers() {
  authed('listUsers').then(function (users) {
    S.users = users;
    var roleTh = { worker: 'พนักงาน', leader: 'หัวหน้า', admin: 'ผู้ดูแล' };
    $('#u-list').innerHTML = table(['รหัส', 'ชื่อ', 'สิทธิ์', 'สถานะ', ''], users.map(function (u, i) {
      return ['<span class="mono">' + esc(u.emp_code) + '</span>', esc(u.name), roleTh[u.role] || u.role, u.active ? '✅ ใช้งาน' : '⛔ ปิด',
        '<button class="btn sm" onclick="drawUserForm(S.users[' + i + '], false)">แก้ไข</button>'];
    }), []);
  }).catch(function (e) { toast(e.message, true); });
}

function drawUserForm(u, isNew) {
  $('#u-form').innerHTML =
    '<div class="row wrap"><div class="grow"><label class="f">รหัสพนักงาน</label><input id="u-code" class="f mono" autocapitalize="characters" value="' + esc(u.emp_code) + '"' + (isNew ? '' : ' readonly') + '></div>' +
    '<div class="grow"><label class="f">ชื่อ-นามสกุล</label><input id="u-name" class="f" value="' + esc(u.name) + '"></div></div>' +
    '<div class="row wrap"><div class="grow"><label class="f">สิทธิ์</label><select id="u-role" class="f">' +
    [['worker', 'พนักงานจัดพาร์ท'], ['leader', 'หัวหน้า (สร้างจ๊อบ / ดูสรุป)'], ['admin', 'ผู้ดูแลระบบ']].map(function (r) { return '<option value="' + r[0] + '"' + (u.role === r[0] ? ' selected' : '') + '>' + r[1] + '</option>'; }).join('') + '</select></div>' +
    '<div class="grow"><label class="f">' + (isNew ? 'ตั้ง PIN (4-8 หลัก)' : 'PIN ใหม่ (เว้นว่าง = ไม่เปลี่ยน)') + '</label><input id="u-pin" class="f pin" type="password" inputmode="numeric" maxlength="8" autocomplete="new-password"></div></div>' +
    '<label class="row" style="margin-top:12px"><input type="checkbox" id="u-active"' + (u.active ? ' checked' : '') + '> เปิดใช้งาน</label>' +
    '<div class="row" style="margin-top:12px">' + (isNew ? '' : '<button class="btn" onclick="drawUserForm({emp_code:\'\',name:\'\',role:\'worker\',active:true}, true)">ยกเลิก</button>') +
    '<span class="grow"></span><button class="btn primary" id="u-save">' + (isNew ? 'เพิ่มผู้ใช้' : 'บันทึก') + '</button></div>';
  $('#u-save').onclick = function () {
    var data = { emp_code: $('#u-code').value.trim(), name: $('#u-name').value.trim(), role: $('#u-role').value, active: $('#u-active').checked, pin: $('#u-pin').value.trim() };
    busy(this, authed('saveUser', data)).then(function () { toast('บันทึกแล้ว'); drawUserForm({ emp_code: '', name: '', role: 'worker', active: true }, true); loadUsers(); }).catch(function () {});
  };
  if (!isNew) $('#u-name').focus();
}

// ======================= เริ่มต้น =======================
function renderApiSetup() {
  $('#app').innerHTML =
    '<div class="login"><div class="logo">⚙️</div><h1>ตั้งค่าการเชื่อมต่อ</h1>' +
    '<div class="card"><label class="f">Apps Script Web App URL (ลงท้ายด้วย /exec)</label>' +
    '<input id="api-url" class="f mono" placeholder="https://script.google.com/macros/s/.../exec">' +
    '<div style="height:14px"></div><button id="api-save" class="btn primary big">บันทึก</button>' +
    '<div class="small muted" style="margin-top:10px">ปกติผู้ดูแลจะใส่ไว้ใน js/config.js แล้ว หน้านี้ใช้ชั่วคราวเท่านั้น</div></div></div>';
  $('#api-save').onclick = function () {
    var u = $('#api-url').value.trim();
    if (!/^https:\/\/script\.google\.com\/.+\/exec$/.test(u)) return toast('URL ไม่ถูกต้อง ต้องขึ้นต้น https://script.google.com/ และลงท้าย /exec', true);
    store('whp_api_url', u); location.reload();
  };
}

(function init() {
  if (!apiUrl()) return renderApiSetup();
  var t = store('whp_token');
  if (!t) return renderLogin();
  S.token = t;
  api('whoami', t).then(function (u) { S.user = u; start(); }).catch(function () { S.token = null; store('whp_token', null); renderLogin(); });
})();
