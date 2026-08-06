(() => {
  'use strict';

  if (document.documentElement.dataset.sxMoodleImporterV2 === '1') return;
  document.documentElement.dataset.sxMoodleImporterV2 = '1';

  const { getSettings, normalizeText, parseDelimited, similarity, setNativeValue, escapeHtml } = SenaiExt;

  const HEADER_ALIASES = {
    nome: ['nome', 'aluno', 'estudante', 'discente', 'nome do aluno', 'nome completo', 'nome do estudante'],
    nota: ['nota', 'grade', 'pontuacao', 'pontuação', 'score', 'nota final', 'nota sugerida'],
    feedback: ['feedback', 'comentario', 'comentário', 'comentarios', 'comentários', 'devolutiva', 'retorno', 'observacao', 'observação'],
    situacao: ['situacao', 'situação', 'status', 'tag', 'classificacao', 'classificação']
  };

  const state = {
    settings: null,
    modal: null,
    file: null,
    records: [],
    matches: [],
    step: 1,
    mode: 'file'
  };

  function gradingPage() {
    const url = new URL(location.href);
    return /\/mod\/assign\/view\.php$/.test(url.pathname) && url.searchParams.get('action') === 'grading';
  }

  function gradeInputs(root = document) {
    return [...root.querySelectorAll(
      'input.quickgrade[id^="quickgrade_"],input.quickgrade[name^="quickgrade_"],input[id^="quickgrade_"],input[name^="quickgrade_"]'
    )].filter(input => !/comments/i.test(`${input.id} ${input.name}`));
  }

  function feedbackInputs(root = document) {
    return [...root.querySelectorAll(
      'textarea.quickgrade[id^="quickgrade_comments_"],textarea.quickgrade[name^="quickgrade_comments_"],textarea[id^="quickgrade_comments_"],textarea[name^="quickgrade_comments_"]'
    )];
  }

  function quickGradingCheckbox() {
    const direct = document.querySelector(
      'input[type="checkbox"][id^="quickgrading"],input[type="checkbox"][name="quickgrading"],input[type="checkbox"][id*="quickgrading"]'
    );
    if (direct) return direct;
    const label = [...document.querySelectorAll('label')]
      .find(item => normalizeText(item.textContent) === 'avaliacao rapida');
    return label?.htmlFor ? document.getElementById(label.htmlFor) : null;
  }

  function readiness() {
    const table = document.querySelector('table#submissions,table[data-region="grading-table"]');
    const root = table || document;
    const checkbox = quickGradingCheckbox();
    const grades = gradeInputs(root);
    const feedbacks = feedbackInputs(root);
    return {
      table,
      checkbox,
      quickEnabled: !checkbox || checkbox.checked,
      fields: grades.length + feedbacks.length,
      ready: Boolean(table) && (!checkbox || checkbox.checked) && Boolean(grades.length || feedbacks.length)
    };
  }

  function findRows() {
    const table = document.querySelector('table#submissions,table[data-region="grading-table"]');
    if (!table) return [];
    return [...table.querySelectorAll('tbody tr,tr[data-region="student-row"]')].map(row => {
      const nameElement = row.querySelector(
        'a.username,a[href*="/user/view.php"],a[href*="/user/profile.php"],td.user a,th.user a,[data-region="user-name"],.fullname'
      );
      const name = String(nameElement?.textContent || '').replace(/\s+/g, ' ').trim();
      const grade = gradeInputs(row)[0] || null;
      const feedback = feedbackInputs(row)[0] || null;
      const text = normalizeText(row.textContent);
      const hasSubmission = !text.includes('nenhum envio') && !text.includes('no submission');
      return { row, name, grade, feedback, hasSubmission };
    }).filter(item => item.name && (item.grade || item.feedback));
  }

  function findGradeNavHost() {
    const main = document.querySelector('[role="main"]') || document;
    const links = [...main.querySelectorAll('.navitem a.btn,a.btn[href*="action=grader"],a.btn[href*="action=grading"]')];
    const link = links.find(item => {
      const text = normalizeText(item.textContent);
      return text === 'nota' || text === 'grade' || item.href.includes('action=grader');
    });
    return link?.closest('.navitem') || document.querySelector('[data-region="grading-actions"],.tertiary-navigation .navitem:last-child');
  }

  function toast(message, tone = 'warning') {
    document.getElementById('sx-importer-toast')?.remove();
    const element = document.createElement('div');
    element.id = 'sx-importer-toast';
    element.className = `sx-importer-toast sx-reset is-${tone}`;
    element.textContent = message;
    document.body.appendChild(element);
    setTimeout(() => element.remove(), 6500);
  }

  function ensureButton() {
    if (!gradingPage()) return;
    let button = document.getElementById('sx-importer-open');
    if (!button) {
      button = document.createElement('button');
      button.id = 'sx-importer-open';
      button.type = 'button';
      button.className = 'sx-importer-open sx-button sx-reset';
      button.textContent = 'Importar';
      button.addEventListener('click', () => {
        const current = readiness();
        if (current.checkbox && !current.checkbox.checked) {
          current.checkbox.click();
          current.checkbox.dispatchEvent(new Event('change', { bubbles: true }));
          toast('A Avaliação rápida foi ativada. Aguarde a tabela atualizar e clique novamente em Importar.');
          return;
        }
        if (!current.ready) {
          toast('Os campos editáveis ainda não estão disponíveis. Confirme a Avaliação rápida e aguarde o carregamento da tabela.');
          return;
        }
        openModal();
      });
    }

    const host = findGradeNavHost();
    if (host && button.parentElement !== host) {
      button.classList.remove('sx-importer-floating');
      host.appendChild(button);
    } else if (!host && button.parentElement !== document.body) {
      button.classList.add('sx-importer-floating');
      document.body.appendChild(button);
    } else if (!button.isConnected) {
      button.classList.add('sx-importer-floating');
      document.body.appendChild(button);
    }

    const current = readiness();
    button.dataset.ready = current.ready ? 'true' : 'false';
    button.title = current.ready
      ? 'Importar notas e feedbacks para a página atual'
      : 'Ative a Avaliação rápida para carregar os campos editáveis';
  }

  function resetFlow() {
    state.file = null;
    state.records = [];
    state.matches = [];
    state.step = 1;
    state.mode = 'file';
  }

  function closeModal() {
    state.modal?.remove();
    state.modal = null;
    resetFlow();
  }

  function openModal() {
    resetFlow();
    const overlay = document.createElement('div');
    overlay.className = 'sx-importer-overlay sx-reset';
    overlay.innerHTML = `
      <section class="sx-importer-modal sx-panel" role="dialog" aria-modal="true" aria-labelledby="sx-importer-title">
        <header class="sx-importer-header">
          <div><h2 id="sx-importer-title">Importar correções</h2><p>Preencha notas e feedbacks com segurança.</p></div>
          <button type="button" class="sx-importer-close" aria-label="Fechar">×</button>
        </header>
        <nav class="sx-importer-tabs" aria-label="Modo de preenchimento">
          <button type="button" data-mode="file" class="is-active">Importar arquivo</button>
          <button type="button" data-mode="bulk">Aplicar em massa</button>
        </nav>
        <div class="sx-importer-content"></div>
      </section>`;
    document.body.appendChild(overlay);
    state.modal = overlay;
    overlay.querySelector('.sx-importer-close').addEventListener('click', closeModal);
    overlay.addEventListener('click', event => { if (event.target === overlay) closeModal(); });
    overlay.querySelectorAll('[data-mode]').forEach(button => {
      button.addEventListener('click', () => {
        state.mode = button.dataset.mode;
        overlay.querySelectorAll('[data-mode]').forEach(item => item.classList.toggle('is-active', item === button));
        render();
      });
    });
    render();
  }

  function stepper(active) {
    return `<div class="sx-importer-stepper">${['Adicionar', 'Validar', 'Executar'].map((label, index) =>
      `<div class="${index + 1 <= active ? 'is-active' : ''}"><span>${index + 1}</span><b>${label}</b></div>`
    ).join('')}</div>`;
  }

  function render() {
    if (!state.modal) return;
    const content = state.modal.querySelector('.sx-importer-content');
    if (state.mode === 'bulk') renderBulk(content);
    else if (state.step === 1) renderAdd(content);
    else if (state.step === 2) renderValidation(content);
    else renderExecution(content);
  }

  function renderAdd(content) {
    content.innerHTML = `${stepper(1)}
      <section class="sx-importer-stage">
        <h3>Arquivo de correção</h3>
        <p>Use CSV, TSV ou TXT com a coluna <b>nome</b> e ao menos nota, feedback ou situação.</p>
        <label class="sx-importer-dropzone">
          <input type="file" accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values">
          <span class="sx-importer-drop-icon">↥</span>
          <strong>${state.file ? escapeHtml(state.file.name) : 'Selecionar arquivo'}</strong>
          <small>${state.file ? 'Clique para trocar o arquivo' : 'Clique ou arraste o arquivo para esta área'}</small>
        </label>
        <div class="sx-importer-options">
          <label><input type="checkbox" data-option="overwriteGrades" ${state.settings.moodle.overwriteGrades ? 'checked' : ''}> Substituir notas preenchidas</label>
          <label><input type="checkbox" data-option="overwriteFeedback" ${state.settings.moodle.overwriteFeedback ? 'checked' : ''}> Substituir feedback preenchido</label>
          <label><input type="checkbox" data-option="flexibleNames" ${state.settings.moodle.flexibleNames ? 'checked' : ''}> Aceitar pequenas diferenças nos nomes</label>
        </div>
      </section>
      <footer class="sx-importer-actions"><button type="button" class="sx-button sx-button--secondary" data-action="cancel">Cancelar</button><button type="button" class="sx-button" data-action="next" ${state.file ? '' : 'disabled'}>Validar arquivo</button></footer>`;

    const input = content.querySelector('input[type="file"]');
    input.addEventListener('change', () => { state.file = input.files?.[0] || null; render(); });
    content.querySelectorAll('[data-option]').forEach(option => option.addEventListener('change', () => {
      state.settings.moodle[option.dataset.option] = option.checked;
    }));
    content.querySelector('[data-action="cancel"]').addEventListener('click', closeModal);
    content.querySelector('[data-action="next"]').addEventListener('click', validateFile);
  }

  function resolveColumn(headers, aliases) {
    return headers.findIndex(header => aliases.some(alias => normalizeText(alias) === normalizeText(header)));
  }

  async function validateFile() {
    if (!state.file) return;
    try {
      const matrix = parseDelimited(await state.file.text());
      if (matrix.length < 2) throw new Error('O arquivo não contém registros suficientes.');
      const indexes = Object.fromEntries(Object.entries(HEADER_ALIASES).map(([key, aliases]) => [key, resolveColumn(matrix[0], aliases)]));
      if (indexes.nome < 0) throw new Error('A coluna “nome” não foi encontrada.');
      if (indexes.nota < 0 && indexes.feedback < 0 && indexes.situacao < 0) throw new Error('Inclua nota, feedback ou situação.');

      state.records = matrix.slice(1).map(columns => ({
        nome: columns[indexes.nome] || '',
        nota: indexes.nota >= 0 ? columns[indexes.nota] || '' : '',
        feedback: indexes.feedback >= 0 ? columns[indexes.feedback] || '' : '',
        situacao: indexes.situacao >= 0 ? columns[indexes.situacao] || '' : ''
      })).filter(record => record.nome && (record.nota || record.feedback || record.situacao));

      const rows = findRows();
      const used = new Set();
      state.matches = state.records.map(record => {
        const wanted = normalizeText(record.nome);
        let target = rows.find(item => !used.has(item) && normalizeText(item.name) === wanted);
        if (!target && state.settings.moodle.flexibleNames) {
          const candidates = rows.filter(item => !used.has(item))
            .map(item => ({ item, score: similarity(record.nome, item.name) }))
            .sort((a, b) => b.score - a.score);
          if (candidates[0]?.score >= .82 && candidates[0].score > (candidates[1]?.score || 0) + .08) target = candidates[0].item;
        }
        if (target) used.add(target);
        return { record, target };
      });
      state.step = 2;
      render();
    } catch (error) {
      const stage = state.modal?.querySelector('.sx-importer-stage');
      stage?.querySelector('.sx-status')?.remove();
      const status = document.createElement('div');
      status.className = 'sx-status sx-status--danger';
      status.textContent = error.message;
      stage?.prepend(status);
    }
  }

  function renderValidation(content) {
    const found = state.matches.filter(item => item.target);
    const missing = state.matches.filter(item => !item.target);
    content.innerHTML = `${stepper(2)}
      <section class="sx-importer-stage">
        <h3>Validação do arquivo</h3>
        <div class="sx-importer-metrics"><span><b>${state.records.length}</b> Registros</span><span class="is-success"><b>${found.length}</b> Encontrados</span><span class="${missing.length ? 'is-warning' : 'is-success'}"><b>${missing.length}</b> Não encontrados</span></div>
        ${missing.length ? `<div class="sx-importer-list"><strong>Não encontrados</strong><ul>${missing.map(item => `<li>${escapeHtml(item.record.nome)}</li>`).join('')}</ul></div>` : '<div class="sx-status sx-status--success">Todos os registros foram localizados na página.</div>'}
      </section>
      <footer class="sx-importer-actions"><button type="button" class="sx-button sx-button--secondary" data-action="back">Voltar</button><button type="button" class="sx-button" data-action="execute" ${found.length ? '' : 'disabled'}>Executar preenchimento</button></footer>`;
    content.querySelector('[data-action="back"]').addEventListener('click', () => { state.step = 1; render(); });
    content.querySelector('[data-action="execute"]').addEventListener('click', executeImport);
  }

  function pageDecimalSeparator() {
    const values = gradeInputs().map(input => input.value || '').join(' ');
    if (/\d,\d/.test(values)) return ',';
    const cells = [...document.querySelectorAll('td.grade,th.grade,td[class*="grade"],th[class*="grade"]')]
      .map(cell => cell.textContent || '').join(' ');
    return /\d,\d/.test(cells) ? ',' : '.';
  }

  function gradeForPage(value) {
    let grade = String(value ?? '').trim().replace(/^['"]|['"]$/g, '').replace(/\s*\/\s*.+$/, '');
    grade = grade.replace(/[^0-9,.-]/g, '');
    if (!grade) return '';
    const separator = pageDecimalSeparator();
    if (separator === ',') {
      if (grade.includes(',') && grade.includes('.')) grade = grade.replace(/\./g, '');
      else if (grade.includes('.') && !grade.includes(',')) grade = grade.replace('.', ',');
    } else {
      if (grade.includes(',') && grade.includes('.')) grade = grade.replace(/,/g, '');
      else if (grade.includes(',') && !grade.includes('.')) grade = grade.replace(',', '.');
    }
    return grade;
  }

  function applySituation(row, value) {
    row.querySelector('.sx-importer-tag')?.remove();
    const normalized = normalizeText(value);
    const tag = document.createElement('span');
    tag.className = `sx-importer-tag ${normalized.includes('perigo') ? 'is-danger' : normalized.includes('aten') ? 'is-warning' : 'is-success'}`;
    tag.textContent = value;
    const host = row.querySelector('td.user,th.user,.username') || row.firstElementChild;
    host?.appendChild(tag);
  }

  async function executeImport() {
    state.step = 3;
    render();
    await new Promise(resolve => requestAnimationFrame(resolve));
    let applied = 0;
    let skipped = 0;
    state.matches.filter(item => item.target).forEach(({ record, target }) => {
      let changed = false;
      if (record.nota && target.grade && (state.settings.moodle.overwriteGrades || !target.grade.value.trim())) {
        setNativeValue(target.grade, gradeForPage(record.nota));
        changed = true;
      }
      if (record.feedback && target.feedback && (state.settings.moodle.overwriteFeedback || !target.feedback.value.trim())) {
        setNativeValue(target.feedback, record.feedback);
        changed = true;
      }
      if (record.situacao) applySituation(target.row, record.situacao);
      if (changed || record.situacao) applied += 1;
      else skipped += 1;
    });
    const result = state.modal?.querySelector('[data-execution-result]');
    if (result) result.innerHTML = `<div class="sx-status sx-status--success"><b>Preenchimento concluído.</b><br>${applied} registro(s) aplicado(s) e ${skipped} ignorado(s). Revise os campos e salve pelo Moodle.</div>`;
  }

  function renderExecution(content) {
    content.innerHTML = `${stepper(3)}
      <section class="sx-importer-stage sx-importer-execution"><div class="sx-importer-loader"></div><h3>Executando preenchimento</h3><p>Aplicando os dados encontrados na página atual.</p><div data-execution-result></div></section>
      <footer class="sx-importer-actions"><button type="button" class="sx-button" data-action="finish">Concluir</button></footer>`;
    content.querySelector('[data-action="finish"]').addEventListener('click', closeModal);
  }

  function renderBulk(content) {
    content.innerHTML = `<section class="sx-importer-stage sx-importer-bulk">
      <h3>Aplicar em massa</h3><p>Preencha a mesma nota ou feedback nos alunos visíveis.</p>
      <label>Nota<input class="sx-field" type="text" data-bulk="grade" placeholder="Opcional"></label>
      <label>Feedback<textarea class="sx-field" data-bulk="feedback" rows="4" placeholder="Opcional"></textarea></label>
      <label>Aplicar em<select class="sx-field" data-bulk="scope"><option value="submissions">Somente alunos com envio</option><option value="all">Todos os alunos visíveis</option></select></label>
      <div class="sx-status" data-bulk-status>Informe uma nota, um feedback ou ambos.</div>
    </section>
    <footer class="sx-importer-actions"><button type="button" class="sx-button sx-button--secondary" data-action="cancel">Cancelar</button><button type="button" class="sx-button" data-action="bulk-apply">Aplicar</button></footer>`;
    content.querySelector('[data-action="cancel"]').addEventListener('click', closeModal);
    content.querySelector('[data-action="bulk-apply"]').addEventListener('click', () => {
      const grade = content.querySelector('[data-bulk="grade"]').value.trim();
      const feedback = content.querySelector('[data-bulk="feedback"]').value.trim();
      const scope = content.querySelector('[data-bulk="scope"]').value;
      const status = content.querySelector('[data-bulk-status]');
      if (!grade && !feedback) {
        status.className = 'sx-status sx-status--danger';
        status.textContent = 'Informe uma nota ou um feedback.';
        return;
      }
      let applied = 0;
      findRows().filter(item => scope === 'all' || item.hasSubmission).forEach(item => {
        let changed = false;
        if (grade && item.grade && (state.settings.moodle.overwriteGrades || !item.grade.value.trim())) {
          setNativeValue(item.grade, gradeForPage(grade));
          changed = true;
        }
        if (feedback && item.feedback && (state.settings.moodle.overwriteFeedback || !item.feedback.value.trim())) {
          setNativeValue(item.feedback, feedback);
          changed = true;
        }
        if (changed) applied += 1;
      });
      status.className = 'sx-status sx-status--success';
      status.textContent = `${applied} aluno(s) preenchido(s). Revise e salve pelo Moodle.`;
    });
  }

  async function initialize() {
    if (!gradingPage()) return;
    state.settings = await getSettings();
    if (!state.settings.modules.moodle || !state.settings.moodle.importer) return;
    ensureButton();
    const observer = new MutationObserver(() => ensureButton());
    observer.observe(document.body, { childList: true, subtree: true });
    quickGradingCheckbox()?.addEventListener('change', () => setTimeout(ensureButton, 250));
  }

  initialize().catch(console.error);
})();