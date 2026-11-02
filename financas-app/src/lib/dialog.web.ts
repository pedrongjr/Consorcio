import type { AlertButton } from 'react-native';

/**
 * Web: `Alert.alert` do react-native-web não mostra nada, então usamos os
 * diálogos do navegador. Com botão "cancel" vira uma confirmação.
 */
export function showAlert(title: string, message?: string, buttons?: AlertButton[]): void {
  const text = message ? `${title}\n\n${message}` : title;
  const actions = (buttons ?? []).filter((b) => b.style !== 'cancel');
  const cancel = (buttons ?? []).find((b) => b.style === 'cancel');
  if (!buttons?.length || (actions.length <= 1 && !cancel)) {
    window.alert(text);
    actions[0]?.onPress?.();
    return;
  }
  if (window.confirm(text)) actions[actions.length - 1]?.onPress?.();
  else cancel?.onPress?.();
}
