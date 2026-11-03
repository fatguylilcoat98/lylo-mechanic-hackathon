/*
 * Simple and Mechanic screens in the v3 look (flag EXPO_PUBLIC_LYLO_HOME_V3=1 with EXPO_PUBLIC_LYLO_VIEW_MODE=1).
 * Layout follows Chris's Simple/Mechanic mockups, but every tile opens a feature that exists today.
 * Not built (omitted, see /workspace/out/polish/mockup-vs-real.md): live-data streaming, all-module scan,
 * service/torque procedures, system tests, ABS/SRS/DPF/TPMS/A-C tools, scan history, settings screen.
 * Simple: plain English; technical tools only behind a "Show technical details" dropdown.
 * Mechanic: every tool and the full demo-replay breakdown open, no dropdown.
 * Same saved setting (lylo.viewMode). Only existing routes and existing demo data (labeled as a replay).
 */
import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View, StyleSheet } from 'react-native';
import * as VM from '../viewModes';
import { MechanicDeep } from '../ViewModeScreens';
import { DEMO_SCANS } from '../../../../baseline/mobile/src/data/demoScans';
import { Brand, Card, C, Icon, ModeToggle, TabBar, st, CRASH_NOTE } from './HomeV3';
import OBDService from '../../../../baseline/mobile/src/services/OBDService';
import { features as cgFeatures } from '../crashGuard';
import { features as colFeatures } from '../collision';

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


/** Big glowing tile (mockup style). Wide = full row. */
export function Tile({ testID, icon, tint, title, sub, onPress, wide, art }) {
  return (
    <Pressable testID={testID} onPress={onPress} accessibilityRole="button" accessibilityLabel={title + '. ' + sub}
      style={({ pressed }) => [x.tile, wide ? x.wide : x.half, { borderColor: tint, shadowColor: tint, backgroundColor: tint + '1F' }, pressed && { opacity: 0.8 }]}>
      <View style={x.tIcon}><Icon name={icon} size={wide ? 44 : 34} color={tint} /></View>
      <View style={{ flex: 1 }}>
        <Text style={x.tTitle}>{title}</Text>
        <Text style={x.tSub}>{sub}</Text>
      </View>
      {art ? <View style={x.art}><Icon name={art} size={40} color={tint} /></View> : <Icon name="chevron-right" size={22} color={C.dim} />}
    </Pressable>
  );
}

function Small({ testID, icon, title, sub, onPress }) {
  return (
    <Pressable testID={testID} onPress={onPress} accessibilityRole="button" accessibilityLabel={title + (sub ? '. ' + sub : '')} style={x.small4}>
      <Icon name={icon} size={26} color={C.text} />
      <Text style={x.sTitle}>{title}</Text>
      {sub ? <Text style={x.sSub}>{sub}</Text> : null}
    </Pressable>
  );
}

function Shell({ navigation, mode, storage, testID, children }) {
  const store = storage === undefined ? defStore : storage;
  const [menu, setMenu] = useState(false);
  const pick = (m) => {
    setMenu(false); VM.saveViewMode(store, m);
    if (m === mode || !navigation) return;
    const r = m === 'simple' ? 'SimpleHome' : 'MechanicHome';
    if (navigation.replace) navigation.replace(r); else navigation.navigate(r);
  };
  useEffect(() => { VM.saveViewMode(store, mode); }, [mode, store]);
  const simple = mode === 'simple';
  return (
    <View style={st.screen} testID={testID}>
      <ScrollView contentContainerStyle={st.scroll}>
        <View style={x.top}>
          <Pressable testID="back" onPress={() => navigation && (navigation.canGoBack && !navigation.canGoBack() ? navigation.navigate('Home') : navigation.goBack())} accessibilityRole="button" accessibilityLabel="Back" style={x.back}>
            <Icon name="arrow-left" size={26} color={C.blue} />
          </Pressable>
          <View style={{ flex: 1 }}><Brand /></View>
        </View>
        <View style={x.pillRow}>
          <Pressable testID="vm-pill" onPress={() => setMenu(!menu)} accessibilityRole="button" accessibilityState={{ expanded: menu }}
            accessibilityLabel={(simple ? 'Simple View' : 'Mechanic View') + ', change view'} style={x.pill}>
            <Icon name={simple ? 'account-outline' : 'tools'} size={20} color={C.text} />
            <Text style={x.pillT}>{simple ? 'Simple View' : 'Mechanic View'}</Text>
            <Icon name={menu ? 'chevron-up' : 'chevron-down'} size={20} color={C.text} />
          </Pressable>
        </View>
        {menu ? <ModeToggle vm={mode} onPick={pick} /> : null}
        {children}
        <Text style={st.foot}>Repair prices are LYLO estimates, not quotes.</Text>
      </ScrollView>
      <TabBar navigation={navigation} active={null} />
    </View>
  );
}

