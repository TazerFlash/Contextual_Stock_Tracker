import React, { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { AskResult, Copilot } from '../../../src/core/copilot';
import { useTheme } from './theme';

const SUGGESTIONS = [
  "How fast did NVIDIA's Data Center revenue grow last quarter?",
  'Did Apple’s iPhone revenue grow, and does that affect my plan to trim AAPL?',
  'Is Azure still growing, and how does that fit my MSFT target?',
  'What export control risks does NVIDIA face in China?',
];

const seconds = (ms: number | null) => (ms === null ? '–' : `${(ms / 1000).toFixed(1)} s`);

export function AskScreen({ copilot }: { copilot: Copilot }) {
  const t = useTheme();
  const [query, setQuery] = useState('');
  const [asked, setAsked] = useState('');
  const [streaming, setStreaming] = useState('');
  const [result, setResult] = useState<AskResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [learned, setLearned] = useState<string | null>(null);
  const [learning, setLearning] = useState(false);
  const [openSource, setOpenSource] = useState<number | null>(null);

  const ask = async (q: string) => {
    const question = q.trim();
    if (!question || busy) return;
    setAsked(question);
    setQuery('');
    setStreaming('');
    setResult(null);
    setError(null);
    setLearned(null);
    setOpenSource(null);
    setBusy(true);
    try {
      let text = '';
      setResult(
        await copilot.ask(question, (token) => {
          text += token;
          setStreaming(text);
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const markHelpful = async () => {
    if (!result) return;
    setLearning(true);
    try {
      setLearned((await copilot.learn(asked, result.answer)) ?? 'Nothing new to remember.');
    } finally {
      setLearning(false);
    }
  };

  const answer = result?.answer ?? streaming;

  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={styles.wrap} keyboardShouldPersistTaps="handled">
      <View style={[styles.inputRow, { backgroundColor: t.card, borderColor: t.border }]}>
        <TextInput
          style={[styles.input, { color: t.text }]}
          placeholder="Ask about your watchlist…"
          placeholderTextColor={t.muted}
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={() => ask(query)}
          editable={!busy}
          multiline
        />
        <Pressable
          style={[styles.askButton, { backgroundColor: busy || !query.trim() ? t.border : t.accent }]}
          onPress={() => ask(query)}
          disabled={busy || !query.trim()}>
          <Text style={{ color: t.accentText, fontWeight: '600' }}>Ask</Text>
        </Pressable>
      </View>

      {!asked && (
        <View style={styles.suggestions}>
          <Text style={[styles.label, { color: t.muted }]}>Try</Text>
          {SUGGESTIONS.map((s) => (
            <Pressable key={s} style={[styles.chip, { backgroundColor: t.chip }]} onPress={() => ask(s)}>
              <Text style={{ color: t.text }}>{s}</Text>
            </Pressable>
          ))}
        </View>
      )}

      {asked !== '' && (
        <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
          <Text style={[styles.question, { color: t.text }]}>{asked}</Text>
          {answer ? (
            <Text style={[styles.answer, { color: t.text }]}>{answer}</Text>
          ) : (
            busy && (
              <View style={styles.thinking}>
                <ActivityIndicator color={t.accent} />
                <Text style={{ color: t.muted }}>Searching filings and thinking on-device…</Text>
              </View>
            )
          )}
          {error && <Text style={{ color: t.bad }}>{error}</Text>}
        </View>
      )}

      {result && (
        <>
          <Text style={[styles.timing, { color: t.muted }]}>
            On-device · search {Math.round(result.timings.embedMs + result.timings.retrieveMs)} ms · first word{' '}
            {seconds(result.timings.firstTokenMs)} · total {seconds(result.timings.totalMs)}
          </Text>

          <Text style={[styles.label, { color: t.muted }]}>Sources</Text>
          {result.sources.map((s, i) => (
            <Pressable
              key={s.id}
              style={[styles.source, { backgroundColor: t.card, borderColor: t.border }]}
              onPress={() => setOpenSource(openSource === i ? null : i)}>
              <Text style={{ color: t.text, fontWeight: '600' }}>
                [{i + 1}] {s.source.ticker} {s.source.form} · filed {s.source.filedAt}
              </Text>
              <Text style={{ color: t.muted }} numberOfLines={openSource === i ? undefined : 2}>
                {s.text}
              </Text>
            </Pressable>
          ))}

          {learned ? (
            <Text style={[styles.learned, { color: t.good }]}>Remembered: {learned}</Text>
          ) : (
            <Pressable
              style={[styles.helpful, { borderColor: t.accent }]}
              onPress={markHelpful}
              disabled={learning}>
              {learning ? (
                <ActivityIndicator color={t.accent} />
              ) : (
                <Text style={{ color: t.accent, fontWeight: '600' }}>👍 Helpful: remember the takeaway</Text>
              )}
            </Pressable>
          )}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: 16, gap: 12, paddingBottom: 40 },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', borderWidth: 1, borderRadius: 12, padding: 8, gap: 8 },
  input: { flex: 1, fontSize: 16, maxHeight: 120, paddingHorizontal: 6 },
  askButton: { borderRadius: 8, paddingHorizontal: 16, paddingVertical: 10 },
  suggestions: { gap: 8 },
  label: { fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  chip: { borderRadius: 10, padding: 12 },
  card: { borderWidth: 1, borderRadius: 12, padding: 14, gap: 10 },
  question: { fontSize: 15, fontWeight: '700' },
  answer: { fontSize: 15, lineHeight: 22 },
  thinking: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  timing: { fontSize: 12 },
  source: { borderWidth: 1, borderRadius: 10, padding: 12, gap: 4 },
  helpful: { borderWidth: 1, borderRadius: 10, padding: 12, alignItems: 'center' },
  learned: { fontWeight: '600' },
});
