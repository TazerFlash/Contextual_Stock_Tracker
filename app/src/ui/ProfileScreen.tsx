import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { estimateTokens, MEMORY_TOKEN_BUDGET, renderMemory, type MemoryStore } from '../../../src/core/memory';
import type { SharedMemory } from '../../../src/core/types';
import { useTheme } from './theme';

/** Layer 2: the investor profile the copilot personalizes answers with. Stored only on this phone. */
export function ProfileScreen({ memory }: { memory: MemoryStore }) {
  const t = useTheme();
  const [profile, setProfile] = useState<SharedMemory | null>(null);
  const [watchlistText, setWatchlistText] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    memory.load().then((m) => {
      setProfile(m);
      setWatchlistText(m.watchlist.join(', '));
    });
  }, [memory]);

  if (!profile) return null;

  const update = (patch: Partial<SharedMemory>) => {
    setProfile({ ...profile, ...patch });
    setSaved(false);
  };

  const setTicker = (ticker: string, field: 'targetPrices' | 'recentSentiment', value: string) => {
    const next = { ...profile[field] } as Record<string, string | number>;
    if (!value.trim()) delete next[ticker];
    else next[ticker] = field === 'targetPrices' ? Number(value.replace(/[^0-9.]/g, '')) || 0 : value;
    update({ [field]: next } as Partial<SharedMemory>);
  };

  const save = async () => {
    const watchlist = watchlistText
      .split(/[,\s]+/)
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    const next = { ...profile, watchlist };
    await memory.save(next);
    setProfile(await memory.load());
    setSaved(true);
  };

  const tokens = estimateTokens(renderMemory(profile));
  const field = [styles.field, { color: t.text, borderColor: t.border, backgroundColor: t.card }];

  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={styles.wrap} keyboardShouldPersistTaps="handled">
      <Text style={[styles.label, { color: t.muted }]}>Watchlist</Text>
      <TextInput style={field} value={watchlistText} onChangeText={(v) => { setWatchlistText(v); setSaved(false); }} autoCapitalize="characters" />

      {profile.watchlist.map((ticker) => (
        <View key={ticker} style={[styles.tickerCard, { backgroundColor: t.card, borderColor: t.border }]}>
          <Text style={[styles.ticker, { color: t.text }]}>{ticker}</Text>
          <View style={styles.tickerRow}>
            <Text style={[styles.small, { color: t.muted }]}>Target $</Text>
            <TextInput
              style={[...field, styles.flex]}
              keyboardType="numeric"
              value={profile.targetPrices[ticker] !== undefined ? String(profile.targetPrices[ticker]) : ''}
              onChangeText={(v) => setTicker(ticker, 'targetPrices', v)}
              placeholder="none"
              placeholderTextColor={t.muted}
            />
          </View>
          <View style={styles.tickerRow}>
            <Text style={[styles.small, { color: t.muted }]}>Sentiment</Text>
            <TextInput
              style={[...field, styles.flex]}
              value={profile.recentSentiment[ticker] ?? ''}
              onChangeText={(v) => setTicker(ticker, 'recentSentiment', v)}
              placeholder="e.g. Strong Buy"
              placeholderTextColor={t.muted}
            />
          </View>
        </View>
      ))}

      <Text style={[styles.label, { color: t.muted }]}>Notes</Text>
      <TextInput style={[...field, styles.notes]} value={profile.portfolioNotes} onChangeText={(v) => update({ portfolioNotes: v })} multiline />

      <Text style={[styles.label, { color: t.muted }]}>Learned from your feedback</Text>
      {profile.insights.length === 0 && <Text style={{ color: t.muted }}>Nothing yet. Tap 👍 on a helpful answer.</Text>}
      {profile.insights.map((insight, i) => (
        <View key={insight.createdAt + i} style={[styles.insight, { borderColor: t.border }]}>
          <Text style={[styles.flex, { color: t.text }]}>{insight.text}</Text>
          <Pressable onPress={() => update({ insights: profile.insights.filter((_, j) => j !== i) })}>
            <Text style={{ color: t.bad }}>Remove</Text>
          </Pressable>
        </View>
      ))}

      <Text style={[styles.small, { color: tokens > MEMORY_TOKEN_BUDGET ? t.bad : t.muted }]}>
        ~{tokens} of {MEMORY_TOKEN_BUDGET} tokens used · stored only on this device
      </Text>
      <Pressable style={[styles.save, { backgroundColor: t.accent }]} onPress={save}>
        <Text style={{ color: t.accentText, fontWeight: '600' }}>{saved ? 'Saved ✓' : 'Save profile'}</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: 16, gap: 10, paddingBottom: 40 },
  label: { fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 6 },
  field: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 15 },
  tickerCard: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 8 },
  ticker: { fontSize: 16, fontWeight: '700' },
  tickerRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  small: { fontSize: 12, minWidth: 70 },
  flex: { flex: 1 },
  notes: { minHeight: 80, textAlignVertical: 'top' },
  insight: { flexDirection: 'row', gap: 10, borderBottomWidth: 1, paddingVertical: 8 },
  save: { borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 8 },
});
