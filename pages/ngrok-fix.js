// Fix ngrok free tier browser warning page blocking API requests
// Only adds ngrok-skip-browser-warning header to SAME-ORIGIN requests
(function() {
  const origFetch = window.fetch;
  window.fetch = function(url, options) {
    options = options || {};
    // Only add ngrok header for same-origin requests (relative URLs or same host)
    if (typeof url === 'string' && (url.startsWith('/') || url.startsWith(window.location.origin) || !url.startsWith('http'))) {
      options.headers = options.headers || {};
      if (options.headers instanceof Headers) {
        options.headers.set('ngrok-skip-browser-warning', '1');
      } else {
        options.headers['ngrok-skip-browser-warning'] = '1';
      }
    }
    return origFetch.call(this, url, options);
  };
})();