function Title({ a, b, sub, bullets, tick }) {
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={x.h1}>{a + ' '}<Text style={{ color: C.cyan }}>{b}</Text></Text>
      <Text style={x.sub}>{sub}</Text>
      {bullets.map((t) => (
        <View key={t} style={x.bullet}><Icon name="check-bold" size={18} color={tick} /><Text style={x.bulletT}>{t}</Text></View>
      ))}
    </View>
  );
}

export function SimpleHomeV3({ navigation, storage, env, setupOn }) {
  const go = (r, p) => navigation && navigation.navigate(r, p);
  const [tour, setTour] = useState(true);
  const colOn = colFeatures(env).on; const crashOn = cgFeatures(env).on;
  const [tools, setTools] = useState(false);
  return (
    <Shell navigation={navigation} mode="simple" storage={storage} testID="simple-v3">
      <Title a="Simple" b="View" sub="Car help made easy." tick={C.blue}
        bullets={["Find what's wrong", 'Get clear next steps', 'Use photos or an adapter']} />
      {tour ? (
        <View style={x.banner} testID="tour-banner">
          <Icon name="map-marker-path" size={30} color={C.cyan} />
          <View style={{ flex: 1, marginLeft: 10 }}>
            <Text style={x.tTitle}>New to LYLO?</Text>
            <Text style={x.tSub}>See a demo scan, clearly marked as a replay.</Text>
            <View style={{ flexDirection: 'row', marginTop: 8 }}>
              <Pressable testID="tour-go" onPress={() => go('Demo')} accessibilityRole="button" accessibilityLabel="Show me around" style={x.btnBlue}><Text style={x.btnT}>Show me around</Text></Pressable>
              <Pressable testID="tour-no" onPress={() => setTour(false)} accessibilityRole="button" accessibilityLabel="No thanks" style={x.btnDark}><Text style={x.btnT}>No thanks</Text></Pressable>
            </View>
          </View>
        </View>
      ) : null}
      <View style={x.grid}>
        <Tile wide testID="simple-check" icon="engine-outline" art="connection" tint={C.cyan} title="Check My Car" sub="Step by step: scan with an OBD adapter, or describe the problem" onPress={() => go('Guide')} />
        <Tile testID="simple-photo" icon="camera-outline" tint={C.blue} title="Take a Photo" sub="Snap your dashboard lights" onPress={() => go('NoAdapter', { start: 'dash' })} />
        <Tile testID="simple-say" icon="microphone-outline" tint={C.purple} title={"Say What's Happening"} sub="In your own words (voice or text)" onPress={() => go('NoAdapter', { start: 'describe' })} />
        {colOn ? <Tile testID="mode-collision" icon="car-multiple" tint={C.orange} title="I Was in a Collision" sub="Step-by-step checklist, photos, and summary" onPress={() => go('Collision')} /> : null}
        <Tile testID="simple-part" icon="car-cog" tint={C.green} title="Find a Part" sub="Use a photo to find a part" onPress={() => go('PhotoHelper')} />
        {crashOn ? <Tile wide testID="mode-crash" icon="shield-car" tint={C.orange} title="Crash Guard" sub="Monitor this drive for a crash or false alarm" onPress={() => go('CrashGuard')} /> : null}
      </View>
      {crashOn ? <Text style={st.note}>{CRASH_NOTE}</Text> : null}
      <View style={x.row4}>
        <Small testID="simple-mycar" icon="book-open-outline" title="My Car" sub="Your car's VIN" onPress={() => go('Vin')} />
        <Small testID="simple-plug" icon="power-plug-outline" title="Plug Help" sub="Where it plugs in" onPress={() => go('PortHelp')} />
        <Small testID="simple-tools" icon="tools" title="Tools" sub="Technical extras" onPress={() => setTools(!tools)} />
        {setupOn ? <Small testID="simple-setup" icon="cog-outline" title="Setup" sub="Quick setup again" onPress={() => go('Setup')} /> : null}
      </View>
      <Fold title="technical details" testID="simple-tech" key={tools ? 'o' : 'c'} initiallyOpen={tools}>
        <Text style={x.smallT}>For people who know cars. You don't need these.</Text>
        <View style={x.grid}>
          <Tile icon="magnify" tint={C.cyan} title="Look up a code" sub="Type a trouble code" onPress={() => go('Lookup')} />
          <Tile icon="text-box-outline" tint={C.green} title="Debug log" sub="What the reader said" onPress={() => go('Log')} />
        </View>
      </Fold>
    </Shell>
  );
}

