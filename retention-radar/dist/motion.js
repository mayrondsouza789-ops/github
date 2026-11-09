/* Keep navigation and form updates synchronous. Animations decorate the committed DOM. */
(() => {
  const preference = matchMedia('(prefers-reduced-motion: reduce)');
  const easeOut = 'cubic-bezier(.22, 1, .36, 1)';
  const easeIn = 'cubic-bezier(.4, 0, .8, .3)';
  const running = new Set();
  const canAnimate = () => !preference.matches && typeof Element.prototype.animate === 'function';
  let currentView;

  function play(element, frames, options) {
    if (!element || !canAnimate()) return null;
    const animation = element.animate(frames, { easing: easeOut, ...options });
    running.add(animation);
    const release = () => running.delete(animation);
    animation.addEventListener('finish', release, { once: true });
    animation.addEventListener('cancel', release, { once: true });
    return animation;
  }

  preference.addEventListener('change', () => {
    if (preference.matches) running.forEach(animation => animation.finish());
  });

  function reveal(element, distance = 6, delay = 0, duration = 290) {
    play(element, [
      { opacity: .38, transform: 'translateY(' + distance + 'px)' },
      { opacity: 1, transform: 'translateY(0)' }
    ], { duration, delay, fill: 'backwards' });
  }

  const render = renderContent;
  renderContent = function (...args) {
    const previous = document.getElementById('content');
    // Read the visible curve when a second filter change interrupts a transition.
    const morphCurve = canAnimate() && currentView === 'Overview' && view === 'Overview' &&
      CSS.supports('d', 'path("M0 0 L1 1")');
    const oldCurves = morphCurve
      ? Array.from(previous.querySelectorAll('.ov-area, .ov-line'), path => getComputedStyle(path).d)
      : [];
    const previousTabs = previous?.querySelectorAll('[role="tab"][aria-selected="true"]');
    const tabLabels = Array.from(previousTabs || [], tab => tab.textContent);
    const previousReport = previous?.querySelector('.report-library button.active')?.textContent;
    const result = render.apply(this, args);
    const content = document.getElementById('content');
    if (!content) return result;
    const routeChanged = currentView !== content.dataset.view;
    currentView = content.dataset.view;
    if (!canAnimate()) return result;

    if (routeChanged) {
      // Cap both the number of composited sections and the last entrance delay.
      Array.from(content.children).slice(0, 6).forEach((section, index) => {
        reveal(section, index === 0 ? 5 : 9, index * 18, 320);
      });
      content.querySelectorAll('path.trend-line[pathLength="1"]').forEach(line => {
        play(line, [{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], {
          duration: 480, delay: 65, fill: 'backwards'
        });
      });
      const overviewLine = content.querySelector('.ov-line');
      if (overviewLine) {
        play(overviewLine, [{ strokeDasharray: '1 1', strokeDashoffset: 1 }, { strokeDasharray: '1 1', strokeDashoffset: 0 }], { duration: 420 });
        play(content.querySelector('.ov-area'), [{ opacity: 0 }, { opacity: 1 }], { duration: 420 });
      }
    } else {
      content.querySelectorAll('.ov-area, .ov-line').forEach((path, index) => {
        const from = oldCurves[index];
        if (!from) return;
        const to = getComputedStyle(path).d;
        if (from === to) return;
        if (from.match(/[MLCZ]/g)?.join('') === to.match(/[MLCZ]/g)?.join('')) {
          play(path, [{ d: from }, { d: to }], { duration: 270 });
        } else {
          play(path, [{ opacity: .3 }, { opacity: 1 }], { duration: 190 });
        }
      });
      const tabs = content.querySelectorAll('[role="tab"][aria-selected="true"]');
      tabs.forEach((tab, index) => {
        if (tabLabels[index] && tabLabels[index] !== tab.textContent) {
          reveal(tab.closest('[role="tablist"]').nextElementSibling, 4, 0, 215);
        }
      });
      const report = content.querySelector('.report-library button.active')?.textContent;
      if (previousReport && report !== previousReport) {
        reveal(content.querySelector('.report-preview'), 4, 0, 215);
      }
    }
    return result;
  };

  let highlight;
  function clearHighlight() {
    if (!highlight) return;
    const { selected, marker, animation } = highlight;
    highlight = null;
    animation.cancel();
    selected.classList.remove('rr-moving-selection');
    selected.style.removeProperty('--rr-selection-fill');
    selected.style.removeProperty('--rr-selection-shadow');
    marker.remove();
  }

  const changeView = navigate;
  navigate = function (...args) {
    const trigger = document.activeElement;
    const fromKeyboard = trigger?.matches(':focus-visible');
    const previous = highlight?.marker || document.querySelector('.nav button.active');
    const oldTop = canAnimate() && previous ? previous.getBoundingClientRect().top : null;
    clearHighlight();
    const result = changeView.apply(this, args);
    const selected = document.querySelector('.nav button.active');
    const mobile = document.querySelector('.mobile-menu')?.offsetParent != null;
    if (selected && oldTop != null && !mobile) {
      const offset = oldTop - selected.getBoundingClientRect().top;
      if (Math.abs(offset) > 1) {
        // Only the active background travels. Text, icons and focus outlines stay in place.
        const style = getComputedStyle(selected);
        selected.style.setProperty('--rr-selection-fill', style.backgroundColor);
        selected.style.setProperty('--rr-selection-shadow', style.boxShadow);
        selected.classList.add('rr-moving-selection');
        const marker = document.createElement('span');
        marker.className = 'rr-nav-marker';
        marker.setAttribute('aria-hidden', 'true');
        selected.prepend(marker);
        const animation = play(marker, [
          { transform: 'translateY(' + offset + 'px)', opacity: .45 },
          { transform: 'translateY(0)', opacity: 1 }
        ], { duration: 285 });
        highlight = { selected, marker, animation };
        animation.addEventListener('finish', () => {
          if (highlight?.marker === marker) clearHighlight();
        }, { once: true });
      }
    }
    if (fromKeyboard && document.activeElement === document.body) {
      const destination = !mobile && trigger.closest('.nav') && selected
        ? selected
        : document.getElementById('content');
      destination?.focus({ preventScroll: true });
    }
    return result;
  };

  const showDrawer = openDrawer;
  let origin;
  let appWasInert = false;
  openDrawer = function (...args) {
    const prior = document.querySelector('#overlay .drawer');
    if (!prior) {
      origin = document.activeElement;
      appWasInert = document.getElementById('app').inert;
    }
    const result = showDrawer.apply(this, args);
    const backdrop = document.querySelector('#overlay .overlay-backdrop');
    const drawer = backdrop?.querySelector('.drawer');
    if (!drawer) return result;
    document.getElementById('app').inert = true;
    if (prior) {
      reveal(drawer, 5, 0, 190);
    } else {
      play(backdrop, [{ opacity: .16 }, { opacity: 1 }], { duration: 210 });
      play(drawer, [
        { transform: 'translateX(40px)', opacity: .55 },
        { transform: 'translateX(0)', opacity: 1 }
      ], { duration: 320 });
    }
    return result;
  };

  closeDrawer = function () {
    const backdrop = document.querySelector('#overlay .overlay-backdrop');
    if (!backdrop || backdrop.dataset.closing) return;
    backdrop.dataset.closing = 'true';
    const drawer = backdrop.querySelector('.drawer');
    drawer.inert = true;
    const finish = () => {
      // Opening a new dialog during an exit must leave the new dialog intact.
      if (!backdrop.isConnected) return;
      oldClose();
      document.getElementById('app').inert = appWasInert;
      const target = origin?.isConnected ? origin : document.getElementById('content');
      target?.focus({ preventScroll: true });
      origin = null;
    };
    if (!canAnimate()) { finish(); return; }
    const transform = getComputedStyle(drawer).transform;
    play(drawer, [{ transform }, { transform: 'translateX(27px)' }], { duration: 160, easing: easeIn });
    const exit = play(backdrop, [
      { opacity: getComputedStyle(backdrop).opacity },
      { opacity: 0 }
    ], { duration: 160, easing: easeIn });
    exit.addEventListener('finish', finish, { once: true });
    exit.addEventListener('cancel', finish, { once: true });
  };

  document.documentElement.classList.add('rr-motion');
})();
