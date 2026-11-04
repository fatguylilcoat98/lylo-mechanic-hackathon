/*
 * UI v2 diagnosis results (flag EXPO_PUBLIC_LYLO_UI_V2=1). Same data and the same single
 * verdict as SimpleResults; presentation only. Order: replay badge, verdict/safety hero,
 * prediction, what to do, the proof (causes with evidence), readings, mechanic details.
 */
import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { buildV2 } from './model';
import { color, space, radius, type, touch } from './theme';
import { CauseCard, EvidenceBadge, PredictionBanner, ReplayBadge, SafetyBanner, Section, s as cs } from './components';
import { loadVehicle } from '../vin';
import { PriceButtons, VehicleLine } from '../PriceButtons';
import DashVoicePanel from '../DashVoicePanel';
import { MechanicView } from '../SimpleResults';
import CodeTimelineCard from '../CodeTimelineCard'; // v0.7, renders nothing unless EXPO_PUBLIC_LYLO_CODE_TIMELINE=1
import * as VM from '../viewModes'; // v0.7.2 flag EXPO_PUBLIC_LYLO_VIEW_MODE
import { MechanicDeep, PlainResults, ViewSwitch } from '../ViewModeScreens';
import { homeV3On, ModeToggle } from './HomeV3'; // flag EXPO_PUBLIC_LYLO_HOME_V3
import { Fold } from './ModeScreensV3';
import * as SV from '../sessionV2'; // v0.7.3 flag EXPO_PUBLIC_LYLO_SESSION_V2
import SessionCard, { StaleNotice } from '../SessionCard';
const OV = require('../oneVerdict'); // v0.7.5 flag EXPO_PUBLIC_LYLO_ONE_VERDICT=1
import MetaAiCard from '../MetaAiCard'; // v0.7.5: shows whether Meta AI ran on this scan
import { ProveCheck } from '../ProvePanel'; // v0.5.1, renders nothing unless EXPO_PUBLIC_LYLO_PROVE=1

