// เซิร์ฟเวอร์ทดสอบบนเครื่อง: เสิร์ฟหน้าเว็บ (เหมือน GitHub Pages) + จำลอง Apps Script (appscript/code.gs) ในเบราว์เซอร์
// เปิด http://localhost:5178  — ข้อมูลทดสอบ (เฉพาะ mock): ผู้ดูแล A001, หัวหน้า L001, พนักงาน W001-W004 — PIN ทุกคน 1234
const http = require('http');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const PORT = process.env.PORT || 5178;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.gs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.pdf': 'application/pdf' };

const MOCK = `<script src="/dev/gas-mock.js"></script>
<script src="/appscript/code.gs"></script>
<script>
(function seed() {
  if (SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Users')) return;
  setup_();
  upsertUser_({ emp_code: 'A001', name: 'ผู้ดูแล ทดสอบ', role: 'admin', pin: '1234' });
  upsertUser_({ emp_code: 'L001', name: 'หัวหน้า ทดสอบ', role: 'leader', pin: '1234' });
  ['สมชาย', 'สมหญิง', 'วิชัย', 'มาลี'].forEach(function (n, i) {
    upsertUser_({ emp_code: 'W00' + (i + 1), name: n, role: 'worker', pin: '1234' });
  });
})();
</script>`;

http.createServer((req, res) => {
  let url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/') url = '/index.html';
  const file = path.normalize(path.join(ROOT, url));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  const ext = path.extname(file);
  let body = fs.readFileSync(file);
  if (url === '/index.html') {
    body = body.toString('utf8')
      .replace('<script src="js/config.js"></script>', MOCK + '\n<script src="js/config.js"></script><script>WH_CONFIG.API_URL = MOCK_API_URL;</script>')
      .replace('</body>', '<button onclick="gasMockReset()" style="position:fixed;right:6px;bottom:70px;z-index:99;font-size:11px;opacity:.5">reset mock</button></body>');
  }
  res.writeHead(200, { 'Content-Type': (TYPES[ext] || 'application/octet-stream') + '; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}).listen(PORT, () => console.log('WH Picking mock at http://localhost:' + PORT));
