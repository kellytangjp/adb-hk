/* ── ADB HK Shared Navigation ── */
(function () {
  const NAV_LINKS = [
    { label: "動物拯救機構", href: "/adb-hk/animal-rescue-organization-list/" },
	{ label: "動物醫院/診所", href: "/veterinary-hospital-clinic-list/" },
	{ label: "獸醫資訊", href: "/vet-list" },
    { label: "緊急求助",   href: "/adb-hk/emergency/" },
    { label: "關於我們",   href: "/adb-hk/about/" },
  ];

  const currentPath = window.location.pathname;

  function isActive(href) {
    return currentPath === href || currentPath.startsWith(href);
  }

  const navHTML = `
<nav id="adb-nav">
  <a href="/adb-hk/" class="nav-logo">浪浪有家 • ADBHK | 領養不購買 | 香港動物資訊網</a>
  <ul class="nav-links">
    ${NAV_LINKS.map(l => `
    <li><a href="${l.href}" ${isActive(l.href) ? 'class="active"' : ''}>${l.label}</a></li>`).join("")}
  </ul>
  <button class="hamburger" id="hamburger" onclick="adbToggleMenu()" aria-label="選單">
    <span></span><span></span><span></span>
  </button>
</nav>
<div class="mobile-menu" id="mobile-menu">
  ${NAV_LINKS.map(l => `
  <a href="${l.href}" ${isActive(l.href) ? 'class="active"' : ''}>${l.label}</a>`).join("")}
</div>`;

  const navCSS = `
<style id="adb-nav-style">
/* ── global reset (applied once via nav.js) ── */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: 'Noto Sans TC', sans-serif; background: #F7F8F7; color: #2F2F2F; }

#adb-nav {
  background: #FFFFFF; border-bottom: 1px solid #E5E7EB;
  padding: 0 2rem; height: 60px;
  display: flex; align-items: center; justify-content: space-between;
  position: sticky; top: 0; z-index: 200;
  font-family: 'Noto Sans TC', sans-serif;
}
#adb-nav .nav-logo {
  font-size: 15px; font-weight: 600; color: #2F2F2F;
  text-decoration: none; display: flex; align-items: center; gap: 8px;
}
#adb-nav .nav-logo span { color: #FF6B2B; }
#adb-nav .nav-links { display: flex; gap: 2rem; list-style: none; }
#adb-nav .nav-links a {
  font-size: 14px; color: #6B7280; text-decoration: none;
  font-weight: 400; transition: color 0.2s;
}
#adb-nav .nav-links a:hover,
#adb-nav .nav-links a.active { color: #FF6B2B; }
#adb-nav .nav-links a.active { font-weight: 500; }

.hamburger {
  display: none; flex-direction: column; justify-content: center; gap: 5px;
  width: 36px; height: 36px; background: none; border: none; cursor: pointer; padding: 4px;
}
.hamburger span {
  display: block; height: 2px; background: #2F2F2F;
  border-radius: 2px; transition: all 0.25s;
}
.hamburger.open span:nth-child(1) { transform: translateY(7px) rotate(45deg); }
.hamburger.open span:nth-child(2) { opacity: 0; }
.hamburger.open span:nth-child(3) { transform: translateY(-7px) rotate(-45deg); }

.mobile-menu {
  display: none; position: fixed; top: 60px; left: 0; right: 0; bottom: 0;
  background: #FFFFFF; z-index: 190; flex-direction: column;
  padding: 1.5rem 2rem; border-top: 1px solid #E5E7EB;
  font-family: 'Noto Sans TC', sans-serif;
}
.mobile-menu.open { display: flex; }
.mobile-menu a {
  font-size: 16px; color: #6B7280; text-decoration: none;
  padding: 1rem 0; border-bottom: 1px solid #E5E7EB; font-weight: 400; transition: color 0.2s;
}
.mobile-menu a:hover,
.mobile-menu a.active { color: #FF6B2B; }
.mobile-menu a.active { font-weight: 500; }

@media (max-width: 680px) {
  #adb-nav { padding: 0 1rem; }
  #adb-nav .nav-links { display: none; }
  .hamburger { display: flex; }
}
</style>`;

  /* inject CSS into <head> */
  document.head.insertAdjacentHTML("beforeend", navCSS);

  /* inject nav at top of <body> */
  document.body.insertAdjacentHTML("afterbegin", navHTML);

  window.adbToggleMenu = function () {
    document.getElementById("hamburger").classList.toggle("open");
    document.getElementById("mobile-menu").classList.toggle("open");
  };
})();