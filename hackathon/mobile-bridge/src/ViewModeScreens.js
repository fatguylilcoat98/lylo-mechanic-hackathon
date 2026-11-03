/*
 * LYLO Mechanic v0.7.2 (flag EXPO_PUBLIC_LYLO_VIEW_MODE=1): opening Simple/Mechanic choice,
 * the guided Simple flow, "Where does it plug in?", and the two result layouts.
 * Flag off: nothing imports these into a visible screen, so nothing changes.
 */
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as VM from './viewModes';

const BG = '#0a0c0f'; const Y = '#f5c518'; const TXT = '#ffffff'; const DIM = '#b8c4d0'; const CARD = '#161c25';
const TONE = { green: '#00c87a', yellow: '#f5c518', orange: '#ff8a1f', red: '#e5383b' };

export function BigChoice({ title, sub, onPress, testID }) {
  return (
    <Pressable onPress={onPress} testID={testID} accessibilityRole="button" style={s.choice}>
      <Text style={s.choiceT}>{title}</Text>{sub ? <Text style={s.choiceS}>{sub}</Text> : null}
    </Pressable>
  );
}

/** Opening choice, shown before anything else until the person picks. */
export function ViewChoice({ onPick }) {
  return (
    <View testID="vm-choice">
      <Text style={s.h1}>How do you want LYLO to talk to you?</Text>
      <BigChoice testID="vm-simple" title="Simple view" sub="Step by step, in plain English. No car knowledge needed." onPress={() => onPick('simple')} />
      <BigChoice testID="vm-mechanic" title="Mechanic view" sub="Every detail: codes, live data, freeze frame, tests." onPress={() => onPick('mechanic')} />
      <Text style={s.small}>You can switch any time.</Text>
    </View>
  );
}

