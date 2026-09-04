(function watchMainWorldNavigation() {
  'use strict';

  const SOURCE = 'clean-trail-extension-v1';
  const rawPushState = history.pushState;
  const rawReplaceState = history.replaceState;
  let requestNumber = 0;
  let pending = null;

  function requestClean() {
    const url = location.href;
    const requestId = `${Date.now()}-${requestNumber += 1}`;
    pending = { requestId, url };
    window.postMessage({ source: SOURCE, type: 'request-clean', requestId, url }, '*');
  }

  function patchedPushState(...args) {
    const result = rawPushState.apply(this, args);
    requestClean();
    return result;
  }

  function patchedReplaceState(...args) {
    const result = rawReplaceState.apply(this, args);
    requestClean();
    return result;
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data || event.data.source !== SOURCE) return;
    if (event.data.type !== 'apply-cleaned') return;
    if (!pending || pending.requestId !== event.data.requestId) return;
    if (location.href !== event.data.url || typeof event.data.cleaned !== 'string') return;
    if (event.data.cleaned !== location.href) {
      rawReplaceState.call(history, history.state, document.title, event.data.cleaned);
    }
    pending = null;
    window.postMessage({
      source: SOURCE,
      type: 'cleaned',
      removed: Array.isArray(event.data.removed) ? event.data.removed : [],
      changed: event.data.cleaned !== event.data.url
    }, '*');
  });

  history.pushState = patchedPushState;
  history.replaceState = patchedReplaceState;
  window.addEventListener('popstate', requestClean, { passive: true });
  window.addEventListener('hashchange', requestClean, { passive: true });
  window.addEventListener('pageshow', requestClean, { passive: true });
  requestClean();
}());
