/**
 * build.js
 * Fetches all pages from the Notion database and writes index.html
 * Filters (服務類型, 動物種類) are auto-generated from the Notion database schema.
 *
 * Env vars required:
 *   NOTION_TOKEN        - your Notion integration secret
 *   NOTION_DATABASE_ID  - the database ID (without dashes)
 */

const { Client } = require('@notionhq/client');
const fs = require('fs');
const path = require('path');

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const DATABASE_ID = process.env.NOTION_DATABASE_ID;

// helpers
function prop(page, name) {
  const p = page.properties[name];
  if (!p) return null;
  switch (p.type) {
    case 'title':        return p.title.map(function(t) { return t.plain_text; }).join('');
    case 'rich_text':    return p.rich_text.map(function(t) { return t.plain_text; }).join('');
    case 'url':          return p.url || null;
    case 'email':        return p.email || null;
    case 'phone_number': return p.phone_number || null;
    case 'checkbox':     return p.checkbox;
    case 'select':       return p.select ? p.select.name : null;
    case 'multi_select': return p.multi_select.map(function(o) { return o.name; });
    default:             return null;
  }
}

// Fetch database schema to get all select/multi_select options dynamically
async function fetchSchema() {
  const db = await notion.databases.retrieve({ database_id: DATABASE_ID });
  const schema = {};

  Object.keys(db.properties).forEach(function(key) {
    const p = db.properties[key];
    if (p.type === 'multi_select' || p.type === 'select') {
      schema[key] = p[p.type].options.map(function(o) { return o.name; });
    }
  });

  return schema;
}

