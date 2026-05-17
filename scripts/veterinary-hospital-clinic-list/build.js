// scripts/veterinary-hospital-clinic-list/build.js
// Syncs 🏥 香港動物診所/醫院資料庫 from Notion → veterinary-hospital-clinic-list/index.html

const fs   = require("fs");
const path = require("path");

const NOTION_TOKEN       = process.env.NOTION_TOKEN;
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID;

if (!NOTION_TOKEN || !NOTION_DATABASE_ID) {
  console.error("Missing NOTION_TOKEN or NOTION_DATABASE_ID");
  process.exit(1);
}

// ─── Notion fetch (handles pagination) ────────────────────────────────────────
async function fetchAllPages() {
  const results = [];
  let cursor    = undefined;

  do {
    const body = {
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    };

    const res = await fetch(
      `https://api.notion.com/v1/databases/${NOTION_DATABASE_ID}/query`,
      {
        method:  "POST",
        headers: {
          Authorization:    `Bearer ${NOTION_TOKEN}`,
          "Notion-Version": "2022-06-28",
          "Content-Type":   "application/json",
        },
        body: JSON.stringify(body),
      }
    );

    if (!res.ok) {
      const err = await res.text();
      console.error("Notion API error:", err);
      process.exit(1);
    }

    const data = await res.json();
    results.push(...data.results);
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);

  return results;
}

// ─── Property helpers ──────────────────────────────────────────────────────────
const getText   = (p) => p?.rich_text?.map((r) => r.plain_text).join("") || "";
const getTitle  = (p) => p?.title?.map((r) => r.plain_text).join("") || "";
const getSelect = (p) => p?.select?.name || "";
const getMulti  = (p) => p?.multi_select?.map((o) => o.name) || [];
const getUrl    = (p) => p?.url || "";
const getPhone  = (p) => p?.phone_number || "";
const getEmail  = (p) => p?.email || "";
const getCheck  = (p) => p?.checkbox || false;

// ─── Map raw Notion page → clinic object ──────────────────────────────────────
function mapClinic(page) {
  const p = page.properties;
  return {
    nameCN:       getTitle(p["診所/醫院中文名稱"]),
    nameEN:       getText(p["診所/醫院英文名稱"]),
    district:     getSelect(p["地區"]),
    subDistrict:  getSelect(p["分區"]),
    types:        getMulti(p["類型"]),
    nature:       getMulti(p["機構性質"]),
    animals:      getMulti(p["接診動物"]),
    services:     getMulti(p["服務種類"]),
    addressCN:    getText(p["地址"]),
    addressEN:    getText(p["Address"]),
    phone:        getPhone(p["聯絡電話"]),
    whatsapp:     getPhone(p["WhatsApp"]),
    email:        getEmail(p["Email"]),
    website:      getUrl(p["網站"]),
    facebook:     getUrl(p["Facebook"]),
    instagram:    getUrl(p["Instagram"]),
    mapUrl:       getUrl(p["Google Maps 連結"]),
    hours:        getText(p["營業時間"]),
    verified:     getCheck(p["已核實"]),
    afcdList:     getCheck(p["漁護署名單"]),
  };
}

// ─── Sub-districts by region ───────────────────────────────────────────────────
const subDistrictsByRegion = {
  "港島": ["灣仔","天后","跑馬地","筲箕灣","上環","北角","西營盤","銅鑼灣","大坑","半山","西灣河","赤柱","淺水灣","堅尼地城","炮台山","柴灣","鰂魚涌","鴨脷洲"],
  "九龍": ["太子","旺角","何文田","深水埗","黃埔","尖沙咀","佐敦","油麻地","大角咀","葵涌","新蒲崗","美孚","黃大仙","觀塘","牛頭角","九龍城","紅磡","土瓜灣"],
  "新界": ["將軍澳","大埔","沙田","屯門","大圍","元朗","東涌","荃灣","錦田","深井","洪水橋","粉嶺","上水","西貢"],
  "離島": ["梅窩","馬灣","愉景灣","貝澳"],
};

// ─── HTML helpers ─────────────────────────────────────────────────────────────
function phoneLinks(rawPhone) {
  if (!rawPhone) return "";
  return rawPhone
    .split(";")
    .map((n) => n.trim())
    .filter(Boolean)
    .map((n) => `<a href="tel:${n.replace(/\s/g, "")}">${n}</a>`)
    .join(" · ");
}

