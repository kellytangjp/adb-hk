/**
 * build.js
 * Fetches all pages from the Notion database and writes
 * veterinary-hospital-clinic-list/index.html
 *
 * Env vars required:
 *   NOTION_TOKEN        - your Notion integration secret
 *   NOTION_DATABASE_ID  - the database ID (without dashes)
 */

const { Client } = require('@notionhq/client');
const fs   = require('fs');
const path = require('path');

const notion      = new Client({ auth: process.env.NOTION_TOKEN });
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
    case 'status':       return p.status ? p.status.name : null;
    case 'multi_select': return p.multi_select.map(o => o.name);
    default:             return null;
  }
}

/* ── fetch schema (for dynamic filter options) ── */
async function fetchSchema() {
  const db     = await notion.databases.retrieve({ database_id: DATABASE_ID });
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
      sorts: [{ property: '診所/醫院中文名稱', direction: 'ascending' }],
    });
    pages.push(...res.results);
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return pages;
}

/* ── map Notion page → JS object ── */
function toClinic(page) {
  const animals  = prop(page, '接診動物') || [];
  const types    = prop(page, '類型') || [];
  const nature   = prop(page, '機構性質') || [];

  // icon from animals
  const has = k => animals.some(a => a.includes(k));
  let icon = '🏥';
  if (has('貓') && has('狗')) icon = '🐾';
  else if (has('貓'))          icon = '🐈';
  else if (has('狗'))          icon = '🐕';
  else if (has('異寵'))        icon = '🦎';

  const avatarColor = nature.includes('非牟利') || nature.includes('政府') || nature.includes('大學') ? 'green' : '';

  // phones: split by ; or ；
  const rawPhone = prop(page, '聯絡電話') || '';
  const phones = rawPhone
    ? rawPhone.split(/[;；]/).map(s => s.trim()).filter(Boolean)
    : [];

  // whatsapp: split same way
  const rawWa = prop(page, 'WhatsApp') || '';
  const whatsapps = rawWa
    ? rawWa.split(/[;；]/).map(s => s.trim()).filter(Boolean)
    : [];

  return {
    nameCN:    prop(page, '診所/醫院中文名稱') || '',
    nameEN:    prop(page, '診所/醫院英文名稱') || '',
    district:  prop(page, '地區') || '',
    subDistrict: prop(page, '分區') || '',
    types,
    nature,
    animals,
    services:  prop(page, '服務種類') || [],
    addressCN: prop(page, '地址') || '',
    addressEN: prop(page, 'Address') || '',
    mapUrl:    prop(page, 'Google Maps 連結') || '',
    phones,
    whatsapps,
    email:     prop(page, 'Email') || '',
    website:   prop(page, '網站') || '',
    facebook:  prop(page, 'Facebook') || '',
    instagram: prop(page, 'Instagram') || '',
    hours:     prop(page, '營業時間') || '',
    verified:  prop(page, '已核實') || false,
    afcdList:  prop(page, '漁護署名單') || false,
    status:    prop(page, '狀態') || '',
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

/* ── build full HTML string ── */
function buildHTML(clinics, lastUpdated, schema) {
  const clinicsJson = JSON.stringify(clinics);

  const districtOptions  = schema['地區']    || ['港島','九龍','新界','離島'];
  const typeOptions      = schema['類型']    || ['診所','醫院','專科中心','大學醫療中心'];
  const natureOptions    = schema['機構性質'] || ['私營','非牟利','政府','大學'];
  const animalOptions    = schema['接診動物'] || ['貓貓 🐈‍⬛','狗狗 🐕','異寵動物🦎'];
  const serviceOptions   = schema['服務種類'] || ['一般診症','外科手術','住院','急症','牙科','腫瘤科','專科','針灸','中獸醫','異寵','水療','超聲波','X-ray','CT掃描','內視鏡','心臟科','24小時'];

  // Sub-districts by region (static — matches Notion options)
  const subsByRegion = {
    '港島': ['灣仔','天后','跑馬地','筲箕灣','上環','北角','西營盤','銅鑼灣','大坑','半山','西灣河','赤柱','淺水灣','堅尼地城','炮台山','柴灣','鰂魚涌','鴨脷洲'],
    '九龍': ['太子','旺角','何文田','深水埗','黃埔','尖沙咀','佐敦','油麻地','大角咀','葵涌','新蒲崗','美孚','黃大仙','觀塘','牛頭角','九龍城','紅磡','土瓜灣'],
    '新界': ['將軍澳','大埔','沙田','屯門','大圍','元朗','東涌','荃灣','錦田','深井','洪水橋','粉嶺','上水','西貢'],
    '離島': ['梅窩','馬灣','愉景灣','貝澳'],
  };

  const CHECK_SVG = `<svg class="tp-check-icon" viewBox="0 0 10 8" fill="none"><polyline points="1,4 4,7 9,1" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const CHECKBOX = `<span class="tp-check">${CHECK_SVG}</span>`;

  function pillCount(dim, val, clinics) {
    if(dim==='type')    return clinics.filter(c=>c.types.includes(val)).length;
    if(dim==='nature')  return clinics.filter(c=>c.nature.includes(val)).length;
    if(dim==='animal')  return clinics.filter(c=>c.animals.includes(val)).length;
    if(dim==='service') return clinics.filter(c=>c.services.includes(val)).length;
    return '';
  }

  function multiPills(id, dim, opts) {
    return `<div class="toggle-group" id="${id}">
${opts.map(o => {
  const cnt = pillCount(dim, o, clinics);
  const countSpan = cnt !== '' ? `<span class="tp-count">${cnt}</span>` : '';
  return `  <button class="toggle-pill" data-val="${esc(o)}" onclick="toggleMulti('${dim}','${esc(o)}',this)">${CHECKBOX}<span class="tp-label">${esc(o)}</span>${countSpan}</button>`;
}).join('\n')}
</div>`;
  }

  function singlePills(id, dim, opts) {
    return `<div class="toggle-group" id="${id}">
${opts.map(o => {
  const cnt = pillCount(dim, o, clinics);
  const countSpan = cnt !== '' ? `<span class="tp-count">${cnt}</span>` : '';
  return `  <button class="toggle-pill" data-val="${esc(o)}" onclick="toggleSingle('${dim}','${esc(o)}',this)">${CHECKBOX}<span class="tp-label">${esc(o)}</span>${countSpan}</button>`;
}).join('\n')}
</div>`;
  }

  // Drawer sub-district pills (grouped by region, shown dynamically)
  const drawerSubPills = Object.entries(subsByRegion).map(([region, subs]) =>
    `<div class="sub-group" data-region="${esc(region)}" style="display:none">
${subs.map(s => `  <button class="toggle-pill" data-val="${esc(s)}" onclick="toggleSingle('subDistrict','${esc(s)}',this)">${CHECKBOX}<span class="tp-label">${esc(s)}</span></button>`).join('\n')}
</div>`
  ).join('\n');

  const sidebarSubPills = Object.entries(subsByRegion).map(([region, subs]) =>
    `<div class="sub-group" data-region="${esc(region)}" style="display:none">
${subs.map(s => `  <button class="toggle-pill sub-pill" data-val="${esc(s)}" onclick="toggleSingle('subDistrict','${esc(s)}',this)">${CHECKBOX}<span class="tp-label">${esc(s)}</span></button>`).join('\n')}
</div>`
  ).join('\n');

  return `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>動物診所/醫院資料庫 | ADB HK</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@300;400;500;600&display=swap" rel="stylesheet">
<style>
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

/* PAGE HEADER */
.page-header{background:var(--white);border-bottom:1px solid var(--border);padding:2.5rem 2rem 2rem;}
.page-header-inner{max-width:1100px;margin:0 auto;}
.breadcrumb{font-size:12px;color:var(--text-muted);margin-bottom:1rem;display:flex;align-items:center;gap:6px;}
.breadcrumb a{color:var(--text-muted);text-decoration:none;}
.breadcrumb a:hover{color:var(--coral);}
.breadcrumb-sep{color:var(--border);}
.page-header h1{font-size:26px;font-weight:600;color:var(--text-primary);margin-bottom:6px;letter-spacing:-.3px;}
.page-header-sub{font-size:14px;color:var(--text-secondary);font-weight:300;margin-bottom:1.75rem;}


/* MAIN */
.main{max-width:1100px;margin:0 auto;padding:1.5rem 2rem;display:grid;grid-template-columns:240px 1fr;gap:1.5rem;align-items:start;}
/* desktop top-bar filter (hides sidebar on wider screens if desired - kept as sidebar) */

/* SIDEBAR */
.sidebar{background:var(--white);border:1px solid var(--border);border-radius:12px;overflow:hidden;position:sticky;top:16px;max-height:calc(100vh - 32px);overflow-y:auto;scrollbar-width:thin;scrollbar-color:var(--border) transparent;}
.sidebar-head{display:flex;align-items:center;justify-content:space-between;padding:.75rem 1.1rem;border-bottom:1px solid var(--border);background:var(--bg-soft);}
.sidebar-head-title{font-size:12px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.8px;}
.sidebar-clear-btn{font-size:12px;color:var(--coral);background:none;border:none;cursor:pointer;font-family:var(--font);font-weight:500;padding:2px 0;}
.sidebar-clear-btn:hover{text-decoration:underline;}
.filter-group{border-bottom:1px solid var(--border);}
.filter-group:last-child{border-bottom:none;}
.filter-group-header{display:flex;align-items:center;justify-content:space-between;padding:.85rem 1.1rem;cursor:pointer;user-select:none;background:transparent;border:none;width:100%;font-family:var(--font);transition:background .15s;}
.filter-group-header:hover{background:var(--bg-soft);}
.filter-group-title{font-size:12px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.8px;display:flex;align-items:center;gap:6px;}
.filter-active-badge{background:var(--coral);color:white;font-size:10px;font-weight:600;border-radius:10px;padding:1px 6px;display:none;}
.filter-active-badge.visible{display:inline-block;}
.filter-chevron{width:15px;height:15px;color:var(--text-muted);transition:transform .2s;flex-shrink:0;}
.filter-group.open .filter-chevron{transform:rotate(180deg);}
.filter-body{display:none;padding:0 .5rem .75rem;}
.filter-group.open .filter-body{display:block;}
/* checkbox list items */
.toggle-group{display:flex;flex-direction:column;gap:0;}
.toggle-pill{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:6px;border:none;background:transparent;font-family:var(--font);font-size:13px;color:var(--text-secondary);cursor:pointer;transition:all .15s;text-align:left;width:100%;}
.toggle-pill:hover{background:var(--bg-soft);color:var(--text-primary);}
.toggle-pill.active{color:var(--coral);font-weight:500;}
.tp-check{width:15px;height:15px;border-radius:4px;border:1.5px solid var(--border);background:var(--white);flex-shrink:0;display:flex;align-items:center;justify-content:center;transition:all .15s;}
.toggle-pill.active .tp-check{background:var(--coral);border-color:var(--coral);}
.tp-check-icon{display:none;width:9px;height:9px;}
.toggle-pill.active .tp-check-icon{display:block;}
.tp-label{flex:1;line-height:1.3;}
.tp-count{font-size:11px;color:var(--text-muted);flex-shrink:0;}
.toggle-pill.active .tp-count{color:var(--coral);}
/* district tree */
.district-tree{display:flex;flex-direction:column;gap:1px;}
.dt-region{margin-bottom:2px;}
.dt-region-header{display:flex;align-items:center;gap:7px;padding:6px 8px;border-radius:6px;cursor:pointer;user-select:none;transition:background .15s;}
.dt-region-header:hover{background:var(--bg-soft);}
.dt-region-header.active{color:var(--coral);}
.dt-chk{width:15px;height:15px;border-radius:4px;border:1.5px solid var(--border);background:var(--white);flex-shrink:0;display:flex;align-items:center;justify-content:center;transition:all .15s;}
.dt-region-header.active .dt-chk{background:var(--coral);border-color:var(--coral);}
.dt-chk svg{display:none;width:9px;height:9px;}
.dt-region-header.active .dt-chk svg{display:block;}
.dt-region-label{flex:1;font-size:13px;font-weight:500;color:var(--text-primary);}
.dt-region-header.active .dt-region-label{color:var(--coral);}
.dt-count{font-size:11px;color:var(--text-muted);}
.dt-region-header.active .dt-count{color:var(--coral);}
.dt-arrow{width:13px;height:13px;color:var(--text-muted);transition:transform .2s;flex-shrink:0;}
.dt-region.open .dt-arrow{transform:rotate(180deg);}
.dt-subs{display:none;padding-left:20px;margin-top:1px;max-height:200px;overflow-y:auto;}
.dt-region.open .dt-subs{display:flex;flex-direction:column;gap:0;}
.dt-sub-row{display:flex;align-items:center;gap:7px;padding:5px 8px;border-radius:5px;cursor:pointer;user-select:none;transition:background .15s;}
.dt-sub-row:hover{background:var(--bg-soft);}
.dt-sub-row.active{color:var(--coral);}
.dt-sub-chk{width:13px;height:13px;border-radius:3px;border:1.5px solid var(--border);background:var(--white);flex-shrink:0;display:flex;align-items:center;justify-content:center;transition:all .15s;}
.dt-sub-row.active .dt-sub-chk{background:var(--coral);border-color:var(--coral);}
.dt-sub-chk svg{display:none;width:8px;height:8px;}
.dt-sub-row.active .dt-sub-chk svg{display:block;}
.dt-sub-label{flex:1;font-size:12px;color:var(--text-secondary);}
.dt-sub-row.active .dt-sub-label{color:var(--coral);font-weight:500;}
.dt-sub-count{font-size:11px;color:var(--text-muted);}
.dt-sub-row.active .dt-sub-count{color:var(--coral);}

/* CONTENT */
.content{min-width:0;}
.search-bar{display:flex;gap:10px;margin-bottom:1rem;}
.search-input-wrap{flex:1;position:relative;}
.search-icon-svg{position:absolute;left:12px;top:50%;transform:translateY(-50%);color:var(--text-muted);pointer-events:none;}
.search-input{width:100%;height:42px;border:1px solid var(--border);border-radius:8px;padding:0 12px 0 38px;font-family:var(--font);font-size:14px;color:var(--text-primary);background:var(--white);outline:none;transition:border-color .2s;}
.search-input:focus{border-color:var(--coral);}
.search-input::placeholder{color:var(--text-muted);}
.search-btn{height:42px;padding:0 20px;background:var(--coral);color:white;border:none;border-radius:8px;font-family:var(--font);font-size:14px;font-weight:500;cursor:pointer;transition:background .2s;}
.search-btn:hover{background:var(--coral-hover);}

.active-filters{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:1rem;}
.filter-pill{display:flex;align-items:center;gap:5px;background:var(--coral-light);color:var(--coral);border-radius:20px;padding:4px 10px 4px 12px;font-size:12px;font-weight:500;border:1px solid rgba(255,107,43,.2);}
.filter-pill button{background:none;border:none;cursor:pointer;color:var(--coral);font-size:14px;line-height:1;padding:0;opacity:.7;}
.filter-pill button:hover{opacity:1;}

.results-meta{font-size:13px;color:var(--text-muted);margin-bottom:1rem;}
.results-meta strong{color:var(--text-primary);font-weight:500;}

/* CLINIC CARDS */
.org-list{display:flex;flex-direction:column;gap:10px;}
.org-card{background:var(--white);border:1px solid var(--border);border-radius:12px;overflow:hidden;transition:border-color .2s,box-shadow .2s;}
.org-card:hover{border-color:#d1d5db;}
.org-card.expanded{border-color:var(--coral);box-shadow:0 4px 16px var(--shadow);}
.org-card-header{display:flex;align-items:center;gap:12px;padding:.9rem 1.2rem;cursor:pointer;user-select:none;}
.org-avatar{width:40px;height:40px;border-radius:9px;background:var(--coral-light);display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0;}
.org-avatar.green{background:var(--sage-light);}
.org-header-info{flex:1;min-width:0;}
.org-name{font-size:14px;font-weight:600;color:var(--text-primary);margin-bottom:5px;}
.org-header-tags{display:flex;flex-wrap:wrap;gap:4px;align-items:center;}
.badge{font-size:11px;padding:2px 8px;border-radius:20px;font-weight:500;white-space:nowrap;}
.badge-coral{background:var(--coral-light);color:var(--coral);}
.badge-sage{background:var(--sage-light);color:var(--sage-deep);}
.badge-gray{background:var(--bg-soft);color:var(--text-secondary);border:1px solid var(--border);}
.badge-verified{background:#eef6ee;color:#3a7a3a;}
.badge-closed{background:#F3F4F6;color:#6B7280;border:1px solid #E5E7EB;font-size:11px;padding:2px 8px;border-radius:4px;font-weight:500;}
.closed-label{margin-bottom:3px;}
.org-card.closed .org-avatar{opacity:.45;filter:grayscale(40%);}
.card-chevron{width:16px;height:16px;color:var(--text-muted);transition:transform .25s;flex-shrink:0;}
.org-card.expanded .card-chevron{transform:rotate(180deg);}

/* CARD BODY – detail table */
.org-card-body{display:none;border-top:1px solid var(--border);}
.org-card.expanded .org-card-body{display:block;}
.detail-table{width:100%;border-collapse:collapse;font-size:13px;}
.detail-table tr{border-bottom:1px solid var(--border);}
.detail-table tr:last-child{border-bottom:none;}
.detail-table td{padding:10px 1.25rem;vertical-align:top;line-height:1.6;}
.detail-table td:first-child{width:90px;color:var(--text-muted);font-size:12px;white-space:nowrap;padding-top:12px;font-weight:500;}
.detail-table td:last-child{color:var(--text-secondary);}
.detail-table a{color:var(--coral);text-decoration:none;}
.detail-table a:hover{text-decoration:underline;}
.social-btns{display:flex;flex-wrap:wrap;gap:7px;margin-top:2px;}
.social-btn{display:inline-flex;align-items:center;gap:6px;padding:5px 13px;border-radius:7px;border:1px solid var(--border);background:var(--white);font-family:var(--font);font-size:12px;font-weight:500;color:var(--text-secondary);text-decoration:none;transition:all .15s;}
.social-btn.fb{border-color:#bad3f5;color:#1877f2;}
.social-btn.fb:hover{background:#e8f0fe;}
.social-btn.ig{border-color:#f5c6da;color:#e1306c;}
.social-btn.ig:hover{background:#fdf0f5;}
.svc-labels{display:flex;flex-wrap:wrap;gap:4px;}
.svc-label{display:inline-block;background:var(--bg-soft);border:1px solid var(--border);border-radius:4px;padding:2px 8px;font-size:11px;color:var(--text-secondary);white-space:nowrap;}
.map-link{display:inline-flex;align-items:center;gap:4px;color:var(--coral);font-size:12px;font-weight:500;margin-top:2px;}
.map-link:hover{text-decoration:underline;}

/* EMPTY */
.empty-state{background:var(--white);border:1px solid var(--border);border-radius:12px;padding:3rem 2rem;text-align:center;}
.empty-icon{font-size:40px;margin-bottom:1rem;}
.empty-state h3{font-size:16px;font-weight:500;margin-bottom:6px;}
.empty-state p{font-size:13px;color:var(--text-muted);}

/* FLOATING BUTTONS */
.float-btns{position:fixed;bottom:28px;left:0;right:0;z-index:300;display:flex;justify-content:space-between;padding:0 28px;pointer-events:none;}
.float-filter-btn,.float-top-btn{pointer-events:all;display:flex;align-items:center;gap:8px;border-radius:50px;font-family:var(--font);font-size:14px;font-weight:500;cursor:pointer;transition:background .2s,transform .15s,box-shadow .2s;}
.float-filter-btn{background:var(--coral);color:white;padding:12px 20px;border:none;box-shadow:0 4px 20px rgba(255,107,43,.4);}
.float-filter-btn:hover{background:var(--coral-hover);transform:translateY(-2px);box-shadow:0 6px 24px rgba(255,107,43,.5);}
.float-top-btn{background:var(--white);color:var(--text-secondary);padding:12px 16px;border:1px solid var(--border);box-shadow:0 4px 16px var(--shadow);opacity:0;transform:translateY(10px);pointer-events:none;transition:opacity .25s,transform .25s,background .15s;}
.float-top-btn.visible{opacity:1;transform:translateY(0);pointer-events:all;}
.float-top-btn:hover{background:var(--bg-soft);transform:translateY(-2px);}
.float-filter-btn svg,.float-top-btn svg{width:16px;height:16px;flex-shrink:0;}
.float-filter-count{background:white;color:var(--coral);font-size:11px;font-weight:700;border-radius:10px;padding:1px 7px;display:none;}
.float-filter-count.visible{display:inline-block;}

/* FILTER DRAWER */
/* ── Filter panel — popover on desktop, bottom sheet on mobile ── */
.filter-drawer-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.2);z-index:400;opacity:0;transition:opacity .25s;}
.filter-drawer-overlay.open{display:block;opacity:1;}

/* desktop: compact centred popover */
.filter-drawer{
  position:fixed;top:50%;left:50%;transform:translate(-50%,-60%);
  z-index:500;background:var(--white);
  border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.18);
  width:min(860px,92vw);max-height:82vh;
  display:flex;flex-direction:column;
  opacity:0;pointer-events:none;
  transition:opacity .22s,transform .22s;
}
.filter-drawer.open{
  opacity:1;pointer-events:all;
  transform:translate(-50%,-50%);
}
.filter-drawer-handle{display:none;} /* desktop: no handle bar */
.filter-drawer-head{
  display:flex;align-items:center;justify-content:space-between;
  padding:.9rem 1.4rem .8rem;border-bottom:1px solid var(--border);flex-shrink:0;
}
.filter-drawer-title{font-size:15px;font-weight:600;color:var(--text-primary);}
.filter-drawer-close{
  width:28px;height:28px;border-radius:50%;border:none;
  background:var(--bg-soft);color:var(--text-secondary);
  cursor:pointer;display:flex;align-items:center;justify-content:center;
  font-size:15px;transition:background .15s;
}
.filter-drawer-close:hover{background:var(--border);}

/* body: 2-column grid */
.filter-drawer-body{
  padding:1.1rem 1.4rem;overflow-y:auto;flex:1;
  display:grid;grid-template-columns:1fr 1fr;gap:1rem 1.5rem;
}
.filter-drawer-section{margin:0;}
.filter-drawer-section.full-width{grid-column:1/-1;}
.filter-drawer-label{
  font-size:11px;font-weight:700;color:var(--text-muted);
  text-transform:uppercase;letter-spacing:.8px;
  margin-bottom:8px;display:block;
}
/* chips inside drawer — horizontal wrap, compact */
.filter-drawer-body .toggle-group{flex-direction:row;flex-wrap:wrap;gap:5px;}
.filter-drawer-body .toggle-pill{
  width:auto;padding:4px 10px;border-radius:20px;
  font-size:12px;border:1px solid var(--border);
  background:var(--white);color:var(--text-secondary);
}
.filter-drawer-body .toggle-pill:hover{border-color:var(--coral);color:var(--coral);background:var(--white);}
.filter-drawer-body .toggle-pill.active{
  background:var(--coral);border-color:var(--coral);color:white;font-weight:500;
}
/* hide checkbox inside drawer chips — not needed in chip style */
.filter-drawer-body .tp-check{display:none;}
.filter-drawer-body .tp-count{display:none;}

/* sub-district in drawer */
.filter-drawer-body #drawer-sub-district-wrap{margin-top:8px;padding-top:8px;border-top:1px solid var(--border);}
.filter-drawer-body .sub-group{display:none;flex-wrap:wrap;gap:5px;}
.filter-drawer-body .sub-group .toggle-pill{font-size:11px;padding:3px 9px;}

.filter-drawer-footer{
  padding:.85rem 1.4rem;border-top:1px solid var(--border);
  display:flex;gap:10px;flex-shrink:0;
}
.drawer-clear-btn{
  height:38px;padding:0 20px;
  border:1px solid var(--border);border-radius:8px;
  background:var(--white);font-family:var(--font);font-size:13px;
  color:var(--text-secondary);cursor:pointer;transition:all .15s;
}
.drawer-clear-btn:hover{border-color:var(--coral);color:var(--coral);}
.drawer-apply-btn{
  flex:1;height:38px;border:none;border-radius:8px;
  background:var(--coral);font-family:var(--font);font-size:13px;
  font-weight:500;color:white;cursor:pointer;transition:background .15s;
}
.drawer-apply-btn:hover{background:var(--coral-hover);}

/* mobile: revert to bottom sheet */
@media(max-width:768px){
  .filter-drawer{
    top:auto;bottom:0;left:0;right:0;width:100%;
    border-radius:20px 20px 0 0;max-height:85vh;
    transform:translateY(100%);opacity:1;
    transition:transform .3s cubic-bezier(.32,.72,0,1);
  }
  .filter-drawer.open{transform:translateY(0);}
  .filter-drawer-handle{display:flex;justify-content:center;padding:12px 0 4px;}
  .filter-drawer-handle-bar{width:36px;height:4px;background:var(--border);border-radius:2px;}
  .filter-drawer-body{grid-template-columns:1fr;gap:.75rem;}
  .filter-drawer-body .toggle-group{flex-direction:column;}
  .filter-drawer-body .toggle-pill{width:100%;border-radius:7px;border:none;padding:6px 8px;}
  .filter-drawer-body .tp-check{display:flex;}
  .filter-drawer-body .tp-count{display:inline;}
}

/* RESPONSIVE */
@media(max-width:768px){
  .main{grid-template-columns:1fr;padding:1rem;}
  .sidebar{position:static;}
  .page-header{padding:1.5rem 1rem 1rem;}
  .scorecard-num{font-size:28px;}
  .update-note{display:none;}
  #adb-nav{padding:0 1rem;}
  .detail-table td:first-child{width:72px;}
}
</style>
</head>
<body>

<script src="/adb-hk/nav.js"></script>

<div class="page-header">
  <div class="page-header-inner">
    <div class="breadcrumb">
      <a href="/adb-hk/">首頁</a><span class="breadcrumb-sep">›</span><span>動物診所/醫院資料庫</span>
    </div>
    <h1>🏥 動物診所/醫院資料庫</h1>
    <p class="page-header-sub">搜尋香港各區動物診所、醫院及專科中心，為毛孩找到最合適的醫療幫助</p>
  </div>
</div>
</div>

<div class="main">
  <aside class="sidebar">
    <div class="sidebar-head">
      <span class="sidebar-head-title">篩選</span>
      <button class="sidebar-clear-btn" id="sidebarClearBtn" onclick="clearAllFilters()" style="display:none">清除全部</button>
    </div>
    <div class="filter-group" id="grp-district">
      <button class="filter-group-header" onclick="toggleGroup('grp-district')">
        <span class="filter-group-title">地區 / 分區<span class="filter-active-badge" id="badge-district"></span></span>
        <svg class="filter-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      <div class="filter-body">
        <div class="district-tree" id="district-tree"></div>
      </div>
    </div>
    <div class="filter-group" id="grp-type">
      <button class="filter-group-header" onclick="toggleGroup('grp-type')">
        <span class="filter-group-title">類型<span class="filter-active-badge" id="badge-type"></span></span>
        <svg class="filter-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      <div class="filter-body">
        ${multiPills('type-toggles', 'type', typeOptions)}
      </div>
    </div>
    <div class="filter-group" id="grp-nature">
      <button class="filter-group-header" onclick="toggleGroup('grp-nature')">
        <span class="filter-group-title">機構性質<span class="filter-active-badge" id="badge-nature"></span></span>
        <svg class="filter-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      <div class="filter-body">
        ${multiPills('nature-toggles', 'nature', natureOptions)}
      </div>
    </div>
    <div class="filter-group" id="grp-animal">
      <button class="filter-group-header" onclick="toggleGroup('grp-animal')">
        <span class="filter-group-title">接診動物<span class="filter-active-badge" id="badge-animal"></span></span>
        <svg class="filter-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      <div class="filter-body">
        ${multiPills('animal-toggles', 'animal', animalOptions)}
      </div>
    </div>
    <div class="filter-group" id="grp-service">
      <button class="filter-group-header" onclick="toggleGroup('grp-service')">
        <span class="filter-group-title">服務種類<span class="filter-active-badge" id="badge-service"></span></span>
        <svg class="filter-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      <div class="filter-body">
        ${multiPills('service-toggles', 'service', serviceOptions)}
      </div>
    </div>
  </aside>

  <div class="content">
    <div class="search-bar">
      <div class="search-input-wrap">
        <svg class="search-icon-svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
        <input class="search-input" type="text" id="searchInput" placeholder="搜尋診所名稱、地址…" oninput="filterClinics()">
      </div>
      <button class="search-btn" onclick="filterClinics()">搜尋</button>
    </div>
    <div class="active-filters" id="active-pills"></div>
    <div class="results-meta" id="results-meta"></div>
    <div class="org-list" id="orgList"></div>
  </div>
</div>

<script>
var clinics = ${clinicsJson};
var subsByRegion = ${JSON.stringify(subsByRegion)};

/* ── stats ── */

/* ── build district tree with counts ── */
(function buildDistrictTree(){
  var sbr = subsByRegion;
  var tree = document.getElementById('district-tree');
  if(!tree) return;

  var distCount = {}, subCount = {};
  clinics.forEach(function(c){
    if(c.district)    distCount[c.district]   = (distCount[c.district]||0)+1;
    if(c.subDistrict) subCount[c.subDistrict] = (subCount[c.subDistrict]||0)+1;
  });

  var CHK_SVG = '<svg viewBox="0 0 10 8" fill="none"><polyline points="1,4 4,7 9,1" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  Object.keys(sbr).forEach(function(region){
    var subs   = sbr[region];
    var rCount = distCount[region]||0;

    var regionDiv = document.createElement('div');
    regionDiv.className = 'dt-region';

    /* ── region header row (checkbox + label + count + arrow) ── */
    var rHdr = document.createElement('div');
    rHdr.className = 'dt-region-header';
    rHdr.innerHTML =
      '<span class="dt-chk">'+CHK_SVG+'</span>'+
      '<span class="dt-region-label">'+region+'</span>'+
      '<span class="dt-count">('+rCount+')</span>'+
      '<svg class="dt-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>';

    rHdr.addEventListener('click', function(e){
      var wasActive = activeDistrict === region;
      /* deselect previous */
      document.querySelectorAll('.dt-region-header').forEach(function(r){r.classList.remove('active');});
      document.querySelectorAll('.dt-sub-row').forEach(function(r){r.classList.remove('active');});
      if(wasActive){
        /* toggle off — collapse */
        activeDistrict = null; activeSubDistrict = null;
        regionDiv.classList.remove('open');
        updateBadge('district',0);
      } else {
        /* select + expand */
        activeDistrict = region; activeSubDistrict = null;
        rHdr.classList.add('active');
        /* collapse all, open this */
        document.querySelectorAll('.dt-region').forEach(function(d){d.classList.remove('open');});
        regionDiv.classList.add('open');
        updateBadge('district',1);
      }
      syncDrawerToState(); updateFloatCount(); filterClinics(); renderPills();
    });
    regionDiv.appendChild(rHdr);

    /* ── sub rows with scrollable container ── */
    var subsDiv = document.createElement('div');
    subsDiv.className = 'dt-subs';
    subs.forEach(function(sub){
      var sCount = subCount[sub]||0;
      var sRow = document.createElement('div');
      sRow.className = 'dt-sub-row';
      sRow.innerHTML =
        '<span class="dt-sub-chk">'+CHK_SVG+'</span>'+
        '<span class="dt-sub-label">'+sub+'</span>'+
        '<span class="dt-sub-count">('+sCount+')</span>';
      sRow.addEventListener('click', function(e){
        e.stopPropagation();
        if(activeSubDistrict===sub){
          activeSubDistrict=null; sRow.classList.remove('active');
        } else {
          document.querySelectorAll('.dt-sub-row').forEach(function(r){r.classList.remove('active');});
          if(activeDistrict!==region){
            document.querySelectorAll('.dt-region-header').forEach(function(r){r.classList.remove('active');});
            activeDistrict=region; rHdr.classList.add('active');
            updateBadge('district',1);
          }
          activeSubDistrict=sub; sRow.classList.add('active');
        }
        syncDrawerToState(); updateFloatCount(); filterClinics(); renderPills();
      });
      subsDiv.appendChild(sRow);
    });
    regionDiv.appendChild(subsDiv);
    tree.appendChild(regionDiv);
  });
})();

/* ── filter state ── */
var activeDistrict    = null;
var activeSubDistrict = null;
var activeTypes       = [];
var activeNature      = [];
var activeAnimals     = [];
var activeServices    = [];

/* ── sidebar collapse ── */
function toggleGroup(id){document.getElementById(id).classList.toggle('open');}

/* ── multi-select ── */
function toggleMulti(dim,val,btn){
  var arr = dim==='type' ? activeTypes : dim==='nature' ? activeNature : dim==='service' ? activeServices : activeAnimals;
  var idx = arr.indexOf(val);
  if(idx>=0){arr.splice(idx,1);btn.classList.remove('active');}
  else{arr.push(val);btn.classList.add('active');}
  updateBadge(dim,arr.length);
  filterClinics();renderPills();
}

/* ── single-select (subDistrict from drawer only) ── */
function toggleSingle(dim,val,btn){
  if(dim==='subDistrict'){
    if(activeSubDistrict===val){
      activeSubDistrict=null;btn.classList.remove('active');
    } else {
      document.querySelectorAll('.dt-sub-row').forEach(function(b){b.classList.remove('active');});
      document.querySelectorAll('#drawer-sub-district-wrap .toggle-pill').forEach(function(b){b.classList.remove('active');});
      activeSubDistrict=val;btn.classList.add('active');
    }
    filterClinics();renderPills();updateFloatCount();
  }
}

function updateBadge(dim,count){
  var b=document.getElementById('badge-'+dim);
  if(!b)return;
  b.textContent=count;
  if(count>0)b.classList.add('visible');else b.classList.remove('visible');
}

/* ── filter ── */
function filterClinics(){
  var q=document.getElementById('searchInput').value.toLowerCase();
  var list=clinics.filter(function(c){
    if(activeDistrict&&c.district!==activeDistrict)return false;
    if(activeSubDistrict&&c.subDistrict!==activeSubDistrict)return false;
    if(activeTypes.length&&!c.types.some(function(t){return activeTypes.indexOf(t)>=0;}))return false;
    if(activeNature.length&&!c.nature.some(function(n){return activeNature.indexOf(n)>=0;}))return false;
    if(activeAnimals.length&&!c.animals.some(function(a){return activeAnimals.indexOf(a)>=0;}))return false;
    if(activeServices.length&&!c.services.some(function(s){return activeServices.indexOf(s)>=0;}))return false;
    if(q&&![c.nameCN,c.nameEN,c.addressCN,c.addressEN,c.district,c.subDistrict].some(function(s){return s&&s.toLowerCase().indexOf(q)>=0;}))return false;
    return true;
  });
  renderClinics(list);
}

/* ── pills ── */
function renderPills(){
  var c=document.getElementById('active-pills');c.innerHTML='';
  if(activeDistrict){c.appendChild(makePill(activeDistrict,function(){
    activeDistrict=null;activeSubDistrict=null;
    document.querySelectorAll('.dt-region-header,.dt-sub-row').forEach(function(b){b.classList.remove('active');});
    document.querySelectorAll('.dt-region').forEach(function(d){d.classList.remove('open');});
    updateBadge('district',0);filterClinics();renderPills();
  }));}
  if(activeSubDistrict){c.appendChild(makePill(activeSubDistrict,function(){
    activeSubDistrict=null;
    document.querySelectorAll('.dt-sub-row').forEach(function(b){b.classList.remove('active');});
    filterClinics();renderPills();
  }));}
  activeTypes.forEach(function(v){c.appendChild(makePill(v,function(){
    var i=activeTypes.indexOf(v);if(i>=0)activeTypes.splice(i,1);
    var btn=document.querySelector('#type-toggles [data-val="'+v+'"]');if(btn)btn.classList.remove('active');
    updateBadge('type',activeTypes.length);filterClinics();renderPills();
  }));});
  activeNature.forEach(function(v){c.appendChild(makePill(v,function(){
    var i=activeNature.indexOf(v);if(i>=0)activeNature.splice(i,1);
    var btn=document.querySelector('#nature-toggles [data-val="'+v+'"]');if(btn)btn.classList.remove('active');
    updateBadge('nature',activeNature.length);filterClinics();renderPills();
  }));});
  activeAnimals.forEach(function(v){c.appendChild(makePill(v,function(){
    var i=activeAnimals.indexOf(v);if(i>=0)activeAnimals.splice(i,1);
    var btn=document.querySelector('#animal-toggles [data-val="'+v+'"]');if(btn)btn.classList.remove('active');
    updateBadge('animal',activeAnimals.length);filterClinics();renderPills();
  }));});
  activeServices.forEach(function(v){c.appendChild(makePill(v,function(){
    var i=activeServices.indexOf(v);if(i>=0)activeServices.splice(i,1);
    var btn=document.querySelector('#service-toggles [data-val="'+v+'"]');if(btn)btn.classList.remove('active');
    updateBadge('service',activeServices.length);filterClinics();renderPills();
  }));});
}
function makePill(label,onRemove){
  var p=document.createElement('div');p.className='filter-pill';
  p.innerHTML=label+' <button title="移除篩選">×</button>';
  p.querySelector('button').addEventListener('click',onRemove);return p;
}

/* ── card toggle ── */
function toggleCard(id){document.getElementById('card-'+id).classList.toggle('expanded');}

/* ── render ── */
function renderClinics(list){
  var el=document.getElementById('orgList');
  var meta=document.getElementById('results-meta');
  if(!list.length){
    el.innerHTML='<div class="empty-state"><div class="empty-icon">🔍</div><h3>找不到符合條件的診所/醫院</h3><p>試試更換搜尋詞或篩選條件</p></div>';
    meta.innerHTML='';return;
  }
  meta.innerHTML='顯示 <strong>'+list.length+'</strong> 間診所/醫院';
  el.innerHTML=list.map(function(c,i){
    var typeBadges=c.types.map(function(t){return'<span class="badge badge-coral">'+t+'</span>';}).join('');
    var natureBadges=c.nature.map(function(n){return'<span class="badge badge-sage">'+n+'</span>';}).join('');
    var aniBadges=c.animals.map(function(a){return'<span class="badge badge-gray">'+a+'</span>';}).join('');
    var verifiedBadge='';

    var rows='';

    // 地址 (2 rows: CN / EN + Google Maps)
    var addrVal='';
    if(c.addressCN)addrVal+=c.addressCN;
    if(c.addressEN)addrVal+=(addrVal?'<br>':'')+c.addressEN;
    var mapHref=c.mapUrl&&c.mapUrl!=='#'?c.mapUrl:'#';
    var mapTarget=mapHref!=='#'?' target="_blank" rel="noopener"':'';
    addrVal+='<br><a class="map-link" href="'+mapHref+'"'+mapTarget+'><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg> 查看Google Map</a>';
    rows+='<tr><td>地址</td><td>'+(addrVal||'-')+'</td></tr>';

    // 電話 (multiple, each hyperlinked)
    if(c.phones&&c.phones.length){
      var phLinks=c.phones.map(function(p){var d=p.replace(/[^0-9]/g,'');var href=d.length<=8?'+852'+d:'+'+d;return'<a href="tel:'+href+'">'+p+'</a>';}).join(' · ');
      rows+='<tr><td>聯絡電話</td><td>'+phLinks+'</td></tr>';
    }else{
      rows+='<tr><td>聯絡電話</td><td>-</td></tr>';
    }

    // WhatsApp (multiple, each hyperlinked to wa.me)
    if(c.whatsapps&&c.whatsapps.length){
      var waLinks=c.whatsapps.map(function(w){var d=w.replace(/[^0-9]/g,'');var full=d.length<=8?'852'+d:d;return'<a href="https://wa.me/'+full+'" target="_blank" rel="noopener">'+w+'</a>';}).join(' · ');
      rows+='<tr><td>WhatsApp</td><td>'+waLinks+'</td></tr>';
    }else{
      rows+='<tr><td>WhatsApp</td><td>-</td></tr>';
    }

    // 電郵
    rows+='<tr><td>電郵</td><td>'+(c.email?'<a href="mailto:'+c.email+'">'+c.email+'</a>':'-')+'</td></tr>';

    // 營業時間
    rows+='<tr><td>營業時間</td><td>'+(c.hours||'-')+'</td></tr>';

    // 網站
    rows+='<tr><td>網站</td><td>'+(c.website?'<a href="'+c.website+'" target="_blank" rel="noopener">'+c.website+'</a>':'-')+'</td></tr>';

    // 服務種類 – rendered as labels
    var svcVal=c.services.length?c.services.map(function(s){return'<span class="svc-label">'+s+'</span>';}).join(''):'<span style="color:var(--text-muted)">-</span>';
    rows+='<tr><td>服務種類</td><td><div class="svc-labels">'+svcVal+'</div></td></tr>';

    // 社交媒體
    var socials='';
    if(c.facebook)socials+='<a class="social-btn fb" href="'+c.facebook+'" target="_blank" rel="noopener"><svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/></svg>Facebook</a>';
    if(c.instagram)socials+='<a class="social-btn ig" href="'+c.instagram+'" target="_blank" rel="noopener"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>Instagram</a>';
    rows+='<tr><td>社交媒體</td><td>'+(socials?'<div class="social-btns">'+socials+'</div>':'-')+'</td></tr>';

    var isClosed=c.status==='已結業';
    return '<div class="org-card'+(isClosed?' closed':'')+'" id="card-'+i+'">'+
      '<div class="org-card-header" onclick="toggleCard('+i+')">'+
        '<div class="org-avatar '+c.avatarColor+'">'+c.icon+'</div>'+
        '<div class="org-header-info">'+
          (isClosed?'<div class="closed-label"><span class="badge badge-closed">已結業</span></div>':'')+
          '<div class="org-name">'+c.nameCN+(c.nameEN?' <span style="font-size:12px;color:var(--text-muted);font-weight:400;">'+c.nameEN+'</span>':'')+'</div>'+

          '<div class="org-header-tags">'+
            typeBadges+natureBadges+
            (c.district?'<span class="badge badge-gray">'+c.district+(c.subDistrict?' · '+c.subDistrict:'')+'</span>':'')+
            aniBadges+verifiedBadge+
          '</div>'+
        '</div>'+
        '<svg class="card-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>'+
      '</div>'+
      '<div class="org-card-body"><table class="detail-table">'+rows+'</table></div>'+
    '</div>';
  }).join('');
}

filterClinics();

/* ── FLOATING FILTER DRAWER ── */
function openFilterDrawer(){
  syncDrawerToState();
  document.getElementById('filterDrawer').classList.add('open');
  document.getElementById('filterOverlay').classList.add('open');
  document.body.style.overflow='hidden';
}
function closeFilterDrawer(){
  document.getElementById('filterDrawer').classList.remove('open');
  document.getElementById('filterOverlay').classList.remove('open');
  document.body.style.overflow='';
}
function syncDrawerToState(){
  /* district tree sidebar synced via buildDistrictTree active classes */
  document.querySelectorAll('#drawer-district-toggles .toggle-pill').forEach(function(b){b.classList.toggle('active',activeDistrict===b.dataset.val);});
  var dWrap=document.getElementById('drawer-sub-district-wrap');
  if(activeDistrict){
    dWrap.style.display='';
    document.querySelectorAll('#drawer-sub-district-wrap .sub-group').forEach(function(g){
      g.style.display=g.dataset.region===activeDistrict?'flex':'none';
      g.style.flexWrap='wrap';g.style.gap='6px';
    });
    document.querySelectorAll('#drawer-sub-district-wrap .toggle-pill').forEach(function(b){b.classList.toggle('active',activeSubDistrict===b.dataset.val);});
  } else { dWrap.style.display='none'; }
  document.querySelectorAll('#drawer-type-toggles .toggle-pill').forEach(function(b){b.classList.toggle('active',activeTypes.indexOf(b.dataset.val)>=0);});
  document.querySelectorAll('#drawer-nature-toggles .toggle-pill').forEach(function(b){b.classList.toggle('active',activeNature.indexOf(b.dataset.val)>=0);});
  document.querySelectorAll('#drawer-animal-toggles .toggle-pill').forEach(function(b){b.classList.toggle('active',activeAnimals.indexOf(b.dataset.val)>=0);});
  document.querySelectorAll('#drawer-service-toggles .toggle-pill').forEach(function(b){b.classList.toggle('active',activeServices.indexOf(b.dataset.val)>=0);});
}
function syncSidebarToState(){
  document.querySelectorAll('#type-toggles .toggle-pill').forEach(function(b){b.classList.toggle('active',activeTypes.indexOf(b.dataset.val)>=0);});
  document.querySelectorAll('#nature-toggles .toggle-pill').forEach(function(b){b.classList.toggle('active',activeNature.indexOf(b.dataset.val)>=0);});
  document.querySelectorAll('#animal-toggles .toggle-pill').forEach(function(b){b.classList.toggle('active',activeAnimals.indexOf(b.dataset.val)>=0);});
  document.querySelectorAll('#service-toggles .toggle-pill').forEach(function(b){b.classList.toggle('active',activeServices.indexOf(b.dataset.val)>=0);});
  updateBadge('district',activeDistrict?1:0);
  updateBadge('type',activeTypes.length);
  updateBadge('nature',activeNature.length);
  updateBadge('animal',activeAnimals.length);
  updateBadge('service',activeServices.length);
}
function toggleSingleDrawer(dim,val,btn){
  if(dim==='district'){
    var wasActive = activeDistrict===val;
    document.querySelectorAll('#drawer-district-toggles .toggle-pill').forEach(function(b){b.classList.remove('active');});
    document.querySelectorAll('.dt-region-header').forEach(function(r){r.classList.remove('active');});
    document.querySelectorAll('.dt-sub-row').forEach(function(r){r.classList.remove('active');});
    document.querySelectorAll('.dt-region').forEach(function(d){d.classList.remove('open');});
    if(wasActive){
      activeDistrict=null; activeSubDistrict=null;
      document.getElementById('drawer-sub-district-wrap').style.display='none';
      updateBadge('district',0);
    } else {
      activeDistrict=val; activeSubDistrict=null;
      btn.classList.add('active');
      updateBadge('district',1);
      // sync sidebar tree
      document.querySelectorAll('.dt-region').forEach(function(d){
        var hdr=d.querySelector('.dt-region-header');
        if(hdr && hdr.querySelector('.dt-region-label') && hdr.querySelector('.dt-region-label').textContent.trim().startsWith(val)){
          hdr.classList.add('active'); d.classList.add('open');
        }
      });
      // show drawer sub-district
      var dWrap=document.getElementById('drawer-sub-district-wrap');
      dWrap.style.display='';
      document.querySelectorAll('#drawer-sub-district-wrap .sub-group').forEach(function(g){
        g.style.display=g.dataset.region===val?'flex':'none';
        g.style.flexWrap='wrap';g.style.gap='6px';
      });
      document.querySelectorAll('#drawer-sub-district-wrap .toggle-pill').forEach(function(b){b.classList.remove('active');});
    }
  } else if(dim==='subDistrict'){
    if(activeSubDistrict===val){
      activeSubDistrict=null;btn.classList.remove('active');
      document.querySelectorAll('.dt-sub-row').forEach(function(b){b.classList.remove('active');});
    } else {
      document.querySelectorAll('#drawer-sub-district-wrap .toggle-pill').forEach(function(b){b.classList.remove('active');});
      document.querySelectorAll('.dt-sub-row').forEach(function(b){b.classList.remove('active');});
      activeSubDistrict=val; btn.classList.add('active');
      // sync sidebar tree sub-row
      document.querySelectorAll('.dt-sub-row').forEach(function(r){
        if(r.querySelector('.dt-sub-label') && r.querySelector('.dt-sub-label').textContent.trim().startsWith(val)){
          r.classList.add('active');
        }
      });
    }
  }
  syncSidebarToState();updateFloatCount();filterClinics();renderPills();
}
function toggleMultiDrawer(dim,val,btn){
  var arr=dim==='type'?activeTypes:dim==='nature'?activeNature:dim==='service'?activeServices:activeAnimals;
  var idx=arr.indexOf(val);
  if(idx>=0){arr.splice(idx,1);btn.classList.remove('active');}
  else{arr.push(val);btn.classList.add('active');}
  syncSidebarToState();updateFloatCount();filterClinics();renderPills();
}
function clearAllFilters(){
  activeDistrict=null;activeSubDistrict=null;
  activeTypes.length=0;activeNature.length=0;activeAnimals.length=0;activeServices.length=0;
  document.querySelectorAll('.toggle-pill').forEach(function(b){b.classList.remove('active');});
  document.querySelectorAll('.dt-region-header,.dt-sub-row').forEach(function(b){b.classList.remove('active');});
  document.querySelectorAll('.dt-region').forEach(function(d){d.classList.remove('open');});
  var dw=document.getElementById('drawer-sub-district-wrap');if(dw)dw.style.display='none';
  updateBadge('district',0);updateBadge('type',0);updateBadge('nature',0);updateBadge('animal',0);updateBadge('service',0);
  updateFloatCount();filterClinics();renderPills();
}
function updateFloatCount(){
  var total=(activeDistrict?1:0)+(activeSubDistrict?1:0)+activeTypes.length+activeNature.length+activeAnimals.length+activeServices.length;
  var el=document.getElementById('floatFilterCount');
  el.textContent=total;
  if(total>0)el.classList.add('visible');else el.classList.remove('visible');
  var sb=document.getElementById('sidebarClearBtn');
  if(sb)sb.style.display=total>0?'':'none';
}

/* ── GO TO TOP ── */
function scrollToTop(){window.scrollTo({top:0,behavior:'smooth'});}
window.addEventListener('scroll',function(){
  var btn=document.getElementById('floatTopBtn');
  if(!btn)return;
  if(window.scrollY>300)btn.classList.add('visible');
  else btn.classList.remove('visible');
});
</script>

<script src="/adb-hk/footer.js"></script>

<!-- FLOATING BUTTONS -->
<div class="float-btns">
  <button class="float-filter-btn" id="floatFilterBtn" onclick="openFilterDrawer()">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="6" x2="20" y2="6"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="11" y1="18" x2="13" y2="18"/></svg>
    篩選
    <span class="float-filter-count" id="floatFilterCount"></span>
  </button>
  <button class="float-top-btn" id="floatTopBtn" onclick="scrollToTop()">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="18 15 12 9 6 15"/></svg>
    頂部
  </button>
</div>

<!-- FILTER DRAWER OVERLAY -->
<div class="filter-drawer-overlay" id="filterOverlay" onclick="closeFilterDrawer()"></div>

<!-- FILTER DRAWER -->
<div class="filter-drawer" id="filterDrawer">
  <div class="filter-drawer-handle"><div class="filter-drawer-handle-bar"></div></div>
  <div class="filter-drawer-head">
    <span class="filter-drawer-title">篩選診所/醫院</span>
    <button class="filter-drawer-close" onclick="closeFilterDrawer()">×</button>
  </div>
  <div class="filter-drawer-body">
    <div class="filter-drawer-section full-width">
      <span class="filter-drawer-label">地區</span>
      <div class="toggle-group" id="drawer-district-toggles">
        ${districtOptions.map(o => `<button class="toggle-pill" data-val="${esc(o)}" onclick="toggleSingleDrawer('district','${esc(o)}',this)">${esc(o)}</button>`).join('')}
      </div>
      <div id="drawer-sub-district-wrap" style="display:none;">
        <div class="filter-drawer-label" style="margin-top:8px;">分區</div>
        ${drawerSubPills}
      </div>
    </div>
    <div class="filter-drawer-section">
      <span class="filter-drawer-label">類型</span>
      <div class="toggle-group" id="drawer-type-toggles">
        ${typeOptions.map(o => `<button class="toggle-pill" data-val="${esc(o)}" onclick="toggleMultiDrawer('type','${esc(o)}',this)">${esc(o)}</button>`).join('')}
      </div>
    </div>
    <div class="filter-drawer-section">
      <span class="filter-drawer-label">機構性質</span>
      <div class="toggle-group" id="drawer-nature-toggles">
        ${natureOptions.map(o => `<button class="toggle-pill" data-val="${esc(o)}" onclick="toggleMultiDrawer('nature','${esc(o)}',this)">${esc(o)}</button>`).join('')}
      </div>
    </div>
    <div class="filter-drawer-section">
      <span class="filter-drawer-label">接診動物</span>
      <div class="toggle-group" id="drawer-animal-toggles">
        ${animalOptions.map(o => `<button class="toggle-pill" data-val="${esc(o)}" onclick="toggleMultiDrawer('animal','${esc(o)}',this)">${esc(o)}</button>`).join('')}
      </div>
    </div>
    <div class="filter-drawer-section full-width">
      <span class="filter-drawer-label">服務種類</span>
      <div class="toggle-group" id="drawer-service-toggles">
        ${serviceOptions.map(o => `<button class="toggle-pill" data-val="${esc(o)}" onclick="toggleMultiDrawer('service','${esc(o)}',this)">${esc(o)}</button>`).join('')}
      </div>
    </div>
  </div>
  <div class="filter-drawer-footer">
    <button class="drawer-clear-btn" onclick="clearAllFilters()">清除全部</button>
    <button class="drawer-apply-btn" onclick="closeFilterDrawer()">顯示結果</button>
  </div>
</div>

</body>
</html>`;
}

/* ── main ── */
(async function () {
  console.log('Fetching Notion schema...');
  const schema = await fetchSchema();

  console.log('Fetching Notion records...');
  const pages = await fetchAll();
  console.log('Found', pages.length, 'records');

  const clinics = pages
    .map(toClinic)
    .filter(c => c.nameCN)
    .sort((a, b) => {
      const rank = s => s === '已結業' ? 1 : 0;
      const r = rank(a.status) - rank(b.status);
      return r !== 0 ? r : a.nameCN.localeCompare(b.nameCN, 'zh-Hant');
    });

  const lastUpdated = new Date().toLocaleDateString('zh-HK', {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  const html    = buildHTML(clinics, lastUpdated, schema);
  const outPath = path.join(__dirname, '..', '..', 'veterinary-hospital-clinic-list', 'index.html');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, html, 'utf8');
  console.log('Done! Written', clinics.length, 'clinics to veterinary-hospital-clinic-list/index.html');
})();