export function ViewSwitch({ mode, onChange }) {
  return (
    <View style={s.toggle} testID="vm-toggle">
      {VM.MODES_LIST.map((m) => (
        <Pressable key={m} testID={'vm-toggle-' + m} onPress={() => onChange(m)} accessibilityRole="tab" accessibilityState={{ selected: mode === m }} style={[s.tBtn, mode === m && s.tOn]}>
          <Text style={[s.tTxt, mode === m && s.tTxtOn]}>{m === 'simple' ? 'Simple view' : 'Mechanic view'}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/** Original drawing built from plain shapes: dashboard, steering wheel, and the 16-pin port near the driver's knees. */
export function PortDrawing() {
  const pins = (n) => Array.from({ length: n }, (_, i) => <View key={i} style={s.pin} />);
  return (
    <View style={s.draw} testID="vm-port-drawing" accessible accessibilityLabel="Drawing: the plug is under the dashboard, below the steering wheel, near your knees">
      <View style={s.dash}><Text style={s.drawLbl}>DASHBOARD</Text></View>
      <View style={s.wheel}><View style={s.hub} /></View>
      <View style={s.column} />
      <View style={s.portWrap}>
        <View style={s.port}>
          <View style={s.pinRow}>{pins(8)}</View>
          <View style={[s.pinRow, { paddingHorizontal: 6 }]}>{pins(8)}</View>
        </View>
        <Text style={s.arrow}>{'\u2B06  The plug: 16 pins, wide D shape'}</Text>
      </View>
      <Text style={s.drawLbl2}>{'Driver\u2019s side, below the wheel, near your knees'}</Text>
    </View>
  );
}

export function PortHelp({ testID = 'vm-port-help' }) {
  const h = VM.PORT_HELP;
  return (
    <View testID={testID}>
      <Text style={s.h1}>{h.title}</Text>
      <PortDrawing />
      <Text style={s.body}>{h.where}</Text>
      {h.steps.map((t, i) => <Text key={t} style={s.step}>{`${i + 1}.  ${t}`}</Text>)}
      <Text style={s.h2}>{"Can't find it?"}</Text>
      {h.cantFind.map((t) => <Text key={t} style={s.body}>{'\u2022  ' + t}</Text>)}
      <Text style={s.small}>{h.note}</Text>
    </View>
  );
}

/** Guided Simple flow: sensor question, then one step per screen. */
export function SimpleGuide({ navigation }) {
  const [path, setPath] = useState(null); // 'sensor' | 'nosensor'
  const [i, setI] = useState(0);
  const go = (r, p) => navigation && navigation.navigate(r, p);
  if (!path) {
    return (
      <View testID="vm-sensor-q">
        <Text style={s.h1}>Do you have an OBD sensor?</Text>
        <Text style={s.body}>{VM.explainTerms('It is a small plug-in reader for your car (OBD).')}</Text>
        <BigChoice testID="vm-sensor-yes" title="Yes, I have one" onPress={() => { setPath('sensor'); setI(0); }} />
        <BigChoice testID="vm-sensor-no" title="No sensor" sub="No problem. We'll use photos and your words." onPress={() => { setPath('nosensor'); setI(0); }} />
      </View>
    );
  }
  const steps = path === 'sensor' ? VM.SENSOR_STEPS : VM.NOSENSOR_STEPS;
  const st = steps[i];
  const last = i === steps.length - 1;
  return (
    <View testID={'vm-step-' + st.id}>
      <Text style={s.small}>{`Step ${i + 1} of ${steps.length}`}</Text>
      {st.port ? <PortHelp /> : <><Text style={s.h1}>{st.title}</Text><Text style={s.body}>{st.body}</Text></>}
      {st.go ? <BigChoice testID="vm-go" title={st.goLabel} onPress={() => go(st.go, st.params)} /> : null}
      {!last ? <BigChoice testID="vm-next" title={st.go ? (path === 'sensor' ? 'Next' : 'Skip, next step') : 'Next'} onPress={() => setI(i + 1)} /> : null}
      <Pressable testID="vm-back" onPress={() => (i ? setI(i - 1) : setPath(null))} style={s.link}><Text style={s.linkT}>Back</Text></Pressable>
    </View>
  );
}

export function GuideScreen({ navigation }) {
  return <ScrollView style={s.screen} contentContainerStyle={s.scroll}><SimpleGuide navigation={navigation} /></ScrollView>;
}
export function PortHelpScreen() {
  return <ScrollView style={s.screen} contentContainerStyle={s.scroll}><PortHelp /></ScrollView>;
}

/** Simple results: one big verdict, then the same facts in everyday words. */
export const stripLeadCode = (t) => (typeof t === 'string' ? t.replace(/^\s*[PBCU][0-9A-F]{4}\b\s*[:\-\u2013\u2014,.]?\s*/i, '') : t);
export function PlainResults({ p: p0, tone, noTech = false }) {
  if (!p0) return null;
  // noTech: drop a leading code from verdict / to-do text only (severity/tone untouched).
  const p = noTech ? { ...p0, verdict: { ...p0.verdict, title: stripLeadCode(p0.verdict.title), why: stripLeadCode(p0.verdict.why) }, todo: (p0.todo || []).map(stripLeadCode) } : p0;
  // noTech (v3 Simple): plain answer only; codes/readings/AI details live in the technical dropdown.
  return (
    <View testID="vm-plain">
      <View style={[s.verdict, { backgroundColor: TONE[tone] || Y }]} testID={'vm-verdict-' + (tone || 'yellow')}>
        <Text style={s.vT}>{p.verdict.title}</Text><Text style={s.vW}>{p.verdict.why}</Text>
      </View>
      {p.vehicle ? <Text style={s.small}>{p.vehicle}</Text> : null}
      {p.cleared ? <Text style={s.warn}>{p.cleared}</Text> : null}
      <Text style={s.h2}>What is going on</Text>
      {p.noCodes ? <Text style={s.body}>Your car did not report any trouble codes (warning messages saved by the car's computer).</Text> : null}
      {noTech && p.codes.length ? <Text style={s.body}>{`Your car saved ${p.codes.length} warning ${p.codes.length === 1 ? 'message' : 'messages'}. The details are under "Show technical details" below.`}</Text> : null}
      {noTech ? null : p.codes.map((c) => (
        <View key={c.code} style={s.card}>
          <Text style={s.cardT}>{`Code ${c.code}`}</Text>
          <Text style={s.body}>{c.means}</Text>
          <Text style={s.small}>{`What the car says about it: ${c.status}.`}</Text>
          {c.likely ? <Text style={s.body}>{c.likely}</Text> : null}
          {c.firstCheck ? <Text style={s.body}>{c.firstCheck}</Text> : null}
          {c.cost ? <Text style={s.body}>{c.cost}</Text> : null}
        </View>
      ))}
      {!noTech && p.ai.length ? <><Text style={s.h2}>What Meta AI thinks (a guess, with proof)</Text>{p.ai.map((t) => <Text key={t} style={s.body}>{'\u2022  ' + t}</Text>)}</> : null}
      {!noTech && p.readings.length ? <><Text style={s.h2}>What your car told us</Text>{p.readings.map((t) => <Text key={t} style={s.body}>{'\u2022  ' + t}</Text>)}</> : null}
      {!noTech && p.selfTests ? <Text style={s.body}>{p.selfTests}</Text> : null}
      <Text style={s.h2}>What to do next</Text>
      {p.todo.map((t, i) => <Text key={t} style={s.step}>{`${i + 1}.  ${t}`}</Text>)}
      {p.costNote ? <Text style={s.small}>{p.costNote}</Text> : null}
    </View>
  );
}

function Row({ k, v }) { return <View style={s.row}><Text style={s.rk}>{k}</Text><Text style={s.rv}>{v}</Text></View>; }

/** Mechanic detail: everything read, dense. Not read = 'not read'. */
export function MechanicDeep({ k, navigation }) {
  if (!k) return null;
  return (
    <View testID="vm-mechanic">
      <Row k="Final safety level" v={k.levelCode || VM.NOT_READ} />
      <Text style={s.h2}>DTCs</Text>
      {k.codes.length ? k.codes.map((c) => (
        <View key={c.code} style={s.card} testID={'vm-dtc-' + c.code}>
          <Text style={s.cardT}>{`${c.code}  ${c.title}`}</Text>
          <Row k="System" v={c.system} /><Row k="Status" v={c.status} />
          {c.causes.length ? <Text style={s.small}>{'Causes (ranked): ' + c.causes.map((x, i) => `${i + 1}) ${x}`).join('  ')}</Text> : null}
          {c.tests.map((t) => <Text key={t} style={s.small}>{'Test: ' + t}</Text>)}
          {c.repair ? <Row k="Typical repair" v={c.repair} /> : null}
          <Row k="Parts" v={c.parts || VM.NOT_READ} /><Row k="Labor" v={c.labor || VM.NOT_READ} /><Row k="Shop est." v={c.shop || VM.NOT_READ} />
          {c.related.length ? <Text style={s.small}>{'Related: ' + c.related.join('; ')}</Text> : null}
        </View>
      )) : <Text style={s.small}>No DTCs reported.</Text>}
      <Text style={s.h2}>Freeze frame</Text>
      {k.freezeFrame ? <><Row k="Stored by" v={k.freezeFrame.code} />{k.freezeFrame.values.map((x) => <Row key={x.name} k={x.name} v={x.value} />)}</> : <Text style={s.small}>{VM.NOT_READ}</Text>}
      <Text style={s.h2}>MIL and clear counters</Text>
      <Row k="MIL" v={k.mil.on === null ? VM.NOT_READ : k.mil.on ? 'on' : 'off'} />
      <Row k="Distance with MIL on" v={k.mil.distance} /><Row k="Time with MIL on" v={k.mil.time} />
      <Row k="Distance since clear" v={k.sinceClear.distance} /><Row k="Time since clear" v={k.sinceClear.time} /><Row k="Warm-ups since clear" v={k.sinceClear.warmups} />
      <Text style={s.h2}>Live PIDs</Text>
      {k.pids.map((x) => <Row key={x.key} k={x.label} v={x.value} />)}
      <Text style={s.h2}>Readiness monitors</Text>
      {k.monitors.length ? k.monitors.map((x) => <Row key={x.name} k={x.name} v={`${x.state} (${x.type})`} />) : <Text style={s.small}>{VM.NOT_READ}</Text>}
      {k.causes.length ? <><Text style={s.h2}>Ranked causes (Meta AI, with evidence)</Text>{k.causes.map((c) => (
        <View key={c.key} style={s.card}><Text style={s.cardT}>{`${c.rank}. ${c.title}`}</Text><Text style={s.small}>{c.likely}{c.nextCheck ? ' · Next check: ' + c.nextCheck : ''}</Text>
          {c.evidence.map((e) => <Text key={e.id} style={s.small}>{`\u2022 [${e.kind}] ${e.label}`}</Text>)}</View>))}</> : null}
      <Text style={s.h2}>TSB / recall</Text>
      <Text style={s.small}>{k.recall}</Text>
      <Pressable testID="vm-port-link" onPress={() => navigation && navigation.navigate('PortHelp')} style={s.link}><Text style={s.linkT}>Where does the sensor plug in?</Text></Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BG }, scroll: { padding: 20, paddingBottom: 56 },
  h1: { color: TXT, fontSize: 28, fontWeight: '900', marginBottom: 14, lineHeight: 34 },
  h2: { color: TXT, fontSize: 21, fontWeight: '800', marginTop: 20, marginBottom: 8 },
  body: { color: TXT, fontSize: 18, lineHeight: 26, marginBottom: 8 },
  step: { color: TXT, fontSize: 19, lineHeight: 27, marginBottom: 8, fontWeight: '600' },
  small: { color: DIM, fontSize: 15, lineHeight: 21, marginTop: 4 },
  warn: { color: '#ffd6d6', backgroundColor: '#3a0d0f', borderRadius: 14, padding: 14, fontSize: 18, fontWeight: '800', marginTop: 10 },
  choice: { backgroundColor: Y, borderRadius: 20, padding: 24, marginBottom: 16, minHeight: 96, justifyContent: 'center' },
  choiceT: { color: '#0a0c0f', fontSize: 26, fontWeight: '900' }, choiceS: { color: '#1a1400', fontSize: 17, marginTop: 6 },
  toggle: { flexDirection: 'row', backgroundColor: '#1b2330', borderRadius: 14, padding: 4, marginBottom: 16 },
  tBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: 'center' }, tOn: { backgroundColor: TXT },
  tTxt: { color: '#d8e2ec', fontSize: 17, fontWeight: '600' }, tTxtOn: { color: BG, fontWeight: '800' },
  verdict: { borderRadius: 20, padding: 24, marginBottom: 16 }, vT: { fontSize: 34, fontWeight: '900', color: '#0a0c0f' }, vW: { fontSize: 19, marginTop: 10, color: '#0a0c0f' },
  card: { backgroundColor: CARD, borderRadius: 14, padding: 14, marginBottom: 10 }, cardT: { color: TXT, fontSize: 18, fontWeight: '800', marginBottom: 6 },
  row: { flexDirection: 'row', paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: '#232b36' }, rk: { color: DIM, fontSize: 14, flex: 1 }, rv: { color: TXT, fontSize: 14, fontWeight: '700', fontFamily: 'monospace' },
  link: { minHeight: 48, justifyContent: 'center' }, linkT: { color: Y, fontSize: 17, fontWeight: '800' },
  draw: { backgroundColor: '#1b2330', borderRadius: 16, padding: 16, marginVertical: 12, alignItems: 'center' },
  dash: { alignSelf: 'stretch', height: 40, backgroundColor: '#3a4656', borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  drawLbl: { color: DIM, fontSize: 12, fontWeight: '800' }, drawLbl2: { color: Y, fontSize: 15, fontWeight: '800', marginTop: 10, textAlign: 'center' },
  wheel: { width: 110, height: 110, borderRadius: 55, borderWidth: 10, borderColor: '#5b6b7f', marginTop: -10, justifyContent: 'center', alignItems: 'center' },
  hub: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#5b6b7f' }, column: { width: 18, height: 20, backgroundColor: '#5b6b7f' },
  portWrap: { alignItems: 'center', marginTop: 10 },
  port: { width: 130, paddingVertical: 8, backgroundColor: '#0a0c0f', borderWidth: 3, borderColor: Y, borderBottomLeftRadius: 24, borderBottomRightRadius: 24, borderTopLeftRadius: 6, borderTopRightRadius: 6 },
  pinRow: { flexDirection: 'row', justifyContent: 'space-around', marginVertical: 3, paddingHorizontal: 2 },
  pin: { width: 7, height: 7, borderRadius: 2, backgroundColor: Y }, arrow: { color: Y, fontSize: 14, marginTop: 6, fontWeight: '700' },
});
