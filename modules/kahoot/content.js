(() => {
  'use strict';

  if (document.documentElement.dataset.sxKahoot === '1') return;
  document.documentElement.dataset.sxKahoot = '1';

  const { getSettings, parseDelimited, escapeHtml, sleep } = SenaiExt;

  const SELECTORS = {
    questionTitle: '[data-functional-selector="question-title__input"]',
    answerCards: '[data-functional-selector="question-answer"]',
    answerInput: '[data-functional-selector="question-answer__input"]',
    correctToggle: '[data-functional-selector="question-answer__toggle-button"]',
    sidebarBlock: '[data-functional-selector="sidebar-block"]',
    addQuestion: '[data-functional-selector="add-question-button"]'
  };

  const HEADERS = {
    question: ['pergunta', 'questao', 'questão', 'enunciado', 'question'],
    answers: [
      ['opcao1', 'opção1', 'alternativa1', 'resposta1', 'answer1', 'option1', 'a'],
      ['opcao2', 'opção2', 'alternativa2', 'resposta2', 'answer2', 'option2', 'b'],
      ['opcao3', 'opção3', 'alternativa3', 'resposta3', 'answer3', 'option3', 'c'],
      ['opcao4', 'opção4', 'alternativa4', 'resposta4', 'answer4', 'option4', 'd']
    ],
    correct: ['correta', 'correto', 'respostacorreta', 'resposta correta', 'alternativacorreta', 'alternativa correta', 'correct', 'gabarito']
  };

  let settings;
  let running = false;
  let cancelled = false;
  let progressPanel = null;

  const normalized = value => String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');

  const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();

  function resolveColumn(headers, aliases) {
    const accepted = aliases.map(normalized);
    return headers.findIndex(header => accepted.includes(normalized(header)));
  }

  function resolveCorrect(rawValue, answers) {
    const value = normalized(rawValue);
    const map = { '1': 0, '2': 1, '3': 2, '4': 3, a: 0, b: 1, c: 2, d: 3 };
    if (Object.prototype.hasOwnProperty.call(map, value)) return map[value];
    return answers.findIndex(answer => normalized(answer) === value);
  }

  function parseQuestions(text) {
    const rows = parseDelimited(text);
    if (rows.length < 2) throw new Error('O arquivo deve conter cabeçalho e pelo menos uma pergunta.');

    const headers = rows[0];
    const indexes = {
      question: resolveColumn(headers, HEADERS.question),
      answers: HEADERS.answers.map(aliases => resolveColumn(headers, aliases)),
      correct: resolveColumn(headers, HEADERS.correct)
    };

    if (indexes.question < 0 || indexes.answers.some(index => index < 0) || indexes.correct < 0) {
      throw new Error('Use as colunas: pergunta, opcao1, opcao2, opcao3, opcao4 e correta.');
    }

    const questions = [];
    const errors = [];

    rows.slice(1).forEach((row, offset) => {
      const line = offset + 2;
      if (!row.some(cell => clean(cell))) return;
      const question = clean(row[indexes.question]);
      const answers = indexes.answers.map(index => clean(row[index]));
      const correctIndex = resolveCorrect(row[indexes.correct], answers);

      if (!question) errors.push(`Linha ${line}: pergunta vazia.`);
      answers.forEach((answer, index) => {
        if (!answer) errors.push(`Linha ${line}: opção ${index + 1} vazia.`);
      });
      if (correctIndex < 0 || correctIndex > 3) {
        errors.push(`Linha ${line}: a resposta correta deve ser 1–4, A–D ou o texto exato da alternativa.`);
      }

      if (question && answers.every(Boolean) && correctIndex >= 0 && correctIndex <= 3) {
        questions.push({ question, answers, correctIndex, line });
      }
    });

    if (!questions.length) throw new Error(errors[0] || 'Nenhuma pergunta válida foi encontrada.');
    return { questions, errors };
  }

  function isVisible(element) {
    if (!element) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
  }

  async function waitFor(getter, description, timeout = 12000) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      if (cancelled) throw new DOMException('Importação cancelada.', 'AbortError');
      const value = typeof getter === 'function' ? getter() : document.querySelector(getter);
      if (value) return value;
      await sleep(120);
    }
    throw new Error(`Tempo esgotado ao aguardar ${description}.`);
  }

  function editorText(element) {
    return clean(element?.innerText || element?.textContent || '');
  }

  function selectEditorContents(element) {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(element);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function insertEditorText(element, value) {
    if (!element) throw new Error('Campo editável não encontrado.');
    element.scrollIntoView({ block: 'center', inline: 'nearest' });
    element.focus({ preventScroll: true });
    selectEditorContents(element);
    let inserted = false;
    try {
      inserted = document.execCommand('insertText', false, String(value));
    } catch {
      inserted = false;
    }
    if (!inserted) throw new Error('O navegador não conseguiu inserir texto no editor do Kahoot.');
    element.blur();
  }

  async function replaceEditorText(getElement, expected, label) {
    const desired = clean(expected);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const element = await waitFor(getElement, `campo de ${label}`, 9000);
      if (editorText(element) === desired) return;
      insertEditorText(element, expected);
      await sleep(350);
      const confirmed = await waitFor(() => {
        const current = getElement();
        return current && editorText(current) === desired ? current : null;
      }, `confirmação de ${label}`, 4500).catch(() => null);
      if (confirmed) return;
      await sleep(250);
    }
    throw new Error(`Não foi possível confirmar ${label}.`);
  }

  function currentQuestionCount() {
    return document.querySelectorAll(SELECTORS.sidebarBlock).length;
  }

  function currentQuestionIsBlank() {
    const title = document.querySelector(SELECTORS.questionTitle);
    const inputs = [...document.querySelectorAll(SELECTORS.answerInput)].slice(0, 4);
    return editorText(title) === '' && inputs.length === 4 && inputs.every(input => editorText(input) === '');
  }

  function pageDiagnostics() {
    const missing = [];
    if (!document.querySelector(SELECTORS.questionTitle)) missing.push('título da pergunta');
    if (document.querySelectorAll(SELECTORS.answerCards).length < 4) missing.push('quatro respostas');
    if (document.querySelectorAll(SELECTORS.correctToggle).length < 4) missing.push('seleção da resposta correta');
    if (!document.querySelector(SELECTORS.sidebarBlock)) missing.push('lista de perguntas');
    if (!document.querySelector(SELECTORS.addQuestion)) missing.push('botão Adicionar');
    return {
      ready: missing.length === 0,
      missing,
      questionCount: currentQuestionCount(),
      currentBlank: currentQuestionIsBlank()
    };
  }

  function createProgress(total) {
    progressPanel?.remove();
    const panel = document.createElement('section');
    panel.id = 'sx-kahoot-progress';
    panel.className = 'sx-kahoot-progress sx-panel sx-reset';
    panel.innerHTML = `
      <div class="sx-kahoot-progress__head"><strong>Importando perguntas</strong><span data-count>0/${total}</span></div>
      <div class="sx-kahoot-progress__track"><span data-bar></span></div>
      <p data-status>Preparando o editor…</p>
      <button type="button" class="sx-button sx-button--secondary" data-cancel>Cancelar</button>`;
    panel.querySelector('[data-cancel]').addEventListener('click', () => {
      if (running) {
        cancelled = true;
        panel.querySelector('[data-status]').textContent = 'Cancelando após a etapa atual…';
      } else {
        panel.remove();
      }
    });
    document.documentElement.appendChild(panel);
    progressPanel = panel;
    return panel;
  }

  function updateProgress(current, total, message, tone = 'running') {
    if (!progressPanel) return;
    progressPanel.querySelector('[data-count]').textContent = `${current}/${total}`;
    progressPanel.querySelector('[data-bar]').style.width = `${Math.max(0, Math.min(100, current / total * 100))}%`;
    progressPanel.querySelector('[data-status]').textContent = message;
    progressPanel.dataset.tone = tone;
    if (tone !== 'running') {
      const button = progressPanel.querySelector('[data-cancel]');
      button.textContent = 'Fechar';
      button.onclick = () => progressPanel?.remove();
    }
  }

  async function setCorrectAnswer(correctIndex) {
    const toggles = [...document.querySelectorAll(SELECTORS.correctToggle)].slice(0, 4);
    if (toggles.length < 4) throw new Error('Não foram encontradas quatro opções de resposta.');

    for (let index = 0; index < toggles.length; index += 1) {
      const toggle = toggles[index];
      const checked = toggle.getAttribute('aria-checked') === 'true';
      const shouldBeChecked = index === correctIndex;
      if (checked !== shouldBeChecked) {
        toggle.scrollIntoView({ block: 'center', inline: 'nearest' });
        toggle.click();
        await sleep(220);
      }
    }

    await waitFor(() => {
      const current = [...document.querySelectorAll(SELECTORS.correctToggle)].slice(0, 4);
      return current.length === 4 && current.every((toggle, index) =>
        (toggle.getAttribute('aria-checked') === 'true') === (index === correctIndex)
      ) ? current : null;
    }, 'marcação da resposta correta', 6000);
  }

  async function fillCurrentQuestion(item) {
    await replaceEditorText(() => document.querySelector(SELECTORS.questionTitle), item.question, 'pergunta');
    for (let index = 0; index < 4; index += 1) {
      await replaceEditorText(() => {
        const cards = [...document.querySelectorAll(SELECTORS.answerCards)].slice(0, 4);
        return cards[index]?.querySelector(SELECTORS.answerInput) || null;
      }, item.answers[index], `opção ${index + 1}`);
    }
    await setCorrectAnswer(item.correctIndex);
    await sleep(450);
  }

  function controlledPopup(addButton) {
    const id = addButton?.getAttribute('aria-controls');
    const direct = id ? document.getElementById(id) : null;
    if (isVisible(direct)) return direct;
    return [...document.querySelectorAll('[role="dialog"],[data-radix-popper-content-wrapper]')].filter(isVisible).at(-1) || null;
  }

  function quizOption(root) {
    if (!root) return null;
    const candidates = [...root.querySelectorAll('button,[role="button"],[data-functional-selector]')].filter(isVisible);
    const stable = candidates.find(element => {
      const selector = String(element.getAttribute('data-functional-selector') || '').toLowerCase();
      return selector.includes('quiz') && (selector.includes('question') || selector.includes('add') || selector.includes('create') || selector.includes('type'));
    });
    if (stable) return stable.closest('button,[role="button"]') || stable;
    const byText = candidates.find(element => /^quiz\b/i.test(clean(element.innerText || element.textContent)));
    return byText ? byText.closest('button,[role="button"]') || byText : null;
  }

  async function createNewQuestion() {
    const beforeCount = currentQuestionCount();
    const previousTitle = document.querySelector(SELECTORS.questionTitle);
    const addButton = await waitFor(() => {
      const button = document.querySelector(SELECTORS.addQuestion);
      return isVisible(button) ? button : null;
    }, 'botão Adicionar');

    addButton.scrollIntoView({ block: 'center', inline: 'nearest' });
    addButton.click();
    await sleep(300);

    if (currentQuestionCount() <= beforeCount) {
      const popup = await waitFor(() => controlledPopup(addButton), 'menu de tipo da pergunta', 8000);
      const option = await waitFor(() => quizOption(popup), 'opção Quiz', 8000);
      option.click();
    }

    await waitFor(() => currentQuestionCount() > beforeCount ? true : null, 'novo card de pergunta', 12000);
    await waitFor(() => {
      const current = document.querySelector(SELECTORS.questionTitle);
      return current && (current !== previousTitle || currentQuestionIsBlank()) ? current : null;
    }, 'ativação do novo card de pergunta', 10000);
    await sleep(500);
  }

  async function runImport(questions) {
    if (running) return;
    running = true;
    cancelled = false;
    createProgress(questions.length);

    try {
      await sleep(250);
      const diagnostics = pageDiagnostics();
      if (!diagnostics.ready) throw new Error(`O editor não está pronto: ${diagnostics.missing.join(', ')}.`);
      if (!diagnostics.currentBlank && !settings.kahoot.replaceCurrent) {
        throw new Error('A pergunta atual já contém dados. Ative a opção para substituí-la ou abra um Kahoot novo.');
      }

      for (let index = 0; index < questions.length; index += 1) {
        if (cancelled) throw new DOMException('Importação cancelada.', 'AbortError');
        if (index > 0 || (!settings.kahoot.replaceCurrent && index === 0)) {
          updateProgress(index, questions.length, `Criando a pergunta ${index + 1}…`);
          await createNewQuestion();
        }
        updateProgress(index, questions.length, `Preenchendo a pergunta ${index + 1} de ${questions.length}…`);
        await fillCurrentQuestion(questions[index]);
        updateProgress(index + 1, questions.length, `Pergunta ${index + 1} concluída.`);
        await sleep(Math.max(250, Number(settings.kahoot.delayMs) || 900));
      }

      updateProgress(questions.length, questions.length, 'Importação concluída. Revise as perguntas antes de salvar.', 'success');
    } catch (error) {
      const aborted = error?.name === 'AbortError';
      updateProgress(0, questions.length, aborted ? 'Importação cancelada.' : error.message, aborted ? 'warning' : 'error');
    } finally {
      running = false;
    }
  }

  function openPanel() {
    if (running) return;
    document.getElementById('sx-kahoot-overlay')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'sx-kahoot-overlay';
    overlay.className = 'sx-kahoot-overlay sx-reset';
    overlay.innerHTML = `
      <section class="sx-kahoot-panel sx-panel" role="dialog" aria-modal="true" aria-labelledby="sx-kahoot-title">
        <header><div><h2 id="sx-kahoot-title">KahootOmático</h2><p>Importe perguntas de um arquivo CSV.</p></div><button type="button" data-close aria-label="Fechar">×</button></header>
        <div class="sx-kahoot-content">
          <label class="sx-kahoot-drop"><input type="file" accept=".csv,.tsv,.txt"><span>CSV</span><strong>Selecionar arquivo</strong><small>pergunta, opcao1, opcao2, opcao3, opcao4, correta</small></label>
          <div class="sx-status" data-status>Selecione um arquivo para validar.</div>
          <div class="sx-kahoot-preview" data-preview hidden></div>
        </div>
        <footer><button type="button" class="sx-button sx-button--secondary" data-close>Cancelar</button><button type="button" class="sx-button" data-run disabled>Importar perguntas</button></footer>
      </section>`;
    document.body.appendChild(overlay);

    let parsed = null;
    const input = overlay.querySelector('input[type="file"]');
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        parsed = parseQuestions(await file.text());
        const status = overlay.querySelector('[data-status]');
        const run = overlay.querySelector('[data-run]');
        status.className = `sx-status ${parsed.errors.length ? 'sx-status--warning' : 'sx-status--success'}`;
        status.textContent = `${parsed.questions.length} pergunta(s) válida(s). ${parsed.errors.length ? `${parsed.errors.length} problema(s) foram encontrados.` : 'Arquivo validado.'}`;
        const preview = overlay.querySelector('[data-preview]');
        preview.hidden = false;
        preview.innerHTML = parsed.questions.slice(0, 6).map((item, index) => `<div><b>${index + 1}.</b> ${escapeHtml(item.question)}</div>`).join('');
        run.disabled = !parsed.questions.length || (settings.kahoot.validateBeforeRun && parsed.errors.length > 0);
      } catch (error) {
        parsed = null;
        const status = overlay.querySelector('[data-status]');
        status.className = 'sx-status sx-status--danger';
        status.textContent = error.message;
        overlay.querySelector('[data-run]').disabled = true;
      }
    });

    overlay.querySelector('[data-run]').addEventListener('click', () => {
      const questions = parsed?.questions || [];
      if (!questions.length) return;
      overlay.remove();
      runImport(questions);
    });
    overlay.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => overlay.remove()));
    overlay.addEventListener('click', event => { if (event.target === overlay) overlay.remove(); });
  }

  function installButton() {
    if (document.getElementById('sx-kahoot-open')) return;
    const button = document.createElement('button');
    button.id = 'sx-kahoot-open';
    button.type = 'button';
    button.className = 'sx-kahoot-open sx-button sx-reset';
    button.innerHTML = '<span>K</span> KahootOmático';
    button.addEventListener('click', openPanel);
    document.body.appendChild(button);
  }

  async function initialize() {
    settings = await getSettings();
    if (!settings.modules.kahoot) return;
    installButton();
  }

  initialize().catch(console.error);
})();
