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

export function ResultsV2Body({ m, pinnedReplay = false }) {
  const [open, setOpen] = useState(() => new Set(m.causes.length ? [m.causes[0].key] : []));
  const [details, setDetails] = useState(false);
  const [readings, setReadings] = useState(false);
  const toggle = (k) => setOpen((p) => { const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const c = m.evidenceCounts;
  return (
    <>
      {pinnedReplay ? null : <ReplayBadge label={m.replay} />}
      <VehicleLine v={m.vehicle} />
      <SafetyBanner tone={m.tone} title={m.verdict.title} why={m.verdict.why} safety={m.safety} />
      {m.clearedWarning ? <View style={st.warn}><Text style={st.warnText}>{m.clearedWarning}</Text></View> : null}
      <PredictionBanner prediction={m.prediction} />

      <Section title="WHAT TO DO NEXT">
        {m.actions.map((a, i) => (
          <View key={a} style={st.action}><Text style={st.actionNum}>{i + 1}</Text><Text style={st.actionText}>{a}</Text></View>
        ))}
        {m.prices.map((p) => <PriceButtons key={p.query} p={p} />)}
      </Section>

      {m.causes.length ? (
        <Section title="THE PROOF \u00B7 MUSE DETECTIVE">
          <View style={st.legend} testID="evidence-summary">
            <View style={st.legendItem}><EvidenceBadge kind="car" /><Text style={st.legendN}>{c.car}</Text></View>
            <View style={st.legendItem}><EvidenceBadge kind="guess" /><Text style={st.legendN}>{c.guess}</Text></View>
            <View style={st.legendItem}><EvidenceBadge kind="unknown" /><Text style={st.legendN}>{c.unknown}</Text></View>
          </View>
          <Text style={cs.small}>Causes are the AI's guesses. Tap one to see the readings from your car that back it up.</Text>
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
      {details ? <MechanicView m={m} /> : null}

      <Text style={st.powered}>{m.poweredBy}</Text>
      {m.receipt ? <Text style={st.mono}>{m.receipt}</Text> : null}
    </>
  );
}

let defaultStorage = null;
try { defaultStorage = require('@react-native-async-storage/async-storage').default; } catch (e) { defaultStorage = null; }

export default function ResultsV2({ scan: scanIn, codes, screen, baselineCleared, footer, storage, dashVoice }) {
  const store = storage === undefined ? defaultStorage : storage;
  const [vehicle, setVehicle] = useState(null);
  const [raised, setRaised] = useState(null);
  const scan = raised && raised.base === scanIn ? raised.scan : scanIn;
  useEffect(() => { let live = true; loadVehicle(store).then((v) => { if (live) setVehicle(v); }); return () => { live = false; }; }, [store]);
  const m = buildV2(scan, { codes, screen, baselineCleared, vehicle });
  if (!m) return null;
  return (
    // A replay badge is a sticky header so it never scrolls out of view.
    <ScrollView style={st.screen} contentContainerStyle={st.scroll} stickyHeaderIndices={m.replay ? [0] : undefined}>
      {m.replay ? <View style={st.pin} testID="replay-pin"><ReplayBadge label={m.replay} /></View> : null}
      <ResultsV2Body m={m} pinnedReplay={!!m.replay} />
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