function whatsappLink(raw) {
  if (!raw) return "";
  const num = raw.replace(/\D/g, "");
  return `<a href="https://wa.me/${num}" target="_blank" rel="noopener">+${num}</a>`;
}

function animalBadge(a) {
  const map = {
    "貓貓 🐈‍⬛": { cls: "cat",     icon: "🐈‍⬛", label: "貓" },
    "狗狗 🐕":   { cls: "dog",     icon: "🐕",    label: "狗" },
    "異寵動物🦎": { cls: "exotic",  icon: "🦎",    label: "異寵" },
  };
  const m = map[a] || { cls: "other", icon: "🐾", label: a };
  return `<span class="badge badge-animal badge-${m.cls}">${m.icon} ${m.label}</span>`;
}

function typeBadge(t) {
  const map = {
    "診所":       "badge-type-clinic",
    "醫院":       "badge-type-hospital",
    "專科中心":   "badge-type-specialist",
    "大學醫療中心": "badge-type-uni",
  };
  return `<span class="badge ${map[t] || "badge-type-clinic"}">${t}</span>`;
}

function natureBadge(n) {
  const map = {
    "私營":   "badge-private",
    "非牟利": "badge-ngo",
    "政府":   "badge-gov",
    "大學":   "badge-uni",
  };
  return `<span class="badge ${map[n] || "badge-private"}">${n}</span>`;
}

function serviceTag(s) {
  return `<span class="svc-tag">${s}</span>`;
}

function renderCard(c) {
  const phones     = phoneLinks(c.phone);
  const wa         = c.whatsapp ? whatsappLink(c.whatsapp) : "";
  const mapHref    = c.mapUrl && c.mapUrl !== "#" ? c.mapUrl : "#";
  const mapTarget  = mapHref !== "#" ? 'target="_blank" rel="noopener"' : "";

  const addressBlock = `
    <div class="address-block">
      ${c.addressCN ? `<div class="addr-row addr-cn">${c.addressCN}</div>` : ""}
      ${c.addressEN ? `<div class="addr-row addr-en">${c.addressEN}</div>` : ""}
      <a class="map-link" href="${mapHref}" ${mapTarget}>
        <span class="map-icon">📍</span> 查看Google Map
      </a>
    </div>`;

  const contactRows = [
    phones ? `<div class="contact-row">📞 ${phones}</div>` : "",
    wa     ? `<div class="contact-row">
                <svg class="wa-icon" viewBox="0 0 24 24" fill="#25D366"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.1.544 4.07 1.494 5.785L.057 23.927l6.293-1.648A11.935 11.935 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.818 9.818 0 01-5.006-1.371l-.36-.213-3.736.979 1-3.636-.234-.374A9.818 9.818 0 1112 21.818z"/></svg>
                ${wa}
              </div>` : "",
    c.email   ? `<div class="contact-row">✉️ <a href="mailto:${c.email}">${c.email}</a></div>` : "",
  ].filter(Boolean).join("");

  const externalLinks = [
    c.website   ? `<a class="ext-link" href="${c.website}" target="_blank" rel="noopener">🌐 網站</a>` : "",
    c.facebook  ? `<a class="ext-link" href="${c.facebook}" target="_blank" rel="noopener">📘 Facebook</a>` : "",
    c.instagram ? `<a class="ext-link" href="${c.instagram}" target="_blank" rel="noopener">📷 Instagram</a>` : "",
  ].filter(Boolean).join("");

  const animalBadges  = c.animals.map(animalBadge).join("");
  const typeBadges    = c.types.map(typeBadge).join("");
  const natureBadges  = c.nature.map(natureBadge).join("");
  const serviceTags   = c.services.map(serviceTag).join("");

  const verifiedBadge = c.verified
    ? `<span class="verified-badge" title="已核實">✓ 已核實</span>`
    : "";

  return `
  <div class="clinic-card"
    data-district="${c.district}"
    data-sub="${c.subDistrict}"
    data-types="${c.types.join(",")}"
    data-nature="${c.nature.join(",")}"
    data-animals="${c.animals.join(",")}"
    data-services="${c.services.join(",")}"
    data-search="${(c.nameCN + " " + c.nameEN + " " + c.addressCN + " " + c.addressEN).toLowerCase()}"
  >
    <div class="card-header">
      <div class="card-title-block">
        <h3 class="clinic-name">${c.nameCN || c.nameEN}</h3>
        ${c.nameEN && c.nameCN ? `<div class="clinic-name-en">${c.nameEN}</div>` : ""}
        <div class="meta-badges">
          ${typeBadges}
          ${natureBadges}
          ${verifiedBadge}
        </div>
      </div>
      <div class="animal-badges">${animalBadges}</div>
    </div>

    ${addressBlock}

    ${contactRows ? `<div class="contact-block">${contactRows}</div>` : ""}

    ${c.hours ? `<div class="hours-row">🕐 ${c.hours}</div>` : ""}

    ${serviceTags ? `<div class="services-block">${serviceTags}</div>` : ""}

    ${externalLinks ? `<div class="ext-links">${externalLinks}</div>` : ""}
  </div>`;
}

