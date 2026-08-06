(() => {
  'use strict';

  const ADD_SELECTORS = [
    '[data-functional-selector="add-question-button"]',
    'button[aria-label*="Add" i]',
    'button[aria-label*="Adicionar" i]'
  ];

  const COPIED_PROPERTIES = [
    'display',
    'align-items',
    'justify-content',
    'gap',
    'min-height',
    'height',
    'padding-top',
    'padding-right',
    'padding-bottom',
    'padding-left',
    'border-top-width',
    'border-right-width',
    'border-bottom-width',
    'border-left-width',
    'border-top-style',
    'border-right-style',
    'border-bottom-style',
    'border-left-style',
    'border-top-color',
    'border-right-color',
    'border-bottom-color',
    'border-left-color',
    'border-radius',
    'background-color',
    'color',
    'box-shadow',
    'font-family',
    'font-size',
    'font-weight',
    'line-height',
    'letter-spacing',
    'text-transform',
    'cursor'
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

  function copyComputedStyle(source, target) {
    const computed = getComputedStyle(source);
    COPIED_PROPERTIES.forEach(property => {
      target.style.setProperty(property, computed.getPropertyValue(property), 'important');
    });
    target.style.setProperty('width', '100%', 'important');
    target.style.setProperty('margin-top', computed.marginBottom || '8px', 'important');
    target.style.setProperty('margin-right', '0', 'important');
    target.style.setProperty('margin-bottom', '0', 'important');
    target.style.setProperty('margin-left', '0', 'important');
  }

  function installHoverBehavior(button) {
    if (button.dataset.sxHoverBound === 'true') return;
    button.dataset.sxHoverBound = 'true';
    button.addEventListener('pointerenter', () => {
      button.style.setProperty('filter', 'brightness(.92)', 'important');
    });
    button.addEventListener('pointerleave', () => {
      button.style.removeProperty('filter');
    });
    button.addEventListener('focus', () => {
      button.style.setProperty('outline', '2px solid rgba(19, 104, 206, .28)', 'important');
      button.style.setProperty('outline-offset', '2px', 'important');
    });
    button.addEventListener('blur', () => {
      button.style.removeProperty('outline');
      button.style.removeProperty('outline-offset');
    });
  }

  function syncButton() {
    const button = document.getElementById('sx-kahoot-open');
    if (!button || button.classList.contains('is-floating')) return;

    const addButton = findAddButton();
    if (!addButton || addButton === button) return;

    const computed = getComputedStyle(addButton);
    const signature = [
      addButton.className,
      computed.backgroundColor,
      computed.borderRadius,
      computed.height,
      computed.fontFamily,
      computed.fontSize
    ].join('|');

    if (button.dataset.sxNativeSignature !== signature) {
      const nativeClasses = [...addButton.classList]
        .filter(className => !className.startsWith('sx-'));
      button.className = [...nativeClasses, 'sx-kahoot-open'].join(' ');
      copyComputedStyle(addButton, button);
      button.dataset.sxNativeSignature = signature;
      button.setAttribute('data-sx-native-style', 'true');
      installHoverBehavior(button);
    }
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
