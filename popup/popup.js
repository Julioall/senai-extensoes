(() => {
  'use strict';

  const { getSettings, updateSettings } = SenaiExt;
  const status = document.getElementById('status');
  let settings;
  let statusTimer;

  function getPath(object, path) {
    return path.split('.').reduce((value, key) => value?.[key], object);
  }

  function patchForPath(path, value) {
    return path.split('.').reverse().reduce((result, key) => ({ [key]: result }), value);
  }

  function showStatus(message, error = false) {
    clearTimeout(statusTimer);
    status.textContent = message;
    status.classList.toggle('is-error', error);
    status.classList.add('is-visible');
    statusTimer = setTimeout(() => status.classList.remove('is-visible'), 2200);
  }

  function render() {
    document.querySelectorAll('[data-setting]').forEach(input => {
      input.checked = Boolean(getPath(settings, input.dataset.setting));
    });
  }

  async function save(path, value) {
    try {
      const patch = path === 'moodle.coursePendingChecks'
        ? { moodle: { coursePendingChecks: value, categoryPendingChecks: value } }
        : patchForPath(path, value);
      settings = await updateSettings(patch);
      render();
      showStatus('Configuração salva. Recarregue a página para aplicar.');
    } catch (error) {
      showStatus(`Não foi possível salvar: ${error?.message || error}`, true);
    }
  }

  async function initialize() {
    settings = await getSettings();
    render();
    document.querySelectorAll('[data-setting]').forEach(input => {
      input.addEventListener('change', () => save(input.dataset.setting, input.checked));
    });
    document.getElementById('close-button').addEventListener('click', () => window.close());
  }

  initialize().catch(error => showStatus(`Falha ao iniciar: ${error?.message || error}`, true));
})();
