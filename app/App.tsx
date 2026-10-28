import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StatusBar, StyleSheet, Text, useColorScheme, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Copilot } from '../src/core/copilot';
import { MemoryStore } from '../src/core/memory';
import { CHAT_MODELS, EMBED_MODEL } from '../src/core/models';
import { VectorStore } from '../src/core/vectorStore';
import { LlamaRnEngine } from './src/engine';
import { loadIndex } from './src/loadIndex';
import { missingModels, modelPath } from './src/models';
import { FsStorage } from './src/storage';
import { AskScreen } from './src/ui/AskScreen';
import { ProfileScreen } from './src/ui/ProfileScreen';
import { SetupScreen } from './src/ui/SetupScreen';
import { useTheme } from './src/ui/theme';

type Phase =
  | { name: 'checking' }
  | { name: 'setup' }
  | { name: 'loading' }
  | { name: 'ready'; copilot: Copilot; memory: MemoryStore; loadMs: number; chunks: number }
  | { name: 'error'; message: string };

export default function App() {
  return (
    <SafeAreaProvider>
      <Root />
    </SafeAreaProvider>
  );
}

function Root() {
  const t = useTheme();
  const [phase, setPhase] = useState<Phase>({ name: 'checking' });
  const [tab, setTab] = useState<'ask' | 'profile'>('ask');

  const start = useCallback(async () => {
    try {
      setPhase({ name: 'checking' });
      if ((await missingModels()).length) return setPhase({ name: 'setup' });
      setPhase({ name: 'loading' });
      const t0 = performance.now();
      const [engine, index] = await Promise.all([
        LlamaRnEngine.create(modelPath(CHAT_MODELS['0.5b']), modelPath(EMBED_MODEL)),
        loadIndex(),
      ]);
      const memory = new MemoryStore(new FsStorage());
      const copilot = new Copilot(engine, new VectorStore(index), memory);
      setPhase({ name: 'ready', copilot, memory, loadMs: performance.now() - t0, chunks: index.chunks.length });
    } catch (e) {
      setPhase({ name: 'error', message: (e as Error).message });
    }
  }, []);

  useEffect(() => {
    start();
  }, [start]);

  const dark = useColorScheme() === 'dark';

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: t.bg }]} edges={['top', 'bottom']}>
      <StatusBar barStyle={dark ? 'light-content' : 'dark-content'} />
      <View style={[styles.header, { borderColor: t.border }]}>
        <Text style={[styles.title, { color: t.text }]}>Contextual Stock Tracker</Text>
        {phase.name === 'ready' && (
          <Text style={[styles.subtitle, { color: t.muted }]}>
            🔒 On-device · {phase.chunks.toLocaleString()} filing passages · loaded in {(phase.loadMs / 1000).toFixed(1)} s
          </Text>
        )}
      </View>

      {phase.name === 'setup' && <SetupScreen onReady={start} />}

      {(phase.name === 'checking' || phase.name === 'loading') && (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={t.accent} />
          <Text style={{ color: t.muted }}>{phase.name === 'loading' ? 'Loading models…' : 'Starting…'}</Text>
        </View>
      )}

      {phase.name === 'error' && (
        <View style={styles.center}>
          <Text style={[styles.errorTitle, { color: t.bad }]}>Couldn't start</Text>
          <Text style={[styles.errorText, { color: t.text }]}>{phase.message}</Text>
          <Pressable style={[styles.retry, { backgroundColor: t.accent }]} onPress={start}>
            <Text style={{ color: t.accentText, fontWeight: '600' }}>Try again</Text>
          </Pressable>
        </View>
      )}

      {phase.name === 'ready' && (
        <>
          <View style={styles.flex}>
            {tab === 'ask' ? <AskScreen copilot={phase.copilot} /> : <ProfileScreen memory={phase.memory} />}
          </View>
          <View style={[styles.tabs, { borderColor: t.border, backgroundColor: t.card }]}>
            {(['ask', 'profile'] as const).map((name) => (
              <Pressable key={name} style={styles.tab} onPress={() => setTab(name)}>
                <Text style={[styles.tabText, { color: tab === name ? t.accent : t.muted }]}>
                  {name === 'ask' ? 'Ask' : 'Profile'}
                </Text>
              </Pressable>
            ))}
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, gap: 2 },
  title: { fontSize: 18, fontWeight: '700' },
  subtitle: { fontSize: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  errorTitle: { fontSize: 18, fontWeight: '700' },
  errorText: { textAlign: 'center' },
  retry: { borderRadius: 10, paddingHorizontal: 20, paddingVertical: 12 },
  tabs: { flexDirection: 'row', borderTopWidth: 1 },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 14 },
  tabText: { fontSize: 15, fontWeight: '600' },
});