// fetch all pages (handles pagination)
async function fetchAll() {
  const pages = [];
  let cursor;
  do {
    const res = await notion.databases.query({
      database_id: DATABASE_ID,
      start_cursor: cursor,
      page_size: 100,
      sorts: [{ property: '\u6a5f\u69cb/\u7d44\u7e54', direction: 'ascending' }],
    });
    pages.push.apply(pages, res.results);
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return pages;
}

// map Notion page to plain JS object
function toOrg(page) {
  const types   = prop(page, '\u670d\u52d9\u985e\u578b') || [];   // 服務類型
  const animals = prop(page, '\u52d5\u7269\u7a2e\u985e') || [];   // 動物種類

  // Pick icon based on animals
  let icon = '\uD83D\uDC3E';
  const hasAnimal = function(k) {
    return animals.some(function(a) { return a.indexOf(k) >= 0; });
  };
  if (hasAnimal('\u72d7'))                                    icon = '\uD83D\uDC15'; // 狗
  if (hasAnimal('\u8c93'))                                    icon = '\uD83D\uDC31'; // 貓
  if (hasAnimal('\u72d7') && hasAnimal('\u8c93'))             icon = '\uD83D\uDC3E'; // both
  if (hasAnimal('\u5154'))                                    icon = '\uD83D\uDC30'; // 兔
  if (hasAnimal('\u91ce\u751f'))                              icon = '\uD83E\uDD9C'; // 野生

  return {
    name:     prop(page, '\u6a5f\u69cb/\u7d44\u7e54') || '',
    en:       prop(page, '\u82f1\u6587\u540d\u7a31')  || '',
    types:    types,
    animals:  animals,
    district: prop(page, '\u5730\u5340') || '',
    phone:    prop(page, '\u96fb\u8a71') || '',
    email:    prop(page, '\u96fb\u90f5') || '',
    website:  prop(page, '\u7db2\u7ad9') || '',
    facebook: prop(page, 'facebook')    || '',
    instagram:prop(page, 'instagram')   || '',
    hours:    prop(page, '\u670d\u52d9\u6642\u9593') || '',
    verified: prop(page, '\u5df2\u6838\u5be6')  || false,
    ngo:      prop(page, '\u975e\u725f\u5229\u6a5f\u69cb') || false,
    category: prop(page, '\u985e\u5225') || '',
    desc:     prop(page, '\u7c21\u4ecb') || '',
    icon:     icon,
  };
}

// Generate filter pills HTML dynamically from schema options
function buildFilterPills(id, filterKind, allLabel, options) {
  const lines = [];
  lines.push('      <div class="pills" id="' + id + '">');
  lines.push('        <button class="pill active" data-v="all" onclick="setFilter(this,\'' + filterKind + '\')">' + allLabel + '</button>');
  options.forEach(function(opt) {
    lines.push('        <button class="pill" data-v="' + opt + '" onclick="setFilter(this,\'' + filterKind + '\')">' + opt + '</button>');
  });
  lines.push('      </div>');
  return lines.join('\n');
}

function buildHTML(orgs, lastUpdated, schema) {
  const orgsJson = JSON.stringify(orgs, null, 0);

  // Get options from schema, fallback to hardcoded if not found
  const typeOptions   = schema['\u670d\u52d9\u985e\u578b'] || ['\u52d5\u7269\u62ef\u6551','\u6536\u5bb9\u6240','\u9818\u990a\u670d\u52d9','\u91ab\u7642\u6551\u52a9','TNR\u7d55\u80b2','\u52d5\u7269\u5584\u7d42'];
  const animalOptions = schema['\u52d5\u7269\u7a2e\u985e'] || ['\u72d7\u72d7 \uD83D\uDC15','\u8c93\u8c93 \uD83D\uDC08\u200D\u2B1B','\u5154\u5154 \uD83D\uDC07','\u91ce\u751f\u52d5\u7269 \uD83E\uDD8E'];

  const lines = [];
  lines.push('<!DOCTYPE html>');
  lines.push('<html lang="zh-Hant">');
  lines.push('<head>');
  lines.push('<meta charset="UTF-8" />');
  lines.push('<meta name="viewport" content="width=device-width, initial-scale=1.0" />');
  lines.push('<title>\u9999\u6e2f\u52d5\u7269\u62ef\u6551\u6a5f\u69cb\u8cc7\u6599\u5eab | ADB HK</title>');
  lines.push('<link rel="preconnect" href="https://fonts.googleapis.com" />');
  lines.push('<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />');
  lines.push('<link href="https://fonts.googleapis.com/css2?family=Noto+Serif+TC:wght@400;700&family=Noto+Sans+TC:wght@300;400;500;700&display=swap" rel="stylesheet" />');
  lines.push('<style>');
  lines.push(':root{--coral:#FF6B2B;--coral-hover:#E85A1D;--coral-light:#FFF1EA;--sage:#8FAF9B;--sage-deep:#6E8F7C;--sage-light:#E6F1EC;--white:#FFFFFF;--bg:#F7F8F7;--text:#2F2F2F;--text-sec:#6B7280;--text-muted:#9CA3AF;--border:#E5E7EB;--shadow:rgba(0,0,0,0.05);--r-sm:8px;--r-md:12px;--r-lg:16px;}');
  lines.push('*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}');
  lines.push('body{font-family:"Noto Sans TC",sans-serif;background:var(--bg);color:var(--text);-webkit-font-smoothing:antialiased;}');
  lines.push('header{background:var(--white);border-bottom:1px solid var(--border);padding:0 2rem;height:64px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:100;}');
  lines.push('.logo{display:flex;align-items:center;gap:10px;text-decoration:none;}');
  lines.push('.logo-icon{width:36px;height:36px;background:var(--coral);border-radius:var(--r-sm);display:flex;align-items:center;justify-content:center;font-size:18px;}');
  lines.push('.logo-text{font-family:"Noto Serif TC",serif;font-size:16px;font-weight:700;color:var(--text);line-height:1.2;}');
  lines.push('.logo-sub{font-size:11px;color:var(--text-sec);}');
  lines.push('nav{display:flex;gap:6px;}');
  lines.push('nav a{font-size:13px;color:var(--text-sec);text-decoration:none;padding:6px 12px;border-radius:var(--r-sm);transition:all .15s;}');
  lines.push('nav a:hover{background:var(--bg);color:var(--text);}');
  lines.push('nav a.active{background:var(--coral-light);color:var(--coral-hover);font-weight:500;}');
  lines.push('.hero{background:var(--white);border-bottom:1px solid var(--border);padding:3rem 2rem 2.5rem;}');
  lines.push('.hero-inner{max-width:900px;margin:0 auto;}');
  lines.push('.hero-eyebrow{display:inline-flex;align-items:center;gap:6px;background:var(--coral-light);color:var(--coral-hover);font-size:12px;font-weight:500;padding:4px 12px;border-radius:20px;margin-bottom:1rem;}');
  lines.push('.hero h1{font-family:"Noto Serif TC",serif;font-size:32px;font-weight:700;line-height:1.3;margin-bottom:.5rem;}');
  lines.push('.hero p{font-size:15px;color:var(--text-sec);margin-bottom:2rem;line-height:1.7;}');
  lines.push('.stats-row{display:flex;gap:12px;flex-wrap:wrap;align-items:center;}');
  lines.push('.stat-chip{background:var(--bg);border:1px solid var(--border);border-radius:var(--r-md);padding:10px 18px;text-align:center;}');
  lines.push('.stat-num{font-size:22px;font-weight:700;color:var(--coral);}');
  lines.push('.stat-label{font-size:11px;color:var(--text-sec);margin-top:2px;}');
  lines.push('.updated{font-size:11px;color:var(--text-muted);margin-left:auto;}');
  lines.push('.main{max-width:900px;margin:2rem auto;padding:0 2rem;}');
  lines.push('.controls{background:var(--white);border:1px solid var(--border);border-radius:var(--r-lg);padding:1.25rem 1.5rem;margin-bottom:1.5rem;box-shadow:0 2px 8px var(--shadow);}');
  lines.push('.search-wrap{position:relative;margin-bottom:1rem;}');
  lines.push('.search-icon{position:absolute;left:14px;top:50%;transform:translateY(-50%);color:var(--text-muted);pointer-events:none;}');
  lines.push('.search-input{width:100%;height:44px;padding:0 14px 0 40px;border:1.5px solid var(--border);border-radius:var(--r-md);font-size:14px;font-family:"Noto Sans TC",sans-serif;color:var(--text);background:var(--bg);outline:none;transition:border-color .15s,background .15s;}');
  lines.push('.search-input:focus{border-color:var(--coral);background:var(--white);}');
  lines.push('.search-input::placeholder{color:var(--text-muted);}');
  lines.push('.filter-group{margin-bottom:.75rem;}');
  lines.push('.filter-group:last-child{margin-bottom:0;}');
  lines.push('.filter-label{font-size:11px;font-weight:500;color:var(--text-muted);text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px;}');
  lines.push('.pills{display:flex;gap:6px;flex-wrap:wrap;}');
  lines.push('.pill{padding:5px 13px;border-radius:20px;border:1.5px solid var(--border);font-size:12px;font-family:"Noto Sans TC",sans-serif;font-weight:500;background:var(--white);color:var(--text-sec);cursor:pointer;transition:all .15s;user-select:none;}');
  lines.push('.pill:hover{border-color:var(--sage);color:var(--sage-deep);background:var(--sage-light);}');
  lines.push('.pill.active{background:var(--coral);border-color:var(--coral);color:var(--white);}');
  lines.push('.results-bar{display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem;}');
  lines.push('.results-count{font-size:13px;color:var(--text-sec);}');
  lines.push('.results-count strong{color:var(--text);}');
  lines.push('.org-list{display:flex;flex-direction:column;gap:10px;}');
  lines.push('.org-card{background:var(--white);border:1px solid var(--border);border-radius:var(--r-lg);overflow:hidden;box-shadow:0 2px 8px var(--shadow);transition:border-color .15s,box-shadow .15s;cursor:pointer;}');
  lines.push('.org-card:hover{border-color:var(--sage);box-shadow:0 4px 16px rgba(143,175,155,.15);}');
  lines.push('.org-card.expanded{border-color:var(--coral);}');
  lines.push('.card-header{padding:1rem 1.25rem;display:flex;align-items:center;gap:14px;}');
  lines.push('.org-avatar{width:48px;height:48px;border-radius:var(--r-md);background:var(--coral-light);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0;}');
  lines.push('.org-info{flex:1;min-width:0;}');
  lines.push('.org-name-row{display:flex;align-items:center;gap:8px;margin-bottom:2px;flex-wrap:wrap;}');
  lines.push('.org-name{font-size:15px;font-weight:700;line-height:1.3;}');
  lines.push('.verified-badge{font-size:10px;font-weight:500;background:var(--sage-light);color:var(--sage-deep);padding:2px 7px;border-radius:10px;white-space:nowrap;}');
  lines.push('.pending-badge{font-size:10px;font-weight:500;background:#FEF9C3;color:#854D0E;padding:2px 7px;border-radius:10px;white-space:nowrap;}');
  lines.push('.ngo-badge{font-size:10px;font-weight:500;background:#EEF2FF;color:#4338CA;padding:2px 7px;border-radius:10px;white-space:nowrap;}');
  lines.push('.vol-badge{font-size:10px;font-weight:500;background:#FEF3C7;color:#92400E;padding:2px 7px;border-radius:10px;white-space:nowrap;}');
  lines.push('.org-en{font-size:11px;color:var(--text-muted);margin-bottom:8px;}');
  lines.push('.tag-row{display:flex;gap:5px;flex-wrap:wrap;}');
  lines.push('.tag{font-size:11px;font-weight:500;padding:2px 9px;border-radius:10px;}');
  lines.push('.tag-district{background:#EEF2FF;color:#4338CA;}');
  lines.push('.tag-type{background:var(--coral-light);color:var(--coral-hover);}');
  lines.push('.tag-animal{background:var(--sage-light);color:var(--sage-deep);}');
  lines.push('.chevron{color:var(--text-muted);font-size:18px;flex-shrink:0;transition:transform .2s;line-height:1;}');
  lines.push('.org-card.expanded .chevron{transform:rotate(180deg);}');
  lines.push('.card-details{display:none;border-top:1px solid var(--border);background:var(--bg);padding:1.25rem 1.5rem;flex-direction:column;gap:1rem;}');
  lines.push('.org-card.expanded .card-details{display:flex;}');
  lines.push('.detail-grid{display:grid;grid-template-columns:80px 1fr;gap:8px 12px;font-size:13px;}');
  lines.push('.dl{color:var(--text-muted);font-size:12px;padding-top:1px;}');
  lines.push('.dv{color:var(--text);word-break:break-word;}');
  lines.push('.dv a{color:var(--coral-hover);text-decoration:none;}');
  lines.push('.dv a:hover{text-decoration:underline;}');
  lines.push('.social-row{display:flex;gap:8px;flex-wrap:wrap;}');
  lines.push('.social-btn{display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:500;padding:5px 12px;border-radius:20px;border:1.5px solid var(--border);background:var(--white);color:var(--text-sec);text-decoration:none;transition:all .15s;}');
  lines.push('.social-btn:hover{border-color:var(--coral);color:var(--coral-hover);}');
  lines.push('.org-desc{font-size:13px;color:var(--text-sec);line-height:1.8;border-top:1px solid var(--border);padding-top:1rem;}');
  lines.push('.empty{text-align:center;padding:4rem 2rem;color:var(--text-sec);}');
  lines.push('.empty-icon{font-size:48px;margin-bottom:1rem;}');
  lines.push('footer{margin-top:4rem;border-top:1px solid var(--border);background:var(--white);padding:2rem;text-align:center;font-size:12px;color:var(--text-muted);line-height:1.8;}');
  lines.push('footer a{color:var(--coral);text-decoration:none;}');
  lines.push('@media(max-width:640px){header{padding:0 1rem;}nav{display:none;}.hero{padding:2rem 1rem 1.5rem;}.hero h1{font-size:24px;}.main{padding:0 1rem;margin:1.5rem auto;}.updated{display:none;}}');
  lines.push('</style>');
  lines.push('</head>');
  lines.push('<body>');
  lines.push('<header>');
  lines.push('  <a class="logo" href="#">');
  lines.push('    <div class="logo-icon">\uD83D\uDC3E</div>');
  lines.push('    <div>');
  lines.push('      <div class="logo-text">ADB HK</div>');
  lines.push('      <div class="logo-sub">\u52d5\u7269\u62ef\u6551\u8cc7\u6599\u5eab</div>');
  lines.push('    </div>');
  lines.push('  </a>');
  lines.push('  <nav>');
  lines.push('    <a href="#" class="active">\u6a5f\u69cb\u8cc7\u6599\u5eab</a>');
  lines.push('    <a href="#">\u7dca\u6025\u6c42\u52a9</a>');
  lines.push('    <a href="#">\u95dc\u65bc\u6211\u5011</a>');
  lines.push('  </nav>');
  lines.push('</header>');
  lines.push('<section class="hero">');
  lines.push('  <div class="hero-inner">');
  lines.push('    <div class="hero-eyebrow">\uD83D\uDC3E \u9999\u6e2f\u52d5\u7269\u62ef\u6551\u8cc7\u6e90</div>');
  lines.push('    <h1>\u52d5\u7269\u62ef\u6551\u6a5f\u69cb\u8cc7\u6599\u5eab</h1>');
  lines.push('    <p>\u641c\u5c0b\u9999\u6e2f\u5404\u5340\u52d5\u7269\u6551\u63f4\u3001\u9818\u990a\u53ca\u7fa9\u5de5\u8cc7\u8a0a\uff0c\u70ba\u6bdb\u5b69\u627e\u5230\u6700\u5408\u9069\u7684\u5e6b\u52a9</p>');
  lines.push('    <div class="stats-row">');
  lines.push('      <div class="stat-chip"><div class="stat-num" id="totalCount">-</div><div class="stat-label">\u767b\u8a18\u6a5f\u69cb</div></div>');
  lines.push('      <div class="stat-chip"><div class="stat-num" id="ngoCount">-</div><div class="stat-label">\u975e\u725f\u5229\u6a5f\u69cb</div></div>');
  lines.push('      <div class="stat-chip"><div class="stat-num" id="volCount">-</div><div class="stat-label">\u7fa9\u5de5\u7d44\u7e54</div></div>');
  lines.push('      <div class="updated">\u8cc7\u6599\u66f4\u65b0\uff1a' + lastUpdated + '</div>');
  lines.push('    </div>');
  lines.push('  </div>');
  lines.push('</section>');
  lines.push('<main class="main">');
  lines.push('  <div class="controls">');
  lines.push('    <div class="search-wrap">');
  lines.push('      <span class="search-icon">\uD83D\uDD0D</span>');
  lines.push('      <input class="search-input" id="searchInput" type="text" placeholder="\u641c\u5c0b\u6a5f\u69cb\u540d\u7a31\u3001\u5730\u5340\u6216\u670d\u52d9\u2026" oninput="filterOrgs()" />');
  lines.push('    </div>');
  // 服務類型 filter - auto-generated from Notion schema
  lines.push('    <div class="filter-group">');
  lines.push('      <div class="filter-label">\u670d\u52d9\u985e\u578b</div>');
  lines.push(buildFilterPills('typeFilters', 'type', '\u5168\u90e8', typeOptions));
  lines.push('    </div>');
  // 動物種類 filter - auto-generated from Notion schema
  lines.push('    <div class="filter-group">');
  lines.push('      <div class="filter-label">\u52d5\u7269\u7a2e\u985e</div>');
  lines.push(buildFilterPills('animalFilters', 'animal', '\u6240\u6709\u52d5\u7269', animalOptions));
  lines.push('    </div>');
  // 類別 filter - static (only 2 values, unlikely to change)
  lines.push('    <div class="filter-group">');
  lines.push('      <div class="filter-label">\u985e\u5225</div>');
  lines.push('      <div class="pills" id="catFilters">');
  lines.push('        <button class="pill active" data-v="all" onclick="setFilter(this,\'cat\')">\u5168\u90e8</button>');
  lines.push('        <button class="pill" data-v="\u975e\u725f\u5229\u6a5f\u69cb" onclick="setFilter(this,\'cat\')">\u975e\u725f\u5229\u6a5f\u69cb</button>');
  lines.push('        <button class="pill" data-v="\u7368\u7acb\u7fa9\u5de5" onclick="setFilter(this,\'cat\')">\u7368\u7acb\u7fa9\u5de5</button>');
  lines.push('      </div>');
  lines.push('    </div>');
  lines.push('  </div>');
  lines.push('  <div class="results-bar"><div class="results-count" id="resultsCount"></div></div>');
  lines.push('  <div class="org-list" id="orgList"></div>');
  lines.push('  <div class="empty" id="emptyState" style="display:none">');
  lines.push('    <div class="empty-icon">\uD83D\uDD0D</div>');
  lines.push('    <h3>\u627e\u4e0d\u5230\u7b26\u5408\u689d\u4ef6\u7684\u6a5f\u69cb</h3>');
  lines.push('    <p>\u8a66\u8a66\u66f4\u63db\u641c\u5c0b\u8a5e\u6216\u7be9\u9078\u689d\u4ef6</p>');
  lines.push('  </div>');
  lines.push('</main>');
  lines.push('<footer>');
  lines.push('  <p>&#169; ' + new Date().getFullYear() + ' ADB HK &middot; \u9999\u6e2f\u52d5\u7269\u62ef\u6551\u6a5f\u69cb\u8cc7\u6599\u5eab</p>');
  lines.push('  <p style="margin-top:4px">\u8cc7\u6599\u5982\u6709\u932f\u8aa4\u6216\u66f4\u65b0\uff0c\u6b61\u8fce <a href="mailto:info@adbhk.org">\u806f\u7d61\u6211\u5011</a></p>');
  lines.push('</footer>');
  lines.push('<script>');
  lines.push('var orgs = ' + orgsJson + ';');
  lines.push('document.getElementById("totalCount").textContent = orgs.length;');
  lines.push('document.getElementById("ngoCount").textContent  = orgs.filter(function(o){return o.category==="\u975e\u725f\u5229\u6a5f\u69cb";}).length;');
  lines.push('document.getElementById("volCount").textContent  = orgs.filter(function(o){return o.category==="\u7368\u7acb\u7fa9\u5de5";}).length;');
  lines.push('var activeType="all", activeAnimal="all", activeCat="all";');
  lines.push('function setFilter(btn,kind){var ids={type:"typeFilters",animal:"animalFilters",cat:"catFilters"};document.getElementById(ids[kind]).querySelectorAll(".pill").forEach(function(p){p.classList.remove("active");});btn.classList.add("active");if(kind==="type")activeType=btn.dataset.v;if(kind==="animal")activeAnimal=btn.dataset.v;if(kind==="cat")activeCat=btn.dataset.v;filterOrgs();}');
  lines.push('function filterOrgs(){var q=document.getElementById("searchInput").value.toLowerCase();var list=orgs.filter(function(o){var mType=activeType==="all"||o.types.indexOf(activeType)>=0;var mAnimal=activeAnimal==="all"||o.animals.indexOf(activeAnimal)>=0;var mCat=activeCat==="all"||o.category===activeCat;var mSearch=!q||[o.name,o.en,o.district,o.desc].some(function(s){return s&&s.toLowerCase().indexOf(q)>=0;});return mType&&mAnimal&&mCat&&mSearch;});renderOrgs(list);}');
  lines.push('function toggle(i){document.getElementById("org-"+i).classList.toggle("expanded");}');
  lines.push('function renderOrgs(list){var el=document.getElementById("orgList");var empty=document.getElementById("emptyState");var count=document.getElementById("resultsCount");if(!list.length){el.innerHTML="";empty.style.display="block";count.innerHTML="\u627e\u4e0d\u5230\u7b26\u5408\u689d\u4ef6\u7684\u6a5f\u69cb";return;}empty.style.display="none";count.innerHTML="\u986f\u793a <strong>"+list.length+"</strong> \u500b\u6a5f\u69cb";el.innerHTML=list.map(function(o,i){var vb=o.verified?"<span class=\\"verified-badge\\">\u2713 \u5df2\u6838\u5be6</span>":"<span class=\\"pending-badge\\">\u5f85\u6838\u5be6</span>";var cb=o.category==="\u975e\u725f\u5229\u6a5f\u69cb"?"<span class=\\"ngo-badge\\">\u975e\u725f\u5229</span>":o.category==="\u7368\u7acb\u7fa9\u5de5"?"<span class=\\"vol-badge\\">\u7fa9\u5de5\u7d44\u7e54</span>":"";var tt=o.types.map(function(t){return"<span class=\\"tag tag-type\\">"+t+"</span>";}).join("");var at=o.animals.map(function(a){return"<span class=\\"tag tag-animal\\">"+a+"</span>";}).join("");var dt=o.district?"<span class=\\"tag tag-district\\">"+o.district+"</span>":"";var det="";if(o.phone)det+="<div class=\\"dl\\">\u96fb\u8a71</div><div class=\\"dv\\">"+o.phone+"</div>";if(o.hours)det+="<div class=\\"dl\\">\u670d\u52d9\u6642\u9593</div><div class=\\"dv\\">"+o.hours+"</div>";if(o.email)det+="<div class=\\"dl\\">\u96fb\u90f5</div><div class=\\"dv\\"><a href=\\"mailto:"+o.email+"\\">"+o.email+"</a></div>";if(o.website)det+="<div class=\\"dl\\">\u7db2\u7ad9</div><div class=\\"dv\\"><a href=\\""+o.website+"\\" target=\\"_blank\\" rel=\\"noopener\\">"+o.website+"</a></div>";var soc="";if(o.facebook||o.instagram){soc="<div class=\\"social-row\\">";if(o.facebook)soc+="<a class=\\"social-btn\\" href=\\""+o.facebook+"\\" target=\\"_blank\\" rel=\\"noopener\\">\uD83D\uDCD8 Facebook</a>";if(o.instagram)soc+="<a class=\\"social-btn\\" href=\\""+o.instagram+"\\" target=\\"_blank\\" rel=\\"noopener\\">\uD83D\uDCF7 Instagram</a>";soc+="</div>";}return"<article class=\\"org-card\\" id=\\"org-"+i+"\\" onclick=\\"toggle("+i+")\\"><div class=\\"card-header\\"><div class=\\"org-avatar\\">"+o.icon+"</div><div class=\\"org-info\\"><div class=\\"org-name-row\\"><span class=\\"org-name\\">"+o.name+"</span>"+vb+cb+"</div>"+(o.en?"<div class=\\"org-en\\">"+o.en+"</div>":"")+"<div class=\\"tag-row\\">"+dt+tt+at+"</div></div><span class=\\"chevron\\">\u2304</span></div><div class=\\"card-details\\">"+(det?"<div class=\\"detail-grid\\">"+det+"</div>":"")+soc+(o.desc?"<div class=\\"org-desc\\">"+o.desc+"</div>":"")+"</div></article>";}).join("");}');
  lines.push('filterOrgs();');
  lines.push('<\/script>');
  lines.push('</body>');
  lines.push('</html>');

  return lines.join('\n');
}

// main
(async function() {
  console.log('Fetching Notion database schema...');
  const schema = await fetchSchema();
  console.log('Schema loaded. 服務類型 options:', schema['\u670d\u52d9\u985e\u578b']);
  console.log('Schema loaded. 動物種類 options:', schema['\u52d5\u7269\u7a2e\u985e']);

  console.log('Fetching Notion database records...');
  const pages = await fetchAll();
  console.log('Found ' + pages.length + ' records');

  const orgs = pages
    .map(toOrg)
    .filter(function(o) { return o.name; })
    .sort(function(a, b) { return a.name.localeCompare(b.name, 'zh-Hant'); });

  const lastUpdated = new Date().toLocaleDateString('zh-HK', {
    year: 'numeric', month: 'long', day: 'numeric'
  });

  const html = buildHTML(orgs, lastUpdated, schema);
  const outPath = path.join(__dirname, '..', 'index.html');
  fs.writeFileSync(outPath, html, 'utf8');
  console.log('Done! Written ' + orgs.length + ' orgs to index.html');
})();
