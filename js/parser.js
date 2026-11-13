/**
 * ตัวอ่านใบ "直接调拨单" (Kingdee) จากตำแหน่งตัวอักษรใน PDF
 * input : pages = [[{str, x, y, w}, ...], ...]  (y มาก = อยู่ด้านบน แบบ PDF)
 * output: { doc_no, biz_type, biz_date, rows: [...] }
 */
var KINGDEE_HEADERS = [
  { key: 'part_code', label: '物料编码' },
  { key: 'part_name', label: '物料名称' },
  { key: 'spec',      label: '规格型号' },
  { key: 'batch_no',  label: '批号' },
  { key: 'qty',       label: '数量' },
  { key: 'from_wh',   label: '调出仓库' },
  { key: 'from_loc',  label: '调出仓位' },
  { key: 'to_wh',     label: '调入仓库' },
  { key: 'to_loc',    label: '调入仓位' }
];
var PART_CODE_RE = /^[0-9]{4}[A-Z]{2}[0-9]{5}$/;

function joinWrapped(parts) {
  var out = '';
  parts.forEach(function (p) {
    p = p.trim();
    if (!p) return;
    if (!out) { out = p; return; }
    var noSpace = /[-(\/]$/.test(out) || /^[+\-),\/]/.test(p);
    out += (noSpace ? '' : ' ') + p;
  });
  return out;
}

function parseKingdeePages(pages) {
  var result = { doc_no: '', biz_type: '', biz_date: '', rows: [] };

  pages.forEach(function (items) {
    items = items.filter(function (it) { return it.str && it.str.trim(); });

    // ---- ข้อมูลหัวเอกสาร ----
    items.forEach(function (it, i) {
      var s = it.str.trim();
      var next = items[i + 1] ? items[i + 1].str.trim() : '';
      if (/^单据编号/.test(s)) result.doc_no = result.doc_no || (s.split(/[：:]/)[1] || next).trim();
      if (/^业务类型/.test(s)) result.biz_type = result.biz_type || (s.split(/[：:]/)[1] || next).trim();
      if (/^业务日期/.test(s)) result.biz_date = result.biz_date || (s.split(/[：:]/)[1] || next).trim();
    });

    // ---- หัวตาราง ----
    var heads = KINGDEE_HEADERS.map(function (h) {
      var found = items.filter(function (it) { return it.str.trim() === h.label; })[0];
      return found ? { key: h.key, right: found.x + found.w, y: found.y } : null;
    });
    if (heads.some(function (h) { return !h; })) return; // หน้านี้ไม่มีตาราง
    var headerY = heads[0].y;

    function columnOf(x) {
      // คอลัมน์ = จำนวนหัวตารางที่ขอบขวาอยู่ทางซ้ายของตัวอักษร
      var idx = 0;
      for (var i = 0; i < heads.length - 1; i++) if (heads[i].right < x) idx = i + 1;
      return idx;
    }

    var body = items.filter(function (it) { return it.y < headerY - 5; });
    var anchors = body.filter(function (it) {
      return columnOf(it.x) === 0 && PART_CODE_RE.test(it.str.trim());
    }).sort(function (a, b) { return b.y - a.y; });

    var rowCells = anchors.map(function () { return {}; });
    body.forEach(function (it) {
      var best = -1, bestDist = 1e9;
      anchors.forEach(function (a, i) {
        var d = Math.abs(a.y - it.y);
        if (d < bestDist) { bestDist = d; best = i; }
      });
      if (best < 0 || bestDist > 18) return;
      var key = KINGDEE_HEADERS[columnOf(it.x)].key;
      (rowCells[best][key] = rowCells[best][key] || []).push(it);
    });

    rowCells.forEach(function (cells) {
      var row = {};
      KINGDEE_HEADERS.forEach(function (h) {
        var list = (cells[h.key] || []).sort(function (a, b) { return b.y - a.y || a.x - b.x; });
        row[h.key] = joinWrapped(list.map(function (it) { return it.str; }));
      });
      row.qty = parseFloat(String(row.qty).replace(/,/g, '')) || 0;
      result.rows.push(row);
    });
  });

  return result;
}

/** อ่านไฟล์ PDF (ArrayBuffer) ด้วย pdf.js แล้วส่งให้ parseKingdeePages */
function parseKingdeePdf(arrayBuffer, pdfjsLib) {
  return pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise.then(function (doc) {
    var jobs = [];
    for (var p = 1; p <= doc.numPages; p++) {
      jobs.push(doc.getPage(p).then(function (page) {
        return page.getTextContent().then(function (tc) {
          return tc.items.map(function (it) {
            return { str: it.str, x: it.transform[4], y: it.transform[5], w: it.width };
          });
        });
      }));
    }
    return Promise.all(jobs).then(parseKingdeePages);
  });
}

/** ใช้กับข้อความจาก OCR (รูปถ่าย) — แม่นน้อยกว่า ต้องให้คนตรวจ */
function parseKingdeeText(text) {
  var result = { doc_no: '', biz_type: '', biz_date: '', rows: [] };
  var m = text.match(/ZJDB-\d{6}-\d{6}/); if (m) result.doc_no = m[0];
  m = text.match(/业务日期[：:]?\s*(\d{4}-\d{2}-\d{2})/); if (m) result.biz_date = m[1];
  m = text.match(/业务类型[：:]?\s*(\S+)/); if (m) result.biz_type = m[1];
  var lines = text.split(/\n/);
  var cur = null;
  lines.forEach(function (ln) {
    var code = ln.match(/\b(\d{4}[A-Z]{2}\d{5})\b/);
    if (code) {
      if (cur) result.rows.push(cur);
      cur = { part_code: code[1], part_name: '', spec: '', batch_no: '', qty: 0, from_wh: '', from_loc: '', to_wh: '', to_loc: '', _text: ln };
    } else if (cur) {
      cur._text += ' ' + ln;
    }
  });
  if (cur) result.rows.push(cur);
  result.rows.forEach(function (r) {
    var t = r._text;
    var b = t.match(/\b(20\d{8})\b/); if (b) r.batch_no = b[1];
    var q = t.match(/\b(\d+)\.(\d{3})\b/); if (q) r.qty = parseFloat(q[0]);
    var loc = t.match(/\b([A-Z]{2}-\d{2}-\d{2}[A-Z]|FR\d{3})\b/) || t.match(/(公共区域)/); if (loc) r.from_loc = loc[1];
    var name = t.replace(r.part_code, '').split(/\b20\d{8}\b/)[0].trim();
    r.part_name = name;
    delete r._text;
  });
  return result;
}