// ─── Filter bar HTML ───────────────────────────────────────────────────────────
function buildFilterBar() {
  const districtOpts = ["港島","九龍","新界","離島"];
  const typeOpts     = ["診所","醫院","專科中心","大學醫療中心"];
  const natureOpts   = ["私營","非牟利","政府","大學"];
  const animalOpts   = [
    { value: "貓貓 🐈‍⬛", label: "🐈‍⬛ 貓貓" },
    { value: "狗狗 🐕",   label: "🐕 狗狗" },
    { value: "異寵動物🦎", label: "🦎 異寵動物" },
  ];

  const districtBtns = districtOpts
    .map((d) => `<button class="filter-btn" data-filter="district" data-value="${d}">${d}</button>`)
    .join("");

  const typeBtns = typeOpts
    .map((t) => `<button class="filter-btn" data-filter="type" data-value="${t}">${t}</button>`)
    .join("");

  const natureBtns = natureOpts
    .map((n) => `<button class="filter-btn" data-filter="nature" data-value="${n}">${n}</button>`)
    .join("");

  const animalBtns = animalOpts
    .map((a) => `<button class="filter-btn" data-filter="animal" data-value="${a.value}">${a.label}</button>`)
    .join("");

  // Sub-district rows (hidden, shown when district is selected)
  const subDistrictRows = Object.entries(subDistrictsByRegion)
    .map(([region, subs]) => {
      const btns = subs
        .map((s) => `<button class="filter-btn sub-btn" data-filter="subDistrict" data-value="${s}">${s}</button>`)
        .join("");
      return `<div class="sub-row" data-region="${region}">${btns}</div>`;
    })
    .join("");

  return `
  <div class="filter-bar">
    <div class="filter-group">
      <span class="filter-label">地區</span>
      <div class="filter-btns">
        <button class="filter-btn active" data-filter="district" data-value="all">全部</button>
        ${districtBtns}
      </div>
    </div>

    <div class="filter-group sub-district-group" id="sub-district-group" style="display:none">
      <span class="filter-label">分區</span>
      <div class="filter-btns sub-district-btns">
        <button class="filter-btn sub-btn active" data-filter="subDistrict" data-value="all">全部分區</button>
        ${subDistrictRows}
      </div>
    </div>

    <div class="filter-group">
      <span class="filter-label">類型</span>
      <div class="filter-btns">
        <button class="filter-btn active" data-filter="type" data-value="all">全部</button>
        ${typeBtns}
      </div>
    </div>

    <div class="filter-group">
      <span class="filter-label">機構性質</span>
      <div class="filter-btns">
        <button class="filter-btn active" data-filter="nature" data-value="all">全部</button>
        ${natureBtns}
      </div>
    </div>

    <div class="filter-group">
      <span class="filter-label">接診動物</span>
      <div class="filter-btns">
        <button class="filter-btn active" data-filter="animal" data-value="all">全部</button>
        ${animalBtns}
      </div>
    </div>
  </div>`;
}

