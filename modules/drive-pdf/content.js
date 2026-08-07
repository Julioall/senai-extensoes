(() => {
  'use strict';

  if (document.documentElement.dataset.sxDrivePdf === '1') return;
  document.documentElement.dataset.sxDrivePdf = '1';

  const { getSettings, downloadBlob, sleep } = SenaiExt;
  const registry = new Map();
  let settings;
  let button;
  let running = false;
  let cancelled = false;
  let discoveryIndex = 0;
  let scanTimer;

  function clean(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function detectTotalPages() {
    let total = 0;
    const candidates = document.querySelectorAll('[aria-label],[title],[data-tooltip],span,div');
    for (const element of candidates) {
      if (element.children.length > 4) continue;
      const values = [element.textContent, element.getAttribute('aria-label'), element.getAttribute('title'), element.getAttribute('data-tooltip')];
      for (const value of values) {
        const match = clean(value).match(/(?:^|\s)(\d{1,5})\s*\/\s*(\d{1,5})(?:\s|$)/);
        if (!match) continue;
        const denominator = Number(match[2]);
        if (denominator > total && denominator < 20000) total = denominator;
      }
    }
    return total;
  }

  function pageNumberFor(element) {
    let current = element;
    for (let depth = 0; current && depth < 8; depth += 1, current = current.parentElement) {
      const direct = current.dataset?.pageNumber || current.dataset?.pageIndex;
      if (/^\d+$/.test(direct || '')) return Number(direct) + (current.dataset.pageIndex ? 1 : 0);
      const values = [current.getAttribute?.('aria-label'), current.getAttribute?.('title'), current.textContent];
      for (const value of values) {
        const match = clean(value).match(/(?:página|pagina|page)\s*(\d{1,5})/i);
        if (match) return Number(match[1]);
      }
    }
    return null;
  }

  function registerImage(image) {
    const src = image.currentSrc || image.src || '';
    const width = image.naturalWidth || image.getBoundingClientRect().width;
    const height = image.naturalHeight || image.getBoundingClientRect().height;
    if (!src || width < 420 || height < 420) return;
    if (!src.startsWith('blob:https://drive.google.com/') && !/googleusercontent|drive\.google\.com|data:image/i.test(src)) return;
    const number = pageNumberFor(image);
    const key = number ? `page:${number}` : `image:${src}`;
    if (registry.has(key)) return;
    registry.set(key, { type: 'image', src, element: image, width, height, number, discovered: discoveryIndex++ });
  }

  function registerCanvas(canvas) {
    if (canvas.width < 420 || canvas.height < 420) return;
    const number = pageNumberFor(canvas);
    const key = number ? `page:${number}` : `canvas:${canvas.width}x${canvas.height}:${discoveryIndex}`;
    if (registry.has(key)) return;
    try {
      registry.set(key, {
        type: 'data',
        src: canvas.toDataURL('image/jpeg', .94),
        width: canvas.width,
        height: canvas.height,
        number,
        discovered: discoveryIndex++
      });
    } catch {
      // Canvas protegido por origem. O visualizador poderá disponibilizar a página como imagem depois.
    }
  }

  function scanPages() {
    document.querySelectorAll('img').forEach(registerImage);
    document.querySelectorAll('canvas').forEach(registerCanvas);
    updateButton();
  }

  function orderedPages() {
    return [...registry.values()].sort((left, right) => {
      if (left.number && right.number) return left.number - right.number;
      if (left.number) return -1;
      if (right.number) return 1;
      return left.discovered - right.discovered;
    });
  }

  function pageProgress() {
    const detected = registry.size;
    const total = Math.max(detectTotalPages(), detected);
    return { detected, total, percentage: total ? Math.min(100, Math.round(detected / total * 1000) / 10) : 0 };
  }

  function updateButton(processed = null, processingTotal = null) {
    if (!button) return;
    const progress = pageProgress();
    const current = processed === null ? progress.detected : processed;
    const total = processingTotal || progress.total || progress.detected;
    const percentage = processed === null ? progress.percentage : (total ? Math.min(100, current / total * 100) : 0);
    button.style.setProperty('--sx-drive-progress', `${percentage}%`);
    button.querySelector('[data-count]').textContent = `${current}/${total || 0}`;
    button.querySelector('[data-label]').textContent = running ? (cancelled ? 'Cancelando' : 'Baixando') : 'Baixar';
    button.title = progress.detected < progress.total
      ? `${progress.detected} de ${progress.total} páginas identificadas. Role o documento para carregar as demais.`
      : `${progress.detected} página(s) identificada(s).`;
  }

  function toast(message, tone = '') {
    document.getElementById('sx-drive-toast')?.remove();
    const element = document.createElement('div');
    element.id = 'sx-drive-toast';
    element.className = `sx-drive-toast sx-reset ${tone ? `is-${tone}` : ''}`;
    element.textContent = message;
    document.body.appendChild(element);
    setTimeout(() => element.remove(), 5500);
  }

  function documentName() {
    const title = String(document.title || 'Documento')
      .replace(/\s+-\s+Google Drive.*$/i, '')
      .replace(/[\\/:*?"<>|]/g, '-')
      .trim();
    return title || 'Documento';
  }

  async function imageFromSource(page) {
    if (page.element?.isConnected && page.element.complete && page.element.naturalWidth) return page.element;
    const image = new Image();
    image.decoding = 'async';
    image.src = page.src;
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error('Não foi possível carregar uma página identificada.'));
      setTimeout(() => reject(new Error('Tempo esgotado ao carregar uma página.')), 10000);
    });
    return image;
  }

  async function pageCanvas(page) {
    const source = await imageFromSource(page);
    const width = source.naturalWidth || page.width;
    const height = source.naturalHeight || page.height;
    if (!width || !height) throw new Error('Página sem dimensões válidas.');
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { alpha: false });
    context.fillStyle = '#fff';
    context.fillRect(0, 0, width, height);
    context.drawImage(source, 0, 0, width, height);
    return canvas;
  }

  function dataUrlBytes(dataUrl) {
    const binary = atob(String(dataUrl).split(',')[1] || '');
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }

  function concatBytes(parts) {
    const size = parts.reduce((sum, part) => sum + part.length, 0);
    const output = new Uint8Array(size);
    let offset = 0;
    parts.forEach(part => { output.set(part, offset); offset += part.length; });
    return output;
  }

  function createPdf(images) {
    const encoder = new TextEncoder();
    const pageWidth = 595.28;
    const pageHeight = 841.89;
    const margin = 8;
    const objects = new Map();
    const references = images.map((_, index) => `${3 + index * 3} 0 R`).join(' ');
    objects.set(1, encoder.encode('<< /Type /Catalog /Pages 2 0 R >>'));
    objects.set(2, encoder.encode(`<< /Type /Pages /Count ${images.length} /Kids [${references}] >>`));

    images.forEach((image, index) => {
      const pageObject = 3 + index * 3;
      const imageObject = pageObject + 1;
      const contentObject = pageObject + 2;
      const scale = Math.min((pageWidth - margin * 2) / image.width, (pageHeight - margin * 2) / image.height);
      const width = image.width * scale;
      const height = image.height * scale;
      const x = (pageWidth - width) / 2;
      const y = (pageHeight - height) / 2;
      const name = `Im${index + 1}`;
      const content = encoder.encode(`q ${width.toFixed(3)} 0 0 ${height.toFixed(3)} ${x.toFixed(3)} ${y.toFixed(3)} cm /${name} Do Q`);
      objects.set(pageObject, encoder.encode(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /${name} ${imageObject} 0 R >> >> /Contents ${contentObject} 0 R >>`));
      objects.set(imageObject, concatBytes([
        encoder.encode(`<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.bytes.length} >>\nstream\n`),
        image.bytes,
        encoder.encode('\nendstream')
      ]));
      objects.set(contentObject, concatBytes([
        encoder.encode(`<< /Length ${content.length} >>\nstream\n`), content, encoder.encode('\nendstream')
      ]));
    });

    const header = new Uint8Array([0x25,0x50,0x44,0x46,0x2D,0x31,0x2E,0x34,0x0A,0x25,0xE2,0xE3,0xCF,0xD3,0x0A]);
    const parts = [header];
    const offsets = [0];
    let length = header.length;
    const maxObject = 2 + images.length * 3;
    for (let number = 1; number <= maxObject; number += 1) {
      offsets[number] = length;
      const object = concatBytes([encoder.encode(`${number} 0 obj\n`), objects.get(number), encoder.encode('\nendobj\n')]);
      parts.push(object);
      length += object.length;
    }
    const xrefOffset = length;
    const lines = [`xref\n0 ${maxObject + 1}\n`, '0000000000 65535 f \n'];
    for (let number = 1; number <= maxObject; number += 1) lines.push(`${String(offsets[number]).padStart(10, '0')} 00000 n \n`);
    parts.push(encoder.encode(lines.join('')));
    parts.push(encoder.encode(`trailer\n<< /Size ${maxObject + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`));
    return new Blob(parts, { type: 'application/pdf' });
  }

  async function generate() {
    if (running) {
      cancelled = true;
      updateButton();
      return;
    }
    const pages = orderedPages();
    if (!pages.length) {
      toast('Nenhuma página foi identificada. Role o documento para carregar as páginas.', 'warning');
      return;
    }

    running = true;
    cancelled = false;
    button.disabled = false;
    const rendered = [];
    const totalKnown = pageProgress().total;
    if (pages.length < totalKnown) toast(`O PDF será criado com ${pages.length} de ${totalKnown} páginas identificadas.`, 'warning');

    try {
      for (let index = 0; index < pages.length; index += 1) {
        if (cancelled) throw new DOMException('Download cancelado.', 'AbortError');
        updateButton(index, pages.length);
        try {
          const canvas = await pageCanvas(pages[index]);
          rendered.push({ bytes: dataUrlBytes(canvas.toDataURL('image/jpeg', .94)), width: canvas.width, height: canvas.height });
        } catch (error) {
          console.warn('[SENAI Extensões] Página ignorada:', error);
        }
        await sleep(12);
      }
      if (!rendered.length) throw new Error('Nenhuma página pôde ser convertida.');
      updateButton(pages.length, pages.length);
      downloadBlob(createPdf(rendered), `${documentName()}.pdf`);
      toast(`PDF criado com ${rendered.length} página(s).`, 'success');
    } catch (error) {
      toast(error?.name === 'AbortError' ? 'Criação do PDF cancelada.' : `Não foi possível criar o PDF: ${error.message}`, error?.name === 'AbortError' ? 'warning' : 'danger');
    } finally {
      running = false;
      cancelled = false;
      button.disabled = false;
      updateButton();
    }
  }

  function installButton() {
    if (document.getElementById('sx-drive-open')) return;
    button = document.createElement('button');
    button.id = 'sx-drive-open';
    button.type = 'button';
    button.className = 'sx-drive-open sx-reset';
    button.innerHTML = `
      <span class="sx-drive-open__icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 3v12m-5-5 5 5 5-5"/><path d="M5 19h14"/></svg></span>
      <span class="sx-drive-open__label" data-label>Baixar</span>
      <span class="sx-drive-open__count" data-count>0/0</span>`;
    button.addEventListener('click', generate);
    document.body.appendChild(button);
    updateButton();
  }

  function scheduleScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scanPages, 120);
  }

  async function initialize() {
    settings = await getSettings();
    if (!settings.modules.drivePdf) return;
    installButton();
    scanPages();
    new MutationObserver(scheduleScan).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'aria-label'] });
    setInterval(scanPages, 1500);
  }

  initialize().catch(error => console.error('[SENAI Extensões/Drive]', error));
})();
