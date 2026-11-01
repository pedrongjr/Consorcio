import { useImperativeHandle, useRef, type ComponentType, type Ref } from 'react';
import { View } from 'react-native';
import { WebView as RNWebView } from 'react-native-webview';
import { groupTextItems, type PdfTextItem } from '../core/pdfLayout';

/**
 * Extrai o texto de PDFs usando o pdf.js dentro de um WebView invisível.
 * O arquivo é processado no próprio aparelho; a internet só é usada para
 * baixar a biblioteca pdf.js (cdnjs) na primeira vez.
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

export interface PdfTextExtractorHandle {
  extract(base64: string, password?: string): Promise<string[]>;
}

const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174';

const HTML = `<!doctype html><html><head><meta charset="utf-8">
<script src="${PDFJS}/pdf.min.js"></script></head><body><script>
  function post(m) { window.ReactNativeWebView.postMessage(JSON.stringify(m)); }
  if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = '${PDFJS}/pdf.worker.min.js';
    post({ type: 'ready' });
  } else {
    post({ type: 'error', message: 'Não foi possível carregar o leitor de PDF. Verifique a conexão com a internet.' });
  }
  window.extractPdf = async function (id, b64, password) {
    try {
      var raw = atob(b64); var bytes = new Uint8Array(raw.length);
      for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      var doc = await pdfjsLib.getDocument({ data: bytes, password: password || undefined }).promise;
      var pages = [];
      for (var p = 1; p <= doc.numPages; p++) {
        var page = await doc.getPage(p);
        var content = await page.getTextContent();
        pages.push(content.items.map(function (it) {
          return { str: it.str, x: it.transform[4], y: it.transform[5], width: it.width, height: it.height || Math.abs(it.transform[3]) };
        }));
      }
      post({ type: 'result', id: id, pages: pages });
    } catch (e) {
      if (e && e.name === 'PasswordException') post({ type: 'password', id: id, wrong: e.code === 2 });
      else post({ type: 'error', id: id, message: String((e && e.message) || e) });
    }
  };
</script></body></html>`;

type Pending = { resolve: (lines: string[]) => void; reject: (e: Error) => void };

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

  useImperativeHandle(ref, () => ({
    async extract(base64, password) {
      const timeout = new Promise<never>((_, rej) => setTimeout(() => rej(new Error('Tempo esgotado ao carregar o leitor de PDF.')), 20000));
      await Promise.race([waitLib(), timeout]);
      const id = nextId.current++;
      return new Promise<string[]>((resolve, reject) => {
        pending.current.set(id, { resolve, reject });
        webRef.current?.injectJavaScript(`window.extractPdf(${id}, ${JSON.stringify(base64)}, ${JSON.stringify(password ?? '')}); true;`);
      });
    },
  }));

  function onMessage(e: { nativeEvent: { data: string } }) {
    let msg: { type: string; id?: number; pages?: PdfTextItem[][]; message?: string; wrong?: boolean };
    try { msg = JSON.parse(e.nativeEvent.data); } catch { return; }
    if (msg.type === 'ready') { settleLib(); return; }
    const p = msg.id !== undefined ? pending.current.get(msg.id) : undefined;
    if (msg.type === 'error' && !p) { settleLib(new Error(msg.message)); return; }
    if (!p || msg.id === undefined) return;
    pending.current.delete(msg.id);
    if (msg.type === 'result') p.resolve((msg.pages ?? []).flatMap(groupTextItems));
    else if (msg.type === 'password') p.reject(new PdfPasswordError(!!msg.wrong));
    else p.reject(new Error(msg.message ?? 'Falha ao ler o PDF.'));
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
