/*
 * LYLO Mechanic hackathon (v0.4.1): results screen for everyone.
 * Takes over the used-car and codes screens when the LYLO server answered.
 * Toggle at the top: Simple view (default) | Mechanic view, remembered under
 * the NEW AsyncStorage key 'lylo.viewMode'. Exactly one verdict either way.
 */
import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { C } from '../../../baseline/mobile/src/constants/colors';
import { buildResults, formatValue } from './resultsView';
import { MODE_LABELS, loadViewMode, saveViewMode } from './viewMode';
import { loadVehicle } from './vin';
import { PriceButtons, VehicleLine } from './PriceButtons';
import DashVoicePanel from './DashVoicePanel'; // v0.4.4, renders nothing with its flags unset
import { ProveCheck } from './ProvePanel'; // v0.5.1, renders nothing unless EXPO_PUBLIC_LYLO_PROVE=1
import { uiV2On } from './ui2/theme'; // UI v2, flag EXPO_PUBLIC_LYLO_UI_V2=1 (off = this screen)

let defaultStorage = null;
try { defaultStorage = require('@react-native-async-storage/async-storage').default; } catch (e) { defaultStorage = null; }

export const TONE_BG = { green: '#00c87a', yellow: '#f5c518', orange: '#ff8a1f', red: '#e5383b' };
const TONE_FG = { green: '#04140c', yellow: '#1a1400', orange: '#1a0c00', red: '#ffffff' };

