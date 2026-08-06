(() => {
  'use strict';

  function update(root = document) {
    const button = root.querySelector?.('#sx-drive-open') || document.getElementById('sx-drive-open');
    if (button) {
      button.classList.add('sx-drive-open--green');
      button.innerHTML = '<span aria-hidden="true">↓</span> Baixar';
      button.setAttribute('aria-label', 'Baixar PDF');
    }

    const overlay = root.matches?.('#sx-drive-overlay') ? root : root.querySelector?.('#sx-drive-overlay');
    if (!overlay) return;
    const title = overlay.querySelector('#sx-drive-title');
    if (title) title.textContent = 'Baixar';
    const generate = overlay.querySelector('[data-generate]');
    if (generate) generate.textContent = 'Baixar';
    const margins = overlay.querySelector('[data-margins]');
    if (margins) {
      margins.checked = true;
      const label = margins.closest('label');
      if (label) label.hidden = true;
    }
    const background = overlay.querySelector('[data-background]');
    if (background) background.checked = true;
  }

  update();
  new MutationObserver(mutations => mutations.forEach(mutation => mutation.addedNodes.forEach(node => {
    if (node instanceof Element) update(node);
  }))).observe(document.documentElement, { childList: true, subtree: true });
})();