import { useEffect, useImperativeHandle, useRef, type Ref } from 'react';
import { cleanOcrLines, groupTextItems, type PdfTextItem } from '../core/pdfLayout';
import { PdfPasswordError, type ExtractProgress, type ExtractResult, type PdfTextExtractorHandle } from './PdfTextExtractor.shared';

export { PdfPasswordError } from './PdfTextExtractor.shared';
export type { ExtractProgress, ExtractResult, PdfTextExtractorHandle } from './PdfTextExtractor.shared';

/**
 * Web: o mesmo leitor (pdf.js + Tesseract) roda num iframe em sandbox
 * (`/reader.html`, servido pelo nosso servidor). Sem `allow-same-origin`, o
 * iframe não acessa cookies nem a página — só troca mensagens com ela.
 * O arquivo é processado no navegador do usuário.
 */

type Pending = { resolve: (r: ExtractResult) => void; reject: (e: Error) => void; onProgress?: (p: ExtractProgress) => void };
type Message = {
  type: string; id?: number; pages?: PdfTextItem[][]; ocr?: boolean; truncated?: boolean;
  message?: string; wrong?: boolean; stage?: ExtractProgress['stage']; page?: number; total?: number; progress?: number;
};

export function PdfTextExtractor({ ref }: { ref: Ref<PdfTextExtractorHandle> }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const pending = useRef(new Map<number, Pending>());
  const nextId = useRef(1);
  const lib = useRef<{ status: 'loading' | 'ready' | 'failed'; error?: Error; waiters: { ok: () => void; fail: (e: Error) => void }[] }>({
    status: 'loading', waiters: [],
  });

  useEffect(() => {
    function settle(error?: Error) {
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
    function onMessage(ev: MessageEvent) {
      if (!frame.current || ev.source !== frame.current.contentWindow) return;
      let msg: Message;
      try { msg = typeof ev.data === 'string' ? JSON.parse(ev.data) : ev.data; } catch { return; }
      if (msg.type === 'ready') { settle(); return; }
      const p = msg.id !== undefined ? pending.current.get(msg.id) : undefined;
      if (msg.type === 'error' && !p) { settle(new Error(msg.message)); return; }
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
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  function waitLib(): Promise<void> {
    const l = lib.current;
    if (l.status === 'ready') return Promise.resolve();
    if (l.status === 'failed') return Promise.reject(l.error);
    return new Promise((ok, fail) => l.waiters.push({ ok, fail }));
  }

  async function run(cmd: 'extractPdf' | 'extractImage', args: (id: number) => unknown[], onProgress?: (p: ExtractProgress) => void) {
    const timeout = new Promise<never>((_, rej) => setTimeout(() => rej(new Error('Tempo esgotado ao carregar o leitor de PDF.')), 20000));
    await Promise.race([waitLib(), timeout]);
    const id = nextId.current++;
    return new Promise<ExtractResult>((resolve, reject) => {
      pending.current.set(id, { resolve, reject, onProgress });
      // O iframe tem origem opaca (sandbox), por isso o destino é '*'.
      frame.current?.contentWindow?.postMessage(JSON.stringify({ cmd, args: args(id) }), '*');
    });
  }

  useImperativeHandle(ref, () => ({
    extractPdf(base64, opts = {}) {
      return run('extractPdf', (id) => [id, base64, opts.password ?? '', true], opts.onProgress);
    },
    extractImage(base64, mimeType, onProgress) {
      return run('extractImage', (id) => [id, base64, mimeType], onProgress);
    },
  }));

  return (
    <iframe
      ref={frame}
      src="/reader.html"
      title="Leitor de PDF"
      sandbox="allow-scripts"
      aria-hidden
      tabIndex={-1}
      style={{ width: 0, height: 0, border: 0, position: 'absolute', opacity: 0, pointerEvents: 'none' }}
    />
  );
}
