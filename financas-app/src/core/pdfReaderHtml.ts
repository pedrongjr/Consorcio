/**
 * Página HTML carregada num WebView invisível que lê PDFs (pdf.js) e faz OCR
 * de PDFs escaneados e fotos de extrato (Tesseract.js, em português).
 *
 * Tudo roda no aparelho. A internet só é usada para baixar as bibliotecas e o
 * modelo de português na primeira vez (o WebView guarda em cache).
 *
 * Mensagens enviadas ao React Native (JSON):
 *   { type: 'ready' }
 *   { type: 'progress', id, stage: 'text' | 'ocr-init' | 'ocr', page?, total?, progress? }
 *   { type: 'result', id, pages: PdfTextItem[][], ocr: boolean }
 *   { type: 'password', id, wrong: boolean }
 *   { type: 'error', id?, message }
 */

export interface ReaderUrls {
  pdfjs: string;
  pdfjsWorker: string;
  tesseract: string;
  tesseractWorker: string;
  tesseractCore: string;
  /** Pasta com `por.traineddata.gz`. */
  tesseractLang: string;
}

export const DEFAULT_READER_URLS: ReaderUrls = {
  pdfjs: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  pdfjsWorker: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
  tesseract: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js',
  tesseractWorker: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js',
  tesseractCore: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1',
  tesseractLang: 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/por@1.0.0/4.0.0_best_int',
};

/** Abaixo desta média de caracteres por página, o PDF é tratado como imagem. */
export const SCANNED_CHARS_PER_PAGE = 40;
/** Limite de páginas para OCR (cada página leva alguns segundos no celular). */
export const MAX_OCR_PAGES = 20;

export interface ReaderOptions {
  /**
   * `native` (padrão): fala com o React Native (`ReactNativeWebView.postMessage`
   * e `injectJavaScript`). `parent`: roda num iframe da versão web e conversa com
   * a página por `postMessage`.
   */
  bridge?: 'native' | 'parent';
}