export function Toggle({ mode, onChange }) {
  return (
    <View style={s.toggle} accessibilityRole="tablist">
      {['simple', 'mechanic'].map((m) => (
        <Pressable key={m} onPress={() => onChange(m)} accessibilityRole="tab" accessibilityState={{ selected: mode === m }}
          style={[s.toggleBtn, mode === m && s.toggleOn]}>
          <Text style={[s.toggleText, mode === m && s.toggleTextOn]}>{MODE_LABELS[m]}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export function Verdict({ v, tone }) {
  return (
    <View style={[s.verdict, { backgroundColor: TONE_BG[tone] }]} testID={'verdict-' + tone}>
      <Text style={[s.verdictTitle, { color: TONE_FG[tone] }]}>{v.icon}  {v.title}</Text>
      <Text style={[s.verdictWhy, { color: TONE_FG[tone] }]}>{v.why}</Text>
    </View>
  );
}

function Row({ label, value }) {
  return (
    <View style={s.row}><Text style={s.rowLabel}>{label}</Text><Text style={s.rowValue}>{value}</Text></View>
  );
}

function SimpleView({ m }) {
  const [open, setOpen] = useState(false);
  const w = m.seeWhy;
  return (
    <>
      {m.clearedWarning ? (
        <View style={s.warn}><Text style={s.warnText}>{'\u26A0\uFE0F  '}{m.clearedWarning}</Text></View>
      ) : null}
      <Text style={s.h}>What to do next</Text>
      {m.actions.map((a) => <Text key={a} style={s.bullet}>{'\u2022  '}{a}</Text>)}
      {m.prices.map((p) => <PriceButtons key={p.query} p={p} />)}
      <Pressable onPress={() => setOpen(!open)} style={s.seeWhy} accessibilityRole="button">
        <Text style={s.seeWhyText}>{open ? 'Hide why  \u25B2' : 'See why  \u25BC'}</Text>
      </Pressable>
      {open ? (
        <View>
          {w.causes.length ? <Text style={s.h2}>Possible causes (Meta AI)</Text> : null}
          {w.causes.map((c) => (
            <View key={c.title} style={s.cause}>
              <Text style={s.causeTitle}>{c.title}</Text>
              <Text style={s.small}>{c.likely}</Text>
              {c.evidence.map((e) => <Text key={e} style={s.small}>{'\u2022 '}{e}</Text>)}
            </View>
          ))}
          {w.readings.length ? <Text style={s.h2}>Readings</Text> : null}
          {w.readings.map((r) => <Row key={r.label} label={r.label} value={r.value} />)}
          {w.monitors.length ? <Text style={s.h2}>Self-checks</Text> : null}
          {w.monitors.map((r) => <Row key={r.label} label={r.label} value={r.value} />)}
          {w.counters.length ? <Text style={s.h2}>Since codes were last erased</Text> : null}
          {w.counters.map((r) => <Row key={r.label} label={r.label} value={r.value} />)}
          <Text style={s.h2}>Car and adapter</Text>
          <Row label="VIN" value={w.vin} />
          <Row label="Adapter" value={w.adapter} />
        </View>
      ) : null}
    </>
  );
}

/** v0.5.1: '190 °F (190 °F)' -> '190 °F'; the raw reading is added only when it differs. */
export function pidText(p) {
  const raw = `${p.value} ${p.unit}`.trim();
  const nice = formatValue(p.name, p.value, p.unit);
  return nice === raw || !nice ? raw : `${nice} (${raw})`;
}

export function MechanicView({ m, hideCauses = false }) {
  const x = m.mechanic;
  return (
    <View>
      <Text style={s.h2}>Safety</Text>
      <Row label="Final level" value={x.levelCode} />
      <Row label="Rule level" value={x.ruleLevel} />
      <Row label="AI action" value={x.safetyAction} />
      {x.safetyNote ? <Text style={s.small}>{x.safetyNote}</Text> : null}
      {x.triggers.map((t) => <Text key={t} style={s.small}>{'\u2022 '}{t}</Text>)}
      {x.clearedText ? <><Text style={s.h2}>Codes cleared</Text><Text style={s.body}>{x.clearedText}</Text></> : null}
      {hideCauses ? null : <Text style={s.h2}>{x.museStatus === 'ok' ? 'Possible causes (Meta AI)' : x.museStatus === 'off' ? 'Possible causes (Meta AI not used)' : "Possible causes (Meta AI didn't answer)"}</Text>}
      {hideCauses ? null : x.hypotheses.map((h) => (
        <View key={h.key} style={s.cause}>
          <Text style={s.causeTitle}>{h.rank}. {h.cause}</Text>
          <Text style={s.small}>{h.confidenceLabel}</Text>
          {h.reasoning ? <Text style={s.small}>{h.reasoning}</Text> : null}
          {h.nextCheck ? <Text style={s.small}>Next check: {h.nextCheck}</Text> : null}
          {h.evidence.map((e) => <Text key={e} style={s.small}>{'\u2022 '}{e}</Text>)}
        </View>
      ))}
      {x.unverified.map((u) => <Text key={u.key} style={[s.small, { color: '#ffb020' }]}>Unverified {u.kind}: {u.text}</Text>)}
      {x.vehicle ? <><Text style={s.h2}>Vehicle (VIN decode)</Text><Row label="Vehicle" value={x.vehicle.name} />
        {x.vehicle.ownerEngine ? <Row label="Engine" value={x.vehicle.ownerEngine + ' (set by owner)'} /> : null}
        {x.vehicle.engine ? <Row label={x.vehicle.ownerEngine ? 'VIN decoder' : 'Engine'} value={'VIN decoder says (unverified): ' + x.vehicle.engine} /> : null}
        <Text style={s.small}>{x.vehicle.source}; {x.vehicle.caveat}</Text></> : null}
      {x.prices.length ? <Text style={s.h2}>Check the price</Text> : null}
      {x.prices.map((p) => <PriceButtons key={p.query} p={p} />)}
      <Text style={s.h2}>Trouble codes</Text>
      <Text style={s.body}>{x.dtcs.length ? x.dtcs.join(', ') : 'None'}</Text>
      <Text style={s.h2}>Live data</Text>
      {x.pids.map((p) => <Row key={p.name} label={p.name} value={pidText(p)} />)}
      <Text style={s.h2}>Readiness monitors</Text>
      {x.monitors.map((t) => <Text key={t} style={s.small}>{t}</Text>)}
      <Text style={s.h2}>Freeze frame</Text>
      <Text style={s.small}>{x.freezeFrame ? JSON.stringify(x.freezeFrame) : 'Not read by this app version.'}</Text>
      <Text style={s.h2}>Server and adapter</Text>
      <Row label="Server" value={x.server} />
      <Row label="Adapter" value={m.seeWhy.adapter} />
      <Row label="VIN" value={m.seeWhy.vin} />
    </View>
  );
}

export function ResultsBody({ m, mode, onMode }) {
  return (
    <>
      <Toggle mode={mode} onChange={onMode} />
      {mode !== 'mechanic' ? <VehicleLine v={m.vehicle} /> : null}
      <Verdict v={m.verdict} tone={m.tone} />
      {mode === 'mechanic' ? <MechanicView m={m} /> : <SimpleView m={m} />}
      {m.receipt ? (
        <View style={s.receipt}>
          <Text style={s.powered}>{m.poweredBy}</Text>
          <Text style={s.mono}>{m.receipt}</Text>
        </View>
      ) : <Text style={[s.powered, { marginTop: 24 }]}>{m.poweredBy}</Text>}
    </>
  );
}

function SimpleResultsV1({ scan: scanIn, codes, screen, baselineCleared, footer, storage, dashVoice, prove }) {
  const store = storage === undefined ? defaultStorage : storage;
  const [mode, setMode] = useState('simple');
  const [vehicle, setVehicle] = useState(null);
  const [raised, setRaised] = useState(null); // v0.4.4: scan with a photo-raised level (never lower)
  const scan = raised && raised.base === scanIn ? raised.scan : scanIn;
  useEffect(() => { let live = true; loadViewMode(store).then((m) => { if (live) setMode(m); }); loadVehicle(store).then((v) => { if (live) setVehicle(v); }); return () => { live = false; }; }, [store]);
  const m = buildResults(scan, { codes, screen, baselineCleared, vehicle });
  if (!m) return null;
  const change = (next) => { setMode(next); saveViewMode(store, next); };
  return (
    <ScrollView style={s.screen} contentContainerStyle={s.scroll}>
      <ResultsBody m={m} mode={mode} onMode={change} />
      <ProveCheck scan={scan} {...(prove || {})} />
      <DashVoicePanel scan={scan} onScan={(next) => setRaised({ base: scanIn, scan: next })} {...(dashVoice || {})} />
      <View style={{ marginTop: 20 }}>{footer}</View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  scroll: { padding: 20, paddingBottom: 48 },
  toggle: { flexDirection: 'row', backgroundColor: '#1b2330', borderRadius: 14, padding: 4, marginBottom: 20 },
  toggleBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
  toggleOn: { backgroundColor: '#ffffff' },
  toggleText: { color: '#d8e2ec', fontSize: 17, fontWeight: '600' },
  toggleTextOn: { color: '#0a0c0f', fontWeight: '800' },
  verdict: { borderRadius: 20, padding: 24, marginBottom: 24 },
  verdictTitle: { fontSize: 32, fontWeight: '900', lineHeight: 38 },
  verdictWhy: { fontSize: 19, marginTop: 12, lineHeight: 27, fontWeight: '500' },
  warn: { backgroundColor: '#3a0d0f', borderColor: '#e5383b', borderWidth: 2, borderRadius: 16, padding: 18, marginBottom: 24 },
  warnText: { color: '#ffd6d6', fontSize: 20, fontWeight: '800', lineHeight: 28 },
  h: { color: '#ffffff', fontSize: 24, fontWeight: '800', marginBottom: 12 },
  h2: { color: '#ffffff', fontSize: 19, fontWeight: '800', marginTop: 22, marginBottom: 8 },
  bullet: { color: '#eef3f8', fontSize: 18, lineHeight: 27, marginBottom: 12 },
  body: { color: '#eef3f8', fontSize: 17, lineHeight: 25 },
  small: { color: '#c5d1dc', fontSize: 16, lineHeight: 23, marginTop: 2 },
  seeWhy: { marginTop: 16, paddingVertical: 16, paddingHorizontal: 18, borderRadius: 14, backgroundColor: '#1b2330' },
  seeWhyText: { color: '#8cc8ff', fontSize: 18, fontWeight: '700' },
  cause: { marginBottom: 14 },
  causeTitle: { color: '#ffffff', fontSize: 17, fontWeight: '700', lineHeight: 24 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#1e2a38' },
  rowLabel: { color: '#c5d1dc', fontSize: 16, flexShrink: 0, minWidth: 90, maxWidth: '50%', paddingRight: 10 }, // v0.5.1: no 'Serve r' wrap
  rowValue: { color: '#ffffff', fontSize: 16, fontWeight: '700', flex: 1, flexWrap: 'wrap', textAlign: 'right' },
  receipt: { marginTop: 32, paddingTop: 14, borderTopWidth: 1, borderTopColor: '#1e2a38' },
  powered: { color: '#c5d1dc', fontSize: 14, fontWeight: '700' },
  mono: { color: '#8a99a8', fontSize: 12, fontFamily: 'monospace', marginTop: 4 },
});

/** UI v2 switch: presentation only. uiV2 prop overrides the build flag (tests). */
export default function SimpleResults(props) {
  const on = props.uiV2 === undefined ? uiV2On({ EXPO_PUBLIC_LYLO_UI_V2: process.env.EXPO_PUBLIC_LYLO_UI_V2 }) : !!props.uiV2;
  if (on) { const ResultsV2 = require('./ui2/ResultsV2').default; return <ResultsV2 {...props} />; }
  return <SimpleResultsV1 {...props} />;
}
