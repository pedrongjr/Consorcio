import type { DocumentPickerAsset } from 'expo-document-picker';

export interface PickedFile {
  name: string;
  bytes: Uint8Array;
  base64(): Promise<string>;
}

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(bin);
}

/** Web: o arquivo é lido no próprio navegador; o extrato bruto não vai para o servidor. */
export async function readPickedFile(asset: DocumentPickerAsset): Promise<PickedFile> {
  const buf = asset.file ? await asset.file.arrayBuffer() : await (await fetch(asset.uri)).arrayBuffer();
  const bytes = new Uint8Array(buf);
  return { name: asset.name, bytes, base64: async () => toBase64(bytes) };
}

/** Web: baixa o arquivo. */
export async function saveTextFile(name: string, content: string, mimeType: string): Promise<void> {
  const url = URL.createObjectURL(new Blob([content], { type: `${mimeType};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
