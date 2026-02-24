const DASHBOARD_HTML_STORAGE_KEY = 'sf_ai_dashboard_html';

function setEmptyState(isEmpty) {
  const emptyEl = document.getElementById('sb-empty');
  const frame = document.getElementById('sb-frame');
  if (!emptyEl || !frame) return;
  emptyEl.hidden = !isEmpty;
  frame.style.display = isEmpty ? 'none' : 'block';
}

function loadDashboardHtml() {
  chrome.storage.local.get([DASHBOARD_HTML_STORAGE_KEY], payload => {
    const html = payload?.[DASHBOARD_HTML_STORAGE_KEY];
    const frame = document.getElementById('sb-frame');
    if (!frame || !html) {
      setEmptyState(true);
      return;
    }

    const blob = new Blob([String(html)], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    frame.src = url;
    setEmptyState(false);

    frame.addEventListener('load', () => {
      setTimeout(() => URL.revokeObjectURL(url), 60 * 1000);
    }, { once: true });
  });
}

document.addEventListener('DOMContentLoaded', loadDashboardHtml);
