/* ProgressCheck — presentation-only motion layer.
   Does not read or change application state, ids, handlers or text.
   - Route-enter choreography (CSS keyed on html[data-enter])
   - Scroll reveals on the demo page (.rv / .in)
   - Range-input fill + topbar scroll shadow */
(function () {
  'use strict';
  var root = document.documentElement;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!reduce) root.classList.add('js-motion');

  /* Route / first-load entrance: CSS animations only run while data-enter is set */
  var enterTimer;
  function enter() {
    if (reduce) return;
    root.setAttribute('data-enter', '');
    clearTimeout(enterTimer);
    enterTimer = setTimeout(function () { root.removeAttribute('data-enter'); }, 900);
  }
  enter();
  window.addEventListener('hashchange', enter);

  /* Scroll reveals (demo page) */
  var targets = [
    '.demo-intro > div', '.demo-intro > aside', '#patient-profile', '#demo-steps', '#scenario-section',
    '#analysis-panel', '#timeline', '#compare-section', '#report', '#mock-review',
    '.demo-main > .panel', '.demo-footer'
  ];
  var seen = new Set();
  var els = [];
  targets.forEach(function (sel) {
    document.querySelectorAll(sel).forEach(function (el) {
      if (seen.has(el)) return;
      seen.add(el);
      el.classList.add('rv');
      els.push(el);
    });
  });
  if (!reduce && els.length && 'IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.01 });
    els.forEach(function (el, i) {
      el.style.transitionDelay = (el.matches('.demo-intro > *') ? i * 80 : 0) + 'ms';
      io.observe(el);
    });
    // Safety net: never leave content hidden
    setTimeout(function () { els.forEach(function (el) { el.classList.add('in'); }); }, 3000);
  } else {
    els.forEach(function (el) { el.classList.add('in'); });
  }

  /* Range fill for the track (purely visual) */
  function fill(r) {
    var min = +r.min || 0, max = +r.max || 100;
    r.style.setProperty('--fill', ((r.value - min) / (max - min || 1)) * 100 + '%');
  }
  function initRanges() { document.querySelectorAll('input[type=range]').forEach(fill); }
  document.addEventListener('input', function (e) {
    if (e.target && e.target.type === 'range') fill(e.target);
  });
  var raf;
  new MutationObserver(function () {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(initRanges);
  }).observe(document.body, { childList: true, subtree: true });
  initRanges();

  // The comparison also changes via image dragging and presentation playback.
  // Those updates do not emit an input event; keep the visual track in sync.
  var reveal = document.getElementById('compare-reveal');
  if (reveal) new MutationObserver(function () {
    var range = document.getElementById('comparison-range');
    if (range) fill(range);
  }).observe(reveal, { attributes: true, attributeFilter: ['style'] });

  /* Topbar hairline shadow after scroll */
  var ticking = false;
  window.addEventListener('scroll', function () {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      root.toggleAttribute('data-scrolled', window.scrollY > 8);
      ticking = false;
    });
  }, { passive: true });
})();