export function MechanicHomeV3({ navigation, storage, env }) {
  const go = (r, p) => navigation && navigation.navigate(r, p);
  const connected = !!OBDService.connected;
  const scan = (mode) => (connected ? go('Scan', { mode }) : go('Connect'));
  const crashOn = cgFeatures(env).on; const colOn = colFeatures(env).on;
  const demo = DEMO_SCANS.checkengine;
  const m = VM.demoModel(demo);
  const k = m ? VM.buildMechanic(m, demo) : null;
  return (
    <Shell navigation={navigation} mode="mechanic" storage={storage} testID="mechanic-v3">
      <Title a="Mechanic" b="View" sub="Codes, readings, and the evidence behind every answer." tick={C.green}
        bullets={['Engine codes, status and freeze frame', 'Sensor readings (one snapshot per scan)', 'Ranked causes with evidence and costs']} />
      <View style={x.obd} testID="obd-bar">
        <Icon name="bluetooth" size={28} color={C.cyan} />
        <View style={{ flex: 1, marginLeft: 8 }}>
          <Text style={x.tTitle}>OBD Connection</Text>
          <Text style={x.tSub} testID="obd-status"><Text style={{ color: connected ? C.green : '#FF5A52' }}>{'\u25CF '}</Text>{connected ? 'Connected' : 'Not connected'}</Text>
        </View>
        <Pressable testID="obd-connect" onPress={() => go('Connect')} accessibilityRole="button" accessibilityLabel="Connect OBD" style={x.btnBlue}><Text style={x.btnT}>Connect OBD</Text></Pressable>
        <Pressable testID="obd-help" onPress={() => go('PortHelp')} accessibilityRole="button" accessibilityLabel="OBD Help" style={x.btnDark}><Text style={x.btnT}>OBD Help</Text></Pressable>
      </View>
      {crashOn || colOn ? (
        <View style={x.grid}>
          {crashOn ? <Tile testID="mode-crash" icon="shield-car" tint={C.orange} title="Crash Guard" sub="Monitor this drive for a crash or false alarm" onPress={() => go('CrashGuard')} /> : null}
          {colOn ? <Tile testID="mode-collision" icon="car-multiple" tint={C.purple} title="I Was in a Collision" sub="Checklist, photos, and a summary" onPress={() => go('Collision')} /> : null}
        </View>
      ) : null}
      {crashOn ? <Text style={st.note}>{CRASH_NOTE}</Text> : null}
      <View style={x.grid}>
        <Tile testID="mech-scan" icon="engine-outline" tint={C.cyan} title="Full Scan" sub="Engine codes, freeze frame, and readings" onPress={() => scan('codes')} />
        <Tile testID="mech-diagnosis" icon="clipboard-list-outline" tint={C.purple} title="Diagnosis" sub="Meta AI causes with evidence. Try it on a demo scan" onPress={() => go('Demo')} />
        <Tile testID="mech-used" icon="car-wrench" tint={C.orange} title="Used-Car Check" sub="Clear counters and readiness monitors" onPress={() => scan('usedcar')} />
        <Tile testID="mech-part" icon="cog-outline" tint={C.green} title="Find a Part" sub="Point the camera to find a part" onPress={() => go('PhotoHelper')} />
      </View>
      <Text style={x.qt}>{'Quick Tools'}</Text>
      <View style={x.row4}>
        <Small testID="mech-lookup" icon="book-open-outline" title="Code Lookup" onPress={() => go('Lookup')} />
        <Small testID="mech-plug" icon="power-plug-outline" title="Port Help" onPress={() => go('PortHelp')} />
        <Small testID="mech-vin" icon="car-outline" title="VIN" onPress={() => go('Vin')} />
        <Small testID="mech-log" icon="text-box-outline" title="Debug Log" onPress={() => go('Log')} />
      </View>
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
  top: { flexDirection: 'row', alignItems: 'center' },
  back: { width: 40, height: 48, justifyContent: 'center' },
  pillRow: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: -6, marginBottom: 6 },
  pill: { flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderColor: C.blue, borderRadius: 999, paddingHorizontal: 14, minHeight: 44, backgroundColor: 'rgba(46,155,255,0.12)', shadowColor: C.blue, shadowOpacity: 0.7, shadowRadius: 10, elevation: 6 },
  pillT: { color: C.text, fontWeight: '800', fontSize: 15, marginHorizontal: 8 },
  h1: { color: C.text, fontSize: 38, fontWeight: '900', lineHeight: 44 },
  sub: { color: C.text, fontSize: 18, lineHeight: 24, marginTop: 2, marginBottom: 6 },
  bullet: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  bulletT: { color: C.text, fontSize: 15, marginLeft: 8 },
  banner: { flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderColor: C.blue, borderRadius: 18, padding: 14, marginBottom: 12, backgroundColor: 'rgba(46,155,255,0.10)' },
  obd: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', borderWidth: 1.5, borderColor: '#2E9BFF88', borderRadius: 18, padding: 12, marginBottom: 12, backgroundColor: 'rgba(16,24,36,0.92)' },
  btnBlue: { backgroundColor: C.blue, borderRadius: 999, paddingHorizontal: 14, minHeight: 44, justifyContent: 'center', marginLeft: 6, marginTop: 4 },
  btnDark: { backgroundColor: '#1C2533', borderWidth: 1, borderColor: '#3A4656', borderRadius: 999, paddingHorizontal: 14, minHeight: 44, justifyContent: 'center', marginLeft: 6, marginTop: 4 },
  btnT: { color: C.text, fontWeight: '800', fontSize: 14 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  tile: { flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderRadius: 18, padding: 12, marginBottom: 10, minHeight: 88, shadowOpacity: 0.7, shadowRadius: 12, elevation: 5 },
  half: { width: '48.5%' }, wide: { width: '100%', minHeight: 100 },
  tIcon: { marginRight: 10 },
  art: { marginLeft: 8, opacity: 0.9 },
  tTitle: { color: C.text, fontSize: 17, fontWeight: '800' },
  tSub: { color: C.dim, fontSize: 13, lineHeight: 18, marginTop: 2 },
  row4: { flexDirection: 'row', justifyContent: 'space-between', marginVertical: 6 },
  small4: { flex: 1, marginHorizontal: 3, alignItems: 'center', borderWidth: 1, borderColor: '#2E9BFF66', borderRadius: 16, paddingVertical: 12, paddingHorizontal: 4, backgroundColor: 'rgba(16,24,36,0.92)', minHeight: 76 },
  sTitle: { color: C.text, fontWeight: '800', fontSize: 14, marginTop: 4, textAlign: 'center' },
  sSub: { color: C.dim, fontSize: 11, textAlign: 'center', marginTop: 2 },
  qt: { color: C.text, fontSize: 18, fontWeight: '900', marginTop: 6 },
  smallT: { color: C.dim, fontSize: 13, marginBottom: 8 },
  panel: { backgroundColor: C.card, borderRadius: 18, borderWidth: 1.5, borderColor: '#2E9BFF55', padding: 16, marginVertical: 12 },
  fold: { backgroundColor: C.card, borderRadius: 16, borderWidth: 1, borderColor: '#243042', marginVertical: 8, paddingHorizontal: 14 },
  foldBtn: { minHeight: 52, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  foldT: { color: C.blue, fontSize: 16, fontWeight: '800' },
  replay: { color: '#C9A6FF', fontWeight: '900', fontSize: 13, marginBottom: 6 },
});
