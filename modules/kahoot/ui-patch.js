(() => {
  'use strict';

  function updateLabels(root = document) {
    const button = root.querySelector?.('#sx-kahoot-open') || document.getElementById('sx-kahoot-open');
    if (button) button.innerHTML = '<span>K</span> Kahoot';

    const title = root.querySelector?.('#sx-kahoot-title') || document.getElementById('sx-kahoot-title');
    if (title) title.textContent = 'Kahoot';

    root.querySelectorAll?.('*').forEach(element => {
      if (element.children.length === 0 && /KahootOmático/i.test(element.textContent || '')) {
        element.textContent = element.textContent.replace(/KahootOmático/gi, 'Kahoot');
      }
    });
  }

  updateLabels();
  new MutationObserver(mutations => mutations.forEach(mutation => mutation.addedNodes.forEach(node => {
    if (node instanceof Element) updateLabels(node);
  }))).observe(document.documentElement, { childList: true, subtree: true });
})();