export function ResultsV2Body({ m, pinnedReplay = false, expandAll = false, noBanner = false }) {
  const [open, setOpen] = useState(() => new Set(expandAll ? m.causes.map((x) => x.key) : m.causes.length ? [m.causes[0].key] : []));
  const [details, setDetails] = useState(expandAll);
  const [readings, setReadings] = useState(expandAll);
  const toggle = (k) => setOpen((p) => { const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const c = m.evidenceCounts;
  return (
    <>
      {pinnedReplay ? null : <ReplayBadge label={m.replay} />}
      <VehicleLine v={m.vehicle} />
      {noBanner ? null : <SafetyBanner tone={m.tone} title={m.verdict.title} why={m.verdict.why} safety={m.safety} />}
      {m.clearedWarning ? <View style={st.warn}><Text style={st.warnText}>{m.clearedWarning}</Text></View> : null}
      <PredictionBanner prediction={m.prediction} />

      <Section title="WHAT TO DO NEXT">
        {m.actions.map((a, i) => (
          <View key={a} style={st.action}><Text style={st.actionNum}>{i + 1}</Text><Text style={st.actionText}>{a}</Text></View>
        ))}
        {m.prices.map((p) => <PriceButtons key={p.query} p={p} />)}
      </Section>

      {m.causes.length ? (
        <Section title="THE PROOF · MUSE DETECTIVE">
          <Text style={cs.small} testID="causes-count">{`${m.causes.length} possible ${m.causes.length === 1 ? 'cause' : 'causes'}, all AI's guesses. The counts below are the evidence behind them:`}</Text>
          <View style={st.legend} testID="evidence-summary">
            <View style={st.legendItem}><EvidenceBadge kind="car" /><Text style={st.legendN}>{c.car}</Text></View>
            <View style={st.legendItem}><EvidenceBadge kind="guess" /><Text style={st.legendN}>{c.guess}</Text></View>
            <View style={st.legendItem}><EvidenceBadge kind="unknown" /><Text style={st.legendN}>{c.unknown}</Text></View>
          </View>
          <Text style={cs.small}>Tap a cause to see the readings from your car that back it up.</Text>
          {m.causes.map((x) => <CauseCard key={x.key} cause={x} open={open.has(x.key)} onToggle={() => toggle(x.key)} />)}
        </Section>
      ) : null}

      {m.seeWhy.readings.length ? (
        <Section title="YOUR CAR'S READINGS">
          <Pressable onPress={() => setReadings(!readings)} accessibilityRole="button" style={st.disclose}>
            <Text style={cs.link}>{readings ? 'Hide readings \u25B2' : `Show ${m.seeWhy.readings.length} readings \u25BC`}</Text>
          </Pressable>
          {readings ? m.seeWhy.readings.map((r) => (
            <View key={r.label} style={st.reading}><EvidenceBadge kind="car" compact /><Text style={st.readLabel}>{r.label}</Text><Text style={st.readValue}>{r.value}</Text></View>
          )) : null}
        </Section>
      ) : null}

      <Pressable onPress={() => setDetails(!details)} accessibilityRole="button" style={[st.disclose, { marginTop: space.xl }]}>
        <Text style={cs.link}>{details ? 'Hide mechanic details \u25B2' : 'Mechanic details \u25BC'}</Text>
      </Pressable>
      {details ? <MechanicView m={m} hideCauses /> : null}

      {m.poweredBy ? <Text style={st.powered}>{m.poweredBy}</Text> : null}
      {m.receipt ? <Text style={st.mono}>{m.receipt}</Text> : null}
    </>
  );
}

let defaultStorage = null;
try { defaultStorage = require('@react-native-async-storage/async-storage').default; } catch (e) { defaultStorage = null; }

export default function ResultsV2({ scan: scanIn, codes, screen, baselineCleared, footer, storage, dashVoice, prove, timelineEnv, viewEnv, homeEnv, sessionEnv, oneEnv, onScanAnother, navigation }) {
  const one = OV.on(oneEnv); // v0.7.5
  const sv = SV.on(sessionEnv);
  const [manual, setManual] = useState(null);
  const vmOn = VM.features(viewEnv).on;
  const v3 = vmOn && homeV3On(homeEnv);
  const [vm, setVm] = useState('simple');
  const store = storage === undefined ? defaultStorage : storage;
  const [vehicle, setVehicle] = useState(null);
  const [raised, setRaised] = useState(null);
  const scan = raised && raised.base === scanIn ? raised.scan : scanIn;
  useEffect(() => { let live = true; loadVehicle(store).then((v) => { if (live) setVehicle(v); }); if (vmOn) VM.loadChosen(store).then((x) => { if (live && x) setVm(x); }); return () => { live = false; }; }, [store]);
  const sm = sv ? SV.buildModel(scanIn, vehicle, manual) : null; // v0.7.3: only a VIN-matched (or confirmed) car
  const m0 = buildV2(scan, { env: oneEnv, codes, screen, baselineCleared, vehicle: sv ? (sm.idv.vehicle || null) : vehicle });
  if (!m0) return null;
  if (sv && SV.isStale(scanIn)) return <ScrollView style={st.screen} contentContainerStyle={st.scroll}><StaleNotice /></ScrollView>;
  const m = sv ? { ...m0, verdict: SV.adjustVerdict(m0.verdict, m0.tone, sm.idv) } : m0;
  const plain = (x) => { const p = VM.buildPlain(x, scanIn, oneEnv); return sv && p && p.verdict ? { ...p, verdict: SV.adjustVerdict(p.verdict, x.tone, sm.idv) } : p; };
  return (
    // A replay badge is a sticky header so it never scrolls out of view.
    <ScrollView style={st.screen} contentContainerStyle={st.scroll} stickyHeaderIndices={m.replay ? [0] : undefined}>
      {m.replay ? <View style={st.pin} testID="replay-pin"><ReplayBadge label={m.replay} /></View> : null}
      {sv ? <SessionCard model={sm} saved={vehicle} onConfirm={vehicle && scanIn.session ? () => setManual({ sessionId: scanIn.session.id, vehicle }) : null}
        onEnterVin={navigation ? () => navigation.navigate('Vin') : null} onScanAnother={onScanAnother} /> : null}
      {v3 ? <ModeToggle vm={vm} onPick={(x) => { setVm(x); VM.saveViewMode(store, x); }} /> : null}
      {v3 && vm === 'simple' ? (
        <View testID="results-simple-v3">
          <PlainResults p={plain(m)} tone={m.tone} noTech />
          <MetaAiCard scan={scanIn} env={oneEnv} />
          <Fold title="technical details (codes, readings, evidence)" testID="results-tech">
            <ResultsV2Body m={m} pinnedReplay={!!m.replay} noBanner={one} />
            <MechanicDeep k={VM.buildMechanic(m, scanIn)} navigation={navigation} plainLevel={one} />
            <CodeTimelineCard scan={scanIn} env={timelineEnv} storage={store} />
            <ProveCheck scan={scan} {...(prove || {})} />
          </Fold>
        </View>
      ) : null}
      {v3 && vm !== 'simple' ? (
        <View testID="results-mechanic-v3">
          <MetaAiCard scan={scanIn} env={oneEnv} />
          <MechanicDeep k={VM.buildMechanic(m, scanIn)} navigation={navigation} plainLevel={one} />
          <ResultsV2Body m={m} pinnedReplay={!!m.replay} expandAll />
          <CodeTimelineCard scan={scanIn} env={timelineEnv} storage={store} />
          <ProveCheck scan={scan} {...(prove || {})} />
        </View>
      ) : null}
      {v3 ? null : <>
      {vmOn ? <ViewSwitch mode={vm} onChange={(x) => { setVm(x); VM.saveViewMode(store, x); }} /> : null}
      {vmOn && vm === 'simple' ? <PlainResults p={plain(m)} tone={m.tone} /> : <ResultsV2Body m={m} pinnedReplay={!!m.replay} />}
      {vmOn && vm === 'mechanic' ? <MechanicDeep k={VM.buildMechanic(m, scanIn)} navigation={navigation} plainLevel={one} /> : null}
      <CodeTimelineCard scan={scanIn} env={timelineEnv} storage={store} />
      <ProveCheck scan={scan} {...(prove || {})} />
      </>}
      <DashVoicePanel scan={scan} onScan={(next) => setRaised({ base: scanIn, scan: next })} {...(dashVoice || {})} />
      <View style={{ marginTop: space.xl }}>{footer}</View>
    </ScrollView>
  );
}

const st = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  pin: { backgroundColor: color.bg, paddingBottom: space.sm, zIndex: 2 },
  scroll: { padding: space.lg, paddingBottom: 56 },
  warn: { backgroundColor: color.surface, borderColor: color.red, borderWidth: 2, borderRadius: radius.md, padding: space.lg, marginTop: space.lg },
  warnText: { color: color.red, ...type.h },
  action: { flexDirection: 'row', backgroundColor: color.surface, borderRadius: radius.md, padding: space.lg, marginTop: space.sm },
  actionNum: { color: color.accent, ...type.h, width: 30 },
  actionText: { color: color.text, ...type.body, flex: 1 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', marginVertical: space.sm },
  legendItem: { flexDirection: 'row', alignItems: 'center', marginRight: space.lg, marginBottom: space.sm },
  legendN: { color: color.text, ...type.h, marginLeft: space.sm },
  disclose: { minHeight: touch.min, justifyContent: 'center' },
  reading: { flexDirection: 'row', alignItems: 'center', paddingVertical: space.sm, borderBottomWidth: 1, borderBottomColor: color.line },
  readLabel: { color: color.textDim, ...type.small, flex: 1, marginLeft: space.sm },
  readValue: { color: color.text, ...type.small, fontWeight: '800' },
  powered: { color: color.textDim, ...type.small, fontWeight: '800', marginTop: space.xl },
  mono: { color: color.textDim, fontSize: 13, fontFamily: 'monospace', marginTop: space.xs },
});
