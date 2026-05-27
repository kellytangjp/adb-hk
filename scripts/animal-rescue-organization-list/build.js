/**
 * build.js
 * Fetches all pages from the Notion database and writes:
 *   animal-rescue-organization-list/index.html        (list page)
 *   animal-rescue-organization-list/[slug]/index.html  (detail pages)
 *
 * Env vars required:
 *   NOTION_TOKEN          - your Notion integration secret
 *   NOTION_DATABASE_ID    - the database ID (without dashes)
 */

const { Client } = require('@notionhq/client');
const fs = require('fs');
const path = require('path');

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const DATABASE_ID = process.env.NOTION_DATABASE_ID;

/* ── helpers ── */
function prop(page, name) {
  const p = page.properties[name];
  if (!p) return null;
  switch (p.type) {
    case 'title':        return p.title.map(t => t.plain_text).join('');
    case 'rich_text':    return p.rich_text.map(t => t.plain_text).join('');
    case 'url':          return p.url || null;
    case 'email':        return p.email || null;
    case 'phone_number': return p.phone_number || null;
    case 'checkbox':     return p.checkbox;
    case 'select':       return p.select ? p.select.name : null;
    case 'multi_select': return p.multi_select.map(o => o.name);
    default:             return null;
  }
}

/* ── rich text → HTML (preserves \n as <br>, escapes HTML chars) ── */
function propHtml(page, name) {
  const p = page.properties[name];
  if (!p) return '';
  let text = '';
  if (p.type === 'rich_text') {
    text = p.rich_text.map(t => t.plain_text).join('');
  } else if (p.type === 'title') {
    text = p.title.map(t => t.plain_text).join('');
  } else {
    return '';
  }
  if (!text) return '';
  text = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  text = text.replace(/\n/g, '<br>');
  return text;
}

/* ── clean & split phone/whatsapp string into array ── */
function parseNumbers(raw) {
  if (!raw) return [];
  return raw
    .split(/[;;\,\,\n]/)
    .map(s => s.replace(/[^\d+]/g, ''))
    .filter(s => s.length >= 4);
}

