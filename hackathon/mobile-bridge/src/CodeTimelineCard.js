/*
 * v0.7 code timeline card (flag EXPO_PUBLIC_LYLO_CODE_TIMELINE=1). Renders nothing when off.
 * Real scans are recorded once in local phone storage; demo scans show a synthetic history and are never stored.
 */
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { features, buildTimeline, loadHistory, recordScan, saveHistory, isDemo } from './codeTimeline';

let defaultStorage = null;
try { defaultStorage = require('@react-native-async-storage/async-storage').default; } catch (e) { defaultStorage = null; }

export default function CodeTimelineCard({ scan, env, storage, now }) {
  const on = features(env).on;
  const store = storage === undefined ? defaultStorage : storage;
  const [history, setHistory] = useState(null);
  useEffect(() => {
    if (!on || !scan) return undefined;
    let live = true;
    (async () => {
      if (isDemo(scan)) { if (live) setHistory({ v: 1, vehicles: {} }); return; }
      const h = recordScan(await loadHistory(store), scan, now);
      await saveHistory(store, h);
      if (live) setHistory(h);
    })();
    return () => { live = false; };
  }, [on, scan, store]);
  if (!on || !scan || !history) return null;
  const t = buildTimeline(scan, history, now);
  if (!t) return null;
  return (
    <View style={s.card} testID="code-timeline">
      <Text style={s.title}>CODE TIMELINE</Text>
      {t.demoLabel ? <Text style={s.demo} testID="ct-demo">{t.demoLabel}</Text> : null}
      <Text style={s.note} testID="ct-note">{t.note}</Text>
      {t.noVin ? <Text style={s.small} testID="ct-novin">Vehicle not identified, so this scan is not added to any car's history.</Text> : null}
      {t.freeze ? (
        <View style={s.box} testID="ct-freeze">
          <Text style={s.h}>{`Freeze frame for ${t.freeze.code}`}</Text>
          <Text style={s.small}>{t.freezeNote}</Text>
          {t.freeze.rows.map((r) => <View key={r.label} style={s.row}><Text style={s.label}>{r.label}</Text><Text style={s.val}>{r.value}</Text></View>)}
        </View>
      ) : null}
      <View style={s.box}>
        {t.counters.map((c) => <View key={c.label} style={s.row}><Text style={s.label}>{c.label}</Text><Text style={c.reported ? s.val : s.dim}>{c.value}</Text></View>)}
      </View>
      {t.empty ? <Text style={s.small}>No codes seen yet. LYLO will start the timeline the first time a code shows up.</Text> : null}
      {t.rows.map((r) => (
        <View key={r.code} style={s.box} testID={'ct-row-' + r.code}>
          <Text style={s.h}>{r.code + (r.inThisScan ? '' : '  (not in this scan)')}</Text>
          {r.labels.map((l) => <Text key={l} style={s.tag}>{l}</Text>)}
          <Text style={s.small}>{`First seen by LYLO: ${r.firstSeen} · ${r.lastLabel || 'Last seen'}: ${r.lastSeen} · Seen in ${r.count} ${r.count === 1 ? 'scan' : 'scans'}`}</Text>
        </View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: '#161a22', borderRadius: 12, padding: 16, marginTop: 20 },
  title: { color: '#f5c518', fontSize: 15, fontWeight: '900', letterSpacing: 1 },
  demo: { color: '#f4a261', fontSize: 15, fontWeight: '800', marginTop: 8 },
  note: { color: '#ffffff', fontSize: 16, marginTop: 8 },
  box: { borderTopWidth: 1, borderTopColor: '#2a3040', marginTop: 12, paddingTop: 10 },
  h: { color: '#ffffff', fontSize: 17, fontWeight: '800' },
  tag: { color: '#f5c518', fontSize: 15, fontWeight: '700', marginTop: 4 },
  small: { color: '#aab2c0', fontSize: 14, marginTop: 4 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  label: { color: '#aab2c0', fontSize: 14, flex: 1 },
  val: { color: '#ffffff', fontSize: 14, fontWeight: '800' },
  dim: { color: '#7a8292', fontSize: 14, fontStyle: 'italic' },
});
