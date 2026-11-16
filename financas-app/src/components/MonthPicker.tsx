import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { colors } from './ui';

const MONTHS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const PAGE = 10;

/**
 * Escolha rápida de mês e ano (como no Minhas Economias): meses à esquerda,
 * anos à direita, paginando de 10 em 10.
 */
export function MonthPicker({
  visible, value, onSelect, onClose, title, onClear, clearLabel,
}: {
  visible: boolean;
  /** YYYY-MM */
  value: string;
  onSelect: (month: string) => void;
  onClose: () => void;
  title?: string;
  /** Mostra um botão extra (ex.: "Sem prazo"). */
  onClear?: () => void;
  clearLabel?: string;
}) {
  const [y0, m0] = value.split('-').map(Number);
  const [year, setYear] = useState(y0);
  const [month, setMonth] = useState(m0);
  const [pageStart, setPageStart] = useState(y0 - 4);
  // Ao abrir, volta para o valor atual.
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) { setYear(y0); setMonth(m0); setPageStart(y0 - 4); }
  }

  const now = new Date();
  const thisYear = now.getFullYear();
  const thisMonth = now.getMonth() + 1;
  const years = Array.from({ length: PAGE }, (_, i) => pageStart + i);

  const cell = (label: string, active: boolean, current: boolean, onPress: () => void, a11y: string) => (
    <Pressable
      key={a11y}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={{
        width: '50%', paddingVertical: 10, alignItems: 'center', borderRadius: 8,
        backgroundColor: active ? colors.primary : 'transparent',
      }}
    >
      <Text style={{ color: active ? '#fff' : colors.text, fontWeight: active || current ? '700' : '400', textDecorationLine: current && !active ? 'underline' : 'none' }}>
        {label}
      </Text>
    </Pressable>
  );

  const confirm = () => onSelect(`${year}-${String(month).padStart(2, '0')}`);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: '#0006', justifyContent: 'center', padding: 20 }}>
        <Pressable onPress={() => undefined} style={{ backgroundColor: colors.card, borderRadius: 16, padding: 16, maxWidth: 420, width: '100%', alignSelf: 'center' }}>
          <Text style={{ fontSize: 17, fontWeight: '700', color: colors.text, marginBottom: 12 }}>{title ?? 'Ir para o mês'}</Text>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <View style={{ flex: 1 }}>
              <View style={{ height: 36, justifyContent: 'center', alignItems: 'center' }}>
                <Text style={{ color: colors.muted, fontWeight: '600' }}>Mês</Text>
              </View>
              {/* Duas colunas: Jan–Jun e Jul–Dez */}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                {Array.from({ length: 6 }, (_, r) => [r, r + 6]).flat().map((i) =>
                  cell(MONTHS[i], month === i + 1, year === thisYear && i + 1 === thisMonth, () => setMonth(i + 1), `Mês ${MONTHS[i]}`))}
              </View>
            </View>
            <View style={{ width: 1, backgroundColor: colors.border }} />
            <View style={{ flex: 1 }}>
              <View style={{ height: 36, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Pressable accessibilityLabel="Anos anteriores" hitSlop={8} onPress={() => setPageStart(pageStart - PAGE)}>
                  <Ionicons name="chevron-back" size={22} color={colors.primary} />
                </Pressable>
                <Text style={{ color: colors.muted, fontWeight: '600' }}>Ano</Text>
                <Pressable accessibilityLabel="Próximos anos" hitSlop={8} onPress={() => setPageStart(pageStart + PAGE)}>
                  <Ionicons name="chevron-forward" size={22} color={colors.primary} />
                </Pressable>
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                {Array.from({ length: PAGE / 2 }, (_, r) => [r, r + PAGE / 2]).flat().map((i) =>
                  cell(String(years[i]), year === years[i], years[i] === thisYear, () => setYear(years[i]), `Ano ${years[i]}`))}
              </View>
            </View>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
            {onClear ? (
              <Pressable onPress={onClear} style={{ paddingHorizontal: 14, paddingVertical: 10, marginRight: 'auto' }}>
                <Text style={{ color: colors.primary, fontWeight: '600' }}>{clearLabel ?? 'Limpar'}</Text>
              </Pressable>
            ) : (
              <Pressable
                onPress={() => onSelect(`${thisYear}-${String(thisMonth).padStart(2, '0')}`)}
                style={{ paddingHorizontal: 14, paddingVertical: 10, marginRight: 'auto' }}
              >
                <Text style={{ color: colors.primary, fontWeight: '600' }}>Mês atual</Text>
              </Pressable>
            )}
            <Pressable onPress={onClose} style={{ paddingHorizontal: 14, paddingVertical: 10 }}>
              <Text style={{ color: colors.muted, fontWeight: '600' }}>Cancelar</Text>
            </Pressable>
            <Pressable onPress={confirm} style={{ paddingHorizontal: 18, paddingVertical: 10, backgroundColor: colors.primary, borderRadius: 8 }}>
              <Text style={{ color: '#fff', fontWeight: '700' }}>OK</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
