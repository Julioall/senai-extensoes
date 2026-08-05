(() => {
  'use strict';

  if (document.documentElement.dataset.sxPendingChecks === '1') return;
  document.documentElement.dataset.sxPendingChecks = '1';

  const { getSettings, visibleText, normalizeText, downloadBlob, sleep } = SenaiExt;
  const state = { settings: null, running: false, results: new Map() };

  function pageType() {
    if (location.pathname === '/course/view.php') return 'course';
    if (location.pathname === '/course/index.php') return 'category';
    return null;
  }

  function activityLinks(root = document) {
    const seen = new Set();
    return [...root.querySelectorAll('a[href*="/mod/assign/view.php?id="]')].map(link => {
      const url = new URL(link.href, location.origin);
      const id = url.searchParams.get('id');
      if (!id || seen.has(id)) return null;
      seen.add(id);
      return {
        id,
        url: `${location.origin}/mod/assign/view.php?id=${encodeURIComponent(id)}`,
        link,
        name: visibleText(link) || `Atividade ${id}`
      };
    }).filter(Boolean);
  }

  function courseCards() {
    return [...document.querySelectorAll('[data-course-id],.coursebox')].map(card => {
      const link = card.querySelector('a[href*="/course/view.php?id="]');
      if (!link) return null;
      const url = new URL(link.href, location.origin);
      return { id: url.searchParams.get('id'), link, card, name: visibleText(link) };
    }).filter(item => item?.id);
  }

  async function fetchDoc(url) {
    const response = await fetch(url, { credentials: 'same-origin', redirect: 'follow' });
    if (!response.ok) throw new Error(`Status ${response.status}`);
    const html = await response.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    if (doc.querySelector('form#login,form[action*="/login/index.php"]')) throw new Error('Sessão expirada');
    return doc;
  }

  function parsePending(doc) {
    const candidates = [...doc.querySelectorAll('dt,th,td,div,span')].filter(element => {
      const text = normalizeText(element.textContent);
      return text === 'precisa de avaliacao' || text === 'requer avaliacao' || text === 'needs grading';
    });

    for (const label of candidates) {
      const values = [label.nextElementSibling, label.parentElement?.querySelector('dd'), label.parentElement?.nextElementSibling]
        .filter(Boolean)
        .map(element => String(element.textContent || '').match(/\d+/)?.[0])
        .filter(Boolean);
      if (values.length) return Number(values[0]);
    }

    const summaryText = String(doc.body?.textContent || '');
    const fallback = summaryText.match(/(?:Precisa de avaliação|Requer avaliação|Needs grading)\s*[:\-]?\s*(\d+)/i);
    if (fallback) return Number(fallback[1]);
    return null;
  }

  function badge(target, result) {
    target.parentElement?.querySelector('.sx-pending-badge')?.remove();
    const item = document.createElement('span');
    item.className = 'sx-pending-badge sx-reset';
    if (result.pending === null) {
      item.classList.add('is-neutral');
      item.textContent = '—';
      item.title = 'Esta atividade não apresenta o campo “Precisa de avaliação”.';
    } else if (result.pending > 0) {
      item.classList.add('is-danger');
      item.textContent = String(result.pending);
      item.title = `${result.pending} envio(s) aguardando avaliação`;
    } else {
      item.classList.add('is-success');
      item.textContent = '✓';
      item.title = 'Nenhum envio aguardando avaliação';
    }
    target.insertAdjacentElement('afterend', item);
  }

  function ensureToolbar() {
    if (document.getElementById('sx-pending-toolbar')) return;
    const main = document.querySelector('#region-main,main,[role="main"]');
    if (!main) return;
    const panel = document.createElement('section');
    panel.id = 'sx-pending-toolbar';
    panel.className = 'sx-pending-toolbar sx-panel sx-reset';
    panel.innerHTML = `
      <div class="sx-pending-head">
        <span class="sx-pending-icon">◷</span>
        <div><strong>Pendências de correção</strong><small id="sx-pending-summary">Preparando consulta…</small></div>
        <div class="sx-pending-actions">
          <button type="button" class="sx-button sx-button--secondary" id="sx-pending-refresh">Atualizar</button>
          <button type="button" class="sx-button" id="sx-pending-download" hidden>Baixar pendentes</button>
        </div>
      </div>
      <div id="sx-pending-status" class="sx-pending-status" hidden></div>`;
    main.prepend(panel);
    panel.querySelector('#sx-pending-refresh').addEventListener('click', run);
    panel.querySelector('#sx-pending-download').addEventListener('click', downloadPending);
  }

  function setSummary(text) {
    const element = document.getElementById('sx-pending-summary');
    if (element) element.textContent = text;
  }

  function setStatus(text, tone = 'info') {
    const element = document.getElementById('sx-pending-status');
    if (!element) return;
    element.hidden = !text;
    element.className = `sx-pending-status is-${tone}`;
    element.textContent = text;
  }

  async function inspectActivity(activity) {
    try {
      const doc = await fetchDoc(activity.url);
      return { ...activity, pending: parsePending(doc), error: null };
    } catch (error) {
      return { ...activity, pending: null, error: error.message };
    }
  }

  async function inspectCourse(course) {
    try {
      const doc = await fetchDoc(`${location.origin}/course/view.php?id=${encodeURIComponent(course.id)}`);
      const activities = activityLinks(doc);
      const results = [];
      for (const activity of activities) results.push(await inspectActivity(activity));
      return { ...course, activities: results };
    } catch (error) {
      return { ...course, activities: [], error: error.message };
    }
  }

  async function runCoursePage() {
    const activities = activityLinks();
    const results = [];
    for (let index = 0; index < activities.length; index += 1) {
      setSummary(`Consultando ${index + 1} de ${activities.length} atividades…`);
      const result = await inspectActivity(activities[index]);
      results.push(result);
      state.results.set(result.id, result);
      if (state.settings.moodle.pendingBadges) badge(result.link, result);
    }
    return results;
  }

  async function runCategoryPage() {
    const courses = courseCards();
    const results = [];
    for (let index = 0; index < courses.length; index += 1) {
      setSummary(`Consultando ${index + 1} de ${courses.length} cursos…`);
      const result = await inspectCourse(courses[index]);
      const pending = result.activities.reduce((sum, activity) => sum + (activity.pending || 0), 0);
      const partial = result.activities.some(activity => activity.pending === null);
      results.push(...result.activities);
      if (state.settings.moodle.pendingBadges) badge(result.link, { pending: pending || (partial ? null : 0) });
    }
    results.forEach(result => state.results.set(result.id, result));
    return results;
  }

  async function run() {
    if (state.running) return;
    state.running = true;
    state.results.clear();
    ensureToolbar();
    setStatus('Consultando o Moodle. Atividades sem o campo “Precisa de avaliação” serão ignoradas.', 'info');
    const refresh = document.getElementById('sx-pending-refresh');
    if (refresh) refresh.disabled = true;
    try {
      const results = pageType() === 'course' ? await runCoursePage() : await runCategoryPage();
      const known = results.filter(result => result.pending !== null);
      const pending = known.reduce((sum, result) => sum + result.pending, 0);
      const affected = known.filter(result => result.pending > 0).length;
      const ignored = results.length - known.length;
      setSummary(`${pending} envio(s) em ${affected} atividade(s)`);
      setStatus(ignored ? `${ignored} atividade(s) não exibem o campo esperado e foram ignoradas sem erro.` : 'Consulta concluída.', ignored ? 'warning' : 'success');
      const download = document.getElementById('sx-pending-download');
      if (download) download.hidden = !state.settings.moodle.pendingDownloads || !pending;
    } catch (error) {
      setStatus(`Não foi possível concluir a consulta: ${error.message}`, 'danger');
    } finally {
      state.running = false;
      if (refresh) refresh.disabled = false;
    }
  }

  async function pendingUsers(activity) {
    const users = new Set();
    let sesskey = null;
    for (let page = 0; page < 60; page += 1) {
      const url = `${location.origin}/mod/assign/view.php?id=${encodeURIComponent(activity.id)}&action=grading&status=requiregrading&perpage=100&page=${page}`;
      const doc = await fetchDoc(url);
      sesskey ||= doc.querySelector('input[name="sesskey"]')?.value || new URL(doc.querySelector('a[href*="sesskey="]')?.href || location.href).searchParams.get('sesskey');
      const checkboxes = [...doc.querySelectorAll('input[type="checkbox"][name*="selecteduser"],input[type="checkbox"].usercheckbox')]
        .map(input => input.value).filter(value => /^\d+$/.test(value));
      checkboxes.forEach(value => users.add(value));
      const next = [...doc.querySelectorAll('a[href*="page="]')].some(anchor => new URL(anchor.href, location.origin).searchParams.get('page') === String(page + 1));
      if (!next || !checkboxes.length) break;
    }
    return { users: [...users], sesskey };
  }

  async function downloadActivity(activity) {
    const { users, sesskey } = await pendingUsers(activity);
    if (!users.length || !sesskey) throw new Error('Os alunos pendentes não foram identificados.');
    const data = new URLSearchParams({
      id: activity.id,
      action: 'grading',
      sesskey,
      operation: 'downloadselected',
      gradingbatchoperation: 'downloadselected',
      selectedusers: users.join(',')
    });
    const response = await fetch(`${location.origin}/mod/assign/view.php`, {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: data
    });
    if (!response.ok) throw new Error(`O Moodle respondeu com status ${response.status}.`);
    const type = response.headers.get('content-type') || '';
    if (!type.includes('zip') && !type.includes('octet-stream')) throw new Error('O Moodle não retornou um arquivo ZIP.');
    const safe = activity.name.replace(/[\\/:*?"<>|]/g, '-').slice(0, 90);
    downloadBlob(await response.blob(), `${safe} - ${users.length} pendentes.zip`);
  }

  async function downloadPending() {
    const activities = [...state.results.values()].filter(result => result.pending > 0);
    const button = document.getElementById('sx-pending-download');
    button.disabled = true;
    try {
      for (let index = 0; index < activities.length; index += 1) {
        setStatus(`Baixando ${index + 1} de ${activities.length}: ${activities[index].name}…`, 'info');
        await downloadActivity(activities[index]);
        await sleep(800);
      }
      setStatus('Downloads concluídos.', 'success');
    } catch (error) {
      setStatus(`O download foi interrompido: ${error.message}`, 'danger');
    } finally {
      button.disabled = false;
    }
  }

  async function initialize() {
    const type = pageType();
    if (!type) return;
    state.settings = await getSettings();
    if (!state.settings.modules.moodle) return;
    if (type === 'course' && !state.settings.moodle.coursePendingChecks) return;
    if (type === 'category' && !state.settings.moodle.categoryPendingChecks) return;
    ensureToolbar();
    run();
  }

  initialize().catch(console.error);
})();
