(() => {
  'use strict';

  if (document.documentElement.dataset.sxPendingChecksV2 === '1') return;
  document.documentElement.dataset.sxPendingChecksV2 = '1';

  const { getSettings, visibleText, normalizeText, downloadBlob, sleep } = SenaiExt;
  const state = {
    settings: null,
    running: false,
    activityResults: new Map(),
    courseResults: new Map(),
    timer: null
  };

  function pageType() {
    const url = new URL(location.href);
    if (/\/course\/view\.php$/.test(url.pathname)) return 'course';
    if (/\/course\/index\.php$/.test(url.pathname) && url.searchParams.has('categoryid')) return 'category';
    return null;
  }

  function assignmentId(href) {
    try {
      const url = new URL(href, location.href);
      if (!/\/mod\/assign\/view\.php$/.test(url.pathname)) return '';
      return url.searchParams.get('id') || '';
    } catch {
      return '';
    }
  }

  function assignmentName(card, link) {
    const instance = card.querySelector('.instancename');
    if (instance) {
      const clone = instance.cloneNode(true);
      clone.querySelectorAll('.accesshide,.visually-hidden,.sr-only').forEach(node => node.remove());
      const text = String(clone.textContent || '').replace(/\s+/g, ' ').trim();
      if (text) return text;
    }
    return visibleText(link) || `Atividade ${assignmentId(link.href)}`;
  }

  function collectAssignments(root = document, baseUrl = location.href) {
    const found = new Map();
    const cards = [...root.querySelectorAll('li.activity.assign.modtype_assign,li.activity.modtype_assign')];
    cards.forEach(card => {
      const link = card.querySelector('.activitytitle.modtype_assign a[href*="/mod/assign/view.php"],a[href*="/mod/assign/view.php"]');
      if (!link) return;
      const href = new URL(link.getAttribute('href') || link.href, baseUrl).href;
      const id = assignmentId(href) || card.dataset.id || '';
      if (!id || found.has(id)) return;
      const badgeHost = card.querySelector('.activity-grid,.activity-item') || card;
      found.set(id, {
        id,
        href,
        name: assignmentName(card, link),
        card,
        link: root === document ? link : null,
        badgeHost: root === document ? badgeHost : null
      });
    });

    if (!found.size) {
      [...root.querySelectorAll('a[href*="/mod/assign/view.php?id="]')].forEach(link => {
        const href = new URL(link.getAttribute('href') || link.href, baseUrl).href;
        const id = assignmentId(href);
        if (!id || found.has(id)) return;
        found.set(id, {
          id,
          href,
          name: visibleText(link) || `Atividade ${id}`,
          card: link.closest('li,article,section,div'),
          link: root === document ? link : null,
          badgeHost: root === document ? link.parentElement : null
        });
      });
    }
    return [...found.values()];
  }

  function parseDate(value) {
    const match = String(value || '').match(/\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})\b/);
    if (!match) return null;
    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = Number(match[3]);
    const timestamp = Date.UTC(year, month - 1, day);
    const date = new Date(timestamp);
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? timestamp : null;
  }

  function futureContainer(container) {
    const start = parseDate(container?.textContent || '');
    if (!Number.isFinite(start)) return false;
    const today = new Date();
    return start > Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  }

  function courseId(href) {
    try {
      const url = new URL(href, location.href);
      if (!/\/course\/view\.php$/.test(url.pathname)) return '';
      return url.searchParams.get('id') || '';
    } catch {
      return '';
    }
  }

  function collectCategoryCourses() {
    const main = document.querySelector('[role="main"],#region-main') || document;
    const found = new Map();
    let futureCount = 0;
    [...main.querySelectorAll('a[href*="/course/view.php"]')].forEach(link => {
      if (link.closest('nav,.breadcrumb,.navbar,.primary-navigation,.secondary-navigation,.pagination')) return;
      const id = courseId(link.href);
      if (!id || found.has(id)) return;
      const container = link.closest('.coursebox,.course-card,.dashboard-card,[data-courseid],[data-course-id],li.course,.card,.course-summaryitem,.course-listitem') || link.closest('li,article,section,div');
      if (!container) return;
      if (futureContainer(container)) {
        futureCount += 1;
        return;
      }
      const nameNode = container.querySelector('.coursename a[href*="/course/view.php"],.course-name a[href*="/course/view.php"],[data-region="course-name"] a[href*="/course/view.php"],h3 a[href*="/course/view.php"],h4 a[href*="/course/view.php"]') || link;
      const name = visibleText(nameNode) || `Curso ${id}`;
      const titleHost = nameNode.closest('.coursename,.course-name,[data-region="course-name"],h3,h4') || nameNode.parentElement || container;
      found.set(id, { id, href: link.href, name, container, titleHost });
    });
    return { courses: [...found.values()], futureCount };
  }

  async function fetchHtml(url, label = 'Página') {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(url, {
        credentials: 'include',
        cache: 'no-store',
        redirect: 'follow',
        signal: controller.signal,
        headers: { Accept: 'text/html,application/xhtml+xml' }
      });
      if (!response.ok) throw new Error(`${label}: HTTP ${response.status}`);
      const finalUrl = new URL(response.url, location.href);
      if (finalUrl.origin !== location.origin) throw new Error(`${label}: redirecionamento não autorizado`);
      const html = await response.text();
      if (/\/login\//.test(finalUrl.pathname) || (/name=["']username["']/i.test(html) && /name=["']password["']/i.test(html))) throw new Error('Sessão do Moodle expirada');
      return { html, doc: new DOMParser().parseFromString(html, 'text/html'), finalUrl: finalUrl.href };
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error(`${label}: tempo limite excedido`);
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  function pendingLabel(value) {
    const text = normalizeText(value);
    return text === 'precisa de avaliacao' || text === 'necessita avaliacao' || text === 'requer avaliacao' || text === 'needs grading' ||
      (text.includes('avaliacao') && (text.includes('precisa') || text.includes('necessita') || text.includes('requer'))) ||
      (text.includes('grading') && (text.includes('needs') || text.includes('requires')));
  }

  function parsePendingCount(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const rows = [...doc.querySelectorAll('tr,[role="row"]')];
    for (const row of rows) {
      const cells = [...row.querySelectorAll('th,td,[role="rowheader"],[role="cell"]')];
      const labelIndex = cells.findIndex(cell => pendingLabel(cell.textContent || ''));
      if (labelIndex < 0) continue;
      const value = cells[labelIndex + 1] || cells[cells.length - 1];
      const match = String(value?.textContent || '').match(/\d+/);
      return match ? Number(match[0]) : 0;
    }
    const fallback = String(doc.body?.textContent || '').match(/(?:Precisa de avaliação|Necessita avaliação|Requer avaliação|Needs grading)\s*[:\-]?\s*(\d+)/i);
    return fallback ? Number(fallback[1]) : null;
  }

  async function inspectAssignment(assignment) {
    try {
      const { html } = await fetchHtml(assignment.href, `Atividade ${assignment.name}`);
      return { ...assignment, pending: parsePendingCount(html), error: null };
    } catch (error) {
      return { ...assignment, pending: null, error: error.message };
    }
  }

  async function mapLimit(items, limit, worker, progress) {
    const results = new Array(items.length);
    let cursor = 0;
    async function runner() {
      while (cursor < items.length) {
        const index = cursor++;
        progress?.(index, items.length);
        results[index] = await worker(items[index], index);
      }
    }
    await Promise.all(Array.from({ length: Math.min(limit, Math.max(1, items.length)) }, runner));
    return results;
  }

  function activityBadge(assignment, result) {
    const host = assignment.badgeHost || assignment.link?.parentElement;
    if (!host) return;
    host.querySelector(`.sx-pending-badge[data-assignment-id="${CSS.escape(assignment.id)}"]`)?.remove();
    const badge = document.createElement('span');
    badge.dataset.assignmentId = assignment.id;
    badge.className = 'sx-pending-badge sx-reset';
    if (result.pending === null) {
      badge.classList.add('is-neutral');
      badge.textContent = '—';
      badge.title = result.error || 'Esta atividade não apresenta o campo “Precisa de avaliação”.';
    } else if (result.pending > 0) {
      badge.classList.add('is-danger');
      badge.textContent = result.pending > 99 ? '99+' : String(result.pending);
      badge.title = `${result.pending} envio(s) aguardando avaliação`;
    } else {
      badge.classList.add('is-success');
      badge.textContent = '✓';
      badge.title = 'Nenhum envio aguardando avaliação';
    }
    host.appendChild(badge);
  }

  function courseBadge(course, result) {
    course.titleHost.querySelector(`.sx-pending-course-badge[data-course-id="${CSS.escape(course.id)}"]`)?.remove();
    const badge = document.createElement('span');
    badge.dataset.courseId = course.id;
    badge.className = 'sx-pending-course-badge sx-reset';
    if (result.totalPending > 0) {
      badge.classList.add('is-danger');
      badge.textContent = `${result.totalPending} pendente${result.totalPending === 1 ? '' : 's'}`;
      badge.title = `${result.totalPending} envio(s) em ${result.activitiesPending} atividade(s)`;
    } else if (result.errors > 0) {
      badge.classList.add('is-neutral');
      badge.textContent = 'Consulta parcial';
      badge.title = `${result.errors} atividade(s) não puderam ser confirmadas.`;
    } else {
      badge.classList.add('is-success');
      badge.textContent = '✓ Sem pendências';
      badge.title = result.assignmentCount ? 'Nenhum envio aguardando avaliação' : 'Nenhuma atividade do tipo Tarefa foi encontrada';
    }
    course.titleHost.appendChild(badge);
  }

  function ensureToolbar() {
    if (document.getElementById('sx-pending-toolbar')) return;
    const main = document.querySelector('#region-main,main,[role="main"]');
    if (!main) return;
    const panel = document.createElement('section');
    panel.id = 'sx-pending-toolbar';
    panel.className = 'sx-pending-toolbar sx-panel sx-reset';
    panel.innerHTML = `<div class="sx-pending-head"><span class="sx-pending-icon">◷</span><div><strong>Pendências de correção</strong><small id="sx-pending-summary">Preparando consulta…</small></div><div class="sx-pending-actions"><button type="button" class="sx-button sx-button--secondary" id="sx-pending-refresh">Atualizar</button><button type="button" class="sx-button" id="sx-pending-download" hidden>Baixar pendentes</button></div></div><div id="sx-pending-status" class="sx-pending-status" hidden></div>`;
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

  async function runCourse() {
    const assignments = collectAssignments();
    const results = await mapLimit(assignments, 4, async (assignment, index) => {
      setSummary(`Consultando ${index + 1} de ${assignments.length} atividades…`);
      const result = await inspectAssignment(assignment);
      state.activityResults.set(result.id, result);
      if (state.settings.moodle.pendingBadges) activityBadge(assignment, result);
      return result;
    });
    return { results, futureCount: 0 };
  }

  async function inspectCourse(course) {
    try {
      const { doc, finalUrl } = await fetchHtml(course.href, `Curso ${course.name}`);
      const assignments = collectAssignments(doc, finalUrl);
      const results = await mapLimit(assignments, 3, inspectAssignment);
      const known = results.filter(item => item.pending !== null);
      return {
        ...course,
        assignments: results,
        totalPending: known.reduce((sum, item) => sum + item.pending, 0),
        activitiesPending: known.filter(item => item.pending > 0).length,
        assignmentCount: assignments.length,
        errors: results.filter(item => item.pending === null).length
      };
    } catch (error) {
      return { ...course, assignments: [], totalPending: 0, activitiesPending: 0, assignmentCount: 0, errors: 1, error: error.message };
    }
  }

  async function runCategory() {
    const { courses, futureCount } = collectCategoryCourses();
    const inspected = await mapLimit(courses, 2, async (course, index) => {
      setSummary(`Consultando ${index + 1} de ${courses.length} cursos…`);
      const result = await inspectCourse(course);
      state.courseResults.set(course.id, result);
      result.assignments.forEach(item => state.activityResults.set(item.id, item));
      if (state.settings.moodle.pendingBadges) courseBadge(course, result);
      return result;
    });
    return { results: inspected.flatMap(item => item.assignments), futureCount };
  }

  async function run() {
    if (state.running) return;
    state.running = true;
    state.activityResults.clear();
    state.courseResults.clear();
    ensureToolbar();
    setStatus('Consultando atividades. Cursos com data de início futura serão ignorados.', 'info');
    const refresh = document.getElementById('sx-pending-refresh');
    if (refresh) refresh.disabled = true;
    try {
      const { results, futureCount } = pageType() === 'course' ? await runCourse() : await runCategory();
      const known = results.filter(item => item.pending !== null);
      const total = known.reduce((sum, item) => sum + item.pending, 0);
      const affected = known.filter(item => item.pending > 0).length;
      const ignored = results.length - known.length;
      setSummary(`${total} envio(s) em ${affected} atividade(s)`);
      const notes = [];
      if (futureCount) notes.push(`${futureCount} curso(s) ainda não iniciado(s) foram ignorados`);
      if (ignored) notes.push(`${ignored} atividade(s) sem o campo esperado foram ignoradas`);
      setStatus(notes.length ? `${notes.join('. ')}.` : 'Consulta concluída.', notes.length ? 'warning' : 'success');
      const download = document.getElementById('sx-pending-download');
      if (download) download.hidden = !state.settings.moodle.pendingDownloads || total === 0;
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
      const { doc } = await fetchHtml(url, `Pendentes de ${activity.name}`);
      sesskey ||= doc.querySelector('input[name="sesskey"]')?.value || new URL(doc.querySelector('a[href*="sesskey="]')?.href || location.href).searchParams.get('sesskey');
      const ids = [...doc.querySelectorAll('input[type="checkbox"][name*="selecteduser"],input[type="checkbox"].usercheckbox')]
        .map(input => input.value).filter(value => /^\d+$/.test(value));
      ids.forEach(id => users.add(id));
      const hasNext = [...doc.querySelectorAll('a[href*="page="]')].some(anchor => new URL(anchor.href, location.origin).searchParams.get('page') === String(page + 1));
      if (!hasNext || !ids.length) break;
    }
    return { users: [...users], sesskey };
  }

  async function downloadActivity(activity) {
    const { users, sesskey } = await pendingUsers(activity);
    if (!users.length || !sesskey) throw new Error('Os alunos pendentes não foram identificados.');
    const body = new URLSearchParams({
      id: activity.id,
      action: 'grading',
      sesskey,
      operation: 'downloadselected',
      gradingbatchoperation: 'downloadselected',
      selectedusers: users.join(',')
    });
    const response = await fetch(`${location.origin}/mod/assign/view.php`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });
    if (!response.ok) throw new Error(`O Moodle respondeu com status ${response.status}.`);
    const type = response.headers.get('content-type') || '';
    if (!type.includes('zip') && !type.includes('octet-stream')) throw new Error('O Moodle não retornou um arquivo ZIP.');
    const safe = activity.name.replace(/[\\/:*?"<>|]/g, '-').slice(0, 90);
    downloadBlob(await response.blob(), `${safe} - ${users.length} pendentes.zip`);
  }

  async function downloadPending() {
    const activities = [...state.activityResults.values()].filter(item => item.pending > 0);
    const button = document.getElementById('sx-pending-download');
    if (!button || !activities.length) return;
    button.disabled = true;
    try {
      for (let index = 0; index < activities.length; index += 1) {
        setStatus(`Baixando ${index + 1} de ${activities.length}: ${activities[index].name}…`, 'info');
        await downloadActivity(activities[index]);
        await sleep(700);
      }
      setStatus('Downloads concluídos.', 'success');
    } catch (error) {
      setStatus(`O download foi interrompido: ${error.message}`, 'danger');
    } finally {
      button.disabled = false;
    }
  }

  function schedule() {
    clearTimeout(state.timer);
    state.timer = setTimeout(run, 300);
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
    new MutationObserver(mutations => {
      const relevant = mutations.some(mutation => [...mutation.addedNodes].some(node => node instanceof Element && (
        node.matches?.('li.activity.modtype_assign,.coursebox,.course-summaryitem,[data-course-id],a[href*="/course/view.php"]') ||
        node.querySelector?.('li.activity.modtype_assign,a[href*="/course/view.php"]')
      )));
      if (relevant) schedule();
    }).observe(document.documentElement, { childList: true, subtree: true });
  }

  initialize().catch(console.error);
})();