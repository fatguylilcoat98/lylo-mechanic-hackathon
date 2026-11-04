/*
 * v0.7.6 guided tours UI (flag EXPO_PUBLIC_LYLO_TOUR=1). TourListScreen lists the tours with no verdict.
 * TourScreen shows ONE tour: car name + one pinned verdict (DemoScreenOne Headline), then
 * "Step i of N" coach cards (plain words, "More detail" for the mechanic depth), then "Try it yourself".
 * Synthetic/replay data only; nothing here touches the network.
 */
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Headline } from './DemoScreenOne';
const { TOURS } = require('./tours');
const T = require('./tours/common');
const DNC = require('./demoNoConnect'); // v0.7.8
import * as W from './TourWow'; // v0.7.8 EXPO_PUBLIC_LYLO_TOUR_WOW

const Y = '#f5c518';

export function TourListScreen({ navigation }) {
  return (
    <ScrollView style={s.screen} contentContainerStyle={s.scroll} testID="tour-list">
      <Text style={s.h1}>Try a demo</Text>
      <Text style={s.p}>Short guided tours. Made-up cars and saved replays only, so nothing here is about your car.</Text>
      {TOURS.map((t) => (
        <Pressable key={t.id} testID={'tour-' + t.id} accessibilityRole="button" style={s.row} onPress={() => navigation && navigation.navigate('Tour', { id: t.id })}>
          <Text style={s.rowT}>{`${t.n}. ${t.title}`}</Text>
          <Text style={s.rowS}>{t.short}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

export function TourBody({ tour, navigation, env }) {
  const [part, setPart] = useState(0);
  const [i, setI] = useState(0);
  const [deep, setDeep] = useState(false);
  const p = T.partOf(tour, part);
  const v = T.verdictOf(tour, part);
  const steps = T.stepsFor(tour, part);
  const done = i >= steps.length;
  const st = steps[Math.min(i, steps.length - 1)];
  const go = (r, prm) => navigation && navigation.navigate(r, prm);
  const nextPart = tour.parts && part < tour.parts.length - 1;
  const wow = W.wowOn(env);
  const facts = wow ? W.factsOf(p.scan ? p : tour) : null;
  return (
    <View>
      <Headline level={v.level} car={p.car} sub={p.sub} />
      {tour.parts ? <Text style={s.small} testID="tour-part">{`Part ${part + 1} of ${tour.parts.length}`}</Text> : null}
      {!done ? (
        wow ? (<>
        <W.ProgressBar i={i + 1} n={steps.length} />
        <W.GlowCard level={v.level} stepKey={part + '-' + i} testID={'tour-step-' + (i + 1)}>
          <Text style={s.small} testID="tour-stepno">{`Step ${i + 1} of ${steps.length}`}</Text>
          <Text style={[s.cardT, { fontSize: 26 }]}>{st.t}</Text>
          <Text style={s.say}>{st.say}</Text>
          <W.CodeChips key={'chips-' + part} codes={facts.codes} hot={W.codesInStep(facts, st)} stepKey={part + '-' + i} />
          {facts.cleared && i === steps.length - 1 ? <W.ClearedFlash /> : null}
          {st.live === 'repair' ? <W.LiveRepair tour={p.scan ? p : tour} /> : null}
          <Pressable testID="tour-more" onPress={() => setDeep(!deep)} accessibilityRole="button"><Text style={s.link}>{deep ? 'Less detail' : 'More detail (mechanic)'}</Text></Pressable>
          {deep ? <Text style={s.deep} testID="tour-deep">{st.deep}</Text> : null}
          <View style={s.nav}>
            {i > 0 ? <Pressable testID="tour-back" style={s.btnDark} onPress={() => setI(i - 1)}><Text style={s.btnT}>Back</Text></Pressable> : null}
            <Pressable testID="tour-next" style={s.btn} onPress={() => setI(i + 1)}><Text style={s.btnTD}>{i === steps.length - 1 ? 'Finish' : 'Next'}</Text></Pressable>
          </View>
        </W.GlowCard>
        </>) :
        <View style={s.card} testID={'tour-step-' + (i + 1)}>
          <Text style={s.small} testID="tour-stepno">{`Step ${i + 1} of ${steps.length}`}</Text>
          <Text style={s.cardT}>{st.t}</Text>
          <Text style={s.say}>{st.say}</Text>
          <Pressable testID="tour-more" onPress={() => setDeep(!deep)} accessibilityRole="button"><Text style={s.link}>{deep ? 'Less detail' : 'More detail (mechanic)'}</Text></Pressable>
          {deep ? <Text style={s.deep} testID="tour-deep">{st.deep}</Text> : null}
          <View style={s.nav}>
            {i > 0 ? <Pressable testID="tour-back" style={s.btnDark} onPress={() => setI(i - 1)}><Text style={s.btnT}>Back</Text></Pressable> : null}
            <Pressable testID="tour-next" style={s.btn} onPress={() => setI(i + 1)}><Text style={s.btnTD}>{i === steps.length - 1 ? 'Finish' : 'Next'}</Text></Pressable>
          </View>
        </View>
      ) : (
        <View>
        {wow ? <W.VerdictSweep level={v.level} /> : null}
        {wow && !nextPart ? <W.Payoff v={v} facts={facts} /> : null}
        <View style={s.card} testID="tour-done">
          {nextPart ? (
            <Pressable testID="tour-next-part" style={s.btn} onPress={() => { setPart(part + 1); setI(0); setDeep(false); }}><Text style={s.btnTD}>{`Go to part ${part + 2}`}</Text></Pressable>
          ) : (
            <>
              {DNC.tryIt(tour, env) ? (<>
              <Text style={s.cardT}>Try it yourself</Text>
              <Pressable testID="tour-try" style={s.btn} onPress={() => go(tour.tryIt.route, tour.tryIt.params)}><Text style={s.btnTD}>{tour.tryIt.label}</Text></Pressable>
              </>) : (<>
              <Text style={s.cardT} testID="tour-demo-note">{DNC.NOTE}</Text>
              <Pressable testID="tour-more" style={s.btn} onPress={() => go('Tours')}><Text style={s.btnTD}>More tours</Text></Pressable>
              </>)}
            </>
          )}
          <Pressable testID="tour-restart" onPress={() => { setPart(0); setI(0); }}><Text style={s.link}>Start this tour again</Text></Pressable>
        </View>
        </View>
      )}
    </View>
  );
}

export function TourScreen({ route, navigation, env }) {
  const id = route && route.params && route.params.id;
  const tour = TOURS.find((t) => t.id === id);
  return (
    <ScrollView style={s.screen} contentContainerStyle={s.scroll}>
      {tour ? <TourBody key={tour.id} tour={tour} navigation={navigation} env={env} /> : <Text style={s.p}>That tour was not found.</Text>}
      <Pressable testID="tour-all" onPress={() => navigation && navigation.navigate('Tours')}><Text style={s.link}>‹ All tours</Text></Pressable>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0a0c0f' }, scroll: { padding: 16, paddingBottom: 48 },
  h1: { color: '#fff', fontSize: 26, fontWeight: '800', marginBottom: 8 }, p: { color: '#b8c4d0', fontSize: 16, lineHeight: 22, marginBottom: 12 },
  row: { backgroundColor: '#161c25', borderRadius: 12, padding: 14, marginBottom: 10, minHeight: 56 },
  rowT: { color: '#fff', fontSize: 18, fontWeight: '700' }, rowS: { color: '#b8c4d0', fontSize: 14, marginTop: 4 },
  card: { backgroundColor: '#161c25', borderRadius: 14, padding: 16, marginTop: 12 },
  small: { color: '#b8c4d0', fontSize: 14, marginTop: 8 }, cardT: { color: '#fff', fontSize: 21, fontWeight: '800', marginTop: 4 },
  say: { color: '#fff', fontSize: 18, lineHeight: 26, marginTop: 8 }, deep: { color: '#b8c4d0', fontSize: 14, lineHeight: 20, marginTop: 8, fontFamily: 'monospace' },
  link: { color: Y, fontSize: 16, marginTop: 12, minHeight: 32 }, nav: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 14 },
  btn: { backgroundColor: Y, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 20, marginLeft: 10, minHeight: 48, justifyContent: 'center' },
  btnDark: { backgroundColor: '#2a3342', borderRadius: 10, paddingVertical: 12, paddingHorizontal: 20, minHeight: 48, justifyContent: 'center' },
  btnT: { color: '#fff', fontSize: 17, fontWeight: '700' }, btnTD: { color: '#000', fontSize: 17, fontWeight: '800' },
});
