/*
 * LYLO Mechanic hackathon v0.4.7: "Try a demo scan". No car, no adapter, no Bluetooth.
 * Each case is a bundled scan the SERVER runs through the real pipeline (rules, Muse Detective,
 * never-lower merge). "AI vs rules" shows a labeled SIMULATED AI answer losing to the rules.
 */
import React, { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { C } from '../../../baseline/mobile/src/constants/colors';
import { configuredUrl, configuredKey } from './scanHook';
import { CASES, replay, proof, replayView, proofView } from './demo';
import { ProveReplay } from './ProvePanel'; // v0.5.1 'Run the proof'

const Y = '#f5c518';
const TONE = { SAFE_TO_DRIVE: '#2a9d8f', INSPECT_SOON: '#f5c518', DRIVE_SHORT_DISTANCE_ONLY: '#f4a261', DO_NOT_DRIVE: '#e5383b', TOW_RECOMMENDED: '#e5383b', EMERGENCY_STOP_IMMEDIATELY: '#ff1f3d' };

function Big({ title, onPress, kind, testID }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" testID={testID} style={[s.btn, kind === 'secondary' ? s.btn2 : null]}>
      <Text style={[s.btnText, kind === 'secondary' ? { color: '#fff' } : null]}>{title}</Text>
    </Pressable>
  );
}

function Verdict({ level, text, tag, testID }) {
  return (
    <View style={[s.verdict, { borderColor: TONE[level] || '#555' }]} testID={testID}>
      {tag ? <Text style={s.tag}>{tag}</Text> : null}
      <Text style={[s.vText, { color: TONE[level] || '#fff' }]}>{text}</Text>
    </View>
  );
}

