(() => {
  'use strict';

  function enhance(modal) {
    if (!(modal instanceof Element)) return;
    const subtitle = modal.querySelector('.sx-importer-header p');
    if (subtitle) subtitle.textContent = 'Fluxo guiado para preencher a página atual';

    const stepper = modal.querySelector('.sx-importer-stepper');
    if (stepper) {
      const steps = [...stepper.children];
      const activeIndexes = steps.map((step, index) => step.classList.contains('is-active') ? index : -1).filter(index => index >= 0);
      const current = activeIndexes.length ? Math.max(...activeIndexes) : 0;
      steps.forEach((step, index) => {
        step.classList.toggle('is-complete', index < current);
        const circle = step.querySelector('span');
        if (circle && index < current) circle.textContent = '✓';
      });
    }

    const stage = modal.querySelector('.sx-importer-stage');
    const heading = stage?.querySelector(':scope > h3');
    if (heading?.textContent.trim() === 'Arquivo de correção') heading.textContent = 'Adicionar arquivo';
    if (heading?.textContent.trim() === 'Validação do arquivo') {
      heading.textContent = 'Arquivo selecionado';
      if (!stage.querySelector('.sx-importer-file-summary')) {
        const filename = modal.dataset.sxFilename || 'Arquivo de correção';
        const summary = document.createElement('div');
        summary.className = 'sx-importer-file-summary';
        summary.innerHTML = `<span>CSV</span><div><strong></strong><small>Arquivo válido</small></div>`;
        summary.querySelector('strong').textContent = filename;
        heading.insertAdjacentElement('afterend', summary);
      }
      const actions = modal.querySelector('.sx-importer-actions');
      if (actions && !actions.querySelector('.sx-importer-cancel-validation')) {
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'sx-button sx-button--secondary sx-importer-cancel-validation';
        cancel.textContent = 'Cancelar';
        cancel.addEventListener('click', () => modal.querySelector('.sx-importer-close')?.click());
        actions.prepend(cancel);
      }
    }
  }

  document.addEventListener('change', event => {
    const input = event.target.closest?.('.sx-importer-dropzone input[type="file"]');
    if (!input) return;
    const modal = input.closest('.sx-importer-modal');
    if (modal && input.files?.[0]) modal.dataset.sxFilename = input.files[0].name;
  }, true);

  const observer = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      mutation.addedNodes.forEach(node => {
        if (!(node instanceof Element)) return;
        if (node.matches('.sx-importer-modal')) enhance(node);
        node.querySelectorAll?.('.sx-importer-modal').forEach(enhance);
        const parent = node.closest?.('.sx-importer-modal');
        if (parent) enhance(parent);
      });
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
