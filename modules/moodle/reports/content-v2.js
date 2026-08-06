(() => {
  'use strict';

  if (document.documentElement.dataset.sxGradeReportsV2 === '1') return;
  document.documentElement.dataset.sxGradeReportsV2 = '1';

  const { getSettings, visibleText, escapeHtml, downloadBlob } = SenaiExt;
  const state = { selected: new Map(), running: false, controller: null, observer: null, timer: null };
  const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
  const xml = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

  function supported() {
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

  function host() {
    const first = document.querySelector('.course-summaryitem[data-course-id]');
    return first?.parentElement || document.querySelector('[data-region="courses-view"]') || document.querySelector('main');
  }

  function ensureToolbar() {
    if (document.getElementById('sx-report-toolbar')) return;
    const target = host();
    if (!target) return;
    const toolbar = document.createElement('section');
    toolbar.id = 'sx-report-toolbar';
    toolbar.className = 'sx-report-toolbar sx-panel sx-reset';
    toolbar.innerHTML = `<div class="sx-report-head"><span class="sx-report-icon">▥</span><div><strong>Relatório de notas</strong><small id="sx-report-count">Nenhuma unidade selecionada</small></div><div class="sx-report-actions"><button type="button" class="sx-button sx-button--secondary" id="sx-report-select-all">Selecionar todas</button><button type="button" class="sx-button sx-button--danger" id="sx-report-cancel" hidden>Cancelar</button><button type="button" class="sx-button" id="sx-report-generate" disabled>Gerar relatório</button></div></div><div id="sx-report-status" class="sx-report-status" hidden role="status" aria-live="polite"></div>`;
    target.before(toolbar);
    toolbar.querySelector('#sx-report-select-all').addEventListener('click', toggleAll);
    toolbar.querySelector('#sx-report-generate').addEventListener('click', generate);
    toolbar.querySelector('#sx-report-cancel').addEventListener('click', cancel);
  }

  function updateToolbar() {
    const inputs = [...document.querySelectorAll('.sx-report-selector input')];
    const count = state.selected.size;
    const label = document.getElementById('sx-report-count');
    const generateButton = document.getElementById('sx-report-generate');
    const allButton = document.getElementById('sx-report-select-all');
    const cancelButton = document.getElementById('sx-report-cancel');
    if (label) label.textContent = count ? `${count} unidade${count === 1 ? '' : 's'} selecionada${count === 1 ? '' : 's'}` : 'Nenhuma unidade selecionada';
    if (generateButton) generateButton.disabled = state.running || count === 0;
    if (allButton) {
      allButton.disabled = state.running || inputs.length === 0;
      allButton.textContent = inputs.length && inputs.every(input => input.checked) ? 'Limpar seleção' : 'Selecionar todas';
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
    const select = inputs.some(input => !input.checked);
    inputs.forEach(input => {
      if (input.checked !== select) {
        input.checked = select;
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
    const response = await fetch(url, { credentials: 'include', cache: 'no-store', redirect: 'follow', signal });
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
    if (!text || text === '-' || text === '–') return null;
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

  function pageUrls(doc, courseId) {
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
      pageUrls(doc, course.id).forEach(next => { if (!visited.has(next) && !queue.includes(next)) queue.push(next); });
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

  function sheetName(value, used) {
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

  function columnName(index) {
    let value = index + 1;
    let result = '';
    while (value > 0) {
      value -= 1;
      result = String.fromCharCode(65 + (value % 26)) + result;
      value = Math.floor(value / 26);
    }
    return result;
  }

  function stringCell(ref, value, style = 0) {
    return `<c r="${ref}" t="inlineStr"${style ? ` s="${style}"` : ''}><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
  }

  function numberCell(ref, value) {
    return value === null || value === undefined ? `<c r="${ref}"/>` : `<c r="${ref}" s="2"><v>${value}</v></c>`;
  }

  function classRows(group) {
    const students = new Map();
    group.reports.forEach(report => report.students.forEach(student => {
      const key = student.userId || clean(student.name).toLowerCase();
      if (!students.has(key)) students.set(key, { name: student.name, grades: new Map() });
      const target = students.get(key);
      if (!target.name || student.name.length > target.name.length) target.name = student.name;
      target.grades.set(report.id, student.grade);
    }));
    return [...students.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  }

  function worksheetXml(group) {
    const students = classRows(group);
    const headers = ['Aluno', ...group.reports.map(report => report.name)];
    const rows = [];
    rows.push(`<row r="1">${headers.map((value, index) => stringCell(`${columnName(index)}1`, value, 1)).join('')}</row>`);
    students.forEach((student, rowIndex) => {
      const row = rowIndex + 2;
      const cells = [stringCell(`A${row}`, student.name)];
      group.reports.forEach((report, index) => cells.push(numberCell(`${columnName(index + 1)}${row}`, student.grades.has(report.id) ? student.grades.get(report.id) : null)));
      rows.push(`<row r="${row}">${cells.join('')}</row>`);
    });
    const lastColumn = columnName(headers.length - 1);
    const widths = headers.map((_, index) => `<col min="${index + 1}" max="${index + 1}" width="${index === 0 ? 40 : 22}" customWidth="1"/>`).join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths}</cols><sheetData>${rows.join('')}</sheetData><autoFilter ref="A1:${lastColumn}${students.length + 1}"/></worksheet>`;
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

  function summaryWorksheet(reports) {
    const headers = ['Turma', 'Origem', 'UC', 'Sem Nota', 'Reprovados', 'Recuperação', 'Aprovados', 'Total com Nota'];
    const rows = [`<row r="1">${headers.map((value, index) => stringCell(`${columnName(index)}1`, value, 1)).join('')}</row>`];
    reports.forEach((report, index) => {
      const row = index + 2;
      const summary = classify(report.students);
      const values = [report.category, report.reportUrl, report.name];
      const cells = values.map((value, cellIndex) => stringCell(`${columnName(cellIndex)}${row}`, value));
      [summary.noGrade, summary.failed, summary.recovery, summary.approved, summary.withGrade].forEach((value, cellIndex) => cells.push(numberCell(`${columnName(cellIndex + 3)}${row}`, value)));
      rows.push(`<row r="${row}">${cells.join('')}</row>`);
    });
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="1" width="40" customWidth="1"/><col min="2" max="2" width="38" customWidth="1"/><col min="3" max="3" width="30" customWidth="1"/><col min="4" max="8" width="14" customWidth="1"/></cols><sheetData>${rows.join('')}</sheetData><autoFilter ref="A1:H${reports.length + 1}"/></worksheet>`;
  }

  const encoder = new TextEncoder();
  const bytes = value => typeof value === 'string' ? encoder.encode(value) : value;

  function concat(parts) {
    const arrays = parts.map(bytes);
    const output = new Uint8Array(arrays.reduce((sum, part) => sum + part.length, 0));
    let offset = 0;
    arrays.forEach(part => { output.set(part, offset); offset += part.length; });
    return output;
  }

  function crc32(data) {
    let crc = 0xFFFFFFFF;
    for (const byte of data) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1));
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function u16(value) {
    const output = new Uint8Array(2);
    new DataView(output.buffer).setUint16(0, value, true);
    return output;
  }

  function u32(value) {
    const output = new Uint8Array(4);
    new DataView(output.buffer).setUint32(0, value >>> 0, true);
    return output;
  }

  function dosDateTime(date = new Date()) {
    const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
    const dosDate = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
    return { time, date: dosDate };
  }

  function zip(files) {
    const local = [];
    const central = [];
    let offset = 0;
    const stamp = dosDateTime();
    files.forEach(file => {
      const name = bytes(file.name);
      const data = bytes(file.content);
      const crc = crc32(data);
      const localHeader = concat([u32(0x04034B50),u16(20),u16(0),u16(0),u16(stamp.time),u16(stamp.date),u32(crc),u32(data.length),u32(data.length),u16(name.length),u16(0),name]);
      local.push(localHeader, data);
      const centralHeader = concat([u32(0x02014B50),u16(20),u16(20),u16(0),u16(0),u16(stamp.time),u16(stamp.date),u32(crc),u32(data.length),u32(data.length),u16(name.length),u16(0),u16(0),u16(0),u16(0),u32(0),u32(offset),name]);
      central.push(centralHeader);
      offset += localHeader.length + data.length;
    });
    const centralBytes = concat(central);
    const end = concat([u32(0x06054B50),u16(0),u16(0),u16(files.length),u16(files.length),u32(centralBytes.length),u32(offset),u16(0)]);
    return new Blob([...local, centralBytes, end], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  function workbookFiles(reports) {
    const groups = groupReports(reports);
    const used = new Set(['situação']);
    const sheets = groups.map(group => ({ name: sheetName(group.category, used), xml: worksheetXml(group) }));
    sheets.push({ name: 'Situação', xml: summaryWorksheet(reports) });

    const overrides = sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('');
    const workbookSheets = sheets.map((sheet, index) => `<sheet name="${xml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('');
    const relationships = sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('');
    const styleId = sheets.length + 1;

    const files = [
      { name: '[Content_Types].xml', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${overrides}</Types>` },
      { name: '_rels/.rels', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
      { name: 'xl/workbook.xml', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${workbookSheets}</sheets></workbook>` },
      { name: 'xl/_rels/workbook.xml.rels', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationships}<Relationship Id="rId${styleId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
      { name: 'xl/styles.xml', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1769E0"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment wrapText="1" vertical="center"/></xf><xf numFmtId="2" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="center"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>` }
    ];
    sheets.forEach((sheet, index) => files.push({ name: `xl/worksheets/sheet${index + 1}.xml`, content: sheet.xml }));
    return files;
  }

  function save(reports) {
    const groups = groupReports(reports);
    const label = groups.length === 1 ? groups[0].category : `${groups.length} turmas`;
    const safe = label.replace(/[\\/:*?"<>|]/g, '-').slice(0, 90);
    const date = new Intl.DateTimeFormat('pt-BR').format(new Date()).replace(/\//g, '-');
    downloadBlob(zip(workbookFiles(reports)), `Relatório de Notas ${date} - ${safe}.xlsx`);
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
      setStatus(errors.length ? `Relatório gerado com ${reports.length} unidade(s) em ${classes} turma(s). Falhas: ${errors.join(' | ')}` : `Relatório XLSX gerado com ${reports.length} unidade(s) em ${classes} turma(s).`, errors.length ? 'warning' : 'success');
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
    if (!supported()) return;
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