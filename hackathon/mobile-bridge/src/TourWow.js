/**
 * v0.7.8 EXPO_PUBLIC_LYLO_TOUR_WOW (must equal exactly '1'; unset = old tour look).
 * Visual layer only: progress bar, glowing step card, codes appearing one by one, a flashing
 * "recently cleared" moment, a verdict color sweep, and a "What LYLO caught" payoff card.
 * Every fact shown comes from the tour's own sample scan / verdict (no new wording about the car).
 * React Native Animated only; no new deps.
 */
import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { PriceButtons } from './PriceButtons';
const { forCodeDetail } = require('./priceLinks');
const { analyzeCodes } = require('../../../baseline/mobile/src/engine/diagnose');
const OV = require('./oneVerdict');
const { assessUsedCar } = require('../../../baseline/mobile/src/engine/usedCarCheck');

const TONE_HEX = { green: '#2a9d8f', yellow: '#f5c518', orange: '#f4a261', red: '#e5383b' };
const ND = false; // useNativeDriver off: width/color animations

function wowOn(env) {
  let v;
  if (env) v = env.EXPO_PUBLIC_LYLO_TOUR_WOW; else { try { v = process.env.EXPO_PUBLIC_LYLO_TOUR_WOW; } catch (e) { v = undefined; } }
  return v === '1';
}
const toneHex = (level) => TONE_HEX[OV.TONE[level] || 'yellow'];

/** Pure facts for the visuals, all from the sample scan. */
function factsOf(tour) {
  const sc = tour && tour.scan;
  if (!sc) return { codes: [], cleared: false };
  const seen = new Set(); const codes = [];
  [['stored', sc.stored], ['pending', sc.pending], ['permanent', sc.permanent]].forEach(([kind, arr]) =>
    (arr || []).forEach((c) => { const k = kind + c; if (!seen.has(k)) { seen.add(k); codes.push({ code: c, kind }); } }));
  let cleared = false; try { cleared = assessUsedCar(sc).recentlyCleared === 'likely'; } catch (e) { cleared = false; }
  return { codes, cleared };
}
/** Codes the current step talks about (by code text in the step), so the glow lands on what is explained. */
const codesInStep = (facts, st) => { const txt = st ? [st.t, st.say, st.deep].join(' ') : ''; return facts.codes.filter((c) => txt.includes(c.code)); };

function ProgressBar({ i, n }) {
  const w = useRef(new Animated.Value(0)).current;
  useEffect(() => { Animated.timing(w, { toValue: n ? Math.min(i, n) / n : 0, duration: 350, useNativeDriver: ND }).start(); }, [i, n]);
  return (<View style={x.track} testID="wow-progress"><Animated.View style={[x.fill, { width: w.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }]} /></View>);
}

function GlowCard({ level, stepKey, children, testID }) {
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => { a.setValue(0); Animated.spring(a, { toValue: 1, friction: 7, useNativeDriver: ND }).start(); }, [stepKey]);
  const c = toneHex(level);
  return (<Animated.View testID={testID} style={[x.card, { borderColor: c, shadowColor: c, opacity: a, transform: [{ translateY: a.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }] }]}>{children}</Animated.View>);
}

function CodeChips({ codes, hot, stepKey }) {
  const vals = useRef(codes.map(() => new Animated.Value(0))).current;
  useEffect(() => { vals.forEach((v) => v.setValue(0)); Animated.stagger(180, vals.map((v) => Animated.timing(v, { toValue: 1, duration: 260, useNativeDriver: ND }))).start(); }, [stepKey]);
  if (!codes.length) return null;
  return (<View style={x.chips} testID="wow-codes">{codes.map((c, k) => {
    const on = hot.some((h) => h.code === c.code && h.kind === c.kind);
    return (<Animated.View key={c.kind + c.code} testID={'wow-code-' + c.code + (on ? '-hot' : '')} style={[x.chip, on && x.chipHot, { opacity: vals[k] || 1, transform: [{ scale: (vals[k] || new Animated.Value(1)).interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }] }]}>
      <Text style={x.chipT}>{c.code}</Text><Text style={x.chipK}>{c.kind}</Text></Animated.View>);
  })}</View>);
}

function ClearedFlash() {
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => { Animated.loop(Animated.sequence([Animated.timing(a, { toValue: 1, duration: 450, useNativeDriver: ND }), Animated.timing(a, { toValue: 0.35, duration: 450, useNativeDriver: ND })]), { iterations: 4 }).start(); }, []);
  return (<Animated.View testID="wow-cleared" style={[x.flash, { opacity: a.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) }]}><Text style={x.flashT}>{'\u26A0  Codes were recently cleared'}</Text></Animated.View>);
}

