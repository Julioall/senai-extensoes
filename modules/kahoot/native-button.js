(() => {
  'use strict';

  const ADD_SELECTORS = [
    '[data-functional-selector="add-question-button"]',
    'button[aria-label*="Add" i]',
    'button[aria-label*="Adicionar" i]'
  ];

  function visible(element) {
    if (!element) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
  }

  function findAddButton() {
    for (const selector of ADD_SELECTORS) {
      const element = document.querySelector(selector);
      if (visible(element)) return element;
    }

    return [...document.querySelectorAll('button,[role="button"]')]
      .filter(visible)
      .find(element => /^\+?\s*(add|adicionar)\b/i.test(String(element.innerText || element.textContent || '').trim())) || null;
  }

  function syncButton() {
    const button = document.getElementById('sx-kahoot-open');
    if (!button || button.classList.contains('is-floating')) return;

    const addButton = findAddButton();
    if (!addButton) return;

    const nativeClasses = [...addButton.classList]
      .filter(className => !className.startsWith('sx-'));
    const nextClassName = [...nativeClasses, 'sx-kahoot-open'].join(' ');

    if (button.className !== nextClassName) button.className = nextClassName;
    button.style.width = addButton.getBoundingClientRect().width ? '100%' : '';
    button.setAttribute('data-sx-native-style', 'true');
  }

  let timer;
  function scheduleSync() {
    clearTimeout(timer);
    timer = setTimeout(syncButton, 80);
  }

  syncButton();
  new MutationObserver(scheduleSync).observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class']
  });
})();
