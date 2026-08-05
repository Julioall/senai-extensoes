(() => {
  'use strict';

  if (document.documentElement.dataset.sxDrivePdf === '1') return;
  document.documentElement.dataset.sxDrivePdf = '1';

  const { getSettings, downloadBlob, sleep } = SenaiExt;
  let settings;
  let running = false;
  let cancelled = false;
  function collectPages() {
    const pages = [];
    const seen = new Set();
    const elements = [...document.querySelectorAll('img,canvas')];

    elements.forEach(element => {
      if (element instanceof HTMLCanvasElement) {
        if (element.width < 300 || element.height < 300) return;
        const key = `canvas:${element.width}x${element.height}:${pages.length}`;
        pages.push({ type: 'canvas', element, width: element.width, height: element.height, key });
        return;
      }

      const src = element.currentSrc || element.src || '';
      const width = element.naturalWidth || element.getBoundingClientRect().width;
      const height = element.naturalHeight || element.getBoundingClientRect().height;
      if (!src || width < 300 || height < 300) return;
      if (!src.startsWith('blob:https://drive.google.com/') && !/googleusercontent|drive\.google\.com|data:image/i.test(src)) return;
      if (seen.has(src)) return;
      seen.add(src);
      pages.push({ type: 'image', element, src, width, height, key: src });
    });

    return pages;
  }

  async function pageCanvas(page, includeBackground) {
    if (page.type === 'image' && (!page.element.complete || !page.element.naturalWidth)) {
      await new Promise(resolve => {
        const done = () => resolve();
        page.element.addEventListener('load', done, { once: true });
        page.element.addEventListener('error', done, { once: true });
        setTimeout(done, 5000);
      });
    }

    const sourceWidth = page.type === 'canvas' ? page.element.width : page.element.naturalWidth;
    const sourceHeight = page.type === 'canvas' ? page.element.height : page.element.naturalHeight;
    if (!sourceWidth || !sourceHeight) throw new Error('Uma das páginas ainda não terminou de carregar.');

    const canvas = document.createElement('canvas');
    canvas.width = sourceWidth;
    canvas.height = sourceHeight;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('Não foi possível preparar a imagem da página.');
    if (!includeBackground) {
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    context.drawImage(page.element, 0, 0, sourceWidth, sourceHeight);
    return canvas;
  }

  function documentName() {
    const title = String(document.title || 'Documento')
      .replace(/\s+-\s+Google Drive.*$/i, '')
      .replace(/[\\/:*?"<>|]/g, '-')
      .trim();
    return title || 'Documento';
  }

  function dataUrlBytes(dataUrl) {
    const base64 = String(dataUrl).split(',')[1] || '';
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }

  function concatBytes(parts) {
    const size = parts.reduce((sum, part) => sum + part.length, 0);
    const output = new Uint8Array(size);
    let offset = 0;
    parts.forEach(part => {
      output.set(part, offset);
      offset += part.length;
    });
    return output;
  }

  function createPdf(images, compactMargins) {
    const encoder = new TextEncoder();
    const pageWidth = 595.28;
    const pageHeight = 841.89;
    const margin = compactMargins ? 18 : 34;
    const objects = new Map();
    const pageReferences = images.map((_, index) => `${3 + index * 3} 0 R`).join(' ');

    objects.set(1, encoder.encode('<< /Type /Catalog /Pages 2 0 R >>'));
    objects.set(2, encoder.encode(`<< /Type /Pages /Count ${images.length} /Kids [${pageReferences}] >>`));

    images.forEach((image, index) => {
      const pageObject = 3 + index * 3;
      const imageObject = pageObject + 1;
      const contentObject = pageObject + 2;
      const availableWidth = pageWidth - margin * 2;
      const availableHeight = pageHeight - margin * 2;
      const scale = Math.min(availableWidth / image.width, availableHeight / image.height);
      const width = image.width * scale;
      const height = image.height * scale;
      const x = (pageWidth - width) / 2;
      const y = (pageHeight - height) / 2;
      const imageName = `Im${index + 1}`;
      const content = encoder.encode(`q ${width.toFixed(3)} 0 0 ${height.toFixed(3)} ${x.toFixed(3)} ${y.toFixed(3)} cm /${imageName} Do Q`);

      objects.set(pageObject, encoder.encode(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /${imageName} ${imageObject} 0 R >> >> /Contents ${contentObject} 0 R >>`
      ));
      objects.set(imageObject, concatBytes([
        encoder.encode(`<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.bytes.length} >>\nstream\n`),
        image.bytes,
        encoder.encode('\nendstream')
      ]));
      objects.set(contentObject, concatBytes([
        encoder.encode(`<< /Length ${content.length} >>\nstream\n`),
        content,
        encoder.encode('\nendstream')
      ]));
    });

    const header = new Uint8Array([0x25,0x50,0x44,0x46,0x2D,0x31,0x2E,0x34,0x0A,0x25,0xE2,0xE3,0xCF,0xD3,0x0A]);
    const parts = [header];
    const offsets = [0];
    let length = header.length;
    const maxObject = 2 + images.length * 3;

    for (let number = 1; number <= maxObject; number += 1) {
      offsets[number] = length;
      const object = concatBytes([
        encoder.encode(`${number} 0 obj\n`),
        objects.get(number),
        encoder.encode('\nendobj\n')
      ]);
      parts.push(object);
      length += object.length;
    }

    const xrefOffset = length;
    const xrefLines = [`xref\n0 ${maxObject + 1}\n`, '0000000000 65535 f \n'];
    for (let number = 1; number <= maxObject; number += 1) {
      xrefLines.push(`${String(offsets[number]).padStart(10, '0')} 00000 n \n`);
    }
    const trailer = `trailer\n<< /Size ${maxObject + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
    parts.push(encoder.encode(xrefLines.join('')));
    parts.push(encoder.encode(trailer));
    return new Blob(parts, { type: 'application/pdf' });
  }

  function updatePanel(overlay, current, total, message, tone = 'info') {
    const status = overlay.querySelector('[data-status]');
    const progress = overlay.querySelector('[data-progress]');
    const count = overlay.querySelector('[data-progress-count]');
    if (status) {
      status.className = `sx-status ${tone === 'success' ? 'sx-status--success' : tone === 'danger' ? 'sx-status--danger' : tone === 'warning' ? 'sx-status--warning' : ''}`;
      status.textContent = message;
    }
    if (progress) progress.style.width = `${total ? Math.round(current / total * 100) : 0}%`;
    if (count) count.textContent = total ? `${current}/${total}` : '';
  }

  async function generatePdf(pages, options, overlay) {
    if (running) return;
    running = true;
    cancelled = false;
    const prepare = overlay.querySelector('[data-generate]');
    const cancel = overlay.querySelector('[data-cancel]');
    prepare.disabled = true;
    cancel.textContent = 'Interromper';

    try {
      updatePanel(overlay, 0, pages.length, 'Preparando as imagens do documento…');
      const rendered = [];

      for (let index = 0; index < pages.length; index += 1) {
        if (cancelled) throw new DOMException('Geração cancelada.', 'AbortError');
        updatePanel(overlay, index, pages.length, `Processando página ${index + 1} de ${pages.length}…`);
        let canvas;
        try {
          canvas = await pageCanvas(pages[index], options.background);
        } catch (error) {
          console.warn('[SENAI Extensões] Página ignorada:', error);
          continue;
        }

        const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
        rendered.push({ bytes: dataUrlBytes(dataUrl), width: canvas.width, height: canvas.height });
        updatePanel(overlay, index + 1, pages.length, `Página ${index + 1} preparada.`);
        await sleep(20);
      }

      if (!rendered.length) throw new Error('Nenhuma página pôde ser convertida. Role o documento até o final e tente novamente.');
      updatePanel(overlay, pages.length, pages.length, 'Montando o arquivo PDF…');
      downloadBlob(createPdf(rendered, options.compact), `${documentName()}.pdf`);
      updatePanel(overlay, pages.length, pages.length, `PDF criado com ${rendered.length} página(s). O download foi iniciado.`, 'success');
      cancel.textContent = 'Fechar';
      cancel.onclick = () => overlay.remove();
    } catch (error) {
      const aborted = error?.name === 'AbortError';
      updatePanel(overlay, 0, pages.length, aborted ? 'Criação do PDF cancelada.' : `Não foi possível criar o PDF: ${error.message}`, aborted ? 'warning' : 'danger');
      cancel.textContent = 'Fechar';
      cancel.onclick = () => overlay.remove();
      prepare.disabled = false;
    } finally {
      running = false;
    }
  }

  function openPanel() {
    document.getElementById('sx-drive-overlay')?.remove();
    const pages = collectPages();
    const overlay = document.createElement('div');
    overlay.id = 'sx-drive-overlay';
    overlay.className = 'sx-drive-overlay sx-reset';
    overlay.innerHTML = `
      <section class="sx-drive-panel sx-panel" role="dialog" aria-modal="true" aria-labelledby="sx-drive-title">
        <header><div><h2 id="sx-drive-title">Baixar PDF</h2><p>Converta as páginas carregadas no Google Drive em um arquivo PDF.</p></div><button type="button" data-close aria-label="Fechar">×</button></header>
        <div class="sx-drive-content">
          <div class="sx-drive-count"><strong>${pages.length}</strong><span>página(s) detectada(s)</span></div>
          <div class="sx-status ${pages.length ? '' : 'sx-status--warning'}" data-status>${pages.length ? 'As páginas serão convertidas diretamente, sem abrir uma guia em branco.' : 'Nenhuma página foi detectada. Role o documento até o final e tente novamente.'}</div>
          <div class="sx-drive-progress"><span data-progress></span></div><small class="sx-drive-progress-count" data-progress-count></small>
          <label><input type="checkbox" data-background ${settings.drivePdf.includeBackground ? 'checked' : ''}> Manter o conteúdo completo das páginas</label>
          <label><input type="checkbox" data-margins ${settings.drivePdf.compactMargins ? 'checked' : ''}> Usar margens compactas</label>
        </div>
        <footer><button type="button" class="sx-button sx-button--secondary" data-cancel>Cancelar</button><button type="button" class="sx-button" data-generate ${pages.length ? '' : 'disabled'}>Criar e baixar PDF</button></footer>
      </section>`;
    document.body.appendChild(overlay);

    const close = () => {
      if (running) {
        cancelled = true;
        updatePanel(overlay, 0, pages.length, 'Cancelando após a página atual…', 'warning');
      } else {
        overlay.remove();
      }
    };
    overlay.querySelector('[data-close]').addEventListener('click', close);
    overlay.querySelector('[data-cancel]').addEventListener('click', close);
    overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
    overlay.querySelector('[data-generate]').addEventListener('click', () => generatePdf(pages, {
      background: overlay.querySelector('[data-background]').checked,
      compact: overlay.querySelector('[data-margins]').checked
    }, overlay));
  }

  function installButton() {
    if (document.getElementById('sx-drive-open')) return;
    const button = document.createElement('button');
    button.id = 'sx-drive-open';
    button.className = 'sx-drive-open sx-button sx-reset';
    button.type = 'button';
    button.innerHTML = '<span>PDF</span> Baixar PDF';
    button.addEventListener('click', openPanel);
    document.body.appendChild(button);
  }

  async function initialize() {
    settings = await getSettings();
    if (!settings.modules.drivePdf) return;
    installButton();
  }

  initialize().catch(console.error);
})();
