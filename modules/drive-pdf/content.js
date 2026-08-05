(() => {
  'use strict';

  if (document.documentElement.dataset.sxDrivePdf === '1') return;
  document.documentElement.dataset.sxDrivePdf = '1';

  const { getSettings, escapeHtml } = SenaiExt;
  let settings;

  function collectPages() {
    const items = [];
    const seen = new Set();

    document.querySelectorAll('canvas').forEach(canvas => {
      if (canvas.width < 200 || canvas.height < 200) return;
      try {
        const src = canvas.toDataURL('image/png');
        if (!seen.has(src)) {
          seen.add(src);
          items.push({ src, width: canvas.width, height: canvas.height });
        }
      } catch { /* Canvas protegido por origem. */ }
    });

    document.querySelectorAll('img').forEach(image => {
      const src = image.currentSrc || image.src;
      const rect = image.getBoundingClientRect();
      if (!src || rect.width < 200 || rect.height < 200 || seen.has(src)) return;
      if (!/googleusercontent|drive|blob:|data:image/i.test(src)) return;
      seen.add(src);
      items.push({ src, width: image.naturalWidth || rect.width, height: image.naturalHeight || rect.height });
    });

    return items.sort((a, b) => b.width * b.height - a.width * a.height);
  }

  function openPanel() {
    document.getElementById('sx-drive-overlay')?.remove();
    const pages = collectPages();
    const overlay = document.createElement('div');
    overlay.id = 'sx-drive-overlay';
    overlay.className = 'sx-drive-overlay sx-reset';
    overlay.innerHTML = `
      <section class="sx-drive-panel sx-panel" role="dialog" aria-modal="true" aria-labelledby="sx-drive-title">
        <header><div><h2 id="sx-drive-title">Baixar PDF</h2><p>Prepare as páginas carregadas no Google Drive.</p></div><button type="button" data-close aria-label="Fechar">×</button></header>
        <div class="sx-drive-content">
          <div class="sx-drive-count"><strong>${pages.length}</strong><span>página(s) detectada(s)</span></div>
          <div class="sx-status ${pages.length ? '' : 'sx-status--warning'}">${pages.length ? 'As páginas visíveis serão organizadas para impressão.' : 'Nenhuma página foi detectada. Role o documento até o final e tente novamente.'}</div>
          <label><input type="checkbox" data-background ${settings.drivePdf.includeBackground ? 'checked' : ''}> Incluir plano de fundo</label>
          <label><input type="checkbox" data-margins ${settings.drivePdf.compactMargins ? 'checked' : ''}> Usar margens compactas</label>
        </div>
        <footer><button type="button" class="sx-button sx-button--secondary" data-close>Cancelar</button><button type="button" class="sx-button" data-print ${pages.length ? '' : 'disabled'}>Preparar PDF</button></footer>
      </section>`;
    document.body.appendChild(overlay);
    overlay.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => overlay.remove()));
    overlay.addEventListener('click', event => { if (event.target === overlay) overlay.remove(); });
    overlay.querySelector('[data-print]').addEventListener('click', () => printPages(pages, {
      background: overlay.querySelector('[data-background]').checked,
      compact: overlay.querySelector('[data-margins]').checked
    }));
  }

  function printPages(pages, options) {
    const popup = window.open('', '_blank', 'noopener,noreferrer');
    if (!popup) {
      alert('Permita pop-ups para preparar o PDF.');
      return;
    }
    const title = String(document.title || 'Documento').replace(/\s+-\s+Google Drive.*$/i, '').trim();
    popup.document.open();
    popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
      @page{size:A4 portrait;margin:${options.compact ? '6mm' : '12mm'}}
      *{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff;font-family:Arial,sans-serif}
      .page{width:100%;min-height:250mm;display:flex;align-items:center;justify-content:center;page-break-after:always;break-after:page;overflow:hidden}
      .page:last-child{page-break-after:auto}.page img{display:block;max-width:100%;max-height:275mm;object-fit:contain}
      ${options.background ? '*{-webkit-print-color-adjust:exact;print-color-adjust:exact}' : ''}
    </style></head><body>${pages.map((page, index) => `<section class="page"><img src="${escapeHtml(page.src)}" alt="Página ${index + 1}"></section>`).join('')}<script>window.addEventListener('load',()=>setTimeout(()=>window.print(),500));<\/script></body></html>`);
    popup.document.close();
    document.getElementById('sx-drive-overlay')?.remove();
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
