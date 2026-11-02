/** Tipos comuns ao leitor nativo (WebView) e web (iframe). */

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
