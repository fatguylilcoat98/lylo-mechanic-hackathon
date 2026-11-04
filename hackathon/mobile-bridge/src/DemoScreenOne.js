/*
 * LYLO Mechanic v0.7.5 "Try a demo", one verdict per screen (flag EXPO_PUBLIC_LYLO_ONE_VERDICT=1).
 * The list opens ONE demo at a time on its own screen: the car is named at the top, one verdict is
 * pinned under it, then Simple or Mechanic detail for that same car only. Switching demos clears the
 * last result. Server demos take their level from the server replay (rules), only ever raised by
 * what this screen also shows (oneVerdict.decide).
 */
import React, { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { configuredUrl, configuredKey } from './scanHook';
import { CASES, replay, proof } from './demo';
import { REPLAY_CASES, replay as proveReplay, asScan, bannerOf } from './prove';
import { buildV2 } from './ui2/model';
import { ResultsV2Body } from './ui2/ResultsV2';
import { PredictionBanner } from './ui2/components';
import * as VM from './viewModes';
import { MechanicDeep, PlainResults, ViewSwitch } from './ViewModeScreens';
const OV = require('./oneVerdict');
const { DEMO_SCANS } = require('../../../baseline/mobile/src/data/demoScans');

const Y = '#f5c518';
const BG = { green: '#2a9d8f', yellow: '#f5c518', orange: '#f4a261', red: '#e5383b' };

// Every demo in one list. kind: server replay | proof | saved (on the phone) | prove (Meta AI proof replay)
const ALL = [
  ...CASES.map((c) => ({ ...c, kind: 'server' })),
  { id: 'proof', kind: 'proof', title: 'Safety rules vs. AI: who wins?', short: 'A made-up AI answer says the overheating car is fine. Watch the safety rules overrule it.' },
  { id: 'checkengine', kind: 'saved', title: 'Check-engine light: Simple vs Mechanic view', short: 'A saved sample scan (2003 Honda, made-up). Flip between the two views.' },
  ...REPLAY_CASES.map((c) => ({ ...c, kind: 'prove', title: 'Meta AI proof: ' + c.title })),
];

export function Headline({ level, car, sub }) {
  const t = OV.TITLES[level] || OV.TITLES.INSPECT_SOON;
  const tone = OV.TONE[level] || 'yellow';
  return (
    <View style={s.pin} testID="one-headline-wrap">
      <Text style={s.demoTag}>DEMO · not your car</Text>
      <Text style={s.car} testID="one-car">{car}</Text>
      <View style={[s.verdict, { backgroundColor: BG[tone] }]} testID={'one-headline-' + tone}>
        <Text style={s.vT} testID="one-headline">{t.title}</Text>
        <Text style={s.vW}>{sub || t.why}</Text>
      </View>
    </View>
  );
}

/** Pure: a server demo/prove reply -> what one demo screen shows. Exported for tests. */
export function serverModel(body, screen, env) {
  const isProve = !!(body && (body.replay || (body.detective && body.detective.prediction_replay)));
  const sc = isProve ? asScan(body) : { serverDiagnosis: { source: 'server', result: body }, demoLabel: null };
  const m = buildV2(sc, { screen: screen || 'codes', env });
  if (!m) return null;
  return { m, plainScan: OV.scanFromResult(body), prediction: isProve ? bannerOf(body.prediction || (body.detective || {}).prediction, body.prove || (body.detective || {}).prove) : null };
}

function Detail({ m, plainScan, env, navigation }) {
  const [mode, setMode] = useState('simple');
  return (
    <View>
      <ViewSwitch mode={mode} onChange={setMode} />
      {mode === 'simple'
        ? <PlainResults p={VM.buildPlain(m, plainScan, env)} tone={m.tone} noVerdict />
        : <><MechanicDeep k={VM.buildMechanic(m, plainScan)} navigation={navigation} plainLevel />{m.seeWhy ? <ResultsV2Body m={m} pinnedReplay noBanner expandAll /> : null}</>}
    </View>
  );
}

export default function DemoScreenOne({ navigation, fetchImpl, baseUrl, appKey, env }) {
  const opts = { baseUrl: baseUrl === undefined ? configuredUrl() : baseUrl, appKey: appKey === undefined ? configuredKey() : appKey, fetchImpl };
  const [active, setActive] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [res, setRes] = useState(null);

  async function open(c) {
    setActive(c); setRes(null); setMsg(null); // switching demos always clears the last result
    if (c.kind === 'saved') {
      const scan = DEMO_SCANS[c.id];
      setRes({ kind: 'saved', m: VM.demoModel(scan, env), plainScan: scan, car: scan.demoLabel || c.title });
      return;
    }
    setBusy(true);
    const r = c.kind === 'server' ? await replay(c.id, opts) : c.kind === 'proof' ? await proof(opts) : await proveReplay(c.id, opts);
    setBusy(false);
    if (!r.ok) { setMsg(r.error); return; }
    if (c.kind === 'proof') {
      const p = r.body.proof || {};
      const final = OV.ORDER.includes(p.final_verdict) ? p.final_verdict : 'INSPECT_SOON';
      setRes({ kind: 'proof', p, level: OV.maxLevel(final, p.rules_verdict), car: p.title || c.title });
      return;
    }
    const sm = serverModel(r.body, c.id === 'usedcar' ? 'usedcar' : 'codes', env);
    if (!sm) { setMsg('The server answered, but not with a result this app can show.'); return; }
    setRes({ kind: 'server', ...sm, car: (r.body.demo && r.body.demo.title) || c.title });
  }

  if (!active) {
    return (
      <ScrollView style={s.screen} contentContainerStyle={s.scroll} testID="demo-screen">
        <Text style={s.h1}>Try a demo</Text>
        <Text style={s.body}>No car or adapter needed. Pick one. Each demo opens on its own screen with one car and one answer at the top.</Text>
        {ALL.map((c) => (
          <Pressable key={c.id} onPress={() => open(c)} style={s.case} accessibilityRole="button" testID={'demo-' + (c.kind === 'prove' ? 'prove-' : '') + c.id}>
            <Text style={s.caseT}>{c.title}</Text><Text style={s.caseS}>{c.short}</Text>
          </Pressable>
        ))}
        <Pressable onPress={() => navigation && navigation.navigate('Home')} style={[s.btn, s.btn2]} accessibilityRole="button"><Text style={[s.btnT, { color: '#fff' }]}>Home</Text></Pressable>
      </ScrollView>
    );
  }

  const level = res ? (res.kind === 'proof' ? res.level : res.m.levelCode) : null;
  return (
    <ScrollView style={s.screen} contentContainerStyle={s.scroll} stickyHeaderIndices={res ? [1] : undefined} testID="demo-one">
      <Pressable onPress={() => { setActive(null); setRes(null); setMsg(null); }} accessibilityRole="button" testID="demo-back" style={s.back}><Text style={s.backT}>{'‹ All demos'}</Text></Pressable>
      {res ? <Headline level={level} car={res.car} sub={res.kind === 'proof' ? 'The safety rules decided this. The AI cannot lower it.' : res.m.verdict && res.m.verdict.why} /> : <View />}
      {busy ? <View style={{ alignItems: 'center', marginTop: 16 }}><ActivityIndicator size="large" color={Y} /><Text style={s.body}>Running the demo on the LYLO server…</Text></View> : null}
      {msg ? <Text style={s.msg} testID="demo-msg">{msg}</Text> : null}
      {res && res.kind === 'proof' ? (
        <View style={s.card} testID="demo-proof-result">
          <Text style={s.label} testID="demo-simulated-label">{res.p.label || 'Simulated AI answer for this test'}</Text>
          <Text style={s.body}>{'1. The AI (simulated) said: ' + OV.plainLevel(res.p.ai_verdict) + '.'}</Text>
          <Text style={s.body}>{'2. The safety rules said: ' + OV.plainLevel(res.p.rules_verdict) + '.'}</Text>
          <Text style={s.body}>{'3. You are shown the safer one: ' + OV.plainLevel(level) + '. ' + (res.p.winner === 'ai' ? 'The AI raised it.' : 'The rules won.')}</Text>
          {res.p.explain ? <Text style={s.small}>{res.p.explain}</Text> : null}
        </View>
      ) : null}
      {res && res.kind !== 'proof' ? (
        <View style={s.card} testID="demo-result">
          {res.prediction ? <PredictionBanner prediction={res.prediction} /> : null}
          <Detail m={res.m} plainScan={res.plainScan} env={env} navigation={navigation} />
        </View>
      ) : null}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0a0c0f' },
  scroll: { padding: 18, paddingBottom: 48 },
  h1: { color: '#fff', fontSize: 26, fontWeight: '800', marginBottom: 8 },
  body: { color: '#c5d1dc', fontSize: 17, lineHeight: 24, marginTop: 6 },
  small: { color: '#9fb0c0', fontSize: 15, lineHeight: 21, marginTop: 6 },
  msg: { color: '#ffb4a2', fontSize: 16, marginTop: 12 },
  label: { color: '#0a0c0f', backgroundColor: Y, fontWeight: '800', padding: 8, borderRadius: 8, marginBottom: 10 },
  case: { backgroundColor: '#121a24', borderRadius: 14, padding: 16, marginTop: 10 },
  caseT: { color: '#fff', fontSize: 18, fontWeight: '800' },
  caseS: { color: '#9fb0c0', fontSize: 14, marginTop: 4 },
  card: { backgroundColor: '#121a24', borderRadius: 16, padding: 16, marginTop: 16 },
  pin: { backgroundColor: '#0a0c0f', paddingBottom: 8 },
  demoTag: { color: Y, fontWeight: '800', fontSize: 13, marginTop: 4 },
  car: { color: '#fff', fontSize: 21, fontWeight: '900', marginTop: 2 },
  verdict: { borderRadius: 14, padding: 14, marginTop: 8 },
  vT: { color: '#0a0c0f', fontSize: 24, fontWeight: '900' },
  vW: { color: '#0a0c0f', fontSize: 16, marginTop: 4, fontWeight: '600' },
  back: { minHeight: 44, justifyContent: 'center' },
  backT: { color: '#8cc8ff', fontSize: 17, fontWeight: '800' },
  btn: { backgroundColor: Y, borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 14 },
  btn2: { backgroundColor: '#1b2330' },
  btnT: { color: '#0a0c0f', fontSize: 18, fontWeight: '800' },
});
