// ======================= เชื่อมต่อ Apps Script API =======================
// ส่ง POST แบบ text/plain (ไม่เกิด CORS preflight) → Apps Script ตอบ JSON { ok, data | error }
var READ_ACTIONS = { whoami: 1, listJobs: 1, getJob: 1, getMyActive: 1, getDashboard: 1, getSettings: 1, listUsers: 1 };

function apiUrl() {
  var override = store('whp_api_url');
  return override || (window.WH_CONFIG && window.WH_CONFIG.API_URL) || '';
}

function withNonce(url) {
  // Apps Script redirect ไป googleusercontent.com แบบหมดอายุได้ — ใส่ค่าไม่ซ้ำกันกัน cache
  return url + (url.indexOf('?') >= 0 ? '&' : '?') + '_r=' + Date.now() + Math.random().toString(36).slice(2, 8);
}

function callApi(action, args) {
  var url = apiUrl();
  if (!url) return Promise.reject(new Error('ยังไม่ได้ตั้งค่า API URL (js/config.js)'));
  return fetch(withNonce(url), {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: action, args: args }),
    redirect: 'follow',
    cache: 'no-store'
  }).then(function (res) {
    return res.text().then(function (text) {
      try { return JSON.parse(text); } catch (e) { throw new Error('เซิร์ฟเวอร์ตอบกลับผิดรูปแบบ (HTTP ' + res.status + ')'); }
    });
  });
}

function api(action) {
  var args = Array.prototype.slice.call(arguments, 1);
  var attempt = function (n) {
    return callApi(action, args).catch(function (err) {
      // ลองใหม่เฉพาะคำสั่งอ่านข้อมูล — คำสั่งบันทึกห้ามส่งซ้ำ
      if (READ_ACTIONS[action] && n < 2) return new Promise(function (r) { setTimeout(r, 800 * (n + 1)); }).then(function () { return attempt(n + 1); });
      if (err instanceof TypeError) throw new Error('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่');
      throw err;
    });
  };
  return attempt(0).then(function (res) {
    if (!res.ok) {
      var msg = res.error || 'เกิดข้อผิดพลาด';
      if (msg.indexOf('SESSION_EXPIRED') >= 0) { doLogout(true); msg = 'หมดเวลาการใช้งาน กรุณาเข้าสู่ระบบใหม่'; }
      throw new Error(msg);
    }
    return res.data;
  });
}
