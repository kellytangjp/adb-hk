/* ── ADB HK Shared Footer ── */
(function () {
  const footerCSS = `
<style id="adb-footer-style">
#adb-footer {
  border-top: 1px solid #E5E7EB;
  background: #FFFFFF;
  padding: 1.5rem 2rem;
  margin-top: 3rem;
  font-family: 'Noto Sans TC', sans-serif;
}
#adb-footer .footer-inner {
  max-width: 1100px;
  margin: 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 13px;
  color: #9CA3AF;
}
#adb-footer a { color: #FF6B2B; text-decoration: none; }
#adb-footer a:hover { text-decoration: underline; }
@media (max-width: 680px) {
  #adb-footer .footer-inner { flex-direction: column; align-items: flex-start; gap: 4px; }
}
</style>`;

  const year = new Date().getFullYear();

  const footerHTML = `
<footer id="adb-footer">
  <div class="footer-inner">
    <span>© ${year} ADB HK · 香港動物拯救機構資料庫</span>
    <span>資料如有錯誤或更新，歡迎 <a href="mailto:info@adbhk.org">聯絡我們</a></span>
  </div>
</footer>`;

  /* inject CSS into <head> */
  document.head.insertAdjacentHTML('beforeend', footerCSS);

  /* inject footer at bottom of <body> */
  document.body.insertAdjacentHTML('beforeend', footerHTML);
})();
