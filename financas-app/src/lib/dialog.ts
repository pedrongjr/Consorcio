import { Alert, type AlertButton } from 'react-native';

/** Alerta/confirmação nativa no iOS e Android. */
export function showAlert(title: string, message?: string, buttons?: AlertButton[]): void {
  Alert.alert(title, message, buttons);
}