export function buildReaderHtml(urls: ReaderUrls = DEFAULT_READER_URLS, opts: ReaderOptions = {}): string {
  const cfg = JSON.stringify({ ...urls, scannedChars: SCANNED_CHARS_PER_PAGE, maxOcrPages: MAX_OCR_PAGES });
  const bridge = opts.bridge ?? 'native';
  return `<!doctype html><html><head><meta charset="utf-8">
<script src="${urls.pdfjs}"></script></head><body><script>
var CFG = ${cfg};
var BRIDGE = ${JSON.stringify(bridge)};
function post(m) {
  if (BRIDGE === 'parent') window.parent.postMessage(JSON.stringify(m), '*');
  else window.ReactNativeWebView.postMessage(JSON.stringify(m));
}
if (BRIDGE === 'parent') {
  // Comandos vindos da página: { cmd: 'extractPdf' | 'extractImage', args: [...] }
  window.addEventListener('message', function (ev) {
    if (ev.source !== window.parent) return;
    var m; try { m = typeof ev.data === 'string' ? JSON.parse(ev.data) : ev.data; } catch (e) { return; }
    if (m && m.cmd === 'extractPdf') window.extractPdf.apply(null, m.args);
    else if (m && m.cmd === 'extractImage') window.extractImage.apply(null, m.args);
  });
}
if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = CFG.pdfjsWorker;
  post({ type: 'ready' });
} else {
  post({ type: 'error', message: 'Não foi possível carregar o leitor de PDF. Verifique a conexão com a internet.' });
}

function b64ToBytes(b64) {
  var raw = atob(b64); var bytes = new Uint8Array(raw.length);
  for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function loadScript(src) {
  return new Promise(function (ok, fail) {
    var s = document.createElement('script');
    s.src = src; s.onload = ok;
    s.onerror = function () { fail(new Error('Não foi possível baixar o leitor de OCR. Verifique a conexão com a internet.')); };
    document.head.appendChild(s);
  });
}

// ---------- OCR (Tesseract) ----------
var OCR = { worker: null, id: null, page: 0, total: 0 };
async function ocrWorker(id) {
  if (OCR.worker) return OCR.worker;
  post({ type: 'progress', id: id, stage: 'ocr-init' });
  if (!window.Tesseract) await loadScript(CFG.tesseract);
  OCR.worker = await Tesseract.createWorker('por', 1, {
    workerPath: CFG.tesseractWorker,
    corePath: CFG.tesseractCore,
    langPath: CFG.tesseractLang,
    logger: function (m) {
      if (m.status === 'recognizing text' && OCR.id !== null) {
        post({ type: 'progress', id: OCR.id, stage: 'ocr', page: OCR.page, total: OCR.total, progress: m.progress });
      }
    },
  });
  return OCR.worker;
}

// Inclinação da página (foto torta): mediana da inclinação das linhas de base
// que o Tesseract encontrou, ponderada pelo comprimento da linha.
function pageSlope(lines) {
  var slopes = [];
  (lines || []).forEach(function (l) {
    var b = l.baseline;
    if (!b || b.x1 - b.x0 < 80) return;
    var s = (b.y1 - b.y0) / (b.x1 - b.x0);
    if (Math.abs(s) < 0.15) for (var k = 0; k < Math.round((b.x1 - b.x0) / 80); k++) slopes.push(s);
  });
  if (!slopes.length) return 0;
  slopes.sort(function (a, b) { return a - b; });
  return slopes[Math.floor(slopes.length / 2)];
}

async function ocrCanvas(worker, canvas) {
  var res = await worker.recognize(canvas);
  var words = (res.data && res.data.words) || [];
  var slope = pageSlope(res.data && res.data.lines);
  return words
    // Palavras com baixa confiança são ruído, mas números são mantidos (a revisão mostra tudo).
    .filter(function (w) { return w.text && w.text.trim() && (w.confidence >= 20 || /\\d/.test(w.text)); })
    .map(function (w) {
      // Endireita: desconta a subida/descida da linha conforme a posição x.
      var cx = (w.bbox.x0 + w.bbox.x1) / 2;
      var bottom = w.bbox.y1 - slope * cx;
      return { str: w.text, x: w.bbox.x0, y: canvas.height - bottom, width: w.bbox.x1 - w.bbox.x0, height: w.bbox.y1 - w.bbox.y0 };
    });
}

function whiteCanvas(w, h) {
  var c = document.createElement('canvas');
  c.width = Math.round(w); c.height = Math.round(h);
  var ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  return c;
}

async function ocrPdf(id, doc) {
  var worker = await ocrWorker(id);
  var total = Math.min(doc.numPages, CFG.maxOcrPages);
  var pages = [];
  OCR.id = id; OCR.total = total;
  try {
    for (var p = 1; p <= total; p++) {
      OCR.page = p;
      post({ type: 'progress', id: id, stage: 'ocr', page: p, total: total, progress: 0 });
      var page = await doc.getPage(p);
      var base = page.getViewport({ scale: 1 });
      // ~2000 px de largura: bom para o OCR sem estourar a memória do celular.
      var viewport = page.getViewport({ scale: Math.min(3, 2000 / base.width) });
      var canvas = whiteCanvas(viewport.width, viewport.height);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport: viewport }).promise;
      pages.push(await ocrCanvas(worker, canvas));
      canvas.width = 0; canvas.height = 0;
    }
  } finally { OCR.id = null; }
  return { pages: pages, truncated: doc.numPages > total };
}

// ---------- PDF ----------
window.extractPdf = async function (id, b64, password, allowOcr) {
  try {
    post({ type: 'progress', id: id, stage: 'text' });
    var doc = await pdfjsLib.getDocument({ data: b64ToBytes(b64), password: password || undefined }).promise;
    var pages = []; var chars = 0;
    for (var p = 1; p <= doc.numPages; p++) {
      var page = await doc.getPage(p);
      var content = await page.getTextContent();
      pages.push(content.items.map(function (it) {
        chars += (it.str || '').replace(/\\s/g, '').length;
        return { str: it.str, x: it.transform[4], y: it.transform[5], width: it.width, height: it.height || Math.abs(it.transform[3]) };
      }));
    }
    if (allowOcr && chars / Math.max(1, doc.numPages) < CFG.scannedChars) {
      var o = await ocrPdf(id, doc);
      post({ type: 'result', id: id, pages: o.pages, ocr: true, truncated: o.truncated });
    } else {
      post({ type: 'result', id: id, pages: pages, ocr: false });
    }
  } catch (e) {
    if (e && e.name === 'PasswordException') post({ type: 'password', id: id, wrong: e.code === 2 });
    else post({ type: 'error', id: id, message: String((e && e.message) || e) });
  }
};

// ---------- Imagem (foto ou print do extrato) ----------
window.extractImage = async function (id, b64, mime) {
  try {
    var img = new Image();
    await new Promise(function (ok, fail) {
      img.onload = ok;
      img.onerror = function () { fail(new Error('Imagem inválida ou em formato não suportado (use JPG ou PNG).')); };
      img.src = 'data:' + (mime || 'image/jpeg') + ';base64,' + b64;
    });
    var scale = Math.min(3, Math.max(1, 2000 / img.naturalWidth));
    if (img.naturalWidth * scale > 4000) scale = 4000 / img.naturalWidth;
    var canvas = whiteCanvas(img.naturalWidth * scale, img.naturalHeight * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    var worker = await ocrWorker(id);
    OCR.id = id; OCR.page = 1; OCR.total = 1;
    try {
      post({ type: 'progress', id: id, stage: 'ocr', page: 1, total: 1, progress: 0 });
      var words = await ocrCanvas(worker, canvas);
      post({ type: 'result', id: id, pages: [words], ocr: true });
    } finally { OCR.id = null; }
  } catch (e) {
    post({ type: 'error', id: id, message: String((e && e.message) || e) });
  }
};
</script></body></html>`;
}
