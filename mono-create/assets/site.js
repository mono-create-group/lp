/* mono.create サイト共通スクリプト（vanilla・依存なし）
   1) ヒーロー段階登場  2) スクロールreveal  3) 数字カウントアップ
   4) モバイルナビ開閉。すべて prefers-reduced-motion を尊重。 */
(function () {
  'use strict';
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* 1) ヒーロー段階登場 */
  function initHero() {
    var heroes = document.querySelectorAll('[data-hero]');
    if (!heroes.length) return;
    heroes.forEach(function (hero) {
      if (reduce) { hero.classList.add('ready'); return; }
      requestAnimationFrame(function () {
        requestAnimationFrame(function () { hero.classList.add('ready'); });
      });
    });
  }

  /* 3) 数字カウントアップ（data-count="150" data-suffix="通" 等） */
  function countUp(el) {
    var target = parseFloat(el.getAttribute('data-count'));
    if (isNaN(target)) return;
    var prefix = el.getAttribute('data-prefix') || '';
    var suffix = el.getAttribute('data-suffix') || '';
    if (reduce) { el.textContent = prefix + target + suffix; return; }
    var dur = 1100, start = null;
    function step(ts) {
      if (start === null) start = ts;
      var p = Math.min((ts - start) / dur, 1);
      var eased = 1 - Math.pow(1 - p, 3); /* easeOutCubic */
      var val = Math.round(target * eased);
      el.textContent = prefix + val + suffix;
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  /* 2)+3) スクロールreveal ＆ カウント発火 */
  function initReveal() {
    var reveals = [].slice.call(document.querySelectorAll('[data-reveal]'));
    var counts = [].slice.call(document.querySelectorAll('[data-count]'));
    if (reduce || !('IntersectionObserver' in window)) {
      reveals.forEach(function (el) { el.classList.add('in-view'); });
      counts.forEach(countUp);
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        e.target.classList.add('in-view');
        if (e.target.hasAttribute('data-count')) countUp(e.target);
        io.unobserve(e.target);
      });
    }, { threshold: 0.15, rootMargin: '0px 0px -8% 0px' });
    reveals.forEach(function (el) { io.observe(el); });
    counts.forEach(function (el) { if (!el.hasAttribute('data-reveal')) io.observe(el); });
  }

  /* 4) モバイルナビ */
  function initNav() {
    var toggle = document.querySelector('.nav-toggle');
    var mnav = document.querySelector('.mnav');
    var scrim = document.querySelector('.mnav-scrim');
    var closeBtn = document.querySelector('.mnav-close');
    if (!toggle || !mnav) return;
    function open() { mnav.classList.add('open'); if (scrim) scrim.classList.add('open'); toggle.setAttribute('aria-expanded', 'true'); }
    function close() { mnav.classList.remove('open'); if (scrim) scrim.classList.remove('open'); toggle.setAttribute('aria-expanded', 'false'); }
    toggle.addEventListener('click', open);
    if (closeBtn) closeBtn.addEventListener('click', close);
    if (scrim) scrim.addEventListener('click', close);
    mnav.querySelectorAll('a').forEach(function (a) { a.addEventListener('click', close); });
  }

  function boot() { initHero(); initReveal(); initNav(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
