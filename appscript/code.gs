/**
 * WH Part Picking — ระบบติดตามการจัดพาร์ทตามใบโอนย้าย (直接调拨单)
 * Backend: Google Apps Script + Google Sheets
 */

// ======================= ค่าคงที่ =======================
const SHEETS = {
  Users:    ['emp_code', 'name', 'role', 'pin_hash', 'salt', 'active', 'created_at'],
  Jobs:     ['job_id', 'doc_no', 'biz_type', 'biz_date', 'from_wh', 'to_wh', 'line_count', 'status',
             'file_url', 'created_by', 'created_at', 'started_at', 'finished_at'],
  Lines:    ['line_id', 'job_id', 'doc_no', 'line_no', 'part_code', 'part_name', 'spec', 'batch_no', 'qty',
             'from_wh', 'from_loc', 'to_wh', 'status', 'picked_by', 'picked_name',
             'started_at', 'finished_at', 'minutes', 'issue_note'],
  Settings: ['key', 'value', 'description']
};

const DEFAULT_SETTINGS = [
  ['work_minutes_per_shift', 450, 'เวลาทำงานจริงต่อกะ (นาที) ไม่รวมพัก'],
  ['efficiency', 0.85, 'สัดส่วนเวลาที่ใช้จัดพาร์ทได้จริง (0-1)'],
  ['shifts_per_day', 2, 'จำนวนกะต่อวัน'],
  ['headcount_per_shift', 4, 'จำนวนพนักงานจัดพาร์ทต่อกะ (ปัจจุบัน)']
];

// คอลัมน์ที่ต้องเก็บเป็นข้อความ (กันเลข 0 นำหน้าหาย / กันแปลงเป็นวันที่)
const TEXT_COLS = {
  Users: ['emp_code', 'pin_hash', 'salt'],
  Jobs:  ['job_id', 'doc_no', 'biz_date'],
  Lines: ['line_id', 'job_id', 'doc_no', 'part_code', 'spec', 'batch_no', 'from_loc', 'picked_by']
};

const ROLES = ['worker', 'leader', 'admin'];
const SESSION_HOURS = 14;
const TZ = 'Asia/Bangkok';

// ======================= Web App (JSON API ให้หน้าเว็บบน GitHub Pages เรียก) =======================
// หน้าเว็บส่ง POST { action, args: [...] } แบบ text/plain → ตอบกลับ { ok, data } หรือ { ok:false, error }
const API_ACTIONS = {
  login: login, whoami: whoami, logout: logout,
  listJobs: listJobs, getJob: getJob, getMyActive: getMyActive,
  createJob: createJob, deleteJob: deleteJob, ocrImage: ocrImage,
  claimLine: claimLine, finishLine: finishLine, reportIssue: reportIssue,
  releaseLine: releaseLine, resetLine: resetLine,
  getDashboard: getDashboard, getSettings: getSettings, saveSettings: saveSettings,
  listUsers: listUsers, saveUser: saveUser
};

