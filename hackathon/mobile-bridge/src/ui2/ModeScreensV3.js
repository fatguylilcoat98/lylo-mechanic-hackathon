/*
 * Simple and Mechanic screens in the v3 look (flag EXPO_PUBLIC_LYLO_HOME_V3=1 with EXPO_PUBLIC_LYLO_VIEW_MODE=1).
 * Simple: guided, plain English; technical tools only behind a "Show technical details" dropdown.
 * Mechanic: every tool and the full demo-replay breakdown expanded, no dropdown.
 * Same saved setting (lylo.viewMode). Only existing routes and existing demo data (labeled as a replay).
 */
import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View, StyleSheet } from 'react-native';
import * as VM from '../viewModes';
import { SimpleGuide, MechanicDeep } from '../ViewModeScreens';
import { DEMO_SCANS } from '../../../../baseline/mobile/src/data/demoScans';
import { Brand, Card, C, ModeToggle, TabBar, st, CRASH_NOTE } from './HomeV3';
import { features as cgFeatures } from '../crashGuard';
import { features as colFeatures } from '../collision';

/** Crash Guard / Collision cards, gated on the same flags as the home screen. */
function SafetyCards({ env, go }) {
  const crashOn = cgFeatures(env).on; const colOn = colFeatures(env).on;
  if (!crashOn && !colOn) return null;
  return (
    <>
      <View style={st.grid}>
        {crashOn ? <Card testID="mode-crash" icon="shield-car" tint={C.orange} title="Crash Guard" sub="Monitor this drive for a crash or false alarm" onPress={() => go('CrashGuard')} /> : null}
        {colOn ? <Card testID="mode-collision" icon="car-multiple" tint={C.purple} title="I Was in a Collision" sub="Step-by-step checklist, photos, and a summary" onPress={() => go('Collision')} /> : null}
      </View>
      {crashOn ? <Text style={st.note}>{CRASH_NOTE}</Text> : null}
    </>
  );
}

let defStore = null;
try { defStore = require('@react-native-async-storage/async-storage').default; } catch (e) { defStore = null; }

/** Collapsed-by-default dropdown. */
export function Fold({ title, testID, children, initiallyOpen = false }) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <View style={x.fold}>
      <Pressable testID={testID} onPress={() => setOpen(!open)} accessibilityRole="button" accessibilityState={{ expanded: open }} style={x.foldBtn}>
        <Text style={x.foldT}>{(open ? 'Hide ' : 'Show ') + title}</Text><Text style={x.foldT}>{open ? '\u25B2' : '\u25BC'}</Text>
      </Pressable>
      {open ? <View testID={testID + '-body'}>{children}</View> : null}
    </View>
  );
}

function Shell({ navigation, mode, storage, testID, children }) {
  const store = storage === undefined ? defStore : storage;
  const pick = (m) => {
    VM.saveViewMode(store, m);
    if (m === mode || !navigation) return;
    const r = m === 'simple' ? 'SimpleHome' : 'MechanicHome';
    if (navigation.replace) navigation.replace(r); else navigation.navigate(r);
  };
  useEffect(() => { VM.saveViewMode(store, mode); }, [mode, store]);
  return (
    <View style={st.screen} testID={testID}>
      <ScrollView contentContainerStyle={st.scroll}>
        <Brand />
        <ModeToggle vm={mode} onPick={pick} />
        {children}
        <Text style={st.foot}>Repair prices are LYLO estimates, not quotes.</Text>
      </ScrollView>
      <TabBar navigation={navigation} active={null} />
    </View>
  );
}

export function SimpleHomeV3({ navigation, storage, env }) {
  const go = (r, p) => navigation && navigation.navigate(r, p);
  return (
    <Shell navigation={navigation} mode="simple" storage={storage} testID="simple-v3">
      <Text style={x.h1}>{"Let's check your car, one step at a time."}</Text>
      <Text style={x.sub}>Plain English. No car knowledge needed.</Text>
      <View style={x.panel}><SimpleGuide navigation={navigation} /></View>
      <View style={st.grid}>
        <Card testID="simple-port" icon="power-plug-outline" tint={C.cyan} title="Where does it plug in?" sub="A picture of where the reader goes" onPress={() => go('PortHelp')} />
        <Card testID="simple-describe" icon="camera-outline" tint={C.purple} title="No reader? Tell us" sub="Describe it or snap the dashboard" onPress={() => go('NoAdapter')} />
      </View>
      <SafetyCards env={env} go={go} />
      <Fold title="technical details" testID="simple-tech">
        <Text style={x.small}>For people who know cars. You don't need these.</Text>
        <View style={st.grid}>
          <Card icon="magnify" tint={C.cyan} title="Look up a code" sub="Type a trouble code" onPress={() => go('Lookup')} />
          <Card icon="text-box-outline" tint={C.green} title="Debug log" sub="What the reader said" onPress={() => go('Log')} />
        </View>
      </Fold>
    </Shell>
  );
}

export function MechanicHomeV3({ navigation, storage, env }) {
  const go = (r, p) => navigation && navigation.navigate(r, p);
  const demo = DEMO_SCANS.checkengine;
  const m = VM.demoModel(demo);
  const k = m ? VM.buildMechanic(m, demo) : null;
  return (
    <Shell navigation={navigation} mode="mechanic" storage={storage} testID="mechanic-v3">
      <Text style={x.h1}>Mechanic tools</Text>
      <Text style={x.sub}>Codes, freeze frame, live PIDs, monitors, evidence. Anything the scanner can't read says "not read".</Text>
      <View style={st.grid}>
        <Card testID="mech-scan" icon="access-point" tint={C.cyan} title="Scan codes + PIDs" sub="Connect OBD adapter, ignition ON" onPress={() => go('Connect')} />
        <Card testID="mech-used" icon="car-wrench" tint={C.orange} title="Used-car check" sub="Clear counters, monitors" onPress={() => go('Connect')} />
        <Card testID="mech-lookup" icon="book-open-outline" tint={C.purple} title="DTC lookup" sub="Any code, offline" onPress={() => go('Lookup')} />
        <Card testID="mech-log" icon="text-box-outline" tint={C.green} title="Debug log" sub="Raw adapter traffic" onPress={() => go('Log')} />
      </View>
      <SafetyCards env={env} go={go} />
      {k ? (
        <View style={x.panel} testID="mech-demo">
          <Text style={x.replay}>DEMO REPLAY · not your car</Text>
          <MechanicDeep k={k} navigation={navigation} />
        </View>
      ) : null}
    </Shell>
  );
}

const x = StyleSheet.create({
  h1: { color: C.text, fontSize: 26, fontWeight: '900', lineHeight: 32, marginTop: 4 },
  sub: { color: C.dim, fontSize: 15, lineHeight: 21, marginTop: 6, marginBottom: 12 },
  small: { color: C.dim, fontSize: 13, marginBottom: 8 },
  panel: { backgroundColor: C.card, borderRadius: 18, borderWidth: 1.5, borderColor: '#2E9BFF55', padding: 16, marginBottom: 12 },
  fold: { backgroundColor: C.card, borderRadius: 16, borderWidth: 1, borderColor: '#243042', marginVertical: 8, paddingHorizontal: 14 },
  foldBtn: { minHeight: 52, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  foldT: { color: C.blue, fontSize: 16, fontWeight: '800' },
  replay: { color: '#C9A6FF', fontWeight: '900', fontSize: 13, marginBottom: 6 },
});
