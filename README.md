# ADB HK — 香港動物拯救機構資料庫

A static website listing Hong Kong animal rescue organisations, built with plain HTML/CSS/JS — no frameworks, no build step.

## 📁 Structure

```
/
├── index.html      # Main page (self-contained)
└── README.md
```

## 🚀 Deploy to GitHub Pages

1. Push this repo to GitHub
2. Go to **Settings → Pages**
3. Source: **Deploy from a branch** → `main` → `/ (root)`
4. Save — your site will be live at `https://<username>.github.io/<repo-name>/`

## ✏️ Updating Data

Organisation data lives in the `orgs` array inside `index.html` (search for `const orgs = [`).

Each entry follows this shape:

```js
{
  name:     '機構名稱',
  en:       'English Name',
  types:    ['動物拯救', '收容所', '領養服務', '醫療救助', 'TNR絕育'],
  animals:  ['狗', '貓', '兔兔', '野生動物'],
  district: '全港',          // 全港 | 港島 | 九龍 | 新界
  phone:    '1234 5678',
  email:    'info@example.org',
  website:  'https://example.org',  // null if none
  hours:    '週一至五 09:00–18:00',
  verified: true,             // true | false
  icon:     '🐾',
  desc:     '機構簡介…'
}
```

## 🎨 Brand Colours

| Token          | Hex       |
|----------------|-----------|
| Coral (CTA)    | `#FF7A6B` |
| Coral hover    | `#E96355` |
| Coral light    | `#FFE5E1` |
| Sage           | `#8FAF9B` |
| Sage deep      | `#6E8F7C` |
| Sage light     | `#E6F1EC` |
| Text primary   | `#2F2F2F` |
| Text secondary | `#6B7280` |
