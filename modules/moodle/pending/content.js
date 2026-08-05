(() => {
  'use strict';

  if (document.documentElement.dataset.sxPendingChecks === '1') return;
  document.documentElement.dataset.sxPendingChecks = '1';

  const { getSettings, visibleText, normalizeText, downloadBlob, sleep } = SenaiExt;
  const state = { settings: null, running: false, results: new Map(), futureCourses: 0 };

  function pageType() {
    if (location.pathname === '/course/view.php') return 'course';
    if (location.pathname === '/course/index.php') return 'category';
    return null;
  }

  function parsePtDate(value) {
    const match = String(value || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (!match) return null;
    const date = new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]), 0, 0, 0, 0);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function courseStartDate(text) {
    const source = String(text || '').replace(/\s+/g, ' ');
    const labelled = source.match(/(?:per[ií]odo|in[ií]cio|data de in[ií]cio)\s*:?\s*(\d{1,2}\/\d{1,2}\/\d{4})/i);
    if (labelled) return parsePtDate(labelled[1]);
    const period = source.match(/(\d{1,2}\/\d{1,2}\/\d{4})\s*(?:a|até|-)\s*\d{1,2}\/\d{1,2}\/\d{4}/i);
    return period ? parsePtDate(period[1]) : null;
  }

  function isFuture(date) {
    if (!date) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return date.getTime() > today.getTime();
  }

  function activityLinks(root = document) {
    const seen = new Set();
    return [...root.querySelectorAll('a[href*="/mod/assign/view.php?id="]')].map(link => {
      let url;
      try { url = new URL(link.href, location.origin); } catch { return null; }
      const id = url.searchParams.get('id');
      if (!id || seen.has(id)) return null;
      seen.add(id);
      return {
        id,
        url: `${location.origin}/mod/assign/view.php?id=${encodeURIComponent(id)}`,
        link: root === document ? link : null,
        name: visibleText(link) || `Atividade ${id}`
      };
    }).filter(Boolean);
  }

  function courseCards() {
    const selectors = [
      '.coursebox',
      '.course-summaryitem[data-course-id]',
      '[data-region="course-content"][data-course-id]'
    ];
    const seen = new Set();
    const cards = [];

    document.querySelectorAll(selectors.join(',')).forEach(card => {
      const link = card.querySelector('a.coursename[href*="/course/view.php?id="],a[href*="/course/view.php?id="]');
      if (!link) return;
      let url;
      try { url = new URL(link.href, location.origin); } catch { return; }
      const id = card.dataset.courseId || url.searchParams.get('id');
      if (!id || seen.has(id)) return;
      seen.add(id);
      const text = visibleText(card) || card.textContent || '';
      cards.push({
        id,
        link,
        card,
        name: visibleText(link) || `Curso ${id}`,
        startDate: courseStartDate(text)
      });
    });
    return cards;
  }

  async function waitForCourseCards(timeout = 12000) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      const cards = courseCards();
      if (cards.length) return cards;
      await sleep(200);
    }
    return courseCards();
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
      const values = [
        label.nextElementSibling,
        label.parentElement?.querySelector('dd'),
        label.parentElement?.nextElementSibling
      ].filter(Boolean).map(element => String(element.textContent || '').match(/\d+/)?.[0]).filter(Boolean);
      if (values.length) return Number(values[0]);
    }

    const fallback = String(doc.body?.textContent || '').match(/(?:Precisa de avaliação|Requer avaliação|Needs grading)\s*[:\-]?\s*(\d+)/i);
    return fallback ? Number(fallback[1]) : null;
  }

  function activityBadge(target, result) {
    if (!target) return;
    target.parentElement?.querySelector('.sx-pending-badge')?.remove();
    const badge = document.createElement('span');
    badge.className = 'sx-pending-badge sx-reset';
    if (result.pending === null) {
      badge.classList.add('is-neutral');
      badge.textContent = '—';
      badge.title = 'Esta atividade não apresenta o campo “Precisa de avaliação”.';
    } else if (result.pending > 0) {
      badge.classList.add('is-danger');
      badge.textContent = String(result.pending);
      badge.title = `${result.pending} envio(s) aguardando avaliação`;
    } else {
      badge.classList.add('is-success');
      badge.textContent = '✓';
      badge.title = 'Nenhum envio aguardando avaliação';
    }
    target.insertAdjacentElement('afterend', badge);
  }

  function courseBadge(course, data) {
    course.card.querySelector('.sx-pending-course-badge')?.remove();
    const badge = document.createElement('span');
    badge.className = 'sx-pending-course-badge sx-reset';

    if (data.future) {
      badge.classList.add('is-future');
      badge.textContent = 'Ainda não iniciado';
      badge.title = 'Este curso foi ignorado porque a data de início ainda não chegou.';
    } else if (data.pending > 0) {
      badge.classList.add('is-danger');
      badge.textContent = `${data.pending} pendente${data.pending === 1 ? '' : 's'}`;
      badge.title = `${data.pending} envio(s) aguardando avaliação em ${data.affected} atividade(s)`;
    } else if (data.partial) {
      badge.classList.add('is-neutral');
      badge.textContent = 'Consulta parcial';
      badge.title = 'Uma ou mais atividades não exibem o campo esperado.';
    } else {
      badge.classList.add('is-success');
      badge.textContent = '✓ Sem pendências';
      badge.title = 'Nenhum envio aguardando avaliação';
    }

    const titleHost = course.card.querySelector('.coursename') || course.link;
    titleHost.insertAdjacentElement('afterend', badge);
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

  async function mapLimit(items, limit, worker, onProgress) {
    const results = new Array(items.length);
    let cursor = 0;
    async function runner() {
      while (cursor < items.length) {
        const index = cursor++;
        onProgress?.(index, items.length);
        results[index] = await worker(items[index], index);
      }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runner));
    return results;
  }

  async function inspectCourse(course) {
    try {
      const doc = await fetchDoc(`${location.origin}/course/view.php?id=${encodeURIComponent(course.id)}`);
      const startDate = course.startDate || courseStartDate(doc.body?.textContent || '');
      if (isFuture(startDate)) return { ...course, future: true, activities: [] };
      const activities = activityLinks(doc);
      const results = await mapLimit(activities, 4, inspectActivity);
      return { ...course, future: false, activities: results };
    } catch (error) {
      return { ...course, future: false, activities: [], error: error.message };
    }
  }

  async function runCoursePage() {
    const activities = activityLinks();
    return mapLimit(activities, 4, async (activity, index) => {
      setSummary(`Consultando ${index + 1} de ${activities.length} atividades…`);
      const result = await inspectActivity(activity);
      state.results.set(result.id, result);
      if (state.settings.moodle.pendingBadges) activityBadge(result.link, result);
      return result;
    });
  }

  async function runCategoryPage() {
    const courses = await waitForCourseCards();
    state.futureCourses = 0;
    const inspected = await mapLimit(courses, 3, async (course, index) => {
      setSummary(`Consultando ${index + 1} de ${courses.length} cursos…`);
      if (isFuture(course.startDate)) return { ...course, future: true, activities: [] };
      return inspectCourse(course);
    });

    const activities = [];
    inspected.forEach(result => {
      if (result.future) {
        state.futureCourses += 1;
        if (state.settings.moodle.pendingBadges) courseBadge(result, { future: true });
        return;
      }
      const known = result.activities.filter(activity => activity.pending !== null);
      const pending = known.reduce((sum, activity) => sum + activity.pending, 0);
      const affected = known.filter(activity => activity.pending > 0).length;
      const partial = result.error || result.activities.some(activity => activity.pending === null);
      if (state.settings.moodle.pendingBadges) courseBadge(result, { pending, affected, partial });
      result.activities.forEach(activity => activities.push(activity));
    });
    return activities;
  }

  async function run() {
    if (state.running) return;
    state.running = true;
    state.results.clear();
    ensureToolbar();
    setStatus('Consultando o Moodle. Cursos que ainda não começaram serão ignorados.', 'info');
    const refresh = document.getElementById('sx-pending-refresh');
    if (refresh) refresh.disabled = true;

    try {
      const results = pageType() === 'course' ? await runCoursePage() : await runCategoryPage();
      results.forEach(result => state.results.set(result.id, result));
      const known = results.filter(result => result.pending !== null);
      const pending = known.reduce((sum, result) => sum + result.pending, 0);
      const affected = known.filter(result => result.pending > 0).length;
      const ignored = results.length - known.length;
      setSummary(`${pending} envio(s) em ${affected} atividade(s)`);

      const notes = [];
      if (state.futureCourses) notes.push(`${state.futureCourses} curso(s) ainda não iniciado(s) foram ignorados`);
      if (ignored) notes.push(`${ignored} atividade(s) sem o campo esperado foram ignoradas`);
      setStatus(notes.length ? `${notes.join('. ')}.` : 'Consulta concluída.', notes.length ? 'warning' : 'success');

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