function doPost(e) {
  let out;
  try {
    const req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const fn = API_ACTIONS[req.action];
    if (!fn) throw new Error('ไม่รู้จักคำสั่ง: ' + req.action);
    out = { ok: true, data: fn.apply(null, Array.isArray(req.args) ? req.args : []) };
  } catch (err) {
    out = { ok: false, error: (err && err.message) || String(err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

/** เปิด /exec ในเบราว์เซอร์เพื่อเช็คว่า API ทำงาน */
function doGet() {
  return ContentService.createTextOutput(JSON.stringify({ ok: true, app: 'WH Part Picking API', time: new Date().toISOString() }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ======================= เมนูใน Google Sheet =======================
function onOpen() {
  SpreadsheetApp.getUi().createMenu('WH Picking')
    .addItem('1) ตั้งค่าเริ่มต้น / สร้าง Admin', 'setupFromMenu')
    .addItem('2) แสดงลิงก์หน้าเว็บ', 'showWebUrl')
    .addToUi();
}

function setupFromMenu() {
  const ui = SpreadsheetApp.getUi();
  setup_();
  const code = ui.prompt('สร้างผู้ดูแลระบบ', 'รหัสพนักงานของ Admin (เช่น A001)', ui.ButtonSet.OK_CANCEL);
  if (code.getSelectedButton() !== ui.Button.OK) return;
  const name = ui.prompt('สร้างผู้ดูแลระบบ', 'ชื่อ-นามสกุล', ui.ButtonSet.OK_CANCEL);
  if (name.getSelectedButton() !== ui.Button.OK) return;
  const pin = ui.prompt('สร้างผู้ดูแลระบบ', 'ตั้ง PIN ตัวเลข 4-8 หลัก', ui.ButtonSet.OK_CANCEL);
  if (pin.getSelectedButton() !== ui.Button.OK) return;
  upsertUser_({ emp_code: code.getResponseText(), name: name.getResponseText(), role: 'admin',
                active: true, pin: pin.getResponseText() });
  ui.alert('เรียบร้อย', 'สร้างชีตและผู้ดูแลระบบแล้ว\nขั้นต่อไป: Deploy เป็น Web app (ดูคู่มือ)', ui.ButtonSet.OK);
}

function showWebUrl() {
  const url = ScriptApp.getService().getUrl();
  SpreadsheetApp.getUi().alert(url ? 'ลิงก์หน้าเว็บ:\n' + url : 'ยังไม่ได้ Deploy เป็น Web app');
}

/** สร้างชีต หัวตาราง ค่าตั้งต้น และโฟลเดอร์เก็บไฟล์ (รันซ้ำได้) */
function setup_() {
  const book = SpreadsheetApp.getActiveSpreadsheet();
  const props = PropertiesService.getScriptProperties();
  props.setProperty('SPREADSHEET_ID', book.getId());
  Object.keys(SHEETS).forEach(name => {
    let sh = book.getSheetByName(name);
    if (!sh) sh = book.insertSheet(name);
    if (sh.getLastRow() === 0) {
      sh.getRange(1, 1, 1, SHEETS[name].length).setValues([SHEETS[name]]);
      sh.setFrozenRows(1);
    }
    (TEXT_COLS[name] || []).forEach(col => {
      const c = SHEETS[name].indexOf(col) + 1;
      sh.getRange(1, c, sh.getMaxRows(), 1).setNumberFormat('@');
    });
  });
  const settings = book.getSheetByName('Settings');
  if (settings.getLastRow() <= 1) {
    settings.getRange(2, 1, DEFAULT_SETTINGS.length, 3).setValues(DEFAULT_SETTINGS);
  }
  if (!props.getProperty('FOLDER_ID')) {
    props.setProperty('FOLDER_ID', DriveApp.createFolder('WH Picking - ไฟล์ใบงาน').getId());
  }
}

// ======================= ตัวช่วยจัดการชีต =======================
function book_() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}

function table_(name) {
  const sh = book_().getSheetByName(name);
  if (!sh) throw new Error('ยังไม่ได้ตั้งค่าระบบ (ไม่พบชีต ' + name + ')');
  const values = sh.getDataRange().getValues();
  const headers = values[0];
  const rows = values.slice(1).map((v, i) => {
    const o = { _row: i + 2 };
    headers.forEach((h, j) => { o[h] = v[j]; });
    return o;
  });
  return { sh, headers, rows };
}

function writeRow_(t, obj) {
  t.sh.getRange(obj._row, 1, 1, t.headers.length).setValues([t.headers.map(h => obj[h] === undefined ? '' : obj[h])]);
}

function appendRows_(t, objs) {
  if (!objs.length) return;
  const start = t.sh.getLastRow() + 1;
  (TEXT_COLS[t.sh.getName()] || []).forEach(col => {
    const c = t.headers.indexOf(col) + 1;
    if (c) t.sh.getRange(start, c, objs.length, 1).setNumberFormat('@');
  });
  t.sh.getRange(start, 1, objs.length, t.headers.length)
    .setValues(objs.map(o => t.headers.map(h => o[h] === undefined ? '' : o[h])));
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw new Error('ระบบกำลังบันทึกข้อมูลของคนอื่น กรุณาลองใหม่');
  try { return fn(); } finally { lock.releaseLock(); }
}

function iso_(d) { return d instanceof Date ? d.toISOString() : (d || ''); }
function ymd_(d) { return d instanceof Date ? Utilities.formatDate(d, TZ, 'yyyy-MM-dd') : ''; }
function round2_(n) { return Math.round(n * 100) / 100; }
function isTrue_(v) { return v === true || String(v).toUpperCase() === 'TRUE'; }
function sameCode_(a, b) { return String(a).trim().toUpperCase() === String(b).trim().toUpperCase(); }
function dateText_(v) { return v instanceof Date ? ymd_(v) : String(v || ''); }

function settings_() {
  const s = {};
  DEFAULT_SETTINGS.forEach(r => { s[r[0]] = r[1]; });
  table_('Settings').rows.forEach(r => { if (r.key) s[r.key] = Number(r.value); });
  return s;
}

// ======================= ผู้ใช้ & Login =======================
function hash_(salt, pin) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + ':' + pin, Utilities.Charset.UTF_8);
  return bytes.map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
}

function upsertUser_(u) {
  const code = String(u.emp_code || '').trim().toUpperCase();
  if (!/^[A-Z0-9_-]{2,20}$/.test(code)) throw new Error('รหัสพนักงานต้องเป็นตัวอักษร/ตัวเลข 2-20 ตัว');
  if (!String(u.name || '').trim()) throw new Error('กรุณาใส่ชื่อ');
  if (ROLES.indexOf(u.role) < 0) throw new Error('สิทธิ์ไม่ถูกต้อง');
  return withLock_(() => {
    const t = table_('Users');
    let row = t.rows.filter(r => sameCode_(r.emp_code, code))[0];
    const isNew = !row;
    if (isNew) row = { emp_code: code, created_at: new Date() };
    row.name = String(u.name).trim();
    row.role = u.role;
    row.active = u.active !== false;
    if (u.pin) {
      if (!/^\d{4,8}$/.test(String(u.pin))) throw new Error('PIN ต้องเป็นตัวเลข 4-8 หลัก');
      row.salt = Utilities.getUuid();
      row.pin_hash = hash_(row.salt, String(u.pin));
    } else if (isNew) {
      throw new Error('ผู้ใช้ใหม่ต้องตั้ง PIN');
    }
    if (isNew) appendRows_(t, [row]); else writeRow_(t, row);
    return { emp_code: code, name: row.name, role: row.role, active: row.active };
  });
}

function login(empCode, pin) {
  const code = String(empCode || '').trim().toUpperCase();
  const cache = CacheService.getScriptCache();
  const failKey = 'fail_' + code;
  const fails = Number(cache.get(failKey) || 0);
  if (fails >= 5) throw new Error('ใส่ PIN ผิดหลายครั้ง กรุณารอ 5 นาที');

  const user = table_('Users').rows.filter(r => sameCode_(r.emp_code, code))[0];
  if (!user || !isTrue_(user.active) || hash_(user.salt, String(pin)) !== user.pin_hash) {
    cache.put(failKey, String(fails + 1), 300);
    throw new Error('รหัสพนักงานหรือ PIN ไม่ถูกต้อง');
  }
  cache.remove(failKey);

  const props = PropertiesService.getScriptProperties();
  cleanupSessions_(props);
  const token = Utilities.getUuid();
  const sess = { code: code, name: user.name, role: user.role, exp: Date.now() + SESSION_HOURS * 3600 * 1000 };
  props.setProperty('S_' + token, JSON.stringify(sess));
  return { token: token, user: { emp_code: code, name: user.name, role: user.role } };
}

function cleanupSessions_(props) {
  const all = props.getProperties();
  Object.keys(all).forEach(k => {
    if (k.indexOf('S_') === 0) {
      try { if (JSON.parse(all[k]).exp < Date.now()) props.deleteProperty(k); } catch (e) { props.deleteProperty(k); }
    }
  });
}

/** ตรวจ token และคืนข้อมูลผู้ใช้ — ทุกฟังก์ชันที่เว็บเรียกต้องผ่านตรงนี้ */
function auth_(token, minRole) {
  const raw = token && PropertiesService.getScriptProperties().getProperty('S_' + token);
  if (!raw) throw new Error('SESSION_EXPIRED');
  const s = JSON.parse(raw);
  if (s.exp < Date.now()) throw new Error('SESSION_EXPIRED');
  if (minRole && ROLES.indexOf(s.role) < ROLES.indexOf(minRole)) throw new Error('คุณไม่มีสิทธิ์ใช้งานส่วนนี้');
  return s;
}

function whoami(token) {
  const s = auth_(token);
  return { emp_code: s.code, name: s.name, role: s.role };
}

function logout(token) {
  if (token) PropertiesService.getScriptProperties().deleteProperty('S_' + token);
  return true;
}

function listUsers(token) {
  auth_(token, 'admin');
  return table_('Users').rows.map(r => ({
    emp_code: String(r.emp_code), name: r.name, role: r.role, active: isTrue_(r.active)
  }));
}

function saveUser(token, u) {
  const s = auth_(token, 'admin');
  if (sameCode_(u.emp_code, s.code) && (u.role !== 'admin' || u.active === false)) {
    throw new Error('ไม่สามารถลดสิทธิ์หรือปิดบัญชีของตัวเองได้');
  }
  return upsertUser_(u);
}

function getSettings(token) {
  auth_(token, 'leader');
  return settings_();
}

function saveSettings(token, values) {
  auth_(token, 'admin');
  return withLock_(() => {
    const t = table_('Settings');
    Object.keys(values).forEach(k => {
      const v = Number(values[k]);
      if (isNaN(v)) return;
      const row = t.rows.filter(r => r.key === k)[0];
      if (row) { row.value = v; writeRow_(t, row); }
    });
    return settings_();
  });
}

// ======================= จ๊อบ =======================
function jobSummary_(job, lines) {
  const mine = lines.filter(l => l.job_id === job.job_id);
  const done = mine.filter(l => l.status === 'done').length;
  const issue = mine.filter(l => l.status === 'issue').length;
  const picking = mine.filter(l => l.status === 'picking');
  const people = {};
  mine.forEach(l => { if (l.picked_name) people[l.picked_name] = 1; });
  return {
    job_id: job.job_id, doc_no: String(job.doc_no), biz_type: job.biz_type, biz_date: dateText_(job.biz_date),
    from_wh: job.from_wh, to_wh: job.to_wh, status: job.status,
    line_count: mine.length, done: done, issue: issue, picking: picking.length,
    people: Object.keys(people), created_at: iso_(job.created_at),
    started_at: iso_(job.started_at), finished_at: iso_(job.finished_at), file_url: job.file_url
  };
}

function listJobs(token, filter) {
  auth_(token);
  const jobs = table_('Jobs').rows;
  const lines = table_('Lines').rows;
  const showDone = filter === 'done';
  const cutoff = Date.now() - 3 * 24 * 3600 * 1000;
  return jobs
    .filter(j => showDone ? (j.status === 'done' && j.finished_at instanceof Date && j.finished_at.getTime() > cutoff)
                          : j.status !== 'done')
    .map(j => jobSummary_(j, lines))
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

function getJob(token, jobId) {
  const s = auth_(token);
  const job = table_('Jobs').rows.filter(j => j.job_id === jobId)[0];
  if (!job) throw new Error('ไม่พบจ๊อบนี้');
  const lines = table_('Lines').rows;
  const myActive = lines.filter(l => l.status === 'picking' && sameCode_(l.picked_by, s.code))[0];
  return {
    job: jobSummary_(job, lines),
    lines: lines.filter(l => l.job_id === jobId).map(lineOut_),
    myActive: myActive ? lineOut_(myActive) : null,
    serverNow: new Date().toISOString()
  };
}

function lineOut_(l) {
  return {
    line_id: l.line_id, job_id: l.job_id, doc_no: String(l.doc_no), line_no: l.line_no,
    part_code: l.part_code, part_name: l.part_name, spec: l.spec, batch_no: String(l.batch_no),
    qty: l.qty, from_wh: l.from_wh, from_loc: l.from_loc, to_wh: l.to_wh, status: l.status,
    picked_by: String(l.picked_by || ''), picked_name: l.picked_name, started_at: iso_(l.started_at),
    finished_at: iso_(l.finished_at), minutes: l.minutes, issue_note: l.issue_note
  };
}

/** งานที่ฉันกำลังทำอยู่ (ไว้แสดงแถบด้านบนทุกหน้า) */
function getMyActive(token) {
  const s = auth_(token);
  const l = table_('Lines').rows.filter(r => r.status === 'picking' && sameCode_(r.picked_by, s.code))[0];
  return { myActive: l ? lineOut_(l) : null, serverNow: new Date().toISOString() };
}

function createJob(token, payload) {
  const s = auth_(token, 'leader');
  const docNo = String(payload.doc_no || '').trim();
  if (!docNo) throw new Error('กรุณาใส่เลขที่เอกสาร');
  const rows = (payload.rows || []).filter(r => String(r.part_code || '').trim());
  if (!rows.length) throw new Error('ไม่มีรายการพาร์ท');

  let fileUrl = '';
  if (payload.file && payload.file.base64) {
    const folderId = PropertiesService.getScriptProperties().getProperty('FOLDER_ID');
    const blob = Utilities.newBlob(Utilities.base64Decode(payload.file.base64), payload.file.mimeType, payload.file.name || docNo);
    fileUrl = (folderId ? DriveApp.getFolderById(folderId) : DriveApp.getRootFolder()).createFile(blob).getUrl();
  }

  return withLock_(() => {
    const jobsT = table_('Jobs');
    if (jobsT.rows.some(j => String(j.doc_no).trim() === docNo)) {
      throw new Error('เอกสาร ' + docNo + ' ถูกสร้างไว้แล้ว');
    }
    const jobId = 'J' + Utilities.formatDate(new Date(), TZ, 'yyMMddHHmmss') + Math.floor(Math.random() * 90 + 10);
    const now = new Date();
    appendRows_(jobsT, [{
      job_id: jobId, doc_no: docNo, biz_type: payload.biz_type || '', biz_date: payload.biz_date || '',
      from_wh: rows[0].from_wh || '', to_wh: rows[0].to_wh || '', line_count: rows.length, status: 'open',
      file_url: fileUrl, created_by: s.name, created_at: now
    }]);
    appendRows_(table_('Lines'), rows.map((r, i) => ({
      line_id: jobId + '-' + ('00' + (i + 1)).slice(-3), job_id: jobId, doc_no: docNo, line_no: i + 1,
      part_code: String(r.part_code).trim(), part_name: r.part_name || '', spec: r.spec || '',
      batch_no: String(r.batch_no || ''), qty: Number(r.qty) || 0,
      from_wh: r.from_wh || '', from_loc: r.from_loc || '', to_wh: r.to_wh || '', status: 'pending'
    })));
    return { job_id: jobId };
  });
}

function deleteJob(token, jobId) {
  auth_(token, 'admin');
  return withLock_(() => {
    const lt = table_('Lines');
    const jt = table_('Jobs');
    const job = jt.rows.filter(j => j.job_id === jobId)[0];
    if (!job) throw new Error('ไม่พบจ๊อบนี้');
    if (lt.rows.some(l => l.job_id === jobId && l.status !== 'pending')) {
      throw new Error('ลบไม่ได้ เพราะเริ่มจัดพาร์ทแล้ว');
    }
    lt.rows.filter(l => l.job_id === jobId).map(l => l._row).sort((a, b) => b - a)
      .forEach(r => lt.sh.deleteRow(r));
    jt.sh.deleteRow(job._row);
    return true;
  });
}

/** สร้างข้อความจากรูปถ่ายด้วย OCR ของ Google Drive */
function ocrImage(token, file) {
  auth_(token, 'leader');
  const blob = Utilities.newBlob(Utilities.base64Decode(file.base64), file.mimeType, file.name || 'photo.jpg');
  const doc = Drive.Files.insert({ title: 'ocr-' + Date.now(), mimeType: MimeType.GOOGLE_DOCS }, blob,
                                 { ocr: true, ocrLanguage: 'zh' });
  try {
    return DocumentApp.openById(doc.id).getBody().getText();
  } finally {
    DriveApp.getFileById(doc.id).setTrashed(true);
  }
}

// ======================= การจัดพาร์ท =======================
function updateLine_(token, lineId, mutate) {
  const s = auth_(token);
  return withLock_(() => {
    const lt = table_('Lines');
    const line = lt.rows.filter(l => l.line_id === lineId)[0];
    if (!line) throw new Error('ไม่พบรายการนี้');
    const now = new Date();
    mutate(line, s, now, lt.rows);
    writeRow_(lt, line);
    refreshJob_(line.job_id, lt.rows);
    return lineOut_(line);
  });
}

function refreshJob_(jobId, lines) {
  const jt = table_('Jobs');
  const job = jt.rows.filter(j => j.job_id === jobId)[0];
  if (!job) return;
  const mine = lines.filter(l => l.job_id === jobId);
  const starts = mine.map(l => l.started_at).filter(d => d instanceof Date).map(d => d.getTime());
  const ends = mine.map(l => l.finished_at).filter(d => d instanceof Date).map(d => d.getTime());
  const allClosed = mine.length > 0 && mine.every(l => l.status === 'done' || l.status === 'issue');
  job.status = allClosed ? 'done' : (starts.length ? 'in_progress' : 'open');
  job.started_at = starts.length ? new Date(Math.min.apply(null, starts)) : '';
  job.finished_at = allClosed && ends.length ? new Date(Math.max.apply(null, ends)) : '';
  writeRow_(jt, job);
}

function claimLine(token, lineId) {
  return updateLine_(token, lineId, (line, s, now, all) => {
    const busy = all.filter(l => l.status === 'picking' && sameCode_(l.picked_by, s.code))[0];
    if (busy && busy.line_id !== lineId) {
      throw new Error('คุณยังมีงานค้างอยู่: ' + busy.part_code + ' (' + busy.from_loc + ') กรุณากดเสร็จก่อน');
    }
    if (line.status !== 'pending') {
      throw new Error(line.status === 'picking' ? 'รายการนี้ ' + line.picked_name + ' รับไปแล้ว' : 'รายการนี้ปิดแล้ว');
    }
    line.status = 'picking';
    line.picked_by = s.code;
    line.picked_name = s.name;
    line.started_at = now;
    line.finished_at = '';
    line.minutes = '';
    line.issue_note = '';
  });
}

function finishLine(token, lineId) {
  return updateLine_(token, lineId, (line, s, now) => {
    if (line.status !== 'picking' || !sameCode_(line.picked_by, s.code)) throw new Error('รายการนี้ไม่ใช่งานที่คุณกำลังทำ');
    line.status = 'done';
    line.finished_at = now;
    line.minutes = round2_((now - line.started_at) / 60000);
  });
}

function reportIssue(token, lineId, note) {
  return updateLine_(token, lineId, (line, s, now) => {
    if (line.status !== 'picking' || !sameCode_(line.picked_by, s.code)) throw new Error('ต้องกดรับงานก่อนจึงจะแจ้งปัญหาได้');
    line.status = 'issue';
    line.finished_at = now;
    line.minutes = round2_((now - line.started_at) / 60000);
    line.issue_note = String(note || '').slice(0, 200);
  });
}

function releaseLine(token, lineId) {
  return updateLine_(token, lineId, (line, s) => {
    const isLeader = ROLES.indexOf(s.role) >= 1;
    if (line.status !== 'picking' || (!sameCode_(line.picked_by, s.code) && !isLeader)) throw new Error('ยกเลิกไม่ได้');
    clearLine_(line);
  });
}

/** หัวหน้าเปิดรายการที่ปิดไปแล้ว (เช่น แจ้งปัญหา) ให้กลับมาจัดใหม่ */
function resetLine(token, lineId) {
  return updateLine_(token, lineId, (line, s) => {
    if (ROLES.indexOf(s.role) < 1) throw new Error('เฉพาะหัวหน้าเท่านั้น');
    clearLine_(line);
  });
}

function clearLine_(line) {
  line.status = 'pending';
  ['picked_by', 'picked_name', 'started_at', 'finished_at', 'minutes', 'issue_note'].forEach(k => { line[k] = ''; });
}

// ======================= Dashboard =======================
function getDashboard(token, fromYmd, toYmd) {
  auth_(token, 'leader');
  const st = settings_();
  const inRange = d => { const k = ymd_(d); return k && k >= fromYmd && k <= toYmd; };
  const lines = table_('Lines').rows;
  const jobs = table_('Jobs').rows;
  const closed = lines.filter(l => (l.status === 'done' || l.status === 'issue') && inRange(l.finished_at));

  // ---- รายวัน ----
  const days = {};
  closed.forEach(l => {
    const k = ymd_(l.finished_at);
    const d = days[k] = days[k] || { date: k, lines: 0, man_min: 0, people: {}, issues: 0 };
    d.lines++; d.man_min += Number(l.minutes) || 0; d.people[l.picked_name] = 1;
    if (l.status === 'issue') d.issues++;
  });
  const capacityPerPerson = st.work_minutes_per_shift * st.efficiency;
  const dayList = Object.keys(days).sort().map(k => {
    const d = days[k];
    const perShift = d.man_min / Math.max(st.shifts_per_day, 1);
    return {
      date: k, lines: d.lines, issues: d.issues, man_min: round2_(d.man_min),
      people: Object.keys(d.people).length,
      required_per_shift: round2_(perShift / capacityPerPerson),
      utilization: round2_(d.man_min / (st.headcount_per_shift * st.shifts_per_day * st.work_minutes_per_shift))
    };
  });

  // ---- รายคน ----
  const workers = {};
  closed.forEach(l => {
    const w = workers[l.picked_by] = workers[l.picked_by] || { emp_code: String(l.picked_by), name: l.picked_name, lines: 0, man_min: 0, qty: 0, issues: 0 };
    w.lines++; w.man_min += Number(l.minutes) || 0; w.qty += Number(l.qty) || 0;
    if (l.status === 'issue') w.issues++;
  });
  const workerList = Object.keys(workers).map(k => {
    const w = workers[k];
    return { emp_code: w.emp_code, name: w.name, lines: w.lines, issues: w.issues, man_min: round2_(w.man_min),
             avg_min: round2_(w.man_min / w.lines), lines_per_hour: round2_(w.lines / (w.man_min / 60 || 1)) };
  }).sort((a, b) => b.lines - a.lines);

  // ---- รายจ๊อบ (จ๊อบที่เสร็จในช่วงวันที่) ----
  const jobList = jobs.filter(j => j.status === 'done' && inRange(j.finished_at)).map(j => {
    const mine = lines.filter(l => l.job_id === j.job_id);
    const people = {};
    let manMin = 0;
    mine.forEach(l => { manMin += Number(l.minutes) || 0; if (l.picked_name) people[l.picked_name] = 1; });
    return {
      job_id: j.job_id, doc_no: String(j.doc_no), biz_type: j.biz_type, lines: mine.length,
      issues: mine.filter(l => l.status === 'issue').length,
      created_at: iso_(j.created_at), started_at: iso_(j.started_at), finished_at: iso_(j.finished_at),
      wait_min: round2_((j.started_at - j.created_at) / 60000),
      lead_min: round2_((j.finished_at - j.started_at) / 60000),
      man_min: round2_(manMin), people: Object.keys(people)
    };
  }).sort((a, b) => (a.finished_at < b.finished_at ? 1 : -1));

  const totalMan = closed.reduce((s, l) => s + (Number(l.minutes) || 0), 0);
  const avgReq = dayList.length ? dayList.reduce((s, d) => s + d.required_per_shift, 0) / dayList.length : 0;
  const peakReq = dayList.reduce((m, d) => Math.max(m, d.required_per_shift), 0);

  return {
    settings: st,
    totals: {
      lines: closed.length, issues: closed.filter(l => l.status === 'issue').length,
      man_min: round2_(totalMan), jobs_done: jobList.length,
      avg_lead_min: jobList.length ? round2_(jobList.reduce((s, j) => s + j.lead_min, 0) / jobList.length) : 0,
      avg_min_per_line: closed.length ? round2_(totalMan / closed.length) : 0,
      avg_required_per_shift: round2_(avgReq), peak_required_per_shift: round2_(peakReq)
    },
    days: dayList, workers: workerList, jobs: jobList,
    issues: closed.filter(l => l.status === 'issue').map(lineOut_),
    lines: closed.map(lineOut_)
  };
}
