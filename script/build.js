/**
 * build.js
 * Fetches all pages from the Notion database and writes index.html
 *
 * Env vars required:
 *   NOTION_TOKEN        – your Notion integration secret
 *   NOTION_DATABASE_ID  – the database ID (without dashes)
 */

const { Client } = require('@notionhq/client');
const fs = require('fs');
const path = require('path');

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const DATABASE_ID = process.env.NOTION_DATABASE_ID;

// ─── helpers ────────────────────────────────────────────────────────────────

function prop(page, name) {
  const p = page.properties[name];
  if (!p) return null;
  switch (p.type) {
    case 'title':       return p.title.map(t => t.plain_text).join('');
    case 'rich_text':   return p.rich_text.map(t => t.plain_text).join('');
    case 'url':         return p.url || null;
    case 'email':       return p.email || null;
    case 'phone_number':return p.phone_number || null;
    case 'checkbox':    return p.checkbox;
    case 'select':      return p.select?.name || null;
    case 'multi_select':return p.multi_select.map(o => o.name);
    default:            return null;
  }
}

function esc(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── fetch all pages (handles pagination) ───────────────────────────────────

async function fetchAll() {
  const pages = [];
  let cursor;
  do {
    const res = await notion.databases.query({
      database_id: DATABASE_ID,
      start_cursor: cursor,
      page_size: 100,
      sorts: [{ property: '機構/組織', direction: 'ascending' }],
    });
    pages.push(...res.results);
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return pages;
}

// ─── map Notion page → plain JS object ──────────────────────────────────────

function toOrg(page) {
  const types   = prop(page, '服務類型')  || [];
  const animals = prop(page, '動物種類')  || [];
  const district = prop(page, '地區') || '';

  // Pick an icon based on animals
  let icon = '🐾';
  if (animals.includes('貓') && animals.includes('狗')) icon = '🐾';
  else if (animals.includes('狗'))  icon = '🐕';
  else if (animals.includes('貓'))  icon = '🐱';
  else if (animals.includes('兔兔')) icon = '🐰';
  else if (animals.includes('野生動物')) icon = '🦜';

  return {
    name:     prop(page, '機構/組織') || '',
    en:       prop(page, '英文名稱')  || '',
    types,
    animals,
    district,
    phone:    prop(page, '電話')     || '',
    email:    prop(page, '電郵')     || '',
    website:  prop(page, '網站')     || '',
    facebook: prop(page, 'facebook') || '',
    instagram:prop(page, 'instagram')|| '',
    hours:    prop(page, '服務時間') || '',
    verified: prop(page, '已核實')   || false,
    ngo:      prop(page, '非牟利機構') || false,
    category: prop(page, '類別')     || '',
    desc:     prop(page, '簡介')     || '',
    icon,
  };
}

// ─── generate HTML ───────────────────────────────────────────────────────────

function buildHTML(orgs) {
  const lastUpdated = new Date().toLocaleDateString('zh-HK', {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  const orgsJson = JSON.stringify(orgs);

  return /* html */`<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>香港動物拯救機構資料庫 | ADB HK</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Noto+Serif+TC:wght@400;700&family=Noto+Sans+TC:wght@300;400;500;700&display=swap" rel="stylesheet" />
<style>
  :root {
    --coral:       #FF7A6B;
    --coral-hover: #E96355;
    --coral-light: #FFE5E1;
    --sage:        #8FAF9B;
    --sage-deep:   #6E8F7C;
    --sage-light:  #E6F1EC;
    --white:       #FFFFFF;
    --bg:          #F7F8F7;
    --text:        #2F2F2F;
    --text-sec:    #6B7280;
    --text-muted:  #9CA3AF;
    --border:      #E5E7EB;
    --shadow:      rgba(0,0,0,0.05);
    --r-sm: 8px; --r-md: 12px; --r-lg: 16px;
  }
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Noto Sans TC', sans-serif; background: var(--bg); color: var(--text); -webkit-font-smoothing: antialiased; }

  /* Header */
  header { background: var(--white); border-bottom: 1px solid var(--border); padding: 0 2rem; height: 64px; display: flex; align-items: center; justify-content: space-between; position: sticky; top: 0; z-index: 100; }
  .logo { display: flex; align-items: center; gap: 10px; text-decoration: none; }
  .logo-icon { width: 36px; height: 36px; background: var(--coral); border-radius: var(--r-sm); display: flex; align-items: center; justify-content: center; font-size: 18px; }
  .logo-text { font-family: 'Noto Serif TC', serif; font-size: 16px; font-weight: 700; color: var(--text); line-height: 1.2; }
  .logo-sub { font-size: 11px; color: var(--text-sec); }
  nav { display: flex; gap: 6px; }
  nav a { font-size: 13px; color: var(--text-sec); text-decoration: none; padding: 6px 12px; border-radius: var(--r-sm); transition: all .15s; }
  nav a:hover { background: var(--bg); color: var(--text); }
  nav a.active { background: var(--coral-light); color: var(--coral-hover); font-weight: 500; }

  /* Hero */
  .hero { background: var(--white); border-bottom: 1px solid var(--border); padding: 3rem 2rem 2.5rem; }
  .hero-inner { max-width: 900px; margin: 0 auto; }
  .hero-eyebrow { display: inline-flex; align-items: center; gap: 6px; background: var(--coral-light); color: var(--coral-hover); font-size: 12px; font-weight: 500; padding: 4px 12px; border-radius: 20px; margin-bottom: 1rem; }
  .hero h1 { font-family: 'Noto Serif TC', serif; font-size: 32px; font-weight: 700; line-height: 1.3; margin-bottom: .5rem; }
  .hero p { font-size: 15px; color: var(--text-sec); margin-bottom: 2rem; line-height: 1.7; }
  .stats-row { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; }
  .stat-chip { background: var(--bg); border: 1px solid var(--border); border-radius: var(--r-md); padding: 10px 18px; text-align: center; }
  .stat-num { font-size: 22px; font-weight: 700; color: var(--coral); }
  .stat-label { font-size: 11px; color: var(--text-sec); margin-top: 2px; }
  .updated { font-size: 11px; color: var(--text-muted); margin-left: auto; }

  /* Main */
  .main { max-width: 900px; margin: 2rem auto; padding: 0 2rem; }

  /* Controls */
  .controls { background: var(--white); border: 1px solid var(--border); border-radius: var(--r-lg); padding: 1.25rem 1.5rem; margin-bottom: 1.5rem; box-shadow: 0 2px 8px var(--shadow); }
  .search-wrap { position: relative; margin-bottom: 1rem; }
  .search-icon { position: absolute; left: 14px; top: 50%; transform: translateY(-50%); color: var(--text-muted); pointer-events: none; }
  .search-input { width: 100%; height: 44px; padding: 0 14px 0 40px; border: 1.5px solid var(--border); border-radius: var(--r-md); font-size: 14px; font-family: 'Noto Sans TC', sans-serif; color: var(--text); background: var(--bg); outline: none; transition: border-color .15s, background .15s; }
  .search-input:focus { border-color: var(--coral); background: var(--white); }
  .search-input::placeholder { color: var(--text-muted); }
  .filter-group { margin-bottom: .75rem; }
  .filter-group:last-child { margin-bottom: 0; }
  .filter-label { font-size: 11px; font-weight: 500; color: var(--text-muted); text-transform: uppercase; letter-spacing: .08em; margin-bottom: 8px; }
  .pills { display: flex; gap: 6px; flex-wrap: wrap; }
  .pill { padding: 5px 13px; border-radius: 20px; border: 1.5px solid var(--border); font-size: 12px; font-family: 'Noto Sans TC', sans-serif; font-weight: 500; background: var(--white); color: var(--text-sec); cursor: pointer; transition: all .15s; user-select: none; }
  .pill:hover { border-color: var(--sage); color: var(--sage-deep); background: var(--sage-light); }
  .pill.active { background: var(--coral); border-color: var(--coral); color: var(--white); }

  /* Results bar */
  .results-bar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1rem; }
  .results-count { font-size: 13px; color: var(--text-sec); }
  .results-count strong { color: var(--text); }

  /* Cards */
  .org-list { display: flex; flex-direction: column; gap: 10px; }
  .org-card { background: var(--white); border: 1px solid var(--border); border-radius: var(--r-lg); overflow: hidden; box-shadow: 0 2px 8px var(--shadow); transition: border-color .15s, box-shadow .15s; cursor: pointer; }
  .org-card:hover { border-color: var(--sage); box-shadow: 0 4px 16px rgba(143,175,155,.15); }
  .org-card.expanded { border-color: var(--coral); }
  .card-header { padding: 1rem 1.25rem; display: flex; align-items: center; gap: 14px; }
  .org-avatar { width: 48px; height: 48px; border-radius: var(--r-md); background: var(--coral-light); border: 1px solid var(--border); display: flex; align-items: center; justify-content: center; font-size: 22px; flex-shrink: 0; }
  .org-info { flex: 1; min-width: 0; }
  .org-name-row { display: flex; align-items: center; gap: 8px; margin-bottom: 2px; flex-wrap: wrap; }
  .org-name { font-size: 15px; font-weight: 700; line-height: 1.3; }
  .verified-badge { font-size: 10px; font-weight: 500; background: var(--sage-light); color: var(--sage-deep); padding: 2px 7px; border-radius: 10px; white-space: nowrap; }
  .pending-badge { font-size: 10px; font-weight: 500; background: #FEF9C3; color: #854D0E; padding: 2px 7px; border-radius: 10px; white-space: nowrap; }
  .ngo-badge { font-size: 10px; font-weight: 500; background: #EEF2FF; color: #4338CA; padding: 2px 7px; border-radius: 10px; white-space: nowrap; }
  .vol-badge { font-size: 10px; font-weight: 500; background: #FEF3C7; color: #92400E; padding: 2px 7px; border-radius: 10px; white-space: nowrap; }
  .org-en { font-size: 11px; color: var(--text-muted); margin-bottom: 8px; }
  .tag-row { display: flex; gap: 5px; flex-wrap: wrap; }
  .tag { font-size: 11px; font-weight: 500; padding: 2px 9px; border-radius: 10px; }
  .tag-district { background: #EEF2FF; color: #4338CA; }
  .tag-type { background: var(--coral-light); color: var(--coral-hover); }
  .tag-animal { background: var(--sage-light); color: var(--sage-deep); }
  .chevron { color: var(--text-muted); font-size: 18px; flex-shrink: 0; transition: transform .2s; line-height: 1; }
  .org-card.expanded .chevron { transform: rotate(180deg); }

  /* Card details */
  .card-details { display: none; border-top: 1px solid var(--border); background: var(--bg); padding: 1.25rem 1.5rem; flex-direction: column; gap: 1rem; }
  .org-card.expanded .card-details { display: flex; }
  .detail-grid { display: grid; grid-template-columns: 80px 1fr; gap: 8px 12px; font-size: 13px; }
  .dl { color: var(--text-muted); font-size: 12px; padding-top: 1px; }
  .dv { color: var(--text); word-break: break-word; }
  .dv a { color: var(--coral-hover); text-decoration: none; }
  .dv a:hover { text-decoration: underline; }
  .social-row { display: flex; gap: 8px; flex-wrap: wrap; }
  .social-btn { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; font-weight: 500; padding: 5px 12px; border-radius: 20px; border: 1.5px solid var(--border); background: var(--white); color: var(--text-sec); text-decoration: none; transition: all .15s; }
  .social-btn:hover { border-color: var(--coral); color: var(--coral-hover); }
  .org-desc { font-size: 13px; color: var(--text-sec); line-height: 1.8; border-top: 1px solid var(--border); padding-top: 1rem; }

  /* Empty */
  .empty { text-align: center; padding: 4rem 2rem; color: var(--text-sec); }
  .empty-icon { font-size: 48px; margin-bottom: 1rem; }

  /* Footer */
  footer { margin-top: 4rem; border-top: 1px solid var(--border); background: var(--white); padding: 2rem; text-align: center; font-size: 12px; color: var(--text-muted); line-height: 1.8; }
  footer a { color: var(--coral); text-decoration: none; }

  @media (max-width: 640px) {
    header { padding: 0 1rem; }
    nav { display: none; }
    .hero { padding: 2rem 1rem 1.5rem; }
    .hero h1 { font-size: 24px; }
    .main { padding: 0 1rem; margin: 1.5rem auto; }
    .updated { display: none; }
  }
</style>
</head>
<body>

<header>
  <a class="logo" href="#">
    <div class="logo-icon">🐾</div>
    <div>
      <div class="logo-text">ADB HK</div>
      <div class="logo-sub">動物拯救資料庫</div>
    </div>
  </a>
  <nav>
    <a href="#" class="active">機構資料庫</a>
    <a href="#">緊急求助</a>
    <a href="#">關於我們</a>
  </nav>
</header>

<section class="hero">
  <div class="hero-inner">
    <div class="hero-eyebrow">🐾 香港動物拯救資源</div>
    <h1>動物拯救機構資料庫</h1>
    <p>搜尋香港各區動物救援、領養及義工資訊，為毛孩找到最合適的幫助</p>
    <div class="stats-row">
      <div class="stat-chip">
        <div class="stat-num" id="totalCount">—</div>
        <div class="stat-label">登記機構</div>
      </div>
      <div class="stat-chip">
        <div class="stat-num" id="ngoCount">—</div>
        <div class="stat-label">非牟利機構</div>
      </div>
      <div class="stat-chip">
        <div class="stat-num" id="volCount">—</div>
        <div class="stat-label">義工組織</div>
      </div>
      <div class="updated">資料更新：${lastUpdated}</div>
    </div>
  </div>
</section>

<main class="main">
  <div class="controls">
    <div class="search-wrap">
      <span class="search-icon">🔍</span>
      <input class="search-input" id="searchInput" type="text" placeholder="搜尋機構名稱、地區或服務…" oninput="filterOrgs()" />
    </div>
    <div class="filter-group">
      <div class="filter-label">服務類型</div>
      <div class="pills" id="typeFilters">
        <button class="pill active" data-v="all" onclick="setFilter(this,'type')">全部</button>
        <button class="pill" data-v="動物拯救" onclick="setFilter(this,'type')">動物拯救</button>
        <button class="pill" data-v="收容所" onclick="setFilter(this,'type')">收容所</button>
        <button class="pill" data-v="領養服務" onclick="setFilter(this,'type')">領養服務</button>
        <button class="pill" data-v="醫療救助" onclick="setFilter(this,'type')">醫療救助</button>
        <button class="pill" data-v="TNR絕育" onclick="setFilter(this,'type')">TNR 絕育</button>
      </div>
    </div>
    <div class="filter-group">
      <div class="filter-label">動物種類</div>
      <div class="pills" id="animalFilters">
        <button class="pill active" data-v="all" onclick="setFilter(this,'animal')">所有動物</button>
        <button class="pill" data-v="狗" onclick="setFilter(this,'animal')">🐕 狗</button>
        <button class="pill" data-v="貓" onclick="setFilter(this,'animal')">🐱 貓</button>
        <button class="pill" data-v="兔兔" onclick="setFilter(this,'animal')">🐰 兔兔</button>
        <button class="pill" data-v="野生動物" onclick="setFilter(this,'animal')">🦜 野生動物</button>
      </div>
    </div>
    <div class="filter-group">
      <div class="filter-label">類別</div>
      <div class="pills" id="catFilters">
        <button class="pill active" data-v="all" onclick="setFilter(this,'cat')">全部</button>
        <button class="pill" data-v="非牟利機構" onclick="setFilter(this,'cat')">非牟利機構</button>
        <button class="pill" data-v="獨立義工" onclick="setFilter(this,'cat')">獨立義工</button>
      </div>
    </div>
  </div>

  <div class="results-bar">
    <div class="results-count" id="resultsCount"></div>
  </div>

  <div class="org-list" id="orgList"></div>
  <div class="empty" id="emptyState" style="display:none">
    <div class="empty-icon">🔍</div>
    <h3>找不到符合條件的機構</h3>
    <p>試試更換搜尋詞或篩選條件</p>
  </div>
</main>

<footer>
  <p>© ${new Date().getFullYear()} ADB HK · 香港動物拯救機構資料庫</p>
  <p style="margin-top:4px">資料如有錯誤或更新，歡迎 <a href="mailto:info@adbhk.org">聯絡我們</a></p>
</footer>

<script>
const orgs = ${orgsJson};

// Update stats
document.getElementById('totalCount').textContent = orgs.length;
document.getElementById('ngoCount').textContent  = orgs.filter(o => o.category === '非牟利機構').length;
document.getElementById('volCount').textContent  = orgs.filter(o => o.category === '獨立義工').length;

let activeType = 'all', activeAnimal = 'all', activeCat = 'all';

function setFilter(btn, kind) {
  const ids = { type: 'typeFilters', animal: 'animalFilters', cat: 'catFilters' };
  document.getElementById(ids[kind]).querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  if (kind === 'type')   activeType   = btn.dataset.v;
  if (kind === 'animal') activeAnimal = btn.dataset.v;
  if (kind === 'cat')    activeCat    = btn.dataset.v;
  filterOrgs();
}

function filterOrgs() {
  const q = document.getElementById('searchInput').value.toLowerCase();
  const list = orgs.filter(o => {
    const mType   = activeType   === 'all' || o.types.includes(activeType);
    const mAnimal = activeAnimal === 'all' || o.animals.includes(activeAnimal);
    const mCat    = activeCat    === 'all' || o.category === activeCat;
    const mSearch = !q || [o.name, o.en, o.district, o.desc].some(s => s && s.toLowerCase().includes(q));
    return mType && mAnimal && mCat && mSearch;
  });
  renderOrgs(list);
}

function toggle(i) {
  document.getElementById('org-' + i).classList.toggle('expanded');
}

function renderOrgs(list) {
  const el    = document.getElementById('orgList');
  const empty = document.getElementById('emptyState');
  const count = document.getElementById('resultsCount');

  if (!list.length) {
    el.innerHTML = '';
    empty.style.display = 'block';
    count.innerHTML = '找不到符合條件的機構';
    return;
  }
  empty.style.display = 'none';
  count.innerHTML = '顯示 <strong>' + list.length + '</strong> 個機構';

  el.innerHTML = list.map((o, i) => {
    const verBadge = o.verified
      ? '<span class="verified-badge">✓ 已核實</span>'
      : '<span class="pending-badge">待核實</span>';
    const catBadge = o.category === '非牟利機構'
      ? '<span class="ngo-badge">非牟利</span>'
      : o.category === '獨立義工'
        ? '<span class="vol-badge">義工組織</span>'
        : '';

    const typeTags   = o.types.map(t   => \`<span class="tag tag-type">\${t}</span>\`).join('');
    const animalTags = o.animals.map(a  => \`<span class="tag tag-animal">\${a}</span>\`).join('');
    const distTag    = o.district ? \`<span class="tag tag-district">\${o.district}</span>\` : '';

    // Detail rows
    let details = '';
    if (o.phone) details += \`<div class="dl">電話</div><div class="dv">\${o.phone}</div>\`;
    if (o.hours) details += \`<div class="dl">服務時間</div><div class="dv">\${o.hours}</div>\`;
    if (o.email) details += \`<div class="dl">電郵</div><div class="dv"><a href="mailto:\${o.email}">\${o.email}</a></div>\`;
    if (o.website) details += \`<div class="dl">網站</div><div class="dv"><a href="\${o.website}" target="_blank" rel="noopener">\${o.website}</a></div>\`;

    // Social buttons
    let social = '';
    if (o.facebook || o.instagram) {
      social = '<div class="social-row">';
      if (o.facebook)  social += \`<a class="social-btn" href="\${o.facebook}"  target="_blank" rel="noopener">📘 Facebook</a>\`;
      if (o.instagram) social += \`<a class="social-btn" href="\${o.instagram}" target="_blank" rel="noopener">📷 Instagram</a>\`;
      social += '</div>';
    }

    return \`
    <article class="org-card" id="org-\${i}" onclick="toggle(\${i})">
      <div class="card-header">
        <div class="org-avatar">\${o.icon}</div>
        <div class="org-info">
          <div class="org-name-row">
            <span class="org-name">\${o.name}</span>\${verBadge}\${catBadge}
          </div>
          \${o.en ? \`<div class="org-en">\${o.en}</div>\` : ''}
          <div class="tag-row">\${distTag}\${typeTags}\${animalTags}</div>
        </div>
        <span class="chevron">⌄</span>
      </div>
      <div class="card-details">
        \${details ? \`<div class="detail-grid">\${details}</div>\` : ''}
        \${social}
        \${o.desc ? \`<div class="org-desc">\${o.desc}</div>\` : ''}
      </div>
    </article>\`;
  }).join('');
}

filterOrgs();
</script>
</body>
</html>`;
}

// ─── main ────────────────────────────────────────────────────────────────────

(async () => {
  console.log('⬇️  Fetching Notion database…');
  const pages = await fetchAll();
  console.log(\`   Found \${pages.length} records\`);

  const orgs = pages
    .map(toOrg)
    .filter(o => o.name)           // skip empty rows
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));

  const html = buildHTML(orgs);

  const outPath = path.join(__dirname, '..', 'index.html');
  fs.writeFileSync(outPath, html, 'utf8');
  console.log(\`✅  Written \${orgs.length} orgs → index.html\`);
})();
