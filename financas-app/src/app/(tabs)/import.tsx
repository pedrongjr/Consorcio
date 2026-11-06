import * as DocumentPicker from 'expo-document-picker';
import { router } from 'expo-router';
import { useDb } from '../../db/DbProvider';
import { useRef, useState } from 'react';
import { Modal, ScrollView, Text, TextInput, View } from 'react-native';
import { showAlert } from '../../lib/dialog';
import { adjustCardSigns, detectFormat, imageMimeType, parseStatementFile, UnsupportedFormatError } from '../../core/importer';
import { parsePdfText } from '../../core/parsers/pdfText';
import { formatDateBR } from '../../core/reports';
import type { ParsedStatement, StatementFormat } from '../../core/types';
import {
  ACCOUNT_TYPES, accountExternalKey, bankName, findAccountByExternalKey, listAccounts, prepareImport, saveAccount,
  type AccountType, type AccountWithBalance,
} from '../../db/repo';
import { readPickedFile } from '../../lib/files';
import { importSession } from '../../lib/importSession';
import { useAsyncData } from '../../lib/useAsyncData';
import {
  PdfPasswordError, PdfTextExtractor, type ExtractProgress, type ExtractResult, type PdfTextExtractorHandle,
} from '../../components/PdfTextExtractor';
import { Button, Card, Chip, colors, Field, Icon, SectionTitle, styles } from '../../components/ui';

const FORMAT_LABEL: Record<StatementFormat, string> = {
  ofx: 'OFX (Money/Quicken)', csv: 'CSV / texto', qif: 'QIF', xlsx: 'Planilha Excel', ods: 'Planilha OpenDocument', pdf: 'PDF',
  image: 'Imagem (OCR)',
};

function progressText(p: ExtractProgress): string {
  if (p.stage === 'text') return 'Lendo o PDF…';
  if (p.stage === 'ocr-init') return 'Preparando o reconhecimento de texto (OCR)…\nNa primeira vez, baixa cerca de 5 MB.';
  const pct = p.progress ? ` ${Math.round(p.progress * 100)}%` : '';
  return p.total && p.total > 1 ? `Reconhecendo texto (OCR): página ${p.page} de ${p.total}${pct}` : `Reconhecendo texto (OCR)…${pct}`;
}

interface Loaded {
  fileName: string;
  bytes: Uint8Array;
  format: StatementFormat;
  pdfLines?: string[];
  ocr?: boolean;
  statement: ParsedStatement;
}

