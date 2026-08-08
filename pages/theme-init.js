// Theme initialization - must load in <head> BEFORE any rendering
// Reads from sportlife_theme (survives logout) instead of sportlife_user
// Also checks scheduled dark mode
(function(){
  // ===== Smooth Page Transition =====
  var TRANSITION_KEY = '__nav_transition';
  var TRANSITION_DURATION = 160;

  // Inject transition CSS
  var css = document.createElement('style');
  css.id = 'nav-transition-css';
  css.textContent =
    '@keyframes navFadeIn{from{opacity:0;transform:translateY(6px) scale(0.99)}to{opacity:1;transform:none}}' +
    '@keyframes navFadeOut{from{opacity:1;transform:none}to{opacity:0;transform:translateY(-4px) scale(0.995)}}' +
    'html.__nav-out body,html.__nav-out>.app-container,html.__nav-out>#app{animation:navFadeOut ' + TRANSITION_DURATION + 'ms ease-in forwards!important;pointer-events:none}' +
    'html.__nav-in body,html.__nav-in>.app-container,html.__nav-in>#app{animation:navFadeIn 200ms ease-out forwards}';
  (document.head || document.documentElement).appendChild(css);

  // On page load: play fade-in if coming from a navigation
  if (sessionStorage.getItem(TRANSITION_KEY) === '1') {
    sessionStorage.removeItem(TRANSITION_KEY);
    document.documentElement.classList.add('__nav-in');
    document.addEventListener('DOMContentLoaded', function() {
      setTimeout(function() { document.documentElement.classList.remove('__nav-in'); }, 220);
    });
    // Fallback: also remove after animation regardless
    setTimeout(function() { document.documentElement.classList.remove('__nav-in'); }, 300);
  }

  // Intercept navigation: smooth fade-out then navigate
  function smoothNavigate(url) {
    if (!url || url === 'javascript:void(0)' || url === '#' || url.startsWith('javascript:')) return false;
    // Don't intercept external links or different origins
    try {
      if (url.startsWith('http') && new URL(url, location.origin).origin !== location.origin) return false;
    } catch(e) { return false; }
    // Mark that next page should fade in
    sessionStorage.setItem(TRANSITION_KEY, '1');
    // Play fade-out
    document.documentElement.classList.add('__nav-out');
    setTimeout(function() {
      window.___skipNavTransition = true;
      window.location.href = url;
    }, TRANSITION_DURATION);
    return true;
  }

  // Intercept <a> clicks (capture phase, before any handler)
  document.addEventListener('click', function(e) {
    var link = e.target.closest('a[href]');
    if (link && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      var href = link.getAttribute('href');
      if (smoothNavigate(href)) {
        e.preventDefault();
        e.stopPropagation();
      }
    }
  }, true);

  // Intercept window.location setter via defineProperty
  var _href = Object.getOwnPropertyDescriptor(window, 'location') && Object.getOwnPropertyDescriptor(window, 'location').get;
  if (!window.___skipNavTransition) {
    try {
      // Use a proxy approach: override the location href descriptor behavior
      // Since window.location is not directly overridable, we intercept common patterns
      var origAssign = window.location.assign.bind(window.location);
      window.location.assign = function(url) {
        if (smoothNavigate(url)) return;
        return origAssign(url);
      };

      // For direct href setter (most common: location.href = 'xxx'), 
      // we use a workaround via defining __navTo on window
      Object.defineProperty(window, '__navTo', {
        value: function(url) { smoothNavigate(url); },
        writable: false, configurable: false
      });
    } catch(e) {}
  }
  window.___skipNavTransition = false;
  window.navigateTo = function(url) { smoothNavigate(url); };

  function applyScheduleDark() {
    var raw = localStorage.getItem('sportlife_dark_schedule');
    if (!raw) return;
    try {
      var schedule = JSON.parse(raw);
      if (!schedule.enabled) return;
      var now = new Date();
      var minutes = now.getHours() * 60 + now.getMinutes();
      var startParts = schedule.startTime.split(':');
      var endParts = schedule.endTime.split(':');
      var startMin = parseInt(startParts[0]) * 60 + parseInt(startParts[1]);
      var endMin = parseInt(endParts[0]) * 60 + parseInt(endParts[1]);
      var shouldBeDark;
      if (startMin > endMin) {
        shouldBeDark = (minutes >= startMin || minutes < endMin);
      } else {
        shouldBeDark = (minutes >= startMin && minutes < endMin);
      }
      if (shouldBeDark) {
        localStorage.setItem('sportlife_theme', 'dark');
        return true;
      } else {
        localStorage.setItem('sportlife_theme', 'light');
        return false;
      }
    } catch(e) { return false; }
  }

  function applyTheme() {
    // Check scheduled dark mode first (overrides manual setting when active)
    var raw = localStorage.getItem('sportlife_dark_schedule');
    var scheduleActive = false;
    if (raw) {
      try { scheduleActive = JSON.parse(raw).enabled; } catch(e) {}
    }

    if (scheduleActive) {
      applyScheduleDark();
    }

    var theme = localStorage.getItem('sportlife_theme');
    if (theme === 'dark' || (!theme && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      document.documentElement.classList.add('dark');
    }
  }
  applyTheme();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyTheme);
  }
})();