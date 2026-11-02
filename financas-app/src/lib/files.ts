import type { DocumentPickerAsset } from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Alert } from 'react-native';

/** Conteúdo de um arquivo escolhido no seletor de documentos. */
export interface PickedFile {
  name: string;
  bytes: Uint8Array;
  base64(): Promise<string>;
}

export async function readPickedFile(asset: DocumentPickerAsset): Promise<PickedFile> {
  const file = new File(asset.uri);
  return { name: asset.name, bytes: await file.bytes(), base64: () => file.base64() };
}

/** Salva um arquivo de texto e abre o menu de compartilhar do sistema. */
export async function saveTextFile(name: string, content: string, mimeType: string, uti?: string): Promise<void> {
  const file = new File(Paths.cache, name);
  if (file.exists) file.delete();
  file.create();
  await file.write(content);
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, { mimeType, UTI: uti, dialogTitle: name });
  } else {
    Alert.alert('Arquivo gerado', file.uri);
  }
}
