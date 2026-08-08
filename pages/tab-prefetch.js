// Prefetch all tab pages for instant switching
(function() {
  var tabs = ['home.html', 'training-plan.html', 'course-detail.html', 'community.html', 'profile.html'];
  var links = [];
  
  function prefetch() {
    tabs.forEach(function(page) {
      var link = document.createElement('link');
      link.rel = 'prefetch';
      link.href = page;
      document.head.appendChild(link);
      links.push(link);
    });
  }
  
  // Prefetch after page loads
  if (document.readyState === 'complete') {
    prefetch();
  } else {
    window.addEventListener('load', prefetch);
  }
})();
