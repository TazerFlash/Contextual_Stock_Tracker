import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { downloadModels, MODELS_DIR, REQUIRED_MODELS } from '../models';
import { useTheme } from './theme';

const mb = (bytes: number) => `${Math.round(bytes / 1e6)} MB`;

/** First launch: the models aren't on the device yet. */
export function SetupScreen({ onReady }: { onReady: () => void }) {
  const t = useTheme();
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const total = REQUIRED_MODELS.reduce((sum, m) => sum + m.file.bytes, 0);

  const start = async () => {
    setError(null);
    setProgress({ done: 0, total });
    try {
      await downloadModels((done, all) => setProgress({ done, total: all }));
      onReady();
    } catch (e) {
      setError((e as Error).message);
      setProgress(null);
    }
  };

  const pct = progress && progress.total ? Math.floor((progress.done / progress.total) * 100) : 0;

  return (
    <View style={[styles.wrap, { backgroundColor: t.bg }]}>
      <Text style={[styles.title, { color: t.text }]}>Set up on-device AI</Text>
      <Text style={[styles.body, { color: t.muted }]}>
        The copilot runs entirely on this phone. It needs two model files, downloaded once. After that it
        works offline and nothing you ask leaves the device.
      </Text>

      <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
        {REQUIRED_MODELS.map(({ label, file }) => (
          <View key={file.fileName} style={styles.row}>
            <Text style={{ color: t.text }}>{label}</Text>
            <Text style={{ color: t.muted }}>{mb(file.bytes)}</Text>
          </View>
        ))}
        <View style={[styles.row, styles.totalRow, { borderColor: t.border }]}>
          <Text style={[styles.bold, { color: t.text }]}>Total</Text>
          <Text style={[styles.bold, { color: t.text }]}>{mb(total)}</Text>
        </View>
      </View>

      {progress ? (
        <View style={styles.progressWrap}>
          <View style={[styles.track, { backgroundColor: t.border }]}>
            <View style={[styles.fill, { width: `${pct}%`, backgroundColor: t.accent }]} />
          </View>
          <Text style={{ color: t.muted }}>
            {pct}% · {mb(progress.done)} of {mb(progress.total)}
          </Text>
          <ActivityIndicator color={t.accent} />
        </View>
      ) : (
        <Pressable style={[styles.button, { backgroundColor: t.accent }]} onPress={start}>
          <Text style={[styles.buttonText, { color: t.accentText }]}>Download models ({mb(total)})</Text>
        </Pressable>
      )}

      {error && <Text style={[styles.error, { color: t.bad }]}>{error}</Text>}
      <Text style={[styles.hint, { color: t.muted }]}>Saved to {MODELS_DIR}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: 24, justifyContent: 'center', gap: 16 },
  title: { fontSize: 24, fontWeight: '700' },
  body: { fontSize: 15, lineHeight: 22 },
  card: { borderWidth: 1, borderRadius: 12, padding: 16, gap: 10 },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  totalRow: { borderTopWidth: 1, paddingTop: 10 },
  bold: { fontWeight: '700' },
  progressWrap: { gap: 8, alignItems: 'center' },
  track: { height: 8, borderRadius: 4, overflow: 'hidden', alignSelf: 'stretch' },
  fill: { height: 8 },
  button: { borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
  buttonText: { fontSize: 16, fontWeight: '600' },
  error: { textAlign: 'center' },
  hint: { fontSize: 11, textAlign: 'center' },
});
