import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Pressable, ScrollView, Text, View } from 'react-native';
import { ApiError, auth, onUnauthorized, type SessionUser } from '../lib/api';
import { showAlert } from '../lib/dialog';
import { Button, Card, colors, Field, Icon, SectionTitle, styles } from './ui';

const AuthContext = createContext<{ user: SessionUser; signOut: () => Promise<void> } | null>(null);

/** Web: cada usuário tem a própria conta; sem login não há acesso a nenhum dado. */
export function AuthGate({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null | undefined>(undefined);

  useEffect(() => {
    auth.me().then(setUser).catch(() => setUser(null));
    return onUnauthorized(() => setUser(null));
  }, []);

  if (user === undefined) {
    return (
      <View style={[styles.screen, { alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  if (!user) return <LoginScreen onLogin={setUser} />;
  const signOut = async () => {
    await auth.logout().catch(() => undefined);
    setUser(null);
  };
  // `key` força remontar tudo ao trocar de usuário: nada do anterior fica em memória.
  return <AuthContext.Provider key={user.id} value={{ user, signOut }}>{children}</AuthContext.Provider>;
}

function LoginScreen({ onLogin }: { onLogin: (u: SessionUser) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    if (mode === 'register' && password !== confirm) return setError('As senhas não conferem.');
    setBusy(true);
    try {
      const u = mode === 'login' ? await auth.login(email, password) : await auth.register(email, password, name);
      setPassword('');
      setConfirm('');
      onLogin(u);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível entrar.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.screen}>
      <ScrollView contentContainerStyle={[styles.content, { maxWidth: 420, width: '100%', alignSelf: 'center', paddingTop: 48 }]} keyboardShouldPersistTaps="handled">
        <View style={{ alignItems: 'center', gap: 6, marginBottom: 8 }}>
          <Icon name="wallet" size={48} color={colors.primary} />
          <Text style={{ fontSize: 24, fontWeight: '700', color: colors.text }}>Minhas Finanças</Text>
          <Text style={[styles.muted, { textAlign: 'center' }]}>Controle financeiro a partir do extrato do seu banco</Text>
        </View>
        <Card>
          <View style={{ flexDirection: 'row', marginBottom: 16, borderRadius: 10, backgroundColor: colors.bg, padding: 4 }}>
            {(['login', 'register'] as const).map((m) => (
              <Pressable
                key={m}
                accessibilityRole="tab"
                accessibilityState={{ selected: mode === m }}
                onPress={() => { setMode(m); setError(null); }}
                style={{ flex: 1, padding: 10, borderRadius: 8, alignItems: 'center', backgroundColor: mode === m ? colors.card : 'transparent' }}
              >
                <Text style={{ fontWeight: '600', color: mode === m ? colors.primary : colors.muted }}>{m === 'login' ? 'Entrar' : 'Criar conta'}</Text>
              </Pressable>
            ))}
          </View>
          {mode === 'register' ? <Field label="Nome" value={name} onChangeText={setName} autoComplete="name" /> : null}
          <Field label="E-mail" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" inputMode="email" />
          <Field
            label="Senha"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            onSubmitEditing={mode === 'login' ? submit : undefined}
          />
          {mode === 'register' ? (
            <>
              <Field label="Confirme a senha" value={confirm} onChangeText={setConfirm} secureTextEntry autoComplete="new-password" onSubmitEditing={submit} />
              <Text style={[styles.muted, { marginBottom: 12 }]}>Mínimo de 8 caracteres. Evite senhas óbvias.</Text>
            </>
          ) : null}
          {error ? <Text accessibilityRole="alert" style={{ color: colors.expense, marginBottom: 12 }}>{error}</Text> : null}
          <Button title={mode === 'login' ? 'Entrar' : 'Criar conta'} onPress={submit} loading={busy} disabled={!email || !password} />
        </Card>
        <Text style={[styles.muted, { textAlign: 'center' }]}>
          Cada conta é separada: ninguém mais consegue ver os seus extratos e lançamentos.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/** Seção "Minha conta" da tela Mais. */
export function AccountSection() {
  const ctx = useContext(AuthContext);
  const [mode, setMode] = useState<'none' | 'password' | 'delete'>('none');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  if (!ctx) return null;

  async function changePassword() {
    setBusy(true);
    try {
      await auth.changePassword(current, next);
      setMode('none'); setCurrent(''); setNext('');
      showAlert('Senha alterada', 'As sessões em outros aparelhos foram encerradas.');
    } catch (e) {
      showAlert('Não foi possível trocar a senha', (e as Error).message);
    } finally { setBusy(false); }
  }

  function deleteAccount() {
    showAlert('Excluir sua conta?', 'Todos os seus lançamentos, contas, regras e orçamentos serão apagados para sempre.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Excluir', style: 'destructive', onPress: async () => {
          try {
            await auth.deleteAccount(current);
            await ctx!.signOut();
          } catch (e) { showAlert('Não foi possível excluir', (e as Error).message); }
        },
      },
    ]);
  }

  return (
    <Card>
      <SectionTitle>Minha conta</SectionTitle>
      <Text style={{ color: colors.text, fontWeight: '600' }}>{ctx.user.name || ctx.user.email}</Text>
      {ctx.user.name ? <Text style={styles.muted}>{ctx.user.email}</Text> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
        <Button title="Trocar senha" variant="secondary" onPress={() => setMode(mode === 'password' ? 'none' : 'password')} />
        <Button title="Sair" variant="secondary" icon="log-out-outline" onPress={() => ctx.signOut()} />
        <Button title="Excluir conta" variant="danger" onPress={() => setMode(mode === 'delete' ? 'none' : 'delete')} />
      </View>
      {mode === 'password' ? (
        <View style={{ marginTop: 12 }}>
          <Field label="Senha atual" value={current} onChangeText={setCurrent} secureTextEntry autoComplete="current-password" />
          <Field label="Nova senha" value={next} onChangeText={setNext} secureTextEntry autoComplete="new-password" />
          <Button title="Salvar nova senha" onPress={changePassword} loading={busy} disabled={!current || !next} />
        </View>
      ) : null}
      {mode === 'delete' ? (
        <View style={{ marginTop: 12 }}>
          <Field label="Confirme com sua senha" value={current} onChangeText={setCurrent} secureTextEntry autoComplete="current-password" />
          <Button title="Excluir minha conta e todos os dados" variant="danger" onPress={deleteAccount} disabled={!current} />
        </View>
      ) : null}
    </Card>
  );
}
