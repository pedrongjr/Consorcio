import { useImperativeHandle, useRef, type ComponentType, type Ref } from 'react';
import { View } from 'react-native';
import { WebView as RNWebView } from 'react-native-webview';
import { cleanOcrLines, groupTextItems, type PdfTextItem } from '../core/pdfLayout';
import { buildReaderHtml } from '../core/pdfReaderHtml';

/**
 * Lê PDFs (pdf.js) e faz OCR de PDFs escaneados e de fotos de extrato
 * (Tesseract.js) dentro de um WebView invisível. O arquivo é processado no
 * próprio aparelho; a internet só é usada para baixar as bibliotecas e o
 * modelo de português na primeira vez. Ver `core/pdfReaderHtml.ts`.
 */

// Os tipos publicados do react-native-webview 14 viram `never` com os tipos do
// React Native 0.88 (props de iOS/Android/Windows conflitam). Declaramos só o
// que usamos aqui.
interface WebViewHandle { injectJavaScript(script: string): void }
const WebView = RNWebView as unknown as ComponentType<{
  ref: Ref<WebViewHandle>;
  source: { html: string; baseUrl?: string };
  originWhitelist: string[];
  javaScriptEnabled: boolean;
  onMessage: (e: { nativeEvent: { data: string } }) => void;
  onError: () => void;
}>;

export class PdfPasswordError extends Error {
  constructor(public readonly wrongPassword: boolean) {
    super(wrongPassword ? 'Senha do PDF incorreta.' : 'Este PDF é protegido por senha.');
  }
}

export interface ExtractProgress {
  stage: 'text' | 'ocr-init' | 'ocr';
  page?: number;
  total?: number;
  /** 0..1 dentro da página atual. */
  progress?: number;
}

export interface ExtractResult {
  lines: string[];
  /** O texto veio de OCR (PDF escaneado ou imagem). */
  ocr: boolean;
  /** O PDF tinha mais páginas do que o limite de OCR. */
  truncated: boolean;
}

export interface PdfTextExtractorHandle {
  extractPdf(base64: string, opts?: { password?: string; onProgress?: (p: ExtractProgress) => void }): Promise<ExtractResult>;
  extractImage(base64: string, mimeType: string, onProgress?: (p: ExtractProgress) => void): Promise<ExtractResult>;
}

const HTML = buildReaderHtml();

type Pending = { resolve: (r: ExtractResult) => void; reject: (e: Error) => void; onProgress?: (p: ExtractProgress) => void };
type Message = {
  type: string; id?: number; pages?: PdfTextItem[][]; ocr?: boolean; truncated?: boolean;
  message?: string; wrong?: boolean; stage?: ExtractProgress['stage']; page?: number; total?: number; progress?: number;
};

export function PdfTextExtractor({ ref }: { ref: Ref<PdfTextExtractorHandle> }) {
  const webRef = useRef<WebViewHandle>(null);
  const pending = useRef(new Map<number, Pending>());
  const nextId = useRef(1);
  // Estado de carregamento do pdf.js dentro do WebView.
  const lib = useRef<{ status: 'loading' | 'ready' | 'failed'; error?: Error; waiters: { ok: () => void; fail: (e: Error) => void }[] }>({
    status: 'loading', waiters: [],
  });

  function settleLib(error?: Error) {
    const l = lib.current;
    if (l.status !== 'loading') return;
    l.status = error ? 'failed' : 'ready';
    l.error = error;
    for (const w of l.waiters) {
      if (error) w.fail(error);
      else w.ok();
    }
    l.waiters = [];
  }

  function waitLib(): Promise<void> {
    const l = lib.current;
    if (l.status === 'ready') return Promise.resolve();
    if (l.status === 'failed') return Promise.reject(l.error);
    return new Promise((ok, fail) => l.waiters.push({ ok, fail }));
  }

  async function run(script: (id: number) => string, onProgress?: (p: ExtractProgress) => void): Promise<ExtractResult> {
    const timeout = new Promise<never>((_, rej) => setTimeout(() => rej(new Error('Tempo esgotado ao carregar o leitor de PDF.')), 20000));
    await Promise.race([waitLib(), timeout]);
    const id = nextId.current++;
    return new Promise<ExtractResult>((resolve, reject) => {
      pending.current.set(id, { resolve, reject, onProgress });
      webRef.current?.injectJavaScript(`${script(id)}; true;`);
    });
  }

  useImperativeHandle(ref, () => ({
    extractPdf(base64, opts = {}) {
      return run((id) => `window.extractPdf(${id}, ${JSON.stringify(base64)}, ${JSON.stringify(opts.password ?? '')}, true)`, opts.onProgress);
    },
    extractImage(base64, mimeType, onProgress) {
      return run((id) => `window.extractImage(${id}, ${JSON.stringify(base64)}, ${JSON.stringify(mimeType)})`, onProgress);
    },
  }));

  function onMessage(e: { nativeEvent: { data: string } }) {
    let msg: Message;
    try { msg = JSON.parse(e.nativeEvent.data); } catch { return; }
    if (msg.type === 'ready') { settleLib(); return; }
    const p = msg.id !== undefined ? pending.current.get(msg.id) : undefined;
    if (msg.type === 'error' && !p) { settleLib(new Error(msg.message)); return; }
    if (!p || msg.id === undefined) return;
    if (msg.type === 'progress') {
      p.onProgress?.({ stage: msg.stage ?? 'text', page: msg.page, total: msg.total, progress: msg.progress });
      return;
    }
    pending.current.delete(msg.id);
    if (msg.type === 'result') {
      let lines = (msg.pages ?? []).flatMap(groupTextItems);
      if (msg.ocr) lines = cleanOcrLines(lines);
      p.resolve({ lines, ocr: !!msg.ocr, truncated: !!msg.truncated });
    } else if (msg.type === 'password') p.reject(new PdfPasswordError(!!msg.wrong));
    else p.reject(new Error(msg.message ?? 'Falha ao ler o arquivo.'));
  }

  return (
    <View style={{ width: 0, height: 0, position: 'absolute', opacity: 0 }} pointerEvents="none">
      <WebView
        ref={webRef}
        source={{ html: HTML, baseUrl: 'https://localhost/' }}
        originWhitelist={['*']}
        javaScriptEnabled={true}
        onMessage={onMessage}
        onError={() => settleLib(new Error('Não foi possível iniciar o leitor de PDF.'))}
      />
    </View>
  );
}