// ─── Full HTML page ────────────────────────────────────────────────────────────
function buildHTML(clinics) {
  const cards = clinics.map(renderCard).join("\n");
  const filterBar = buildFilterBar();
  const now = new Date().toLocaleDateString("zh-HK", {
    year: "numeric", month: "long", day: "numeric",
  });

  return `<!DOCTYPE html>
<html lang="zh-HK">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>香港動物診所/醫院資料庫 | ADB HK</title>
  <meta name="description" content="香港動物診所及醫院資料庫，提供地區、類型、接診動物等篩選功能。" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+HK:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <style>
    /* ── CSS Variables ───────────────────────────────── */
    :root {
      --coral:        #FF6B2B;
      --coral-hover:  #E85A1D;
      --coral-light:  #FFF1EA;
      --sage:         #8FAF9B;
      --sage-deep:    #6E8F7C;
      --sage-light:   #E6F1EC;
      --white:        #FFFFFF;
      --bg:           #F7F8F7;
      --card-bg:      #FFFFFF;
      --text:         #2F2F2F;
      --text-sec:     #6B7280;
      --text-muted:   #9CA3AF;
      --border:       #E5E7EB;
      --shadow:       rgba(0,0,0,0.05);
      --font:         'Noto Sans HK', sans-serif;
    }

    /* ── Reset & Base ────────────────────────────────── */
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--font);
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
    }
    a { color: var(--coral); text-decoration: none; }
    a:hover { color: var(--coral-hover); text-decoration: underline; }

    /* ── Header ──────────────────────────────────────── */
    .site-header {
      background: var(--white);
      border-bottom: 1px solid var(--border);
      padding: 0 1.5rem;
    }
    .header-inner {
      max-width: 1100px;
      margin: 0 auto;
      display: flex;
      align-items: center;
      justify-content: space-between;
      height: 60px;
    }
    .logo {
      font-size: 1rem;
      font-weight: 700;
      color: var(--text);
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .logo span { color: var(--coral); }

    nav a {
      font-size: 13px;
      color: var(--text-sec);
      margin-left: 1.25rem;
      font-weight: 500;
    }
    nav a:hover { color: var(--coral); text-decoration: none; }

    /* ── Hero ────────────────────────────────────────── */
    .page-hero {
      background: linear-gradient(135deg, var(--coral-light) 0%, var(--white) 60%);
      border-bottom: 1px solid var(--border);
      padding: 2.5rem 1.5rem 2rem;
    }
    .hero-inner {
      max-width: 1100px;
      margin: 0 auto;
    }
    .hero-inner h1 {
      font-size: 1.75rem;
      font-weight: 700;
      color: var(--text);
      margin-bottom: 0.4rem;
    }
    .hero-inner p {
      font-size: 14px;
      color: var(--text-sec);
    }
    .hero-inner .updated {
      font-size: 12px;
      color: var(--text-muted);
      margin-top: 0.5rem;
    }

    /* ── Layout ──────────────────────────────────────── */
    .page-body {
      max-width: 1100px;
      margin: 0 auto;
      padding: 1.5rem;
    }

    /* ── Search ──────────────────────────────────────── */
    .search-wrap {
      position: relative;
      margin-bottom: 1rem;
    }
    .search-icon {
      position: absolute;
      left: 12px;
      top: 50%;
      transform: translateY(-50%);
      color: var(--text-muted);
      font-size: 15px;
      pointer-events: none;
    }
    .search-input {
      width: 100%;
      height: 42px;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 0 12px 0 36px;
      font-family: var(--font);
      font-size: 14px;
      color: var(--text);
      background: var(--white);
      outline: none;
      transition: border-color 0.2s;
    }
    .search-input:focus { border-color: var(--coral); }
    .search-input::placeholder { color: var(--text-muted); }

    /* ── Filter Bar ──────────────────────────────────── */
    .filter-bar {
      background: var(--white);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 1rem 1.25rem;
      margin-bottom: 1rem;
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }
    .filter-group {
      display: flex;
      align-items: flex-start;
      gap: 0.75rem;
      flex-wrap: wrap;
    }
    .filter-label {
      font-size: 12px;
      font-weight: 600;
      color: var(--text-sec);
      min-width: 52px;
      padding-top: 6px;
      white-space: nowrap;
    }
    .filter-btns {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .filter-btn {
      height: 30px;
      padding: 0 12px;
      border: 1px solid var(--border);
      border-radius: 20px;
      background: var(--white);
      font-family: var(--font);
      font-size: 12px;
      color: var(--text-sec);
      cursor: pointer;
      transition: all 0.15s;
      white-space: nowrap;
    }
    .filter-btn:hover {
      border-color: var(--coral);
      color: var(--coral);
    }
    .filter-btn.active {
      background: var(--coral);
      border-color: var(--coral);
      color: var(--white);
      font-weight: 500;
    }

    /* Sub-district group */
    .sub-district-group { margin-top: -0.25rem; }
    .sub-district-btns { flex-wrap: wrap; }
    .sub-row { display: none; }
    .sub-row.visible { display: contents; }

    /* ── Active Filter Pills ─────────────────────────── */
    .active-filters {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-bottom: 1rem;
      min-height: 0;
    }
    .filter-pill {
      display: flex;
      align-items: center;
      gap: 5px;
      background: var(--coral-light);
      color: var(--coral);
      border-radius: 20px;
      padding: 4px 10px 4px 12px;
      font-size: 12px;
      font-weight: 500;
      border: 1px solid rgba(255,107,43,0.2);
    }
    .filter-pill button {
      background: none;
      border: none;
      cursor: pointer;
      color: var(--coral);
      font-size: 14px;
      line-height: 1;
      padding: 0;
      opacity: 0.7;
    }
    .filter-pill button:hover { opacity: 1; }

    /* ── Results Meta ────────────────────────────────── */
    .results-meta {
      font-size: 13px;
      color: var(--text-muted);
      margin-bottom: 1rem;
    }
    .results-meta strong { color: var(--text); font-weight: 500; }

    /* ── Clinic Cards ────────────────────────────────── */
    .clinic-list {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .clinic-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 1.25rem 1.5rem;
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    .clinic-card:hover {
      border-color: var(--coral);
      box-shadow: 0 4px 16px var(--shadow);
    }

    .card-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 0.75rem;
    }
    .clinic-name {
      font-size: 1rem;
      font-weight: 700;
      color: var(--text);
      line-height: 1.3;
    }
    .clinic-name-en {
      font-size: 12px;
      color: var(--text-sec);
      margin-top: 2px;
    }
    .meta-badges {
      display: flex;
      flex-wrap: wrap;
      gap: 5px;
      margin-top: 6px;
    }

    .animal-badges {
      display: flex;
      flex-direction: column;
      gap: 4px;
      flex-shrink: 0;
    }

    /* ── Badges ──────────────────────────────────────── */
    .badge {
      display: inline-flex;
      align-items: center;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 500;
    }
    /* Type badges */
    .badge-type-clinic    { background: #EFF6FF; color: #3B82F6; }
    .badge-type-hospital  { background: #F5F3FF; color: #7C3AED; }
    .badge-type-specialist{ background: #FEF2F2; color: #EF4444; }
    .badge-type-uni       { background: #FFF7ED; color: #F97316; }
    /* Nature badges */
    .badge-private { background: #EFF6FF; color: #3B82F6; }
    .badge-ngo     { background: var(--sage-light); color: var(--sage-deep); }
    .badge-gov     { background: #F3F4F6; color: #6B7280; }
    .badge-uni     { background: #FFF7ED; color: #F97316; }
    /* Animal badges */
    .badge-animal  { padding: 3px 8px; border-radius: 20px; font-size: 12px; }
    .badge-cat     { background: #FDF4FF; color: #A855F7; }
    .badge-dog     { background: #FFF7ED; color: #F97316; }
    .badge-exotic  { background: var(--sage-light); color: var(--sage-deep); }
    /* Verified */
    .verified-badge {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      background: var(--sage-light);
      color: var(--sage-deep);
      border-radius: 4px;
      padding: 2px 8px;
      font-size: 11px;
      font-weight: 600;
    }

    /* ── Address ─────────────────────────────────────── */
    .address-block {
      margin-bottom: 0.6rem;
    }
    .addr-row {
      font-size: 13px;
      color: var(--text-sec);
      line-height: 1.5;
    }
    .addr-cn { font-weight: 500; }
    .addr-en { color: var(--text-muted); }
    .map-link {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 12px;
      color: var(--coral);
      margin-top: 4px;
      font-weight: 500;
    }
    .map-link:hover { color: var(--coral-hover); text-decoration: underline; }
    .map-icon { font-size: 13px; }

    /* ── Contact ─────────────────────────────────────── */
    .contact-block {
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin-bottom: 0.6rem;
    }
    .contact-row {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 13px;
      color: var(--text-sec);
    }
    .wa-icon {
      width: 15px;
      height: 15px;
      flex-shrink: 0;
    }

    /* ── Hours ───────────────────────────────────────── */
    .hours-row {
      font-size: 13px;
      color: var(--text-sec);
      margin-bottom: 0.6rem;
    }

    /* ── Services ────────────────────────────────────── */
    .services-block {
      display: flex;
      flex-wrap: wrap;
      gap: 5px;
      margin-bottom: 0.6rem;
    }
    .svc-tag {
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 2px 8px;
      font-size: 11px;
      color: var(--text-sec);
    }

    /* ── External Links ──────────────────────────────── */
    .ext-links {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 0.5rem;
    }
    .ext-link {
      font-size: 12px;
      color: var(--text-sec);
      display: flex;
      align-items: center;
      gap: 3px;
    }
    .ext-link:hover { color: var(--coral); text-decoration: none; }

    /* ── Empty State ─────────────────────────────────── */
    .empty-state {
      text-align: center;
      padding: 3rem 1rem;
      color: var(--text-muted);
    }
    .empty-icon { font-size: 2.5rem; margin-bottom: 0.75rem; }
    .empty-state h3 { font-size: 1rem; color: var(--text-sec); margin-bottom: 0.4rem; }
    .empty-state p  { font-size: 13px; }

    /* ── Footer ──────────────────────────────────────── */
    footer {
      border-top: 1px solid var(--border);
      margin-top: 3rem;
      padding: 1.5rem;
      background: var(--white);
    }
    .footer-inner {
      max-width: 1100px;
      margin: 0 auto;
      display: flex;
      justify-content: space-between;
      font-size: 12px;
      color: var(--text-muted);
      flex-wrap: wrap;
      gap: 8px;
    }

    /* ── Responsive ──────────────────────────────────── */
    @media (max-width: 640px) {
      .card-header { flex-direction: column; }
      .animal-badges { flex-direction: row; }
      .hero-inner h1 { font-size: 1.4rem; }
      .filter-label { min-width: 40px; font-size: 11px; }
    }
  </style>
</head>
<body>

<!-- HEADER -->
<header class="site-header">
  <div class="header-inner">
    <div class="logo">🐾 <span>ADB</span> HK</div>
    <nav>
      <a href="/">首頁</a>
      <a href="/animal-rescue-organization-list">動物救援機構</a>
      <a href="/animal-hospital-clinic">動物診所/醫院</a>
    </nav>
  </div>
</header>

<!-- HERO -->
<div class="page-hero">
  <div class="hero-inner">
    <h1>🏥 香港動物診所/醫院資料庫</h1>
    <p>搜尋全港動物診所、醫院及專科中心，支援地區、類型及接診動物篩選。</p>
    <p class="updated">最後更新：${now} · 共 ${clinics.length} 間診所/醫院</p>
  </div>
</div>

<!-- MAIN -->
<main class="page-body">

  <!-- SEARCH -->
  <div class="search-wrap">
    <span class="search-icon">🔍</span>
    <input
      class="search-input"
      id="search"
      type="search"
      placeholder="搜尋診所名稱、地址…"
      oninput="applyFilters()"
    />
  </div>

  <!-- FILTERS -->
  ${filterBar}

  <!-- ACTIVE PILLS -->
  <div class="active-filters" id="active-pills"></div>

  <!-- RESULTS META -->
  <div class="results-meta" id="results-meta"></div>

  <!-- CLINIC LIST -->
  <div class="clinic-list" id="clinic-list">
    ${cards}
  </div>

</main>

<!-- FOOTER -->
<footer>
  <div class="footer-inner">
    <span>© ${new Date().getFullYear()} ADB HK · 香港動物診所/醫院資料庫</span>
    <span>資料如有錯誤或更新，歡迎 <a href="mailto:info@adbhk.org">聯絡我們</a></span>
  </div>
</footer>

<script>
// ── Filter state ────────────────────────────────────────────────────────────
const state = {
  district:    "all",
  subDistrict: "all",
  type:        "all",
  nature:      "all",
  animal:      "all",
};

// Sub-districts per region (for showing/hiding the sub-district row)
const subsByRegion = ${JSON.stringify(subDistrictsByRegion)};

// ── On load ─────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  applyFilters();

  // Attach filter button listeners
  document.querySelectorAll(".filter-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const dim = btn.dataset.filter;
      const val = btn.dataset.value;
      setFilter(dim, val, btn);
    });
  });
});

// ── Set a filter ─────────────────────────────────────────────────────────────
function setFilter(dim, val, btn) {
  state[dim] = val;

  // Update active class within the same filter group buttons
  document.querySelectorAll(\`.filter-btn[data-filter="\${dim}"]\`).forEach((b) => {
    b.classList.remove("active");
  });
  btn.classList.add("active");

  // Handle district → show sub-districts
  if (dim === "district") {
    handleSubDistrict(val);
  }

  applyFilters();
  renderPills();
}

function handleSubDistrict(district) {
  const group = document.getElementById("sub-district-group");
  // Reset sub-district
  state.subDistrict = "all";
  document.querySelectorAll('.filter-btn[data-filter="subDistrict"]').forEach((b) => {
    b.classList.remove("active");
  });
  const allSubBtn = document.querySelector('.sub-btn[data-value="all"]');
  if (allSubBtn) allSubBtn.classList.add("active");

  if (district === "all") {
    group.style.display = "none";
    document.querySelectorAll(".sub-row").forEach((r) => r.classList.remove("visible"));
  } else {
    group.style.display = "";
    document.querySelectorAll(".sub-row").forEach((r) => {
      r.classList.toggle("visible", r.dataset.region === district);
    });
  }
}

// ── Apply all filters + search ───────────────────────────────────────────────
function applyFilters() {
  const q    = (document.getElementById("search")?.value || "").trim().toLowerCase();
  const list = document.getElementById("clinic-list");
  const meta = document.getElementById("results-meta");
  const cards = document.querySelectorAll(".clinic-card");

  let visible = 0;
  cards.forEach((card) => {
    const match =
      (state.district    === "all" || card.dataset.district === state.district) &&
      (state.subDistrict === "all" || card.dataset.sub === state.subDistrict) &&
      (state.type        === "all" || card.dataset.types.split(",").includes(state.type)) &&
      (state.nature      === "all" || card.dataset.nature.split(",").includes(state.nature)) &&
      (state.animal      === "all" || card.dataset.animals.split(",").includes(state.animal)) &&
      (!q || card.dataset.search.includes(q));

    card.style.display = match ? "" : "none";
    if (match) visible++;
  });

  if (visible === 0) {
    if (!document.querySelector(".empty-state")) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.innerHTML = \`
        <div class="empty-icon">🔍</div>
        <h3>找不到符合條件的診所/醫院</h3>
        <p>試試更換搜尋詞或篩選條件</p>\`;
      list.appendChild(empty);
    }
  } else {
    const existing = list.querySelector(".empty-state");
    if (existing) existing.remove();
  }

  meta.innerHTML = \`顯示 <strong>\${visible}</strong> 間 / 共 \${cards.length} 間\`;
}

// ── Active filter pills ──────────────────────────────────────────────────────
const dimLabels = {
  district:    "地區",
  subDistrict: "分區",
  type:        "類型",
  nature:      "機構性質",
  animal:      "接診動物",
};

function renderPills() {
  const container = document.getElementById("active-pills");
  container.innerHTML = "";
  Object.entries(state).forEach(([dim, val]) => {
    if (val === "all") return;
    const pill = document.createElement("div");
    pill.className = "filter-pill";
    pill.innerHTML = \`\${dimLabels[dim]}：\${val} <button onclick="clearFilter('\${dim}')" title="移除篩選">×</button>\`;
    container.appendChild(pill);
  });
}

function clearFilter(dim) {
  state[dim] = "all";
  const allBtn = document.querySelector(\`.filter-btn[data-filter="\${dim}"][data-value="all"]\`);
  if (allBtn) {
    document.querySelectorAll(\`.filter-btn[data-filter="\${dim}"]\`).forEach((b) => b.classList.remove("active"));
    allBtn.classList.add("active");
  }
  if (dim === "district") handleSubDistrict("all");
  applyFilters();
  renderPills();
}
</script>
</body>
</html>`;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log("Fetching clinic database from Notion…");
  const pages   = await fetchAllPages();
  const clinics = pages.map(mapClinic).filter((c) => c.nameCN || c.nameEN);
  console.log(`Fetched ${clinics.length} clinics`);

  const html    = buildHTML(clinics);
  const outDir  = path.join(__dirname, "..", "..", "veterinary-hospital-clinic-list");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "index.html"), html, "utf8");
  console.log("✅ Written to veterinary-hospital-clinic-list/index.html");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});