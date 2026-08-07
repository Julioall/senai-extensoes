(() => {
  'use strict';

  if (document.documentElement.dataset.sxKahootV2 === '1') return;
  document.documentElement.dataset.sxKahootV2 = '1';

  const { getSettings, updateSettings, parseDelimited, escapeHtml, setNativeValue, sleep } = SenaiExt;

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

  const state = {
    settings: null,
    overlay: null,
    file: null,
    parsed: null,
    step: 1,
    mode: 'replace',
    running: false,
    cancelled: false,
    progress: null,
    startedAt: 0,
    timer: null,
    observer: null,
    scanTimer: null
  };

  const normalized = value => String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');

  const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();

  function isVisible(element) {
    if (!element) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      Number(style.opacity || 1) !== 0 &&
      rect.width > 0 &&
      rect.height > 0;
  }

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
      if (!row.some(cell => clean(cell))) return;
      const line = offset + 2;
      const question = clean(row[indexes.question]);
      const answers = indexes.answers.map(index => clean(row[index]));
      const correctIndex = resolveCorrect(row[indexes.correct], answers);
      const rowErrors = [];

      if (!question) rowErrors.push(`Linha ${line}: pergunta vazia.`);
      answers.forEach((answer, index) => {
        if (!answer) rowErrors.push(`Linha ${line}: opção ${index + 1} vazia.`);
      });
      if (correctIndex < 0 || correctIndex > 3) rowErrors.push(`Linha ${line}: resposta correta inválida.`);

      errors.push(...rowErrors);
      if (!rowErrors.length) questions.push({ question, answers, correctIndex, line });
    });

    if (!questions.length) throw new Error(errors[0] || 'Nenhuma pergunta válida foi encontrada.');
    return { questions, errors };
  }

  function editorText(element) {
    if (!element) return '';
    if ('value' in element) return clean(element.value);
    return clean(element.innerText || element.textContent || '');
  }

  function questionTitle() {
    const selectors = [
      '[data-functional-selector="question-title__input"]',
      '[data-functional-selector*="question-title"] [contenteditable="true"]',
      '[contenteditable="true"][aria-label*="question" i]',
      '[contenteditable="true"][aria-label*="pergunta" i]',
      'textarea[placeholder*="question" i]',
      'textarea[placeholder*="pergunta" i]',
      'input[placeholder*="question" i]',
      'input[placeholder*="pergunta" i]'
    ];
    return selectors
      .map(selector => [...document.querySelectorAll(selector)].find(isVisible))
      .find(Boolean) || null;
  }

  function answerInputs() {
    const selectors = [
      '[data-functional-selector="question-answer__input"]',
      '[data-functional-selector*="question-answer"] input[type="text"]',
      '[data-functional-selector*="question-answer"] textarea',
      '[data-functional-selector*="question-answer"] [contenteditable="true"]',
      '[contenteditable="true"][aria-label*="answer" i]',
      '[contenteditable="true"][aria-label*="resposta" i]',
      'textarea[placeholder*="answer" i]',
      'textarea[placeholder*="resposta" i]',
      'input[placeholder*="answer" i]',
      'input[placeholder*="resposta" i]'
    ];

    const seen = new Set();
    const results = [];
    for (const selector of selectors) {
      for (const element of document.querySelectorAll(selector)) {
        if (!isVisible(element) || element === questionTitle() || seen.has(element)) continue;
        seen.add(element);
        results.push(element);
      }
      if (results.length >= 4) break;
    }
    return results.slice(0, 4);
  }

  function answerCards() {
    const stable = [...document.querySelectorAll('[data-functional-selector="question-answer"]')].filter(isVisible);
    if (stable.length >= 4) return stable.slice(0, 4);

    return answerInputs().map(input =>
      input.closest(
        '[data-functional-selector*="question-answer"],[data-testid*="answer"],article,li,[role="listitem"]'
      ) || input.parentElement || input
    );
  }

  function answerInput(card, index) {
    const direct = answerInputs()[index];
    if (direct) return direct;
    if (!card) return null;
    if (card.matches?.('input,textarea,[contenteditable="true"]')) return card;
    return card.querySelector?.('input[type="text"],textarea,[contenteditable="true"]') || null;
  }

  function mediaLike(element) {
    const text = normalized([
      element.getAttribute?.('aria-label'),
      element.getAttribute?.('title'),
      element.getAttribute?.('data-functional-selector'),
      element.getAttribute?.('data-testid'),
      element.innerText,
      element.textContent
    ].filter(Boolean).join(' '));

    return ['image', 'imagem', 'media', 'upload', 'photo', 'foto', 'picture', 'asset']
      .some(token => text.includes(token));
  }

  function correctToggleForCard(card) {
    if (!card) return null;

    const strongSelectors = [
      '[data-functional-selector="question-answer__toggle-button"]',
      '[data-functional-selector*="correct"]',
      '[data-testid*="correct"]',
      '[role="radio"][aria-checked]',
      '[role="checkbox"][aria-checked]',
      'button[aria-checked]',
      'button[aria-pressed]',
      'button[aria-label*="correct" i]',
      'button[aria-label*="correta" i]',
      'input[type="radio"]',
      'input[type="checkbox"]'
    ];

    for (const selector of strongSelectors) {
      const found = [...card.querySelectorAll(selector)].find(element =>
        (isVisible(element) || element.matches('input[type="radio"],input[type="checkbox"]')) &&
        !mediaLike(element)
      );
      if (found) return found;
    }

    const cardRect = card.getBoundingClientRect();
    const candidates = [...card.querySelectorAll('button,[role="button"],[role="radio"],[role="checkbox"],label')]
      .filter(element => isVisible(element) && !mediaLike(element))
      .map(element => {
        const rect = element.getBoundingClientRect();
        const attrs = normalized([
          element.getAttribute('aria-label'),
          element.getAttribute('title'),
          element.getAttribute('data-functional-selector'),
          element.getAttribute('data-testid'),
          element.getAttribute('role')
        ].filter(Boolean).join(' '));

        let score = 0;
        if (/correct|corret|answer|respost|toggle|select|check|radio/.test(attrs)) score += 8;
        if (element.hasAttribute('aria-checked') || element.hasAttribute('aria-pressed')) score += 6;
        if (['radio', 'checkbox'].includes(element.getAttribute('role'))) score += 6;
        if (rect.width >= 16 && rect.width <= 52 && rect.height >= 16 && rect.height <= 52) score += 3;
        if (Math.abs(rect.width - rect.height) <= 8) score += 2;
        if (cardRect.width > 0 && rect.left > cardRect.left + cardRect.width * 0.58) score += 2;
        return { element, score, left: rect.left };
      })
      .filter(item => item.score >= 4)
      .sort((a, b) => b.score - a.score || a.left - b.left);

    return candidates[0]?.element || null;
  }

  function correctToggles() {
    const cards = answerCards();
    if (cards.length >= 4) {
      const perCard = cards.slice(0, 4).map(correctToggleForCard);
      if (perCard.every(Boolean)) return perCard;
    }

    const globalSelectors = [
      '[data-functional-selector="question-answer__toggle-button"]',
      '[data-functional-selector*="correct-answer"]',
      '[data-testid*="correct-answer"]',
      '[role="radio"][aria-checked]',
      '[role="checkbox"][aria-checked]',
      'button[aria-label*="correct" i]',
      'button[aria-label*="correta" i]'
    ];

    for (const selector of globalSelectors) {
      const found = [...document.querySelectorAll(selector)].filter(element => isVisible(element) && !mediaLike(element));
      if (found.length >= 4) return found.slice(0, 4);
    }
    return [];
  }

  function sidebarBlocks() {
    const stable = [...document.querySelectorAll('[data-functional-selector="sidebar-block"]')].filter(isVisible);
    if (stable.length) return stable;
    return [...document.querySelectorAll('aside [data-testid*="question"],nav [data-testid*="question"]')].filter(isVisible);
  }

  function addQuestionButton() {
    const stable = document.querySelector('[data-functional-selector="add-question-button"]');
    if (isVisible(stable)) return stable;
    return [...document.querySelectorAll('button,[role="button"]')].filter(isVisible).find(element => {
      const text = normalized(element.innerText || element.textContent);
      return ['add', 'adicionar', 'adicionarpergunta', 'addquestion'].includes(text);
    }) || null;
  }

  function currentQuestionIsBlank() {
    const title = questionTitle();
    const inputs = answerInputs();
    return editorText(title) === '' && inputs.length >= 4 && inputs.every(input => editorText(input) === '');
  }

  function diagnostics() {
    const missing = [];
    if (!questionTitle()) missing.push('campo da pergunta');
    if (answerInputs().length < 4) missing.push('quatro alternativas');
    if (!addQuestionButton()) missing.push('botão para adicionar pergunta');
    return { ready: missing.length === 0, missing, currentBlank: currentQuestionIsBlank() };
  }

  async function waitFor(getter, description, timeout = 12000) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      if (state.cancelled) throw new DOMException('Importação cancelada.', 'AbortError');
      const result = getter();
      if (result) return result;
      await sleep(120);
    }
    throw new Error(`Tempo esgotado ao aguardar ${description}.`);
  }

  function selectContents(element) {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(element);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function insertText(element, value) {
    element.scrollIntoView({ block: 'center', inline: 'nearest' });
    element.focus({ preventScroll: true });

    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      setNativeValue(element, value);
      return;
    }

    selectContents(element);
    let inserted = false;
    try {
      inserted = document.execCommand('insertText', false, String(value));
    } catch {
      inserted = false;
    }

    if (!inserted) {
      element.textContent = String(value);
      element.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        inputType: 'insertText',
        data: String(value)
      }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    }
    element.blur();
  }

  async function replaceText(getter, value, label) {
    const expected = clean(value);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const element = await waitFor(getter, label, 9000);
      if (editorText(element) === expected) return;
      insertText(element, value);
      await sleep(320);
      const confirmed = getter();
      if (confirmed && editorText(confirmed) === expected) return;
    }
    throw new Error(`Não foi possível preencher ${label}.`);
  }

  function toggleSelected(toggle) {
    if (!toggle) return false;
    if ('checked' in toggle) return Boolean(toggle.checked);
    return toggle.getAttribute('aria-checked') === 'true' ||
      toggle.getAttribute('aria-pressed') === 'true' ||
      toggle.dataset.selected === 'true' ||
      toggle.dataset.checked === 'true' ||
      /\b(selected|is-selected|checked|active)\b/i.test(String(toggle.className || ''));
  }

  function hasObservableSelection(toggle) {
    return Boolean(toggle) && (
      'checked' in toggle ||
      toggle.hasAttribute('aria-checked') ||
      toggle.hasAttribute('aria-pressed') ||
      toggle.hasAttribute('data-selected') ||
      toggle.hasAttribute('data-checked')
    );
  }

  async function clickCorrectToggle(toggle) {
    const target = toggle.matches?.('input[type="radio"],input[type="checkbox"]')
      ? (toggle.labels?.[0] || toggle)
      : toggle;
    target.scrollIntoView?.({ block: 'center', inline: 'nearest' });
    target.click();
    await sleep(300);
  }

  async function setCorrectAnswer(correctIndex) {
    const toggles = await waitFor(() => {
      const found = correctToggles();
      return found.length >= 4 ? found : null;
    }, 'os controles de resposta correta', 9000);

    const target = toggles[correctIndex];
    if (!target) throw new Error(`Não foi possível localizar a alternativa correta ${correctIndex + 1}.`);

    if (!toggleSelected(target)) {
      await clickCorrectToggle(target);
    }

    const refreshed = correctToggles();
    const refreshedTarget = refreshed[correctIndex] || target;
    if (hasObservableSelection(refreshedTarget) && !toggleSelected(refreshedTarget)) {
      await clickCorrectToggle(refreshedTarget);
      const finalTarget = correctToggles()[correctIndex] || refreshedTarget;
      if (hasObservableSelection(finalTarget) && !toggleSelected(finalTarget)) {
        throw new Error('A alternativa correta foi localizada, mas o Kahoot não confirmou a seleção.');
      }
    }
  }

  async function fillCurrentQuestion(item) {
    await replaceText(questionTitle, item.question, 'a pergunta');

    for (let index = 0; index < 4; index += 1) {
      await replaceText(() => answerInputs()[index], item.answers[index], `a alternativa ${index + 1}`);
    }

    // O Kahoot pode criar o seletor de resposta correta somente depois que a alternativa recebe texto.
    await sleep(350);
    await setCorrectAnswer(item.correctIndex);
    await sleep(420);
  }

  function controlledPopup(button) {
    const controlled = button?.getAttribute('aria-controls');
    const direct = controlled ? document.getElementById(controlled) : null;
    if (isVisible(direct)) return direct;
    return [...document.querySelectorAll('[role="dialog"],[role="menu"],[data-radix-popper-content-wrapper]')]
      .filter(isVisible)
      .at(-1) || null;
  }

  function quizOption(root) {
    if (!root) return null;
    return [...root.querySelectorAll('button,[role="button"],[data-functional-selector]')]
      .filter(isVisible)
      .find(element => {
        const text = normalized(element.innerText || element.textContent);
        const selector = normalized(element.getAttribute('data-functional-selector'));
        return text === 'quiz' || selector.includes('quizquestion') || selector.includes('addquiz');
      }) || null;
  }

  async function createNewQuestion() {
    const before = sidebarBlocks().length;
    const previous = questionTitle();
    const add = await waitFor(addQuestionButton, 'o botão Adicionar');
    add.click();
    await sleep(320);

    if (sidebarBlocks().length <= before) {
      const popup = await waitFor(() => controlledPopup(add), 'o menu de tipos de pergunta', 8000);
      const option = await waitFor(() => quizOption(popup), 'a opção Quiz', 8000);
      option.click();
    }

    await waitFor(
      () => sidebarBlocks().length > before || questionTitle() !== previous,
      'a nova pergunta',
      12000
    );
    await waitFor(() => questionTitle() && currentQuestionIsBlank(), 'o editor da nova pergunta', 10000);
    await sleep(420);
  }

  function formatTime(seconds) {
    const minutes = Math.floor(seconds / 60);
    return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  }

  function createProgress(total) {
    state.progress?.remove();

    const panel = document.createElement('section');
    panel.id = 'sx-kahoot-progress';
    panel.className = 'sx-kahoot-progress sx-reset';
    panel.innerHTML = `
      <header>
        <span class="sx-kahoot-progress__brand" aria-hidden="true">S</span>
        <strong data-title>Importando questões</strong>
        <button type="button" data-minimize aria-label="Minimizar">−</button>
      </header>
      <div class="sx-kahoot-progress__body">
        <div class="sx-kahoot-progress__line">
          <span data-count>0 de ${total} questões</span>
          <small data-percent>0%</small>
        </div>
        <div class="sx-kahoot-progress__track"><span data-bar></span></div>
      </div>
      <footer>
        <span data-time>◷ 00:00</span>
        <button type="button" data-hide>Ocultar</button>
        <button type="button" data-cancel aria-label="Cancelar importação">×</button>
      </footer>`;

    document.body.appendChild(panel);
    state.progress = panel;
    state.startedAt = Date.now();

    clearInterval(state.timer);
    state.timer = setInterval(() => {
      const elapsed = Math.floor((Date.now() - state.startedAt) / 1000);
      panel.querySelector('[data-time]').textContent = `◷ ${formatTime(elapsed)}`;
    }, 500);

    const collapse = () => panel.classList.toggle('is-collapsed');
    panel.querySelector('[data-minimize]').addEventListener('click', collapse);
    panel.querySelector('[data-hide]').addEventListener('click', collapse);
    panel.querySelector('[data-cancel]').addEventListener('click', () => {
      if (state.running) {
        state.cancelled = true;
        panel.querySelector('[data-title]').textContent = 'Cancelando…';
      } else {
        panel.remove();
      }
    });

    return panel;
  }

  function updateProgress(current, total, tone = 'running', message = '') {
    const panel = state.progress;
    if (!panel) return;

    const percentage = total ? Math.round(current / total * 100) : 0;
    panel.dataset.tone = tone;
    panel.querySelector('[data-count]').textContent = `${current} de ${total} questões`;
    panel.querySelector('[data-percent]').textContent = `${percentage}%`;
    panel.querySelector('[data-bar]').style.width = `${percentage}%`;

    if (message) panel.querySelector('[data-title]').textContent = message;

    if (tone !== 'running') {
      clearInterval(state.timer);
      const cancel = panel.querySelector('[data-cancel]');
      cancel.setAttribute('aria-label', 'Fechar');
      cancel.onclick = () => panel.remove();
    }
  }

  async function runImport(questions) {
    if (state.running) return;

    state.running = true;
    state.cancelled = false;
    createProgress(questions.length);

    try {
      const check = diagnostics();
      if (!check.ready) throw new Error(`O editor não está pronto: ${check.missing.join(', ')}.`);

      for (let index = 0; index < questions.length; index += 1) {
        if (state.cancelled) throw new DOMException('Importação cancelada.', 'AbortError');

        if (index > 0 || state.mode === 'append') await createNewQuestion();

        updateProgress(index, questions.length, 'running', `Importando questão ${index + 1}`);
        await fillCurrentQuestion(questions[index]);
        updateProgress(index + 1, questions.length, 'running', 'Importando questões');
        await sleep(Math.max(350, Number(state.settings.kahoot.delayMs) || 900));
      }

      updateProgress(questions.length, questions.length, 'success', 'Importação concluída');
    } catch (error) {
      const aborted = error?.name === 'AbortError';
      updateProgress(
        0,
        questions.length,
        aborted ? 'warning' : 'error',
        aborted ? 'Importação cancelada' : 'Falha na importação'
      );
      const count = state.progress?.querySelector('[data-count]');
      if (count) count.textContent = error.message;
    } finally {
      state.running = false;
    }
  }

  function stepper(active) {
    return `<nav class="sx-kahoot-stepper" aria-label="Etapas da importação">${
      ['Adicionar', 'Validar', 'Executar'].map((label, index) => {
        const step = index + 1;
        const complete = step < active;
        return `<div class="${step === active ? 'is-active' : ''} ${complete ? 'is-complete' : ''}">
          <span>${complete ? '✓' : step}</span><b>${step}. ${label}</b>
        </div>`;
      }).join('')
    }</nav>`;
  }

  function closeModal() {
    state.overlay?.remove();
    state.overlay = null;
    state.file = null;
    state.parsed = null;
    state.step = 1;
  }

  function openModal() {
    if (state.running) return;

    closeModal();
    state.mode = state.settings.kahoot.replaceCurrent ? 'replace' : 'append';

    const overlay = document.createElement('div');
    overlay.id = 'sx-kahoot-overlay';
    overlay.className = 'sx-kahoot-overlay sx-reset';
    overlay.innerHTML = `
      <section class="sx-kahoot-modal" role="dialog" aria-modal="true" aria-labelledby="sx-kahoot-title">
        <header class="sx-kahoot-modal__header">
          <span class="sx-brand-mark" aria-hidden="true">S</span>
          <div>
            <h2 id="sx-kahoot-title">Importar questões</h2>
            <p>Fluxo guiado para adicionar perguntas ao quiz</p>
          </div>
          <button type="button" class="sx-icon-button" data-close aria-label="Fechar">
            <svg class="sx-icon" viewBox="0 0 24 24">
              <path d="M18 6 6 18M6 6l12 12"/>
            </svg>
          </button>
        </header>
        <div class="sx-kahoot-modal__content"></div>
      </section>`;

    document.body.appendChild(overlay);
    state.overlay = overlay;

    overlay.querySelector('[data-close]').addEventListener('click', closeModal);
    overlay.addEventListener('click', event => {
      if (event.target === overlay) closeModal();
    });

    renderModal();
  }

  function renderModal() {
    if (!state.overlay) return;
    const content = state.overlay.querySelector('.sx-kahoot-modal__content');
    if (state.step === 1) renderAdd(content);
    else renderValidation(content);
  }

  function renderAdd(content) {
    content.innerHTML = `
      ${stepper(1)}
      <section class="sx-kahoot-stage">
        <h3>Adicionar arquivo</h3>
        <label class="sx-kahoot-dropzone">
          <input type="file" accept=".csv,.tsv,.txt,text/csv">
          <svg class="sx-kahoot-file-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M14 2H6a2 2 0 0 0-2 2v16h16V8Z"/>
            <path d="M14 2v6h6M8 13h8M8 17h6"/>
          </svg>
          <strong>${state.file ? escapeHtml(state.file.name) : 'Arraste o arquivo aqui'}</strong>
          <span>${state.file ? 'Clique para trocar o arquivo' : 'ou selecione no computador'}</span>
          <span class="sx-button sx-button--secondary">Selecionar arquivo</span>
        </label>

        <div class="sx-kahoot-info">
          <b>Formato aceito: CSV (UTF-8).</b>
          <span>Colunas esperadas: pergunta, opcao1, opcao2, opcao3, opcao4, correta.</span>
        </div>

        <div class="sx-kahoot-options">
          <h4>Opções de importação</h4>
          <button type="button" data-mode="replace" class="${state.mode === 'replace' ? 'is-selected' : ''}">
            <span>Substituir pergunta atual</span><i></i>
          </button>
          <button type="button" data-mode="append" class="${state.mode === 'append' ? 'is-selected' : ''}">
            <span>Adicionar ao final do quiz</span><i></i>
          </button>
        </div>
      </section>

      <footer class="sx-kahoot-actions">
        <button type="button" class="sx-button sx-button--secondary" data-cancel>Cancelar</button>
        <button type="button" class="sx-button" data-validate ${state.file ? '' : 'disabled'}>Validar arquivo</button>
      </footer>`;

    const input = content.querySelector('input[type="file"]');
    input.addEventListener('change', () => {
      state.file = input.files?.[0] || null;
      state.parsed = null;
      renderModal();
    });

    content.querySelectorAll('[data-mode]').forEach(button => {
      button.addEventListener('click', async () => {
        state.mode = button.dataset.mode;
        state.settings = await updateSettings({
          kahoot: { replaceCurrent: state.mode === 'replace' }
        });
        renderModal();
      });
    });

    content.querySelector('[data-cancel]').addEventListener('click', closeModal);
    content.querySelector('[data-validate]').addEventListener('click', validateSelectedFile);
  }

  async function validateSelectedFile() {
    if (!state.file) return;

    try {
      state.parsed = parseQuestions(await state.file.text());
      state.step = 2;
      renderModal();
    } catch (error) {
      const stage = state.overlay?.querySelector('.sx-kahoot-stage');
      stage?.querySelector('.sx-status')?.remove();
      const status = document.createElement('div');
      status.className = 'sx-status sx-status--danger';
      status.textContent = error.message;
      stage?.prepend(status);
    }
  }

  function renderValidation(content) {
    const questions = state.parsed?.questions || [];
    const errors = state.parsed?.errors || [];
    const canRun = questions.length && (!state.settings.kahoot.validateBeforeRun || errors.length === 0);

    content.innerHTML = `
      ${stepper(2)}
      <section class="sx-kahoot-stage">
        <h3>Arquivo carregado</h3>
        <div class="sx-kahoot-file-card">
          <svg class="sx-icon" viewBox="0 0 24 24">
            <path d="M14 2H6a2 2 0 0 0-2 2v16h16V8Z"/>
            <path d="M14 2v6h6M8 13h8M8 17h6"/>
          </svg>
          <span>
            <b>${escapeHtml(state.file?.name || 'Arquivo CSV')}</b>
            <small>Arquivo lido com sucesso</small>
          </span>
        </div>

        <h3>Resumo da validação</h3>
        <div class="sx-kahoot-metrics">
          <span><b>${questions.length}</b>perguntas</span>
          <span><b>${questions.length * 4}</b>alternativas</span>
          <span><b>${questions.length}</b>respostas corretas</span>
          <span class="${errors.length ? 'is-error' : ''}"><b>${errors.length}</b>erros críticos</span>
        </div>

        <h3>Pré-visualização</h3>
        <div class="sx-kahoot-preview">
          ${questions.slice(0, 3).map((question, index) => `
            <div><span>${index + 1}</span><p>${escapeHtml(question.question)}</p><b>OK</b></div>
          `).join('')}
        </div>

        <div class="sx-kahoot-info">
          <b>${errors.length ? `${errors.length} problema(s) precisam ser corrigidos.` : 'Todas as colunas obrigatórias foram encontradas.'}</b>
          <span>As perguntas serão adicionadas ao quiz após a execução.</span>
        </div>
      </section>

      <footer class="sx-kahoot-actions">
        <button type="button" class="sx-button sx-button--secondary" data-back>Voltar</button>
        <button type="button" class="sx-button" data-run ${canRun ? '' : 'disabled'}>Executar importação</button>
      </footer>`;

    content.querySelector('[data-back]').addEventListener('click', () => {
      state.step = 1;
      renderModal();
    });

    content.querySelector('[data-run]').addEventListener('click', () => {
      const items = [...questions];
      closeModal();
      runImport(items);
    });
  }

  function importButtonHost() {
    const add = addQuestionButton();
    if (!add) return null;

    const create = [...document.querySelectorAll('button,[role="button"]')]
      .filter(isVisible)
      .find(element => ['create', 'criar'].includes(normalized(element.innerText || element.textContent)));

    if (create && create.parentElement === add.parentElement) {
      return { parent: create.parentElement, after: add };
    }
    return { parent: add.parentElement, after: add };
  }

  function ensureImportButton() {
    let button = document.getElementById('sx-kahoot-open');

    if (!button) {
      button = document.createElement('button');
      button.id = 'sx-kahoot-open';
      button.type = 'button';
      button.className = 'sx-kahoot-open sx-reset';
      button.innerHTML = `
        <svg class="sx-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 3v12m-5-5 5 5 5-5"/>
          <path d="M5 19h14"/>
        </svg>
        <span>Importar!</span>`;
      button.addEventListener('click', openModal);
    }

    const host = importButtonHost();

    if (host && button.parentElement !== host.parent) {
      host.after.insertAdjacentElement('afterend', button);
    } else if (!host && !button.isConnected) {
      button.classList.add('is-floating');
      document.body.appendChild(button);
    } else if (host) {
      button.classList.remove('is-floating');
    }
  }

  function scheduleButton() {
    clearTimeout(state.scanTimer);
    state.scanTimer = setTimeout(ensureImportButton, 120);
  }

  async function initialize() {
    state.settings = await getSettings();
    if (!state.settings.modules.kahoot) return;

    ensureImportButton();
    state.observer = new MutationObserver(scheduleButton);
    state.observer.observe(document.body, { childList: true, subtree: true });
  }

  initialize().catch(error => console.error('[SENAI Extensões] Kahoot:', error));
})();