function VerdictSweep({ level }) {
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => { Animated.timing(a, { toValue: 1, duration: 700, useNativeDriver: ND }).start(); }, [level]);
  return (<View style={x.sweepTrack} testID="wow-sweep"><Animated.View style={[x.sweep, { backgroundColor: toneHex(level), width: a.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }]} /></View>);
}

/** Payoff: reasons from the verdict + codes + cleared flag. No verdict title here (headline stays the only one). */
function Payoff({ v, facts }) {
  const items = [...(v.reasons || []), ...facts.codes.filter((c) => !(v.reasons || []).some((r) => r.includes(c.code))).map((c) => c.kind + ' ' + c.code)];
  if (facts.cleared) items.push('Codes were recently cleared');
  return (<View style={[x.card, { borderColor: toneHex(v.level) }]} testID="wow-payoff">
    <Text style={x.payT}>What LYLO caught</Text>
    {items.length ? items.map((t, k) => <Text key={k} style={x.payI}>{'\u2714  ' + t}</Text>) : <Text style={x.payI}>{'\u2714  ' + ((v.title && v.title.why) || '')}</Text>}
  </View>);
}

const x = StyleSheet.create({
  track: { height: 8, backgroundColor: '#2a3342', borderRadius: 4, marginTop: 12, overflow: 'hidden' }, fill: { height: 8, backgroundColor: '#f5c518' },
  card: { backgroundColor: '#11161e', borderRadius: 18, padding: 18, marginTop: 12, borderWidth: 2, shadowOpacity: 0.9, shadowRadius: 16, shadowOffset: { width: 0, height: 0 }, elevation: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 12 },
  chip: { backgroundColor: '#1f2733', borderRadius: 10, paddingVertical: 6, paddingHorizontal: 10, marginRight: 8, marginBottom: 8, borderWidth: 2, borderColor: '#2a3342' },
  chipHot: { borderColor: '#f5c518', shadowColor: '#f5c518', shadowOpacity: 1, shadowRadius: 10, elevation: 8 },
  chipT: { color: '#fff', fontSize: 18, fontWeight: '900', fontFamily: 'monospace' }, chipK: { color: '#9fb0c0', fontSize: 11, textTransform: 'uppercase' },
  flash: { backgroundColor: '#e5383b', borderRadius: 10, padding: 12, marginTop: 12 }, flashT: { color: '#fff', fontSize: 17, fontWeight: '900' },
  sweepTrack: { height: 6, borderRadius: 3, overflow: 'hidden', marginTop: 8, backgroundColor: '#1f2733' }, sweep: { height: 6 },
  live: { borderWidth: 3, borderRadius: 14, padding: 8, marginTop: 12 }, liveT: { color: '#f5c518', fontSize: 18, fontWeight: '900', marginBottom: 4 },
  payT: { color: '#f5c518', fontSize: 22, fontWeight: '900', marginBottom: 8 }, payI: { color: '#fff', fontSize: 17, lineHeight: 26 },
});

/** Live repair panel: the SAME PriceButtons + forCodeDetail the Code detail screen uses (RepairLinks),
 * for the worst code in the sample scan. No vehicle is passed (the demo car is not yours), exactly like
 * the live app before a VIN is saved. Links open only on tap, via the same safeOpen (https only). */
function repairModel(tour) {
  const sc = tour && tour.scan; if (!sc) return null;
  let r = []; try { r = analyzeCodes(sc) || []; } catch (e) { r = []; }
  return r.length ? forCodeDetail(r[0], null) : null;
}
function LiveRepair({ tour, open }) {
  const p = repairModel(tour);
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => { Animated.loop(Animated.sequence([Animated.timing(a, { toValue: 1, duration: 600, useNativeDriver: ND }), Animated.timing(a, { toValue: 0, duration: 600, useNativeDriver: ND })]), { iterations: 5 }).start(); }, []);
  if (!p) return null;
  return (<Animated.View testID="wow-live-repair" style={[x.live, { borderColor: a.interpolate({ inputRange: [0, 1], outputRange: ['#2a3342', '#f5c518'] }) }]}>
    <Text style={x.liveT}>{'\uD83D\uDC49  Try it: tap here'}</Text>
    <PriceButtons p={p} open={open} />
  </Animated.View>);
}

export { repairModel, LiveRepair, wowOn, factsOf, codesInStep, ProgressBar, GlowCard, CodeChips, ClearedFlash, VerdictSweep, Payoff, TONE_HEX };
