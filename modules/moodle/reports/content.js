(() => {
  'use strict';

  if (document.documentElement.dataset.sxGradeReports === '1') return;
  document.documentElement.dataset.sxGradeReports = '1';

  const { getSettings, visibleText, escapeHtml, escapeXml, downloadBlob } = SenaiExt;
  const state = {
    selected: new Map(),
    running: false,
    controller: null,
    observer: null,
    timer: null
  };

  const clean = value => String(value || '').replace(/\s+/g, ' ').trim();

  function isSupportedPage() {
    return (location.hostname === 'ead.fieg.com.br' && location.pathname === '/my/courses.php') ||
      (location.hostname === 'ead.senai.br' && ['/my/', '/my/index.php'].includes(location.pathname));
  }

  function courseData(card) {
    const id = card.dataset.courseId;
    const link = card.querySelector('a.coursename');
    return {
      id,
      name: visibleText(link) || clean(link?.getAttribute('title')) || `Unidade ${id}`,
      category: visibleText(card.querySelector('.categoryname')) || 'Turma sem identificação',
      courseUrl: link?.href || `${location.origin}/course/view.php?id=${id}`
    };
  }

  function installSelector(card) {
    if (card.querySelector('.sx-report-selector')) return;
    const course = courseData(card);
    if (!course.id) return;
    const label = document.createElement('label');
    label.className = 'sx-report-selector sx-reset';
    label.title = `Incluir ${course.name}`;
    label.innerHTML = `<input type="checkbox" aria-label="Selecionar ${escapeHtml(course.name)}"><span></span>`;
    const input = label.querySelector('input');
    input.checked = state.selected.has(course.id);
    input.addEventListener('change', () => {
      if (input.checked) state.selected.set(course.id, course);
      else state.selected.delete(course.id);
      card.classList.toggle('sx-report-selected', input.checked);
      updateToolbar();
    });
    card.classList.add('sx-report-course');
    card.prepend(label);
  }

  function findHost() {
    const first = document.querySelector('.course-summaryitem[data-course-id]');
    return first?.parentElement || document.querySelector('[data-region="courses-view"]') || document.querySelector('main');
  }

  function ensureToolbar() {
    if (document.getElementById('sx-report-toolbar')) return;
    const host = findHost();
    if (!host) return;
    const toolbar = document.createElement('section');
    toolbar.id = 'sx-report-toolbar';
    toolbar.className = 'sx-report-toolbar sx-panel sx-reset';
    toolbar.innerHTML = `
      <div class="sx-report-head">
        <span class="sx-report-icon">▥</span>
        <div><strong>Relatório de notas</strong><small id="sx-report-count">Nenhuma unidade selecionada</small></div>
        <div class="sx-report-actions">
          <button type="button" class="sx-button sx-button--secondary" id="sx-report-select-all">Selecionar todas</button>
          <button type="button" class="sx-button sx-button--danger" id="sx-report-cancel" hidden>Cancelar</button>
          <button type="button" class="sx-button" id="sx-report-generate" disabled>Gerar relatório</button>
        </div>
      </div>
      <div id="sx-report-status" class="sx-report-status" hidden role="status" aria-live="polite"></div>`;
    host.before(toolbar);
    toolbar.querySelector('#sx-report-select-all').addEventListener('click', toggleAll);
    toolbar.querySelector('#sx-report-generate').addEventListener('click', generate);
    toolbar.querySelector('#sx-report-cancel').addEventListener('click', cancel);
  }

  function updateToolbar() {
    const count = state.selected.size;
    const checkboxes = [...document.querySelectorAll('.sx-report-selector input')];
    const countLabel = document.getElementById('sx-report-count');
    const generateButton = document.getElementById('sx-report-generate');
    const selectAllButton = document.getElementById('sx-report-select-all');
    const cancelButton = document.getElementById('sx-report-cancel');
    if (countLabel) countLabel.textContent = count ? `${count} unidade${count === 1 ? '' : 's'} selecionada${count === 1 ? '' : 's'}` : 'Nenhuma unidade selecionada';
    if (generateButton) generateButton.disabled = state.running || !count;
    if (selectAllButton) {
      selectAllButton.disabled = state.running || !checkboxes.length;
      selectAllButton.textContent = checkboxes.length && checkboxes.every(input => input.checked) ? 'Limpar seleção' : 'Selecionar todas';
    }
    if (cancelButton) cancelButton.hidden = !state.running;
  }

  function setStatus(message, tone = 'info') {
    const element = document.getElementById('sx-report-status');
    if (!element) return;
    element.hidden = !message;
    element.className = `sx-report-status is-${tone}`;
    element.textContent = message;
  }

  function toggleAll() {
    const inputs = [...document.querySelectorAll('.sx-report-selector input')];
    const selected = inputs.some(input => !input.checked);
    inputs.forEach(input => {
      if (input.checked !== selected) {
        input.checked = selected;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
  }

  function cancel() {
    if (!state.running) return;
    state.controller?.abort();
    setStatus('Cancelando a criação do relatório…', 'warning');
  }

  async function fetchDocument(url, signal) {
    const response = await fetch(url, { credentials: 'same-origin', redirect: 'follow', signal });
    if (!response.ok) throw new Error(`O Moodle respondeu com status ${response.status}.`);
    const html = await response.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    if (doc.querySelector('form#login,form[action*="/login/index.php"]')) throw new Error('A sessão do Moodle expirou.');
    return doc;
  }

  function totalItemId(doc) {
    const headers = [...doc.querySelectorAll('th[data-itemid]')];
    const exact = headers.find(header => clean(header.querySelector('.gradeitemheader')?.textContent).toLowerCase() === 'total do curso');
    const fallback = headers.find(header => header.classList.contains('courseitem') || clean(header.textContent).toLowerCase().includes('total do curso'));
    return (exact || fallback)?.dataset.itemid || null;
  }

  function parseGrade(value) {
    const text = clean(value).replace(/\u00a0/g, '');
    if (!text || ['-', '–'].includes(text)) return null;
    const normalized = text.includes(',') ? text.replace(/\./g, '').replace(',', '.') : text;
    const number = Number(normalized.replace(/[^0-9.-]/g, ''));
    return Number.isFinite(number) ? number : null;
  }

  function extractStudents(doc, itemId) {
    return [...doc.querySelectorAll('tr.userrow[data-uid],tr.userrow')].map(row => {
      const link = row.querySelector('a.username,a[href*="/user/view.php"]');
      const name = visibleText(link) || visibleText(row.querySelector('th.user'));
      const userId = row.dataset.uid || row.id?.match(/(\d+)/)?.[1] || name;
      const cell = row.querySelector(`td[data-itemid="${CSS.escape(itemId)}"]`);
      const grade = parseGrade(cell?.querySelector('.gradevalue')?.textContent || cell?.textContent);
      return { userId, name, grade };
    }).filter(student => student.name);
  }

  function paginationUrls(doc, courseId) {
    return [...doc.querySelectorAll('a[href]')].map(anchor => {
      try { return new URL(anchor.href, location.origin); } catch { return null; }
    }).filter(url => url && url.origin === location.origin && url.pathname === '/grade/report/grader/index.php' && url.searchParams.get('id') === String(courseId) && url.searchParams.has('page')).map(url => url.href);
  }

  async function loadCourse(course, index, total, signal) {
    const startUrl = `${location.origin}/grade/report/grader/index.php?id=${encodeURIComponent(course.id)}`;
    const queue = [startUrl];
    const visited = new Set();
    const students = new Map();
    let itemId = null;
    while (queue.length && visited.size < 100) {
      if (signal.aborted) throw new DOMException('Operação cancelada', 'AbortError');
      const url = queue.shift();
      if (visited.has(url)) continue;
      visited.add(url);
      setStatus(`${index + 1}/${total} — Lendo ${course.name}, página ${visited.size}…`);
      const doc = await fetchDocument(url, signal);
      itemId ||= totalItemId(doc);
      if (!itemId) throw new Error('A coluna “Total do curso” não foi localizada.');
      extractStudents(doc, itemId).forEach(student => students.set(student.userId, student));
      paginationUrls(doc, course.id).forEach(next => {
        if (!visited.has(next) && !queue.includes(next)) queue.push(next);
      });
    }
    if (!students.size) throw new Error('Nenhum aluno foi localizado.');
    return { ...course, reportUrl: startUrl, students: [...students.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')) };
  }

  function groupReports(reports) {
    const groups = new Map();
    reports.forEach(report => {
      const key = clean(report.category).toLowerCase() || `curso-${report.id}`;
      if (!groups.has(key)) groups.set(key, { category: report.category || report.name, reports: [] });
      groups.get(key).reports.push(report);
    });
    return [...groups.values()];
  }

  function safeSheetName(value, used) {
    const base = clean(value).replace(/[\\/?*\[\]:]/g, ' ').slice(0, 31) || 'Turma';
    let name = base;
    let suffix = 2;
    while (used.has(name.toLowerCase())) {
      const extra = ` (${suffix++})`;
      name = `${base.slice(0, 31 - extra.length)}${extra}`;
    }
    used.add(name.toLowerCase());
    return name;
  }

  const textCell = (value, style = '') => `<Cell${style ? ` ss:StyleID="${style}"` : ''}><Data ss:Type="String">${escapeXml(value)}</Data></Cell>`;
  const numberCell = value => value === null || value === undefined ? '<Cell><Data ss:Type="String"></Data></Cell>' : `<Cell ss:StyleID="Grade"><Data ss:Type="Number">${value}</Data></Cell>`;

  function classWorksheet(group, used) {
    const students = new Map();
    group.reports.forEach(report => report.students.forEach(student => {
      const key = student.userId || clean(student.name).toLowerCase();
      if (!students.has(key)) students.set(key, { name: student.name, grades: new Map() });
      students.get(key).grades.set(report.id, student.grade);
    }));
    const sorted = [...students.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    const name = safeSheetName(group.category, used);
    const columns = `<Column ss:Width="290"/>${group.reports.map(() => '<Column ss:Width="150"/>').join('')}`;
    const header = `<Row>${textCell('Aluno', 'Header')}${group.reports.map(report => textCell(report.name, 'Header')).join('')}</Row>`;
    const rows = sorted.map(student => `<Row>${textCell(student.name)}${group.reports.map(report => numberCell(student.grades.get(report.id))).join('')}</Row>`).join('');
    return `<Worksheet ss:Name="${escapeXml(name)}"><Table>${columns}${header}${rows}</Table><WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><FreezePanes/><FrozenNoSplit/><SplitHorizontal>1</SplitHorizontal><TopRowBottomPane>1</TopRowBottomPane><AutoFilter x:Range="R1C1:R${sorted.length + 1}C${group.reports.length + 1}" xmlns:x="urn:schemas-microsoft-com:office:excel"/></WorksheetOptions></Worksheet>`;
  }

  function classify(students) {
    return students.reduce((summary, student) => {
      if (student.grade === null) summary.noGrade += 1;
      else if (student.grade < 50) summary.failed += 1;
      else if (student.grade < 70) summary.recovery += 1;
      else summary.approved += 1;
      if (student.grade !== null) summary.withGrade += 1;
      return summary;
    }, { noGrade: 0, failed: 0, recovery: 0, approved: 0, withGrade: 0 });
  }

  function workbook(reports) {
    const used = new Set(['situação']);
    const sheets = groupReports(reports).map(group => classWorksheet(group, used)).join('');
    const summaryRows = reports.map(report => {
      const summary = classify(report.students);
      return `<Row>${textCell(report.category)}${textCell(report.reportUrl)}${textCell(report.name)}${numberCell(summary.noGrade)}${numberCell(summary.failed)}${numberCell(summary.recovery)}${numberCell(summary.approved)}${numberCell(summary.withGrade)}</Row>`;
    }).join('');
    const summary = `<Worksheet ss:Name="Situação"><Table><Column ss:Width="290"/><Column ss:Width="250"/><Column ss:Width="220"/><Column ss:Width="80"/><Column ss:Width="85"/><Column ss:Width="90"/><Column ss:Width="85"/><Column ss:Width="100"/><Row>${['Turma','Origem','UC','Sem Nota','Reprovados','Recuperação','Aprovados','Total com Nota'].map(value => textCell(value, 'Header')).join('')}</Row>${summaryRows}</Table></Worksheet>`;
    return `<?xml version="1.0" encoding="UTF-8"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Styles><Style ss:ID="Default" ss:Name="Normal"><Alignment ss:Vertical="Center"/><Font ss:FontName="Calibri" ss:Size="11"/></Style><Style ss:ID="Header"><Alignment ss:Vertical="Center" ss:WrapText="1"/><Font ss:FontName="Calibri" ss:Size="11" ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#1769E0" ss:Pattern="Solid"/></Style><Style ss:ID="Grade"><Alignment ss:Horizontal="Center"/><NumberFormat ss:Format="0.00"/></Style></Styles>${sheets}${summary}</Workbook>`;
  }

  function save(reports) {
    const groups = groupReports(reports);
    const label = groups.length === 1 ? groups[0].category : `${groups.length} turmas`;
    const safe = label.replace(/[\\/:*?"<>|]/g, '-').slice(0, 90);
    const date = new Intl.DateTimeFormat('pt-BR').format(new Date()).replace(/\//g, '-');
    downloadBlob(new Blob(['\uFEFF', workbook(reports)], { type: 'application/vnd.ms-excel;charset=utf-8' }), `Relatório de Notas ${date} - ${safe}.xls`);
  }

  async function generate() {
    if (state.running || !state.selected.size) return;
    state.running = true;
    state.controller = new AbortController();
    updateToolbar();
    setStatus('Preparando o relatório…');
    const reports = [];
    const errors = [];
    const courses = [...state.selected.values()];
    try {
      for (let index = 0; index < courses.length; index += 1) {
        try {
          reports.push(await loadCourse(courses[index], index, courses.length, state.controller.signal));
        } catch (error) {
          if (error.name === 'AbortError') throw error;
          errors.push(`${courses[index].name}: ${error.message}`);
        }
      }
      if (state.controller.signal.aborted) throw new DOMException('Operação cancelada', 'AbortError');
      if (!reports.length) throw new Error(errors.join(' | ') || 'Nenhuma unidade pôde ser lida.');
      save(reports);
      const classes = groupReports(reports).length;
      setStatus(errors.length ? `Relatório gerado com ${reports.length} unidade(s) em ${classes} turma(s). Falhas: ${errors.join(' | ')}` : `Relatório gerado com ${reports.length} unidade(s) em ${classes} turma(s).`, errors.length ? 'warning' : 'success');
    } catch (error) {
      if (error.name === 'AbortError') setStatus('Criação do relatório cancelada. Nenhum arquivo foi gerado.', 'warning');
      else setStatus(`Não foi possível gerar o relatório: ${error.message}`, 'danger');
    } finally {
      state.running = false;
      state.controller = null;
      updateToolbar();
    }
  }

  function scan() {
    document.querySelectorAll('.course-summaryitem[data-course-id]').forEach(installSelector);
    ensureToolbar();
    updateToolbar();
  }

  async function initialize() {
    if (!isSupportedPage()) return;
    const settings = await getSettings();
    if (!settings.modules.moodle || !settings.moodle.gradeReports) return;
    scan();
    state.observer = new MutationObserver(() => {
      clearTimeout(state.timer);
      state.timer = setTimeout(scan, 120);
    });
    state.observer.observe(document.body, { childList: true, subtree: true });
  }

  initialize().catch(console.error);
})();
