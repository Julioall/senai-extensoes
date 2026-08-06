(() => {
  'use strict';

  const { getSettings, updateSettings } = SenaiExt;
  const views = [...document.querySelectorAll('[data-view]')];
  const title = document.getElementById('view-title');
  const subtitle = document.getElementById('view-subtitle');
  const backButton = document.getElementById('back-button');
  const status = document.getElementById('status');
  let settings;

  const viewMeta = {
    home: ['SENAI Extensões', 'Ferramentas para Moodle, Drive e Kahoot'],
    moodle: ['Moodle', 'Correções, relatórios e pendências'],
    drivePdf: ['Baixar', 'Salvar documentos do Google Drive em PDF'],
    kahoot: ['Kahoot', 'Importação automatizada de questões']
  };

  function setStatus(message, isError = false) {
    status.textContent = message;
    status.classList.toggle('is-error', isError);
  }

  function showView(name) {
    views.forEach(view => { view.hidden = view.dataset.view !== name; });
    title.textContent = viewMeta[name][0];
    subtitle.textContent = viewMeta[name][1];
    backButton.hidden = name === 'home';
  }

  function getPath(object, path) {
    return path.split('.').reduce((value, key) => value?.[key], object);
  }

  function patchForPath(path, value) {
    return path.split('.').reverse().reduce((result, key) => ({ [key]: result }), value);
  }

  function renderSettings() {
    document.querySelectorAll('[data-module-switch]').forEach(toggle => {
      const enabled = Boolean(settings.modules[toggle.dataset.moduleSwitch]);
      toggle.classList.toggle('is-on', enabled);
      toggle.setAttribute('aria-checked', String(enabled));
    });
    document.querySelectorAll('[data-setting]').forEach(input => {
      const value = getPath(settings, input.dataset.setting);
      if (input.type === 'checkbox') input.checked = Boolean(value);
      else input.value = String(value);
    });
  }

  async function persist(path, value) {
    try {
      settings = await updateSettings(patchForPath(path, value));
      renderSettings();
      setStatus('Configurações salvas. Recarregue a página para aplicar.');
    } catch (error) {
      setStatus(`Não foi possível salvar: ${error?.message || error}`, true);
    }
  }

  function bindEvents() {
    document.querySelectorAll('[data-open-view]').forEach(button => {
      button.addEventListener('click', event => {
        if (event.target.closest('[data-module-switch]')) return;
        showView(button.dataset.openView);
      });
    });

    document.querySelectorAll('[data-module-switch]').forEach(toggle => {
      const change = event => {
        event.preventDefault();
        event.stopPropagation();
        persist(`modules.${toggle.dataset.moduleSwitch}`, !settings.modules[toggle.dataset.moduleSwitch]);
      };
      toggle.addEventListener('click', change);
      toggle.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') change(event);
      });
    });

    document.querySelectorAll('[data-setting]').forEach(input => {
      input.addEventListener('change', async () => {
        const value = input.type === 'checkbox' ? input.checked : Number(input.value) || input.value;
        if (input.dataset.setting === 'moodle.coursePendingChecks') {
          try {
            settings = await updateSettings({ moodle: { coursePendingChecks: value, categoryPendingChecks: value } });
            renderSettings();
            setStatus('Configurações salvas. Recarregue a página para aplicar.');
          } catch (error) {
            setStatus(`Não foi possível salvar: ${error?.message || error}`, true);
          }
          return;
        }
        persist(input.dataset.setting, value);
      });
    });

    backButton.addEventListener('click', () => showView('home'));
    document.getElementById('close-button').addEventListener('click', () => window.close());
    document.getElementById('manage-extension').addEventListener('click', () => chrome.runtime.sendMessage({ type: 'SENAI_EXT_OPEN_MANAGE' }));
  }

  function updateSiteInfo() {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      const description = document.getElementById('site-description');
      try {
        const url = new URL(tabs?.[0]?.url || '');
        const supported = ['ead.fieg.com.br', 'ead.senai.br', 'drive.google.com', 'create.kahoot.it'].includes(url.hostname);
        description.textContent = supported ? url.hostname : 'Nenhum recurso disponível nesta página';
      } catch {
        description.textContent = 'Não foi possível identificar a página atual';
      }
    });
  }

  async function initialize() {
    settings = await getSettings();
    renderSettings();
    bindEvents();
    updateSiteInfo();
    showView('home');
  }

  initialize().catch(error => setStatus(`Falha ao iniciar: ${error?.message || error}`, true));
})();