/* ── generate URL slug from English name ── */
function generateSlug(enName) {
  if (!enName) return '';
  return enName
    .toLowerCase()
    .replace(/[''\.&,\(\)]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/* ── fetch schema (for dynamic filter options) ── */
async function fetchSchema() {
  const db = await notion.databases.retrieve({ database_id: DATABASE_ID });
  const schema = {};
  Object.keys(db.properties).forEach(key => {
    const p = db.properties[key];
    if (p.type === 'multi_select' || p.type === 'select') {
      schema[key] = p[p.type].options.map(o => o.name);
    }
  });
  return schema;
}

/* ── fetch all pages (handles pagination) ── */
async function fetchAll() {
  const pages = [];
  let cursor;
  do {
    const res = await notion.databases.query({
      database_id: DATABASE_ID,
      start_cursor: cursor,
      page_size: 100,
      sorts: [{ property: '\u6a5f\u69cb/\u7d44\u7e54\u4e2d\u6587\u540d\u7a31', direction: 'ascending' }],
    });
    pages.push(...res.results);
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return pages;
}

/* ── map Notion page → JS object ── */
function toOrg(page) {
  const services  = prop(page, '\u670d\u52d9\u985e\u578b') || [];
  const animals   = prop(page, '\u52d5\u7269\u7a2e\u985e') || [];

  const has = k => animals.some(a => a.includes(k));
  let icon = '\ud83d\udc3e';
  if (has('\u72d7') && has('\u8c93')) icon = '\ud83d\udc3e';
  else if (has('\u72d7'))  icon = '\ud83d\udc15';
  else if (has('\u8c93'))  icon = '\ud83d\udc31';
  else if (has('\u5154'))  icon = '\ud83d\udc30';
  else if (has('\u91ce\u751f')) icon = '\ud83e\udd9c';

  const category    = prop(page, '\u985e\u5225') || '';
  const avatarColor = category === '\u7368\u7acb\u7fa9\u5de5' ? 'green' : '';

  const phones    = parseNumbers(prop(page, '\u96fb\u8a71') || '');
  const whatsapps = parseNumbers(prop(page, 'WhatsApp') || '');

  const fbUrl = prop(page, 'facebook') || '';
  const igUrl = prop(page, 'instagram') || '';

  function urlToName(url) {
    if (!url) return '';
    try {
      const seg = new URL(url).pathname.replace(/\/$/, '').split('/').pop();
      return seg ? seg : url;
    } catch { return url; }
  }

  const enName = prop(page, '\u6a5f\u69cb/\u7d44\u7e54\u82f1\u6587\u540d\u7a31') || '';

  return {
    name:       prop(page, '\u6a5f\u69cb/\u7d44\u7e54\u4e2d\u6587\u540d\u7a31') || '',
    en:         enName,
    slug:       generateSlug(enName),
    category,
    area:       prop(page, '\u5730\u5340') || '',
    desc:       prop(page, '\u7c21\u4ecb') || '',
    services,
    animals,
    phones,
    whatsapps,
    hours:      prop(page, '\u670d\u52d9\u6642\u9593') || '',
    website:    prop(page, '\u7db2\u7ad9') || '',
    email:      prop(page, '\u96fb\u90f5') || '',
    emails:     (prop(page, '\u96fb\u90f5') || '').split(/[;;\uff1b]/).map(s => s.trim()).filter(Boolean),
    facebook:   fbUrl ? { name: urlToName(fbUrl), url: fbUrl } : null,
    instagram:  igUrl ? { name: '@' + urlToName(igUrl).replace(/^@/, ''), url: igUrl } : null,
    taxDeductible: prop(page, '\u53ef\u624d\u7a05') === true,
    charityRef: prop(page, '\u6148\u5584\u5718\u9ad4\u53c3\u8003\u7de8\u865f') || '',
    donation:   propHtml(page, '\u6350\u52a9\u65b9\u6cd5'),
    addressZh:  propHtml(page, '\u5730\u5740'),
    addressEn:  propHtml(page, 'Address'),
    icon,
    avatarColor,
  };
}

/* ── escape HTML ── */
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ── shared CSS (same as list page) ── */
function sharedCSS() {
  return `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
:root{
  --coral:#FF6B2B;--coral-hover:#E85A1D;--coral-light:#FFF1EA;
  --sage:#8FAF9B;--sage-deep:#6E8F7C;--sage-light:#E6F1EC;
  --white:#FFFFFF;--bg-soft:#F7F8F7;
  --text-primary:#2F2F2F;--text-secondary:#6B7280;--text-muted:#9CA3AF;
  --border:#E5E7EB;--shadow:rgba(0,0,0,0.05);
  --font:'Noto Sans TC',sans-serif;
}
body{font-family:var(--font);background:var(--bg-soft);color:var(--text-primary);min-height:100vh;}
.page-header{background:var(--white);border-bottom:1px solid var(--border);padding:2.5rem 2rem 2rem;}
.page-header-inner{max-width:800px;margin:0 auto;}
.breadcrumb{font-size:12px;color:var(--text-muted);margin-bottom:1rem;display:flex;align-items:center;gap:6px;flex-wrap:wrap;}
.breadcrumb a{color:var(--text-muted);text-decoration:none;}
.breadcrumb a:hover{color:var(--coral);}
.breadcrumb-sep{color:var(--border);}
.page-header h1{font-size:24px;font-weight:600;color:var(--text-primary);margin-bottom:4px;letter-spacing:-.3px;}
.page-header-en{font-size:14px;color:var(--text-muted);font-weight:300;margin-bottom:1rem;}
.header-badges{display:flex;flex-wrap:wrap;gap:6px;margin-top:.75rem;}
.badge{font-size:11px;padding:3px 10px;border-radius:20px;font-weight:500;white-space:nowrap;}
.badge-coral{background:var(--coral-light);color:var(--coral);}
.badge-sage{background:var(--sage-light);color:var(--sage-deep);}
.badge-gray{background:var(--bg-soft);color:var(--text-secondary);border:1px solid var(--border);}
.main{max-width:800px;margin:2rem auto;padding:0 2rem 4rem;}
.detail-card{background:var(--white);border:1px solid var(--border);border-radius:14px;overflow:hidden;box-shadow:0 2px 12px var(--shadow);}
.detail-table{width:100%;border-collapse:collapse;font-size:14px;}
.detail-table tr{border-bottom:1px solid var(--border);}
.detail-table tr:last-child{border-bottom:none;}
.detail-table td{padding:14px 1.5rem;vertical-align:top;line-height:1.7;}
.detail-table td:first-child{width:110px;color:var(--text-muted);font-size:12px;white-space:nowrap;padding-top:16px;font-weight:500;}
.detail-table td:last-child{color:var(--text-secondary);}
.detail-table a{color:var(--coral);text-decoration:none;}
.detail-table a:hover{text-decoration:underline;}
.social-btns{display:flex;flex-wrap:wrap;gap:8px;margin-top:2px;}
.social-btn{display:inline-flex;align-items:center;gap:6px;padding:6px 14px;border-radius:8px;border:1px solid var(--border);background:var(--white);font-family:var(--font);font-size:13px;font-weight:500;color:var(--text-secondary);text-decoration:none;transition:all .15s;}
.social-btn.fb{border-color:#bad3f5;color:#1877f2;}
.social-btn.fb:hover{background:#e8f0fe;}
.social-btn.ig{border-color:#f5c6da;color:#e1306c;}
.social-btn.ig:hover{background:#fdf0f5;}
.badge-tax{display:inline-block;background:#eef6ee;color:#3a7a3a;font-size:11px;font-weight:600;border-radius:6px;padding:2px 8px;margin-left:6px;vertical-align:middle;}
.back-btn{display:inline-flex;align-items:center;gap:6px;margin-bottom:1.5rem;padding:8px 16px;border-radius:8px;border:1px solid var(--border);background:var(--white);font-family:var(--font);font-size:13px;color:var(--text-secondary);text-decoration:none;transition:all .15s;cursor:pointer;}
.back-btn:hover{border-color:var(--coral);color:var(--coral);background:var(--coral-light);}
@media(max-width:640px){
  .page-header{padding:1.5rem 1rem 1rem;}
  .main{padding:0 1rem 3rem;}
  .detail-table td:first-child{width:80px;}
  .detail-table td{padding:12px 1rem;}
}`;
}

/* ── build detail page HTML for one org ── */
function buildDetailHTML(org, lastUpdated) {
  /* phone links */
  function phoneLink(p) {
    var d = p.replace(/\D/g, '');
    var full = d.length <= 8 ? '852' + d : d;
    var display = d.length === 8 ? d.slice(0, 4) + ' ' + d.slice(4) : p;
    return '<a href="tel:+' + full + '">' + display + '</a>';
  }
  /* whatsapp links */
  function waLink(w) {
    var d = w.replace(/\D/g, '');
    var full = d.length <= 8 ? '852' + d : d;
    var display = d.length === 8 ? d.slice(0, 4) + ' ' + d.slice(4) : w;
    return '<a href="https://wa.me/' + full + '" target="_blank" rel="noopener">' + display + '</a>';
  }

  var rows = '';

  // 機構簡介
  rows += '<tr><td>\u6a5f\u69cb\u7c21\u4ecb</td><td>' + (org.desc || '-') + '</td></tr>';

  // 服務時間
  rows += '<tr><td>\u670d\u52d9\u6642\u9593</td><td>' + (org.hours || '-') + '</td></tr>';

  // 網站
  rows += '<tr><td>\u7db2\u7ad9</td><td>' + (org.website ? '<a href="' + esc(org.website) + '" target="_blank" rel="noopener">' + esc(org.website) + '</a>' : '-') + '</td></tr>';

  // 電話
  if (org.phones && org.phones.length) {
    rows += '<tr><td>\u96fb\u8a71</td><td>' + org.phones.map(phoneLink).join('\uff1b') + '</td></tr>';
  } else {
    rows += '<tr><td>\u96fb\u8a71</td><td>-</td></tr>';
  }

  // WhatsApp
  if (org.whatsapps && org.whatsapps.length) {
    rows += '<tr><td>WhatsApp</td><td>' + org.whatsapps.map(waLink).join('\uff1b') + '</td></tr>';
  } else {
    rows += '<tr><td>WhatsApp</td><td>-</td></tr>';
  }

  // 電郵
  if (org.emails && org.emails.length) {
    rows += '<tr><td>\u96fb\u90f5</td><td>' + org.emails.map(function(e) { return '<a href="mailto:' + esc(e) + '">' + esc(e) + '</a>'; }).join('<br>') + '</td></tr>';
  } else {
    rows += '<tr><td>\u96fb\u90f5</td><td>-</td></tr>';
  }

  // 社交媒體
  var socials = '';
  if (org.facebook) socials += '<a class="social-btn fb" href="' + esc(org.facebook.url) + '" target="_blank" rel="noopener"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/></svg>Facebook</a>';
  if (org.instagram) socials += '<a class="social-btn ig" href="' + esc(org.instagram.url) + '" target="_blank" rel="noopener"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>Instagram</a>';
  rows += '<tr><td>\u793e\u4ea4\u5a92\u9ad4</td><td>' + (socials ? '<div class="social-btns">' + socials + '</div>' : '-') + '</td></tr>';

  // 慈善團體參考編號 + 可扣稅
  var charityCell = org.charityRef || '-';
  if (org.taxDeductible) {
    charityCell = esc(org.charityRef) + ' <span class="badge-tax">\u53ef\u624d\u7a05</span>';
  }
  rows += '<tr><td>\u6148\u5584\u5718\u9ad4<br>\u53c3\u8003\u7de8\u865f</td><td>' + charityCell + '</td></tr>';

  // 捐助方法
  var donationCell = '-';
  if (org.donation) {
    donationCell = org.donation.replace(/(\d{4})\s*(\d{4})/g, function(match, a, b) {
      var full = '852' + a + b;
      return '<a href="tel:+' + full + '">' + a + ' ' + b + '</a>';
    });
  }
  rows += '<tr><td>\u6350\u52a9\u65b9\u6cd5</td><td>' + donationCell + '</td></tr>';

  // 地址
  var addrCell = '-';
  if (org.addressZh || org.addressEn) {
    var parts = [];
    if (org.addressZh) parts.push(org.addressZh);
    if (org.addressEn) parts.push(org.addressEn);
    addrCell = parts.join('<br><br>');
  }
  rows += '<tr><td>\u5730\u5740</td><td>' + addrCell + '</td></tr>';

  // service badges
  var svcBadges = org.services.map(function(s) { return '<span class="badge badge-coral">' + esc(s) + '</span>'; }).join('');
  var aniBadges = org.animals.map(function(a) { return '<span class="badge badge-gray">' + esc(a) + '</span>'; }).join('');

  return '<!DOCTYPE html>\n' +
    '<html lang="zh-Hant">\n' +
    '<head>\n' +
    '<meta charset="UTF-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
    '<title>' + esc(org.name) + ' | \u52d5\u7269\u62ef\u6551\u6a5f\u69cb\u8cc7\u6599\u5eab | ADB HK</title>\n' +
    '<meta name="description" content="' + esc(org.desc || org.name + ' \u2014 \u9999\u6e2f\u52d5\u7269\u62ef\u6551\u6a5f\u69cb\u8cc7\u6599') + '">\n' +
    '<link rel="preconnect" href="https://fonts.googleapis.com">\n' +
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n' +
    '<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@300;400;500;600&display=swap" rel="stylesheet">\n' +
    '<style>' + sharedCSS() + '</style>\n' +
    '</head>\n' +
    '<body>\n' +
    '<script src="/adb-hk/nav.js"></script>\n' +
    '<div class="page-header">\n' +
    '  <div class="page-header-inner">\n' +
    '    <div class="breadcrumb">\n' +
    '      <a href="/adb-hk/">\u9996\u9801</a>\n' +
    '      <span class="breadcrumb-sep">\u203a</span>\n' +
    '      <a href="/adb-hk/animal-rescue-organization-list/">\u52d5\u7269\u62ef\u6551\u6a5f\u69cb\u8cc7\u6599\u5eab</a>\n' +
    '      <span class="breadcrumb-sep">\u203a</span>\n' +
    '      <span>' + esc(org.name) + '</span>\n' +
    '    </div>\n' +
    '    <h1>' + esc(org.name) + '</h1>\n' +
    (org.en ? '    <div class="page-header-en">' + esc(org.en) + '</div>\n' : '') +
    '    <div class="header-badges">\n' +
    (org.category ? '      <span class="badge badge-sage">' + esc(org.category) + '</span>\n' : '') +
    (org.area ? '      <span class="badge badge-gray">' + esc(org.area) + '</span>\n' : '') +
    svcBadges + aniBadges +
    '    </div>\n' +
    '  </div>\n' +
    '</div>\n' +
    '<div class="main">\n' +
    '  <a class="back-btn" href="/adb-hk/animal-rescue-organization-list/">\n' +
    '    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>\n' +
    '    \u8fd4\u56de\u5217\u8868\n' +
    '  </a>\n' +
    '  <div class="detail-card">\n' +
    '    <table class="detail-table">' + rows + '</table>\n' +
    '  </div>\n' +
    '  <p style="font-size:12px;color:var(--text-muted);margin-top:1.5rem;text-align:right;">\u8cc7\u6599\u66f4\u65b0\uff1a' + lastUpdated + '</p>\n' +
    '</div>\n' +
    '<script src="/adb-hk/footer.js"></script>\n' +
    '</body>\n</html>';
}

/* ── build list page HTML (same as before, with detail page links added) ── */
function buildHTML(orgs, lastUpdated, schema) {
  const orgsJson = JSON.stringify(orgs);
  const typeOptions   = schema['\u670d\u52d9\u985e\u578b'] || ['\u52d5\u7269\u62ef\u6551', '\u6536\u5bb9\u6240', '\u9818\u990a\u670d\u52d9', '\u91ab\u7642\u6551\u52a9', 'TNR\u7d55\u80b2', '\u52d5\u7269\u5584\u7d42'];
  const animalOptions = schema['\u52d5\u7269\u7a2e\u985e'] || ['\u72d7\u72d7 \ud83d\udc15', '\u8c93\u8c93 \ud83d\udc08\u200d\u2b1b', '\u5154\u5154 \ud83d\udc07', '\u91ce\u751f\u52d5\u7269 \ud83e\udd8e'];

  function multiPills(id, dim, opts) {
    var lines = [];
    lines.push('<div class="toggle-group" id="' + id + '">');
    opts.forEach(function(o) {
      lines.push('  <button class="toggle-pill" data-val="' + esc(o) + '" onclick="toggleMulti(\'' + dim + '\',\'' + esc(o) + '\',this)">' + esc(o) + '</button>');
    });
    lines.push('</div>');
    return lines.join('\n');
  }

  function singlePills(id, dim, opts) {
    var lines = [];
    lines.push('<div class="toggle-group" id="' + id + '">');
    opts.forEach(function(o) {
      lines.push('  <button class="toggle-pill" data-val="' + esc(o) + '" onclick="toggleSingle(\'' + dim + '\',\'' + esc(o) + '\',this)">' + esc(o) + '</button>');
    });
    lines.push('</div>');
    return lines.join('\n');
  }

  var lines = [];
  lines.push('<!DOCTYPE html>');
  lines.push('<html lang="zh-Hant">');
  lines.push('<head>');
  lines.push('<meta charset="UTF-8">');
  lines.push('<meta name="viewport" content="width=device-width, initial-scale=1.0">');
  lines.push('<title>\u52d5\u7269\u62ef\u6551\u6a5f\u69cb\u8cc7\u6599\u5eab | ADB HK</title>');
  lines.push('<link rel="preconnect" href="https://fonts.googleapis.com">');
  lines.push('<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>');
  lines.push('<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@300;400;500;600&display=swap" rel="stylesheet">');
  lines.push('<style>');
  lines.push('*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}');
  lines.push(':root{');
  lines.push('  --coral:#FF6B2B;--coral-hover:#E85A1D;--coral-light:#FFF1EA;');
  lines.push('  --sage:#8FAF9B;--sage-deep:#6E8F7C;--sage-light:#E6F1EC;');
  lines.push('  --white:#FFFFFF;--bg-soft:#F7F8F7;');
  lines.push('  --text-primary:#2F2F2F;--text-secondary:#6B7280;--text-muted:#9CA3AF;');
  lines.push('  --border:#E5E7EB;--shadow:rgba(0,0,0,0.05);');
  lines.push('  --font:\'Noto Sans TC\',sans-serif;');
  lines.push('}');
  lines.push('body{font-family:var(--font);background:var(--bg-soft);color:var(--text-primary);min-height:100vh;}');
  lines.push('.page-header{background:var(--white);border-bottom:1px solid var(--border);padding:2.5rem 2rem 2rem;}');
  lines.push('.page-header-inner{max-width:1100px;margin:0 auto;}');
  lines.push('.breadcrumb{font-size:12px;color:var(--text-muted);margin-bottom:1rem;display:flex;align-items:center;gap:6px;}');
  lines.push('.breadcrumb a{color:var(--text-muted);text-decoration:none;}');
  lines.push('.breadcrumb a:hover{color:var(--coral);}');
  lines.push('.breadcrumb-sep{color:var(--border);}');
  lines.push('.page-header h1{font-size:26px;font-weight:600;color:var(--text-primary);margin-bottom:6px;letter-spacing:-.3px;}');
  lines.push('.page-header-sub{font-size:14px;color:var(--text-secondary);font-weight:300;margin-bottom:1.75rem;}');
  lines.push('.scorecards{display:flex;gap:1rem;flex-wrap:wrap;align-items:flex-end;}');
  lines.push('.scorecard{background:var(--white);border:1px solid var(--border);border-radius:12px;padding:1rem 1.5rem;min-width:108px;text-align:center;box-shadow:0 2px 8px var(--shadow);}');
  lines.push('.scorecard-num{font-size:36px;font-weight:600;color:var(--coral);line-height:1;margin-bottom:6px;}');
  lines.push('.scorecard-label{font-size:12px;color:var(--text-secondary);white-space:nowrap;}');
  lines.push('.update-note{font-size:12px;color:var(--text-muted);margin-left:auto;}');
  lines.push('.main{max-width:1100px;margin:0 auto;padding:2rem;display:grid;grid-template-columns:230px 1fr;gap:1.5rem;align-items:start;}');
  lines.push('.sidebar{background:var(--white);border:1px solid var(--border);border-radius:12px;overflow:hidden;position:sticky;top:76px;}');
  lines.push('.filter-group{border-bottom:1px solid var(--border);}');
  lines.push('.filter-group:last-child{border-bottom:none;}');
  lines.push('.filter-group-header{display:flex;align-items:center;justify-content:space-between;padding:.85rem 1.1rem;cursor:pointer;user-select:none;background:transparent;border:none;width:100%;font-family:var(--font);transition:background .15s;}');
  lines.push('.filter-group-header:hover{background:var(--bg-soft);}');
  lines.push('.filter-group-title{font-size:12px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.8px;display:flex;align-items:center;gap:6px;}');
  lines.push('.filter-active-badge{background:var(--coral);color:white;font-size:10px;font-weight:600;border-radius:10px;padding:1px 6px;display:none;}');
  lines.push('.filter-active-badge.visible{display:inline-block;}');
  lines.push('.filter-chevron{width:15px;height:15px;color:var(--text-muted);transition:transform .2s;flex-shrink:0;}');
  lines.push('.filter-group.open .filter-chevron{transform:rotate(180deg);}');
  lines.push('.filter-body{display:none;padding:0 1rem 1rem;}');
  lines.push('.filter-group.open .filter-body{display:block;}');
  lines.push('.toggle-group{display:flex;flex-wrap:wrap;gap:6px;}');
  lines.push('.toggle-pill{padding:5px 11px;border-radius:20px;border:1px solid var(--border);background:var(--white);font-family:var(--font);font-size:12px;color:var(--text-secondary);cursor:pointer;transition:all .15s;white-space:nowrap;}');
  lines.push('.toggle-pill:hover{border-color:var(--coral);color:var(--coral);}');
  lines.push('.toggle-pill.active{background:var(--coral);border-color:var(--coral);color:white;font-weight:500;}');
  lines.push('.content{min-width:0;}');
  lines.push('.search-bar{display:flex;gap:10px;margin-bottom:1rem;}');
  lines.push('.search-input-wrap{flex:1;position:relative;}');
  lines.push('.search-icon-svg{position:absolute;left:12px;top:50%;transform:translateY(-50%);color:var(--text-muted);pointer-events:none;}');
  lines.push('.search-input{width:100%;height:42px;border:1px solid var(--border);border-radius:8px;padding:0 12px 0 38px;font-family:var(--font);font-size:14px;color:var(--text-primary);background:var(--white);outline:none;transition:border-color .2s;}');
  lines.push('.search-input:focus{border-color:var(--coral);}');
  lines.push('.search-input::placeholder{color:var(--text-muted);}');
  lines.push('.search-btn{height:42px;padding:0 20px;background:var(--coral);color:white;border:none;border-radius:8px;font-family:var(--font);font-size:14px;font-weight:500;cursor:pointer;transition:background .2s;}');
  lines.push('.search-btn:hover{background:var(--coral-hover);}');
  lines.push('.active-filters{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:1rem;}');
  lines.push('.filter-pill{display:flex;align-items:center;gap:5px;background:var(--coral-light);color:var(--coral);border-radius:20px;padding:4px 10px 4px 12px;font-size:12px;font-weight:500;border:1px solid rgba(255,107,43,.2);}');
  lines.push('.filter-pill button{background:none;border:none;cursor:pointer;color:var(--coral);font-size:14px;line-height:1;padding:0;opacity:.7;}');
  lines.push('.filter-pill button:hover{opacity:1;}');
  lines.push('.results-meta{font-size:13px;color:var(--text-muted);margin-bottom:1rem;}');
  lines.push('.results-meta strong{color:var(--text-primary);font-weight:500;}');
  lines.push('.org-list{display:flex;flex-direction:column;gap:10px;}');
  lines.push('.org-card{background:var(--white);border:1px solid var(--border);border-radius:12px;overflow:hidden;transition:border-color .2s,box-shadow .2s;}');
  lines.push('.org-card:hover{border-color:#d1d5db;}');
  lines.push('.org-card.expanded{border-color:var(--coral);box-shadow:0 4px 16px var(--shadow);}');
  lines.push('.org-card-header{display:flex;align-items:center;gap:12px;padding:.9rem 1.2rem;cursor:pointer;user-select:none;}');
  lines.push('.org-avatar{width:40px;height:40px;border-radius:9px;background:var(--coral-light);display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0;}');
  lines.push('.org-avatar.green{background:var(--sage-light);}');
  lines.push('.org-header-info{flex:1;min-width:0;}');
  lines.push('.org-name{font-size:14px;font-weight:600;color:var(--text-primary);margin-bottom:5px;}');
  lines.push('.org-header-tags{display:flex;flex-wrap:wrap;gap:4px;align-items:center;}');
  lines.push('.badge{font-size:11px;padding:2px 8px;border-radius:20px;font-weight:500;white-space:nowrap;}');
  lines.push('.badge-coral{background:var(--coral-light);color:var(--coral);}');
  lines.push('.badge-sage{background:var(--sage-light);color:var(--sage-deep);}');
  lines.push('.badge-gray{background:var(--bg-soft);color:var(--text-secondary);border:1px solid var(--border);}');
  lines.push('.card-chevron{width:16px;height:16px;color:var(--text-muted);transition:transform .25s;flex-shrink:0;}');
  lines.push('.org-card.expanded .card-chevron{transform:rotate(180deg);}');
  lines.push('.org-card-body{display:none;border-top:1px solid var(--border);}');
  lines.push('.org-card.expanded .org-card-body{display:block;}');
  lines.push('.detail-table{width:100%;border-collapse:collapse;font-size:13px;}');
  lines.push('.detail-table tr{border-bottom:1px solid var(--border);}');
  lines.push('.detail-table tr:last-child{border-bottom:none;}');
  lines.push('.detail-table td{padding:10px 1.25rem;vertical-align:top;line-height:1.6;}');
  lines.push('.detail-table td:first-child{width:90px;color:var(--text-muted);font-size:12px;white-space:nowrap;padding-top:12px;font-weight:500;}');
  lines.push('.detail-table td:last-child{color:var(--text-secondary);}');
  lines.push('.detail-table a{color:var(--coral);text-decoration:none;}');
  lines.push('.detail-table a:hover{text-decoration:underline;}');
  lines.push('.social-btns{display:flex;flex-wrap:wrap;gap:7px;margin-top:2px;}');
  lines.push('.social-btn{display:inline-flex;align-items:center;gap:6px;padding:5px 13px;border-radius:7px;border:1px solid var(--border);background:var(--white);font-family:var(--font);font-size:12px;font-weight:500;color:var(--text-secondary);text-decoration:none;transition:all .15s;}');
  lines.push('.social-btn.fb{border-color:#bad3f5;color:#1877f2;}');
  lines.push('.social-btn.fb:hover{background:#e8f0fe;}');
  lines.push('.social-btn.ig{border-color:#f5c6da;color:#e1306c;}');
  lines.push('.social-btn.ig:hover{background:#fdf0f5;}');
  lines.push('.badge-tax{display:inline-block;background:#eef6ee;color:#3a7a3a;font-size:11px;font-weight:600;border-radius:6px;padding:2px 8px;margin-left:6px;vertical-align:middle;}');
  lines.push('.view-detail-btn{display:inline-flex;align-items:center;gap:5px;font-size:12px;color:var(--coral);text-decoration:none;font-weight:500;padding:4px 0;border:none;background:none;cursor:pointer;font-family:var(--font);transition:opacity .15s;}');
  lines.push('.view-detail-btn:hover{opacity:.75;}');
  lines.push('.detail-page-btn{display:none;align-items:center;gap:5px;padding:7px 14px;background:var(--coral);color:white;border:none;border-radius:8px;font-family:var(--font);font-size:12px;font-weight:600;text-decoration:none;white-space:nowrap;flex-shrink:0;transition:background .15s;cursor:pointer;}');
  lines.push('.org-card.expanded .detail-page-btn{display:inline-flex;}');
  lines.push('.detail-page-btn:hover{background:var(--coral-hover);}');
  lines.push('.empty-state{background:var(--white);border:1px solid var(--border);border-radius:12px;padding:3rem 2rem;text-align:center;}');
  lines.push('.empty-icon{font-size:40px;margin-bottom:1rem;}');
  lines.push('.empty-state h3{font-size:16px;font-weight:500;margin-bottom:6px;}');
  lines.push('.empty-state p{font-size:13px;color:var(--text-muted);}');
  lines.push('.float-btns{position:fixed;bottom:28px;left:0;right:0;z-index:300;display:flex;justify-content:space-between;padding:0 28px;pointer-events:none;}');
  lines.push('.float-filter-btn,.float-top-btn{pointer-events:all;display:flex;align-items:center;gap:8px;border-radius:50px;font-family:var(--font);font-size:14px;font-weight:500;cursor:pointer;transition:background .2s,transform .15s,box-shadow .2s;}');
  lines.push('.float-filter-btn{background:var(--coral);color:white;padding:12px 20px;border:none;box-shadow:0 4px 20px rgba(255,107,43,.4);}');
  lines.push('.float-filter-btn:hover{background:var(--coral-hover);transform:translateY(-2px);box-shadow:0 6px 24px rgba(255,107,43,.5);}');
  lines.push('.float-top-btn{background:var(--white);color:var(--text-secondary);padding:12px 16px;border:1px solid var(--border);box-shadow:0 4px 16px var(--shadow);opacity:0;transform:translateY(10px);pointer-events:none;transition:opacity .25s,transform .25s,background .15s;}');
  lines.push('.float-top-btn.visible{opacity:1;transform:translateY(0);pointer-events:all;}');
  lines.push('.float-top-btn:hover{background:var(--bg-soft);transform:translateY(-2px);}');
  lines.push('.float-filter-btn svg,.float-top-btn svg{width:16px;height:16px;flex-shrink:0;}');
  lines.push('.float-filter-count{background:white;color:var(--coral);font-size:11px;font-weight:700;border-radius:10px;padding:1px 7px;display:none;}');
  lines.push('.float-filter-count.visible{display:inline-block;}');
  lines.push('.filter-drawer-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:400;opacity:0;transition:opacity .25s;}');
  lines.push('.filter-drawer-overlay.open{display:block;opacity:1;}');
  lines.push('.filter-drawer{position:fixed;bottom:0;left:0;right:0;z-index:500;background:var(--white);border-radius:20px 20px 0 0;box-shadow:0 -8px 40px rgba(0,0,0,.12);transform:translateY(100%);transition:transform .3s cubic-bezier(.32,.72,0,1);max-height:80vh;overflow-y:auto;}');
  lines.push('.filter-drawer.open{transform:translateY(0);}');
  lines.push('.filter-drawer-handle{display:flex;justify-content:center;padding:12px 0 0;}');
  lines.push('.filter-drawer-handle-bar{width:36px;height:4px;background:var(--border);border-radius:2px;}');
  lines.push('.filter-drawer-head{display:flex;align-items:center;justify-content:space-between;padding:1rem 1.5rem .75rem;border-bottom:1px solid var(--border);}');
  lines.push('.filter-drawer-title{font-size:15px;font-weight:600;color:var(--text-primary);}');
  lines.push('.filter-drawer-close{width:30px;height:30px;border-radius:50%;border:none;background:var(--bg-soft);color:var(--text-secondary);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:16px;transition:background .15s;}');
  lines.push('.filter-drawer-close:hover{background:var(--border);}');
  lines.push('.filter-drawer-body{padding:1rem 1.5rem;}');
  lines.push('.filter-drawer-section{margin-bottom:1.25rem;}');
  lines.push('.filter-drawer-section:last-child{margin-bottom:.5rem;}');
  lines.push('.filter-drawer-label{font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.8px;margin-bottom:10px;}');
  lines.push('.filter-drawer-footer{padding:1rem 1.5rem 1.5rem;border-top:1px solid var(--border);display:flex;gap:10px;}');
  lines.push('.drawer-clear-btn{flex:1;height:44px;border:1px solid var(--border);border-radius:10px;background:var(--white);font-family:var(--font);font-size:14px;color:var(--text-secondary);cursor:pointer;transition:all .15s;}');
  lines.push('.drawer-clear-btn:hover{border-color:var(--coral);color:var(--coral);}');
  lines.push('.drawer-apply-btn{flex:2;height:44px;border:none;border-radius:10px;background:var(--coral);font-family:var(--font);font-size:14px;font-weight:500;color:white;cursor:pointer;transition:background .15s;}');
  lines.push('.drawer-apply-btn:hover{background:var(--coral-hover);}');
  lines.push('@media(max-width:768px){');
  lines.push('.main{grid-template-columns:1fr;padding:1rem;}');
  lines.push('.sidebar{position:static;}');
  lines.push('.page-header{padding:1.5rem 1rem 1rem;}');
  lines.push('.scorecard-num{font-size:28px;}');
  lines.push('.update-note{display:none;}');
  lines.push('#adb-nav{padding:0 1rem;}');
  lines.push('.detail-table td:first-child{width:72px;}');
  lines.push('}');
  lines.push('</style>');
  lines.push('</head>');
  lines.push('<body>');
  lines.push('<script src="/adb-hk/nav.js"></script>');
  lines.push('<div class="page-header">');
  lines.push('  <div class="page-header-inner">');
  lines.push('    <div class="breadcrumb">');
  lines.push('      <a href="/adb-hk/">\u9996\u9801</a><span class="breadcrumb-sep">\u203a</span><span>\u52d5\u7269\u62ef\u6551\u6a5f\u69cb\u8cc7\u6599\u5eab</span>');
  lines.push('    </div>');
  lines.push('    <h1>\u52d5\u7269\u62ef\u6551\u6a5f\u69cb\u8cc7\u6599\u5eab</h1>');
  lines.push('    <p class="page-header-sub">\u641c\u5c0b\u9999\u6e2f\u5404\u5340\u52d5\u7269\u6551\u63f4\u3001\u9818\u990a\u53ca\u7fa9\u5de5\u8cc7\u8a0a\uff0c\u70ba\u6bdb\u5b69\u627e\u5230\u6700\u5408\u9069\u7684\u5e6b\u52a9</p>');
  lines.push('    <div class="scorecards">');
  lines.push('      <div class="scorecard"><div class="scorecard-num" id="totalCount">0</div><div class="scorecard-label">\u767b\u8a18\u6a5f\u69cb</div></div>');
  lines.push('      <div class="scorecard"><div class="scorecard-num" id="ngoCount">0</div><div class="scorecard-label">\u975e\u725f\u5229\u6a5f\u69cb</div></div>');
  lines.push('      <div class="scorecard"><div class="scorecard-num" id="volCount">0</div><div class="scorecard-label">\u7fa9\u5de5\u7d44\u7e54</div></div>');
  lines.push('      <div class="update-note">\u8cc7\u6599\u66f4\u65b0\uff1a' + lastUpdated + '</div>');
  lines.push('    </div>');
  lines.push('  </div>');
  lines.push('</div>');
  lines.push('<div class="main">');
  lines.push('  <aside class="sidebar">');
  lines.push('    <div class="filter-group" id="grp-service">');
  lines.push('      <button class="filter-group-header" onclick="toggleGroup(\'grp-service\')">');
  lines.push('        <span class="filter-group-title">\u670d\u52d9\u985e\u578b<span class="filter-active-badge" id="badge-service"></span></span>');
  lines.push('        <svg class="filter-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>');
  lines.push('      </button>');
  lines.push('      <div class="filter-body">' + multiPills('service-toggles', 'service', typeOptions) + '</div>');
  lines.push('    </div>');
  lines.push('    <div class="filter-group" id="grp-animal">');
  lines.push('      <button class="filter-group-header" onclick="toggleGroup(\'grp-animal\')">');
  lines.push('        <span class="filter-group-title">\u52d5\u7269\u7a2e\u985e<span class="filter-active-badge" id="badge-animal"></span></span>');
  lines.push('        <svg class="filter-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>');
  lines.push('      </button>');
  lines.push('      <div class="filter-body">' + multiPills('animal-toggles', 'animal', animalOptions) + '</div>');
  lines.push('    </div>');
  lines.push('    <div class="filter-group" id="grp-type">');
  lines.push('      <button class="filter-group-header" onclick="toggleGroup(\'grp-type\')">');
  lines.push('        <span class="filter-group-title">\u985e\u5225<span class="filter-active-badge" id="badge-type"></span></span>');
  lines.push('        <svg class="filter-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>');
  lines.push('      </button>');
  lines.push('      <div class="filter-body">' + singlePills('type-toggles', 'type', ['\u975e\u725f\u5229\u6a5f\u69cb', '\u7368\u7acb\u7fa9\u5de5']) + '</div>');
  lines.push('    </div>');
  lines.push('  </aside>');
  lines.push('  <div class="content">');
  lines.push('    <div class="search-bar">');
  lines.push('      <div class="search-input-wrap">');
  lines.push('        <svg class="search-icon-svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>');
  lines.push('        <input class="search-input" type="text" id="searchInput" placeholder="\u641c\u5c0b\u6a5f\u69cb\u540d\u7a31\u3001\u5730\u5340\u6216\u670d\u52d9\u2026" oninput="filterOrgs()">');
  lines.push('      </div>');
  lines.push('      <button class="search-btn" onclick="filterOrgs()">\u641c\u5c0b</button>');
  lines.push('    </div>');
  lines.push('    <div class="active-filters" id="active-pills"></div>');
  lines.push('    <div class="results-meta" id="results-meta"></div>');
  lines.push('    <div class="org-list" id="orgList"></div>');
  lines.push('  </div>');
  lines.push('</div>');

  lines.push('<script>');
  lines.push('var orgs = ' + orgsJson + ';');
  lines.push('document.getElementById(\'totalCount\').textContent = orgs.length;');
  lines.push('document.getElementById(\'ngoCount\').textContent = orgs.filter(function(o){return o.category===\'\u975e\u725f\u5229\u6a5f\u69cb\';}).length;');
  lines.push('document.getElementById(\'volCount\').textContent = orgs.filter(function(o){return o.category===\'\u7368\u7acb\u7fa9\u5de5\';}).length;');
  lines.push('var activeServices=[];');
  lines.push('var activeAnimals=[];');
  lines.push('var activeType=null;');
  lines.push('function toggleGroup(id){document.getElementById(id).classList.toggle(\'open\');}');
  lines.push('function toggleMulti(dim,val,btn){var arr=dim===\'service\'?activeServices:activeAnimals;var idx=arr.indexOf(val);if(idx>=0){arr.splice(idx,1);btn.classList.remove(\'active\');}else{arr.push(val);btn.classList.add(\'active\');}updateBadge(dim,arr.length);filterOrgs();renderPills();}');
  lines.push('function toggleSingle(dim,val,btn){if(activeType===val){activeType=null;btn.classList.remove(\'active\');updateBadge(dim,0);}else{document.querySelectorAll(\'#type-toggles .toggle-pill\').forEach(function(b){b.classList.remove(\'active\');});activeType=val;btn.classList.add(\'active\');updateBadge(dim,1);}filterOrgs();renderPills();}');
  lines.push('function updateBadge(dim,count){var b=document.getElementById(\'badge-\'+dim);if(!b)return;b.textContent=count;if(count>0)b.classList.add(\'visible\');else b.classList.remove(\'visible\');}');
  lines.push('function filterOrgs(){var q=document.getElementById(\'searchInput\').value.toLowerCase();var list=orgs.filter(function(o){if(activeServices.length&&!o.services.some(function(s){return activeServices.indexOf(s)>=0;}))return false;if(activeAnimals.length&&!o.animals.some(function(a){return activeAnimals.indexOf(a)>=0;}))return false;if(activeType&&o.category!==activeType)return false;if(q&&![o.name,o.en,o.area,o.desc].some(function(s){return s&&s.toLowerCase().indexOf(q)>=0;}))return false;return true;});renderOrgs(list);}');
  lines.push('function renderPills(){var c=document.getElementById(\'active-pills\');c.innerHTML=\'\';activeServices.forEach(function(v){c.appendChild(makePill(v,function(){var i=activeServices.indexOf(v);if(i>=0)activeServices.splice(i,1);var btn=document.querySelector(\'#service-toggles [data-val="\'+v+\'"]\');if(btn)btn.classList.remove(\'active\');updateBadge(\'service\',activeServices.length);filterOrgs();renderPills();}));});activeAnimals.forEach(function(v){c.appendChild(makePill(v,function(){var i=activeAnimals.indexOf(v);if(i>=0)activeAnimals.splice(i,1);var btn=document.querySelector(\'#animal-toggles [data-val="\'+v+\'"]\');if(btn)btn.classList.remove(\'active\');updateBadge(\'animal\',activeAnimals.length);filterOrgs();renderPills();}));});if(activeType){c.appendChild(makePill(activeType,function(){var btn=document.querySelector(\'#type-toggles [data-val="\'+activeType+\'"]\');if(btn)btn.classList.remove(\'active\');activeType=null;updateBadge(\'type\',0);filterOrgs();renderPills();}));}}');
  lines.push('function makePill(label,onRemove){var p=document.createElement(\'div\');p.className=\'filter-pill\';p.innerHTML=label+\' <button title="\u79fb\u9664\u7bf9\u9078">\xd7</button>\';p.querySelector(\'button\').addEventListener(\'click\',onRemove);return p;}');
  lines.push('function toggleCard(id){document.getElementById(\'card-\'+id).classList.toggle(\'expanded\');}');

  // renderOrgs — now includes "查看詳情" link if org has a slug
  lines.push('function renderOrgs(list){');
  lines.push('  var el=document.getElementById(\'orgList\');');
  lines.push('  var meta=document.getElementById(\'results-meta\');');
  lines.push('  if(!list.length){el.innerHTML=\'<div class="empty-state"><div class="empty-icon">\ud83d\udd0d</div><h3>\u627e\u4e0d\u5230\u7b26\u5408\u689d\u4ef6\u7684\u6a5f\u69cb</h3><p>\u8a66\u8a66\u66f4\u63db\u641c\u5c0b\u8a5e\u6216\u7bf9\u9078\u689d\u4ef6</p></div>\';meta.innerHTML=\'\';return;}');
  lines.push('  meta.innerHTML=\'\u986f\u793a <strong>\'+list.length+\'</strong> \u500b\u6a5f\u69cb\';');
  lines.push('  el.innerHTML=list.map(function(o,i){');
  lines.push('    var typeLabel=o.category||\'\'');
  lines.push('    var svcBadges=o.services.map(function(s){return\'<span class="badge badge-coral">\'+s+\'</span>\';}).join(\'\')');
  lines.push('    var aniBadges=o.animals.map(function(a){return\'<span class="badge badge-gray">\'+a+\'</span>\';}).join(\'\')');
  lines.push('    var rows=\'\'');
  lines.push('    rows+=\'<tr><td>\u6a5f\u69cb\u7c21\u4ecb</td><td>\'+(o.desc||\'-\')+\'</td></tr>\'');
  lines.push('    rows+=\'<tr><td>\u670d\u52d9\u6642\u9593</td><td>\'+(o.hours||\'-\')+\'</td></tr>\'');
  lines.push('    rows+=\'<tr><td>\u7db2\u7ad9</td><td>\'+(o.website?\'<a href="\'+o.website+\'" target="_blank" rel="noopener">\'+o.website+\'</a>\':\'-\')+\'</td></tr>\'');
  lines.push('    if(o.phones&&o.phones.length){var phLinks=o.phones.map(function(p){var d=p.replace(/\\D/g,\'\');var full=d.length<=8?\'852\'+d:d;var display=d.length===8?d.slice(0,4)+\' \'+d.slice(4):p;return\'<a href="tel:+\'+full+\'">\'+display+\'</a>\';}).join(\'\uff1b\');rows+=\'<tr><td>\u96fb\u8a71</td><td>\'+phLinks+\'</td></tr>\';}else{rows+=\'<tr><td>\u96fb\u8a71</td><td>-</td></tr>\';}');
  lines.push('    if(o.whatsapps&&o.whatsapps.length){var waLinks=o.whatsapps.map(function(w){var d=w.replace(/\\D/g,\'\');var full=d.length<=8?\'852\'+d:d;var display=d.length===8?d.slice(0,4)+\' \'+d.slice(4):w;return\'<a href="https://wa.me/\'+full+\'" target="_blank" rel="noopener">\'+display+\'</a>\';}).join(\'\uff1b\');rows+=\'<tr><td>WhatsApp</td><td>\'+waLinks+\'</td></tr>\';}else{rows+=\'<tr><td>WhatsApp</td><td>-</td></tr>\';}');
  lines.push('    if(o.emails&&o.emails.length){var emailLinks=o.emails.map(function(e){return\'<a href="mailto:\'+e+\'">\'+e+\'</a>\';}).join(\'<br>\');rows+=\'<tr><td>\u96fb\u90f5</td><td>\'+emailLinks+\'</td></tr>\';}else{rows+=\'<tr><td>\u96fb\u90f5</td><td>-</td></tr>\';}');
  lines.push('    var socials=\'\';if(o.facebook)socials+=\'<a class="social-btn fb" href="\'+o.facebook.url+\'" target="_blank" rel="noopener"><svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/></svg>Facebook</a>\';if(o.instagram)socials+=\'<a class="social-btn ig" href="\'+o.instagram.url+\'" target="_blank" rel="noopener"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>Instagram</a>\';rows+=\'<tr><td>\u793e\u4ea4\u5a92\u9ad4</td><td>\'+(socials?\'<div class="social-btns">\'+socials+\'</div>\':\'-\')+\'</td></tr>\'');
  lines.push('    var charityCell=o.charityRef||\'-\';if(o.taxDeductible){charityCell=o.charityRef+\' <span class="badge-tax">\u53ef\u624d\u7a05</span>\';}rows+=\'<tr><td>\u6148\u5584\u5718\u9ad4<br>\u53c3\u8003\u7de8\u865f</td><td>\'+charityCell+\'</td></tr>\'');
  lines.push('    var donationCell=\'-\';if(o.donation){donationCell=o.donation.replace(/(\\d{4})\\s*(\\d{4})/g,function(match,a,b){var full=\'852\'+a+b;return\'<a href="tel:+\'+full+\'">\'+a+\' \'+b+\'</a>\';});}rows+=\'<tr><td>\u6350\u52a9\u65b9\u6cd5</td><td>\'+donationCell+\'</td></tr>\'');
  lines.push('    var addrCell=\'-\';if(o.addressZh||o.addressEn){var parts=[];if(o.addressZh)parts.push(o.addressZh);if(o.addressEn)parts.push(o.addressEn);addrCell=parts.join(\'<br><br>\');}rows+=\'<tr><td>\u5730\u5740</td><td>\'+addrCell+\'</td></tr>\'');
  lines.push('    var detailBtn=o.slug?\'<a class="detail-page-btn" href="/adb-hk/animal-rescue-organization-list/\'+o.slug+\'/\" onclick="event.stopPropagation()">\u67e5\u770b\u8a73\u60c5 &gt;&gt;</a>\':\'\';');
  lines.push('    return \'<div class="org-card" id="card-\'+i+\'">\'');
  lines.push('      +\'<div class="org-card-header" onclick="toggleCard(\'+i+\')">\'');
  lines.push('      +\'<div class="org-avatar \'+o.avatarColor+\'">\'+o.icon+\'</div>\'');
  lines.push('      +\'<div class="org-header-info">\'');
  lines.push('      +\'<div class="org-name">\'+o.name+(o.en?\' <span style="font-size:12px;color:var(--text-muted);font-weight:400;">\'+o.en+\'</span>\':\'\')+\'</div>\'');
  lines.push('      +\'<div class="org-header-tags">\'');
  lines.push('      +(typeLabel?\'<span class="badge badge-sage">\'+typeLabel+\'</span>\':\'\')+\'\'');
  lines.push('      +(o.area?\'<span class="badge badge-gray">\'+o.area+\'</span>\':\'\')+svcBadges+aniBadges');
  lines.push('      +\'</div></div>\'');
  lines.push('      +detailBtn');
  lines.push('      +\'<svg class="card-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>\'');
  lines.push('      +\'</div>\'');
  lines.push('      +\'<div class="org-card-body"><table class="detail-table">\'+rows+\'</table></div>\'');
  lines.push('      +\'</div>\'');
  lines.push('  }).join(\'\');');
  lines.push('}');

  lines.push('filterOrgs();');

  // floating drawer JS (unchanged from original)
  lines.push('function openFilterDrawer(){syncDrawerToState();document.getElementById(\'filterDrawer\').classList.add(\'open\');document.getElementById(\'filterOverlay\').classList.add(\'open\');document.body.style.overflow=\'hidden\';}');
  lines.push('function closeFilterDrawer(){document.getElementById(\'filterDrawer\').classList.remove(\'open\');document.getElementById(\'filterOverlay\').classList.remove(\'open\');document.body.style.overflow=\'\';}');
  lines.push('function syncDrawerToState(){document.querySelectorAll(\'#drawer-service-toggles .toggle-pill\').forEach(function(b){b.classList.toggle(\'active\',activeServices.indexOf(b.dataset.val)>=0);});document.querySelectorAll(\'#drawer-animal-toggles .toggle-pill\').forEach(function(b){b.classList.toggle(\'active\',activeAnimals.indexOf(b.dataset.val)>=0);});document.querySelectorAll(\'#drawer-type-toggles .toggle-pill\').forEach(function(b){b.classList.toggle(\'active\',activeType===b.dataset.val);});}');
  lines.push('function syncSidebarToState(){document.querySelectorAll(\'#service-toggles .toggle-pill\').forEach(function(b){b.classList.toggle(\'active\',activeServices.indexOf(b.dataset.val)>=0);});document.querySelectorAll(\'#animal-toggles .toggle-pill\').forEach(function(b){b.classList.toggle(\'active\',activeAnimals.indexOf(b.dataset.val)>=0);});document.querySelectorAll(\'#type-toggles .toggle-pill\').forEach(function(b){b.classList.toggle(\'active\',activeType===b.dataset.val);});updateBadge(\'service\',activeServices.length);updateBadge(\'animal\',activeAnimals.length);updateBadge(\'type\',activeType?1:0);}');
  lines.push('function toggleMultiDrawer(dim,val,btn){var arr=dim===\'service\'?activeServices:activeAnimals;var idx=arr.indexOf(val);if(idx>=0){arr.splice(idx,1);btn.classList.remove(\'active\');}else{arr.push(val);btn.classList.add(\'active\');}syncSidebarToState();updateFloatCount();filterOrgs();renderPills();}');
  lines.push('function toggleSingleDrawer(dim,val,btn){if(activeType===val){activeType=null;btn.classList.remove(\'active\');}else{document.querySelectorAll(\'#drawer-type-toggles .toggle-pill\').forEach(function(b){b.classList.remove(\'active\');});activeType=val;btn.classList.add(\'active\');}syncSidebarToState();updateFloatCount();filterOrgs();renderPills();}');
  lines.push('function clearAllFilters(){activeServices.length=0;activeAnimals.length=0;activeType=null;document.querySelectorAll(\'.toggle-pill\').forEach(function(b){b.classList.remove(\'active\');});updateBadge(\'service\',0);updateBadge(\'animal\',0);updateBadge(\'type\',0);updateFloatCount();filterOrgs();renderPills();}');
  lines.push('function updateFloatCount(){var total=activeServices.length+activeAnimals.length+(activeType?1:0);var el=document.getElementById(\'floatFilterCount\');el.textContent=total;if(total>0)el.classList.add(\'visible\');else el.classList.remove(\'visible\');}');
  lines.push('function scrollToTop(){window.scrollTo({top:0,behavior:\'smooth\'});}');
  lines.push('window.addEventListener(\'scroll\',function(){var btn=document.getElementById(\'floatTopBtn\');if(!btn)return;if(window.scrollY>300)btn.classList.add(\'visible\');else btn.classList.remove(\'visible\');});');
  lines.push('</script>');

  lines.push('<script src="/adb-hk/footer.js"></script>');

  // floating buttons
  lines.push('<div class="float-btns">');
  lines.push('  <button class="float-filter-btn" id="floatFilterBtn" onclick="openFilterDrawer()">');
  lines.push('    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="6" x2="20" y2="6"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="11" y1="18" x2="13" y2="18"/></svg>');
  lines.push('    \u7bf9\u9078');
  lines.push('    <span class="float-filter-count" id="floatFilterCount"></span>');
  lines.push('  </button>');
  lines.push('  <button class="float-top-btn" id="floatTopBtn" onclick="scrollToTop()">');
  lines.push('    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="18 15 12 9 6 15"/></svg>');
  lines.push('    \u9802\u90e8');
  lines.push('  </button>');
  lines.push('</div>');

  // filter drawer overlay + drawer
  lines.push('<div class="filter-drawer-overlay" id="filterOverlay" onclick="closeFilterDrawer()"></div>');
  lines.push('<div class="filter-drawer" id="filterDrawer">');
  lines.push('  <div class="filter-drawer-handle"><div class="filter-drawer-handle-bar"></div></div>');
  lines.push('  <div class="filter-drawer-head">');
  lines.push('    <span class="filter-drawer-title">\u7bf9\u9078\u6a5f\u69cb</span>');
  lines.push('    <button class="filter-drawer-close" onclick="closeFilterDrawer()">\xd7</button>');
  lines.push('  </div>');
  lines.push('  <div class="filter-drawer-body">');
  lines.push('    <div class="filter-drawer-section">');
  lines.push('      <div class="filter-drawer-label">\u670d\u52d9\u985e\u578b</div>');
  lines.push('      <div class="toggle-group" id="drawer-service-toggles">');
  typeOptions.forEach(function(o) {
    lines.push('        <button class="toggle-pill" data-val="' + esc(o) + '" onclick="toggleMultiDrawer(\'service\',\'' + esc(o) + '\',this)">' + esc(o) + '</button>');
  });
  lines.push('      </div>');
  lines.push('    </div>');
  lines.push('    <div class="filter-drawer-section">');
  lines.push('      <div class="filter-drawer-label">\u52d5\u7269\u7a2e\u985e</div>');
  lines.push('      <div class="toggle-group" id="drawer-animal-toggles">');
  animalOptions.forEach(function(o) {
    lines.push('        <button class="toggle-pill" data-val="' + esc(o) + '" onclick="toggleMultiDrawer(\'animal\',\'' + esc(o) + '\',this)">' + esc(o) + '</button>');
  });
  lines.push('      </div>');
  lines.push('    </div>');
  lines.push('    <div class="filter-drawer-section">');
  lines.push('      <div class="filter-drawer-label">\u985e\u5225</div>');
  lines.push('      <div class="toggle-group" id="drawer-type-toggles">');
  lines.push('        <button class="toggle-pill" data-val="\u975e\u725f\u5229\u6a5f\u69cb" onclick="toggleSingleDrawer(\'type\',\'\u975e\u725f\u5229\u6a5f\u69cb\',this)">\u975e\u725f\u5229\u6a5f\u69cb</button>');
  lines.push('        <button class="toggle-pill" data-val="\u7368\u7acb\u7fa9\u5de5" onclick="toggleSingleDrawer(\'type\',\'\u7368\u7acb\u7fa9\u5de5\',this)">\u7368\u7acb\u7fa9\u5de5</button>');
  lines.push('      </div>');
  lines.push('    </div>');
  lines.push('  </div>');
  lines.push('  <div class="filter-drawer-footer">');
  lines.push('    <button class="drawer-clear-btn" onclick="clearAllFilters()">\u6e05\u9664\u5168\u90e8</button>');
  lines.push('    <button class="drawer-apply-btn" onclick="closeFilterDrawer()">\u986f\u793a\u7d50\u679c</button>');
  lines.push('  </div>');
  lines.push('</div>');
  lines.push('</body>');
  lines.push('</html>');

  return lines.join('\n');
}

/* ── main ── */
(async function () {
  console.log('Fetching Notion schema...');
  const schema = await fetchSchema();
  console.log('\u670d\u52d9\u985e\u578b:', schema['\u670d\u52d9\u985e\u578b']);
  console.log('\u52d5\u7269\u7a2e\u985e:', schema['\u52d5\u7269\u7a2e\u985e']);

  console.log('Fetching Notion records...');
  const pages = await fetchAll();
  console.log('Found', pages.length, 'records');

  const orgs = pages
    .map(toOrg)
    .filter(o => o.name)
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));

  const lastUpdated = new Date().toLocaleDateString('zh-HK', {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  /* ── write list page ── */
  const html = buildHTML(orgs, lastUpdated, schema);
  const listPath = path.join(__dirname, '..', '..', 'animal-rescue-organization-list', 'index.html');
  fs.mkdirSync(path.dirname(listPath), { recursive: true });
  fs.writeFileSync(listPath, html, 'utf8');
  console.log('Written list page to animal-rescue-organization-list/index.html');

  /* ── write individual detail pages ── */
  let detailCount = 0;
  let skippedCount = 0;
  orgs.forEach(function(org) {
    if (!org.slug) {
      console.log('SKIP (no slug):', org.name);
      skippedCount++;
      return;
    }
    const detailHtml = buildDetailHTML(org, lastUpdated);
    const detailPath = path.join(
      __dirname, '..', '..', 'animal-rescue-organization-list', org.slug, 'index.html'
    );
    fs.mkdirSync(path.dirname(detailPath), { recursive: true });
    fs.writeFileSync(detailPath, detailHtml, 'utf8');
    detailCount++;
  });

  console.log('Done! Written', orgs.length, 'orgs to list page.');
  console.log('Written', detailCount, 'detail pages to animal-rescue-organization-list/[slug]/');
  if (skippedCount > 0) {
    console.log('Skipped', skippedCount, 'orgs with no English name / slug - add \u6a5f\u69cb/\u7d44\u7e54\u82f1\u6587\u540d\u7a31 in Notion.');
  }
})();