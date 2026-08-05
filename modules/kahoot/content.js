(() => {
  'use strict';

  if (document.documentElement.dataset.sxKahoot === '1') return;
  document.documentElement.dataset.sxKahoot = '1';

  const { getSettings, parseDelimited, setNativeValue, sleep, escapeHtml } = SenaiExt;
  let settings;
  let cancelled = false;

  const HEADERS = {
    question: ['pergunta', 'question'],
    answers: [
      ['opcao1', 'opção1', 'resposta1', 'answer1'],
      ['opcao2', 'opção2', 'resposta2', 'answer2'],
      ['opcao3', 'opção3', 'resposta3', 'answer3'],
      ['opcao4', 'opção4', 'resposta4', 'answer4']
    ],
    correct: ['correta', 'correto', 'correct', 'resposta correta']
  };

  const normal = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();

  function column(headers, aliases) {
    return headers.findIndex(header => aliases.map(normal).includes(normal(header)));
  }

  function parseQuestions(text) {
    const rows = parseDelimited(text);
    if (rows.length < 2) throw new Error('O arquivo não contém perguntas.');
    const headers = rows[0];
    const indexes = {
      question: column(headers, HEADERS.question),
      answers: HEADERS.answers.map(aliases => column(headers, aliases)),
      correct: column(headers, HEADERS.correct)
    };
    if (indexes.question < 0 || indexes.answers.some(index => index < 0) || indexes.correct < 0) {
      throw new Error('Use as colunas: pergunta, opcao1, opcao2, opcao3, opcao4 e correta.');
    }
    const questions = rows.slice(1).map((row, index) => ({
      number: index + 1,
      question: row[indexes.question] || '',
      answers: indexes.answers.map(columnIndex => row[columnIndex] || ''),
      correct: Number(String(row[indexes.correct] || '').replace(/[^1-4]/g, ''))
    })).filter(item => item.question || item.answers.some(Boolean));
    const invalid = questions.filter(item => !item.question || item.answers.filter(Boolean).length < 2 || item.correct < 1 || item.correct > 4);
    return { questions, invalid };
  }

  function findQuestionInput() {
    return document.querySelector('[data-functional-selector*="question"] textarea,[data-functional-selector*="question"] input,textarea[placeholder*="question" i],textarea[placeholder*="pergunta" i]');
  }

  function findAnswerInputs() {
    const direct = [...document.querySelectorAll('[data-functional-selector*="answer"] textarea,[data-functional-selector*="answer"] input')]
      .filter(input => input.offsetParent && !/question/i.test(input.getAttribute('data-functional-selector') || ''));
    if (direct.length >= 2) return direct.slice(0, 4);
    return [...document.querySelectorAll('textarea,input[type="text"]')]
      .filter(input => input.offsetParent && input !== findQuestionInput())
      .slice(0, 4);
  }

  function correctButtons() {
    const buttons = [...document.querySelectorAll('[data-functional-selector*="correct"],button[aria-label*="correct" i],button[aria-label*="correta" i]')]
      .filter(element => element.offsetParent);
    return buttons.slice(0, 4);
  }

  async function fillQuestion(item) {
    const questionInput = findQuestionInput();
    const answerInputs = findAnswerInputs();
    if (!questionInput || answerInputs.length < 2) throw new Error('Os campos da pergunta não foram localizados no editor atual.');
    setNativeValue(questionInput, item.question);
    answerInputs.forEach((input, index) => setNativeValue(input, item.answers[index] || ''));
    await sleep(200);
    const buttons = correctButtons();
    buttons[item.correct - 1]?.click();
  }

  function addQuestionButton() {
    return document.querySelector('[data-functional-selector="add-question-button"],[data-functional-selector*="add-question"],button[aria-label*="add question" i],button[aria-label*="adicionar pergunta" i]');
  }

  async function addNextQuestion() {
    const button = addQuestionButton();
    if (!button) throw new Error('O botão para adicionar uma pergunta não foi localizado.');
    button.click();
    await sleep(settings.kahoot.delayMs);
    const quizType = [...document.querySelectorAll('button,[role="button"]')].find(element => /quiz|questionário|pergunta de quiz/i.test(element.textContent || ''));
    if (quizType?.offsetParent) {
      quizType.click();
      await sleep(settings.kahoot.delayMs);
    }
  }

  function openPanel() {
    document.getElementById('sx-kahoot-overlay')?.remove();
    cancelled = false;
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
        <footer><button type="button" class="sx-button sx-button--secondary" data-cancel>Cancelar</button><button type="button" class="sx-button" data-run disabled>Importar perguntas</button></footer>
      </section>`;
    document.body.appendChild(overlay);
    const input = overlay.querySelector('input[type="file"]');
    let parsed = null;
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        parsed = parseQuestions(await file.text());
        const status = overlay.querySelector('[data-status]');
        const run = overlay.querySelector('[data-run]');
        status.className = `sx-status ${parsed.invalid.length ? 'sx-status--warning' : 'sx-status--success'}`;
        status.textContent = `${parsed.questions.length} pergunta(s) encontrada(s). ${parsed.invalid.length ? `${parsed.invalid.length} precisam de correção.` : 'Arquivo válido.'}`;
        const preview = overlay.querySelector('[data-preview]');
        preview.hidden = false;
        preview.innerHTML = parsed.questions.slice(0, 5).map(item => `<div><b>${item.number}.</b> ${escapeHtml(item.question || 'Pergunta vazia')}</div>`).join('');
        run.disabled = !parsed.questions.length || (settings.kahoot.validateBeforeRun && parsed.invalid.length > 0);
      } catch (error) {
        parsed = null;
        const status = overlay.querySelector('[data-status]');
        status.className = 'sx-status sx-status--danger';
        status.textContent = error.message;
        overlay.querySelector('[data-run]').disabled = true;
      }
    });
    overlay.querySelector('[data-run]').addEventListener('click', () => runImport(parsed.questions, overlay));
    overlay.querySelector('[data-cancel]').addEventListener('click', () => {
      cancelled = true;
      overlay.remove();
    });
    overlay.querySelector('[data-close]').addEventListener('click', () => { cancelled = true; overlay.remove(); });
    overlay.addEventListener('click', event => { if (event.target === overlay) { cancelled = true; overlay.remove(); } });
  }

  async function runImport(questions, overlay) {
    const run = overlay.querySelector('[data-run]');
    const cancel = overlay.querySelector('[data-cancel]');
    const status = overlay.querySelector('[data-status]');
    run.disabled = true;
    cancel.textContent = 'Interromper';
    let completed = 0;
    try {
      for (let index = 0; index < questions.length; index += 1) {
        if (cancelled) throw new DOMException('Importação cancelada', 'AbortError');
        status.className = 'sx-status';
        status.textContent = `Importando ${index + 1} de ${questions.length}: ${questions[index].question}`;
        if (index > 0 || !settings.kahoot.replaceCurrent) await addNextQuestion();
        await fillQuestion(questions[index]);
        completed += 1;
        await sleep(settings.kahoot.delayMs);
      }
      status.className = 'sx-status sx-status--success';
      status.textContent = `${completed} pergunta(s) preenchida(s). Revise o Kahoot antes de publicar.`;
    } catch (error) {
      status.className = `sx-status ${error.name === 'AbortError' ? 'sx-status--warning' : 'sx-status--danger'}`;
      status.textContent = error.name === 'AbortError' ? `Importação interrompida após ${completed} pergunta(s).` : `Falha após ${completed} pergunta(s): ${error.message}`;
    } finally {
      cancel.textContent = 'Fechar';
    }
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
