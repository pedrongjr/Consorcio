import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps, ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps, type ViewStyle } from 'react-native';
import { formatBRL, monthLabel, shiftMonth } from '../core/reports';

export const colors = {
  bg: '#F4F6F8',
  card: '#FFFFFF',
  text: '#1F2933',
  muted: '#6B7785',
  border: '#E3E8EE',
  primary: '#1B7F6B',
  primaryLight: '#E3F2EF',
  income: '#1E8E3E',
  expense: '#C62828',
  warning: '#E9A23B',
  transfer: '#457B9D',
};

export type IconName = ComponentProps<typeof Ionicons>['name'];

export function Icon({ name, size = 20, color = colors.text }: { name: string; size?: number; color?: string }) {
  const glyph = (name in Ionicons.glyphMap ? name : 'pricetag') as IconName;
  return <Ionicons name={glyph} size={size} color={color} />;
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <View style={styles.sectionRow}>
      <Text style={styles.sectionTitle}>{children}</Text>
      {right}
    </View>
  );
}

export function Money({ cents, style, colored = true, size = 15 }: { cents: number; style?: object; colored?: boolean; size?: number }) {
  const color = !colored ? colors.text : cents < 0 ? colors.expense : cents > 0 ? colors.income : colors.muted;
  return <Text style={[{ color, fontSize: size, fontWeight: '600', fontVariant: ['tabular-nums'] }, style]}>{formatBRL(cents)}</Text>;
}

export function Button({
  title, onPress, variant = 'primary', icon, disabled, loading, style,
}: {
  title: string; onPress: () => void; variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  icon?: IconName; disabled?: boolean; loading?: boolean; style?: ViewStyle;
}) {
  const bg = { primary: colors.primary, secondary: colors.primaryLight, danger: '#FDECEA', ghost: 'transparent' }[variant];
  const fg = { primary: '#fff', secondary: colors.primary, danger: colors.expense, ghost: colors.primary }[variant];
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [styles.button, { backgroundColor: bg, opacity: disabled ? 0.5 : pressed ? 0.8 : 1 }, style]}
    >
      {loading ? <ActivityIndicator color={fg} /> : icon ? <Ionicons name={icon} size={18} color={fg} /> : null}
      <Text style={[styles.buttonText, { color: fg }]}>{title}</Text>
    </Pressable>
  );
}

export function Field({ label, ...props }: TextInputProps & { label: string }) {
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput placeholderTextColor={colors.muted} {...props} style={[styles.input, props.style]} />
    </View>
  );
}

export function Chip({ label, active, onPress, color }: { label: string; active?: boolean; onPress?: () => void; color?: string }) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, active && { backgroundColor: color ?? colors.primary, borderColor: color ?? colors.primary }]}
    >
      <Text style={[styles.chipText, active && { color: '#fff' }]} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

export function MonthSwitcher({ month, onChange }: { month: string; onChange: (m: string) => void }) {
  return (
    <View style={styles.monthRow}>
      <Pressable accessibilityLabel="Mês anterior" hitSlop={12} onPress={() => onChange(shiftMonth(month, -1))}>
        <Ionicons name="chevron-back" size={22} color={colors.primary} />
      </Pressable>
      <Text style={styles.monthText}>{monthLabel(month, true)}</Text>
      <Pressable accessibilityLabel="Próximo mês" hitSlop={12} onPress={() => onChange(shiftMonth(month, 1))}>
        <Ionicons name="chevron-forward" size={22} color={colors.primary} />
      </Pressable>
    </View>
  );
}

export function ProgressBar({ ratio, color }: { ratio: number; color: string }) {
  return (
    <View style={styles.progressTrack}>
      <View style={[styles.progressFill, { width: `${Math.min(100, Math.max(0, ratio * 100))}%`, backgroundColor: color }]} />
    </View>
  );
}

export function EmptyState({ icon, title, text, action }: { icon: IconName; title: string; text?: string; action?: ReactNode }) {
  return (
    <View style={styles.empty}>
      <Ionicons name={icon} size={48} color={colors.border} />
      <Text style={styles.emptyTitle}>{title}</Text>
      {text ? <Text style={styles.emptyText}>{text}</Text> : null}
      {action}
    </View>
  );
}

export function CategoryBadge({ name, icon, color }: { name: string; icon: string; color: string }) {
  return (
    <View style={[styles.badge, { backgroundColor: `${color}1A` }]}>
      <Icon name={icon} size={12} color={color} />
      <Text style={[styles.badgeText, { color }]} numberOfLines={1}>{name}</Text>
    </View>
  );
}

export function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 48, gap: 12 },
  card: {
    backgroundColor: colors.card, borderRadius: 14, padding: 16,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 1,
  },
  sectionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
  button: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12, paddingHorizontal: 16, borderRadius: 10, minHeight: 46 },
  buttonText: { fontSize: 15, fontWeight: '600' },
  label: { fontSize: 13, color: colors.muted, marginBottom: 4 },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12, fontSize: 15, backgroundColor: '#fff', color: colors.text },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: '#fff', maxWidth: 220 },
  chipText: { fontSize: 13, color: colors.text },
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4 },
  monthText: { fontSize: 17, fontWeight: '700', color: colors.text },
  progressTrack: { height: 8, backgroundColor: colors.border, borderRadius: 4, overflow: 'hidden' },
  progressFill: { height: 8, borderRadius: 4 },
  empty: { alignItems: 'center', padding: 32, gap: 8 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: colors.text, textAlign: 'center' },
  emptyText: { fontSize: 14, color: colors.muted, textAlign: 'center', marginBottom: 8 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, alignSelf: 'flex-start', maxWidth: 200 },
  badgeText: { fontSize: 12, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  muted: { color: colors.muted, fontSize: 13 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: 8 },
});