export default function ImportScreen() {
  const db = useDb();
  const extractor = useRef<PdfTextExtractorHandle>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [accountId, setAccountId] = useState<number | 'new' | null>(null);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<AccountType>('checking');
  const [password, setPassword] = useState<{ base64: string; fileName: string; bytes: Uint8Array; wrong: boolean } | null>(null);
  const [pwText, setPwText] = useState('');

  const { data: accounts, reload } = useAsyncData(() => listAccounts(db), [db]);

  async function pickFile() {
    const res = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true, multiple: false });
    if (res.canceled || !res.assets?.length) return;
    const asset = res.assets[0];
    setBusy(true);
    try {
      const file = await readPickedFile(asset);
      const bytes = file.bytes;
      const format = detectFormat(asset.name, bytes);
      if (format === 'pdf') {
        const base64 = await file.base64();
        await readPdf(asset.name, bytes, base64);
      } else if (format === 'image') {
        const base64 = await file.base64();
        const mime = imageMimeType(asset.name, bytes) ?? 'image/jpeg';
        const r = await extractor.current!.extractImage(base64, mime, (p) => setProgress(progressText(p)));
        await onExtracted(asset.name, bytes, 'image', r);
      } else {
        await onParsed({ fileName: asset.name, bytes, format, statement: parseStatementFile({ fileName: asset.name, bytes }) });
      }
    } catch (e) {
      const msg = e instanceof UnsupportedFormatError ? e.message : `Não foi possível ler o arquivo: ${(e as Error).message}`;
      showAlert('Arquivo não suportado', msg);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  async function onExtracted(fileName: string, bytes: Uint8Array, format: 'pdf' | 'image', r: ExtractResult) {
    const statement = parseStatementFile({ fileName, bytes, pdfLines: r.lines, ocr: r.ocr });
    if (r.truncated) statement.warnings.unshift('O OCR leu só as primeiras 20 páginas.');
    await onParsed({ fileName, bytes, format, pdfLines: r.lines, ocr: r.ocr, statement });
  }

  async function readPdf(fileName: string, bytes: Uint8Array, base64: string, pw?: string) {
    try {
      const r = await extractor.current!.extractPdf(base64, { password: pw, onProgress: (p) => setProgress(progressText(p)) });
      setPassword(null);
      await onExtracted(fileName, bytes, 'pdf', r);
    } catch (e) {
      if (e instanceof PdfPasswordError) {
        setPwText('');
        setPassword({ base64, fileName, bytes, wrong: e.wrongPassword });
        return;
      }
      throw e;
    }
  }

  async function onParsed(l: Loaded) {
    if (l.statement.transactions.length === 0) {
      showAlert('Nenhum lançamento encontrado', l.statement.warnings.join('\n') || 'Verifique se o arquivo é um extrato.');
      return;
    }
    setLoaded(l);
    const ext = accountExternalKey(l.statement.account);
    const match = await findAccountByExternalKey(db, ext);
    const suggestedType = l.statement.account?.type ?? 'checking';
    setNewType(suggestedType);
    const bank = bankName(l.statement.account?.bankId);
    setNewName(bank ? `${bank}${suggestedType === 'credit_card' ? ' - Cartão' : ''}` : '');
    setAccountId(match?.id ?? (accounts?.length === 1 ? accounts[0].id : accounts?.length ? null : 'new'));
  }

  async function continueToReview() {
    if (!loaded || accountId === null) return;
    setBusy(true);
    try {
      let id: number;
      let type: AccountType;
      if (accountId === 'new') {
        if (!newName.trim()) { showAlert('Informe o nome da conta'); return; }
        id = await saveAccount(db, {
          name: newName.trim(), type: newType, bank: bankName(loaded.statement.account?.bankId) ?? null,
          external_key: accountExternalKey(loaded.statement.account),
          color: ['#2A9D8F', '#E76F51', '#264653', '#8338EC', '#FB8500', '#3A86FF'][(accounts?.length ?? 0) % 6],
        });
        type = newType;
        reload();
      } else {
        id = accountId;
        type = accounts?.find((a) => a.id === accountId)?.type ?? 'checking';
      }
      // Faturas de cartão em CSV/planilha costumam trazer compras como valores positivos.
      let statement = loaded.statement;
      if (type === 'credit_card' && (loaded.format === 'pdf' || loaded.format === 'image') && statement.account?.type !== 'credit_card' && loaded.pdfLines) {
        statement = parsePdfText(loaded.pdfLines, { creditCard: true, ocr: loaded.ocr, format: loaded.format });
      } else if (type === 'credit_card' && ['csv', 'xlsx', 'ods', 'qif'].includes(loaded.format)) {
        statement = adjustCardSigns(statement);
      }
      const candidates = await prepareImport(db, id, statement);
      importSession.set({ fileName: loaded.fileName, accountId: id, statement, candidates });
      setLoaded(null);
      setAccountId(null);
      router.push('/import-review');
    } finally {
      setBusy(false);
    }
  }

  const period = loaded ? periodOf(loaded.statement) : null;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <PdfTextExtractor ref={extractor} />

      {!loaded ? (
        <>
          <Card>
            <View style={{ alignItems: 'center', gap: 8, paddingVertical: 8 }}>
              <Icon name="cloud-upload-outline" size={48} color={colors.primary} />
              <Text style={[styles.sectionTitle, { textAlign: 'center' }]}>Importe o extrato do seu banco</Text>
              <Text style={[styles.muted, { textAlign: 'center' }]}>
                Aceita OFX, CSV, XLSX, ODS, QIF, PDF e fotos ou prints do extrato (OCR). Os lançamentos são classificados automaticamente e você revisa antes de salvar.
                Lançamentos já importados são ignorados.
              </Text>
              <Button title="Escolher arquivo" icon="folder-open" onPress={pickFile} loading={busy} style={{ alignSelf: 'stretch', marginTop: 8 }} />
              {progress ? <Text style={[styles.muted, { textAlign: 'center' }]}>{progress}</Text> : null}
            </View>
          </Card>
          <Card>
            <SectionTitle>Qual formato escolher?</SectionTitle>
            <Tip title="OFX — recomendado" text="É o formato mais preciso: traz identificador único de cada lançamento e os dados da conta. No internet banking procure por “Exportar extrato”, “Money”, “OFX” ou “Quicken”." />
            <Tip title="CSV / Excel" text="Nubank, Inter, C6 e outros oferecem CSV. Faturas de cartão em CSV são ajustadas automaticamente (compras viram saídas)." />
            <Tip title="PDF" text="PDFs gerados pelo banco são lidos direto. PDFs protegidos por senha (geralmente parte do CPF) também são aceitos. Confira os valores na revisão." />
            <Tip title="PDF escaneado, foto ou print (OCR)" text="Quando o PDF é uma imagem, o texto é reconhecido no próprio celular (leva alguns segundos por página). Fotos e prints em JPG ou PNG também funcionam: use imagem nítida, reta e bem iluminada, e confira tudo na revisão." />
          </Card>
        </>
      ) : (
        <>
          <Card>
            <SectionTitle>Arquivo lido</SectionTitle>
            <Text style={{ color: colors.text, fontWeight: '600' }} numberOfLines={2}>{loaded.fileName}</Text>
            <Text style={styles.muted}>Formato: {FORMAT_LABEL[loaded.format]}</Text>
            <Text style={styles.muted}>{loaded.statement.transactions.length} lançamentos{period ? ` de ${period}` : ''}</Text>
            {loaded.statement.warnings.slice(0, 3).map((w, i) => (
              <Text key={i} style={{ color: colors.warning, marginTop: 6, fontSize: 13 }}>⚠ {w}</Text>
            ))}
          </Card>

          <Card>
            <SectionTitle>Para qual conta?</SectionTitle>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {(accounts ?? []).map((a: AccountWithBalance) => (
                <Chip key={a.id} label={a.name} active={accountId === a.id} color={a.color} onPress={() => setAccountId(a.id)} />
              ))}
              <Chip label="+ Nova conta" active={accountId === 'new'} onPress={() => setAccountId('new')} />
            </View>
            {accountId === 'new' ? (
              <View style={{ marginTop: 12 }}>
                <Field label="Nome da conta" value={newName} onChangeText={setNewName} placeholder="Ex.: Itaú corrente, Nubank cartão" />
                <Text style={styles.label}>Tipo</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {ACCOUNT_TYPES.map((t) => <Chip key={t.value} label={t.label} active={newType === t.value} onPress={() => setNewType(t.value)} />)}
                </View>
              </View>
            ) : null}
          </Card>

          <Button title="Revisar lançamentos" icon="checkmark-done" onPress={continueToReview} loading={busy} disabled={accountId === null} />
          <Button title="Cancelar" variant="ghost" onPress={() => { setLoaded(null); setAccountId(null); }} />
        </>
      )}

      <Modal visible={!!password} transparent animationType="fade" onRequestClose={() => setPassword(null)}>
        <View style={{ flex: 1, backgroundColor: '#0006', justifyContent: 'center', padding: 24 }}>
          <Card>
            <SectionTitle>PDF protegido</SectionTitle>
            <Text style={[styles.muted, { marginBottom: 12 }]}>
              {password?.wrong ? 'Senha incorreta. Tente novamente.' : 'Informe a senha do PDF. Nos extratos bancários costuma ser parte do CPF ou a data de nascimento.'}
            </Text>
            <TextInput
              value={pwText}
              onChangeText={setPwText}
              secureTextEntry
              autoFocus
              placeholder="Senha"
              placeholderTextColor={colors.muted}
              style={[styles.input, { marginBottom: 12 }]}
            />
            <Button
              title="Abrir"
              loading={busy}
              onPress={async () => {
                if (!password) return;
                setBusy(true);
                try { await readPdf(password.fileName, password.bytes, password.base64, pwText); }
                catch (e) { setPassword(null); showAlert('Erro', (e as Error).message); }
                finally { setBusy(false); setProgress(null); }
              }}
            />
            <Button title="Cancelar" variant="ghost" onPress={() => setPassword(null)} />
          </Card>
        </View>
      </Modal>
    </ScrollView>
  );
}

function Tip({ title, text }: { title: string; text: string }) {
  return (
    <View style={{ marginBottom: 10 }}>
      <Text style={{ fontWeight: '600', color: colors.text }}>{title}</Text>
      <Text style={styles.muted}>{text}</Text>
    </View>
  );
}

function periodOf(st: ParsedStatement): string | null {
  if (!st.transactions.length) return null;
  const dates = st.transactions.map((t) => t.date).sort();
  return `${formatDateBR(dates[0])} a ${formatDateBR(dates[dates.length - 1])}`;
}