export default function DemoScreen({ navigation, fetchImpl, baseUrl, appKey }) {
  const opts = { baseUrl: baseUrl === undefined ? configuredUrl() : baseUrl, appKey: appKey === undefined ? configuredKey() : appKey, fetchImpl };
  const [busy, setBusy] = useState(null);
  const [msg, setMsg] = useState(null);
  const [view, setView] = useState(null);
  const [pv, setPv] = useState(null);

  async function run(id) {
    setBusy(id); setMsg(null); setView(null); setPv(null);
    const r = await replay(id, opts);
    setBusy(null);
    if (r.ok) setView(replayView(r.body)); else setMsg(r.error);
  }
  async function runProof() {
    setBusy('proof'); setMsg(null); setView(null); setPv(null);
    const r = await proof(opts);
    setBusy(null);
    if (r.ok) setPv(proofView(r.body)); else setMsg(r.error);
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg || '#0a0c0f' }} contentContainerStyle={s.scroll} testID="demo-screen">
      <Text style={s.h1}>Try a demo scan</Text>
      <Text style={s.body}>No car or adapter needed. Each demo sends a saved scan to the LYLO server, which runs it through the same steps as a real scan: safety rules first, then Meta's Muse AI explains, citing the evidence.</Text>
      {CASES.map((c) => (
        <Pressable key={c.id} onPress={() => run(c.id)} style={s.case} accessibilityRole="button" testID={'demo-' + c.id}>
          <Text style={s.caseT}>{c.title}</Text>
          <Text style={s.caseS}>{c.short}</Text>
        </Pressable>
      ))}
      <Big title="AI vs rules: who wins?" onPress={runProof} kind="secondary" testID="demo-proof" />
      {busy ? <View style={{ alignItems: 'center', marginTop: 16 }}><ActivityIndicator size="large" color={Y} /><Text style={s.body}>Running on the server…</Text></View> : null}
      {msg ? <Text style={s.msg} testID="demo-msg">{msg}</Text> : null}

      {view ? (
        <View style={s.card} testID="demo-result">
          <Text style={s.h2}>{view.title}</Text>
          <Text style={s.small}>{view.source}</Text>
          <Verdict level={view.level} text={view.levelText} testID="demo-verdict" />
          {view.recentlyCleared ? <Text style={s.warn}>Codes were cleared recently. Problems can stay hidden until the self-tests finish.</Text> : null}
          {view.coldNote ? <Text style={s.small}>{view.coldNote}</Text> : null}
          {view.museOk ? (
            <>
              {view.causes.map((c, i) => <Text key={i} style={s.body}>{i + 1}. {c.cause} ({c.confidence} confidence, {c.cites} evidence items)</Text>)}
              {view.explanation ? <Text style={s.body}>{view.explanation}</Text> : null}
              <Text style={s.small}>Rules said: {view.rulesLevel} · AI said: {view.aiLevel || 'no opinion'} · Result: {view.action}</Text>
              {view.receipt ? <Text style={s.receipt} testID="demo-receipt">Receipt: {view.receipt.model}, {view.receipt.seconds} s, {view.receipt.cited} of {view.receipt.ledger} evidence items cited{view.unverified ? `, ${view.unverified} unverified claim(s) withheld` : ''}</Text> : null}
            </>
          ) : <Text style={s.small}>AI step: {view.museStatus}. The safety rules still decided the level.</Text>}
        </View>
      ) : null}

      {pv ? (
        <View style={s.card} testID="demo-proof-result">
          <Text style={s.label} testID="demo-simulated-label">{pv.label}</Text>
          <Text style={s.h2}>Overheating scan: coolant 260 °F</Text>
          <Verdict level={pv.ai} text={pv.aiText} tag="AI's answer (simulated)" testID="proof-ai" />
          <Verdict level={pv.rules} text={pv.rulesText} tag="Safety rules" testID="proof-rules" />
          <Verdict level={pv.final} text={pv.finalText} tag={'Shown to you: ' + pv.winner + ' won'} testID="proof-final" />
          <Text style={s.body}>{pv.explain}</Text>
          <Text style={s.small}>Merge result: {pv.action}</Text>
        </View>
      ) : null}
      <ProveReplay opts={opts} />
      <Big title="Home" onPress={() => navigation && navigation.navigate('Home')} kind="secondary" />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  scroll: { padding: 18, paddingBottom: 48 },
  h1: { color: '#fff', fontSize: 26, fontWeight: '800', marginBottom: 8 },
  h2: { color: '#fff', fontSize: 20, fontWeight: '800', marginBottom: 6 },
  body: { color: '#c5d1dc', fontSize: 17, lineHeight: 24, marginTop: 6 },
  small: { color: '#9fb0c0', fontSize: 15, lineHeight: 21, marginTop: 6 },
  receipt: { color: '#8cc8ff', fontSize: 15, marginTop: 10, fontWeight: '700' },
  warn: { color: '#ffb4a2', fontSize: 16, marginTop: 8, fontWeight: '700' },
  msg: { color: '#ffb4a2', fontSize: 16, marginTop: 12 },
  label: { color: '#0a0c0f', backgroundColor: Y, fontWeight: '800', padding: 8, borderRadius: 8, marginBottom: 10 },
  case: { backgroundColor: '#121a24', borderRadius: 14, padding: 16, marginTop: 10 },
  caseT: { color: '#fff', fontSize: 18, fontWeight: '800' },
  caseS: { color: '#9fb0c0', fontSize: 14, marginTop: 4 },
  card: { backgroundColor: '#121a24', borderRadius: 16, padding: 16, marginTop: 16 },
  verdict: { borderWidth: 3, borderRadius: 12, padding: 12, marginTop: 10 },
  tag: { color: '#9fb0c0', fontSize: 14, fontWeight: '700' },
  vText: { fontSize: 20, fontWeight: '900' },
  btn: { backgroundColor: Y, borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 14 },
  btn2: { backgroundColor: '#1b2330' },
  btnText: { color: '#0a0c0f', fontSize: 18, fontWeight: '800' },
});
