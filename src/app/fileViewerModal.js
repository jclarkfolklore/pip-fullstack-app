// Larger modal for previewing a non-image attachment (PDF, DOCX, ...).
//
// An <iframe> pointed at the raw route sounds simpler, but Chromium's built-in
// PDF viewer renders solid black inside a flexbox container that resizes
// after the iframe has already loaded — exactly the situation a modal is. So
// PDFs are rendered ourselves with pdfjs-dist, straight to <canvas>, which
// sidesteps that entirely and also means we control zoom. DOCX has no
// in-browser renderer at all, so it goes through mammoth to real HTML first.
// Everything else still has no renderer without pulling in a third-party
// viewer (uploading the document to one is exactly what PIP's attachment
// model exists to avoid), so it falls back to a plain card.

import * as pdfjsLib from 'pdfjs-dist';
import mammoth from 'mammoth';
import { h, wrapProseTables } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { openModal } from './modal.js';

// Not the .min.mjs build: pdfjs-dist 6.2.108's own minifier output trips a
// "Private field must be declared in an enclosing class" SyntaxError on at
// least one real engine — a bug in their minification, not in this code (the
// unminified build parses and runs fine, confirmed by importing it directly).
// The size difference doesn't matter for a local, personal tool.
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url
).toString();

// mammoth reads the OOXML (.docx) zip format only — legacy binary .doc has
// no in-browser renderer, so it stays on the generic fallback below.
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const MIN_SCALE = 0.5;
const MAX_SCALE = 2.6;

function downloadUrl(src) {
  return `${src}${src.includes('?') ? '&' : '?'}download=1`;
}

function fallback(icon_, text) {
  return h('div', { class: 'pip-fileviewer-fallback' }, [
    icon(icon_, { size: 32 }),
    h('div', { class: 'pip-fileviewer-fallback-text' }, text)
  ]);
}

// Renders every page as its own canvas, stacked — a plain scroll rather than
// a pager, since that's how a document reads and it means no page-count UI
// to keep in sync with render state.
async function renderPdf(host, bytes, zoomOutBtn, zoomInBtn) {
  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
  let scale = 1.2;

  const pagesHost = h('div', { class: 'pip-fileviewer-pages' });
  host.appendChild(pagesHost);

  async function renderAll() {
    pagesHost.replaceChildren();
    for (let i = 1; i <= pdf.numPages; i += 1) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.className = 'pip-fileviewer-page';
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      pagesHost.appendChild(canvas);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    }
  }

  await renderAll();

  zoomOutBtn.addEventListener('click', () => {
    scale = Math.max(MIN_SCALE, scale - 0.2);
    renderAll();
  });
  zoomInBtn.addEventListener('click', () => {
    scale = Math.min(MAX_SCALE, scale + 0.2);
    renderAll();
  });
}

async function renderDocx(host, bytes) {
  const { value: htmlStr } = await mammoth.convertToHtml({ arrayBuffer: bytes });
  host.appendChild(wrapProseTables(h('div', { class: 'pip-fileviewer-docx pip-prose', html: htmlStr })));
}

export function openFileModal(attachment) {
  const isPdf = attachment.mime === 'application/pdf';
  const isDocx = attachment.mime === DOCX_MIME;

  const body = h('div', { class: 'pip-fileviewer-body' });
  body.appendChild(h('div', { class: 'pip-fileviewer-fallback' }, 'Loading preview…'));

  const openBtn = h('button', { class: 'pip-action-btn pip-action-btn--ghost' }, [
    icon('external', { size: 10 }),
    ' OPEN IN NEW TAB'
  ]);
  openBtn.addEventListener('click', () => window.open(attachment.src, '_blank', 'noopener'));

  const downloadBtn = h('button', { class: 'pip-action-btn' }, [icon('download', { size: 10 }), ' DOWNLOAD']);
  downloadBtn.addEventListener('click', () => {
    const a = h('a', { href: downloadUrl(attachment.src), download: attachment.title || 'attachment' });
    document.body.appendChild(a);
    a.click();
    a.remove();
  });

  const footerButtons = [];
  let zoomOutBtn = null;
  let zoomInBtn = null;
  if (isPdf) {
    zoomOutBtn = h('button', { class: 'pip-action-btn pip-action-btn--ghost' }, '−');
    zoomInBtn = h('button', { class: 'pip-action-btn pip-action-btn--ghost' }, '+');
    footerButtons.push(zoomOutBtn, zoomInBtn);
  }
  footerButtons.push(openBtn, downloadBtn);

  const modal = openModal({
    title: attachment.title || 'Document',
    size: 'large',
    body: [body],
    footer: h('div', { class: 'pip-fileviewer-actions' }, footerButtons)
  });

  (async () => {
    try {
      const res = await fetch(attachment.src);
      if (!res.ok) throw new Error(`fetch failed (${res.status})`);
      const bytes = await res.arrayBuffer();
      body.replaceChildren();
      if (isPdf) {
        await renderPdf(body, new Uint8Array(bytes), zoomOutBtn, zoomInBtn);
      } else if (isDocx) {
        await renderDocx(body, bytes);
      } else {
        body.appendChild(
          fallback('note', 'No inline preview for this file type — open it in a new tab or download it.')
        );
      }
    } catch (err) {
      body.replaceChildren();
      body.appendChild(
        fallback(
          'alert',
          `Couldn't render a preview (${err.message}) — open it in a new tab or download it instead.`
        )
      );
    }
  })();

  return modal;
}
