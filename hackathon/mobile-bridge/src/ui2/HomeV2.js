/*
 * UI v2 home (flag EXPO_PUBLIC_LYLO_UI_V2=1). One clear primary action, two backups,
 * everything else tucked under "More tools". Same routes and flags as the v1 home.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import OBDService from '../../../../baseline/mobile/src/services/OBDService';
// v0.7.1: footer version comes from app.json (was hardcoded 'v0.5.2').
let APP_VERSION = '?';
try { APP_VERSION = require('../../../../baseline/mobile/app.json').expo.version || '?'; } catch (e) { APP_VERSION = '?'; }
import { DEMO_SCANS } from '../../../../baseline/mobile/src/data/demoScans';
import { features as noAdapterFeatures } from '../noAdapter';
import { useFirstRunSetup } from '../SetupScreen';
import { features as demoFeatures } from '../demo';
import { features as smFeatures } from '../showMe'; // v0.6
import { features as cgFeatures } from '../crashGuard'; // v0.6
import { features as colFeatures } from '../collision'; // v0.6
import * as VM from '../viewModes'; // v0.7.2 flag EXPO_PUBLIC_LYLO_VIEW_MODE
import { ViewChoice, ViewSwitch } from '../ViewModeScreens';
import { color, space, radius, type, touch } from './theme';
import { BigActionButton } from './components';
import HomeV3, { homeV3On } from './HomeV3'; // flag EXPO_PUBLIC_LYLO_HOME_V3

function Link({ title, onPress }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [st.link, pressed && { backgroundColor: color.surfaceHi }]}>
      <Text style={st.linkText}>{title}</Text><Text style={st.chev}>{'\u203A'}</Text>
    </Pressable>
  );
}

let vmStorage = null;
try { vmStorage = require('@react-native-async-storage/async-storage').default; } catch (e) { vmStorage = null; }

export default function HomeV2({ route, navigation, noAdapterOn, demoOn: demoOnProp, env, storage }) {
  const vmOn = VM.features(env).on;
  const vmStore = storage === undefined ? vmStorage : storage;
  const [vm, setVm] = useState(vmOn ? 'loading' : null);
  useEffect(() => { if (!vmOn) return undefined; let live = true; VM.loadChosen(vmStore).then((m) => { if (live) setVm(m); }); return () => { live = false; }; }, [vmOn, vmStore]);
  const pickView = (m) => { setVm(m); VM.saveViewMode(vmStore, m); if (m === 'simple' && navigation) navigation.navigate('Guide'); };
  const hero = smFeatures(env).home; // v0.6 EXPO_PUBLIC_LYLO_NOSENSOR_HOME: no-sensor check is the primary action when no adapter
  const crashOn = cgFeatures(env).on; const colOn = colFeatures(env).on;
  const noAdapter = noAdapterOn === undefined ? noAdapterFeatures().on : noAdapterOn;
  const demoOn = demoOnProp === undefined ? demoFeatures().on : demoOnProp;
  const setupOn = useFirstRunSetup(navigation);
  const [device, setDevice] = useState(OBDService.device);
  const [more, setMore] = useState(false);
  useFocusEffect(useCallback(() => { setDevice(OBDService.connected ? OBDService.device : null);
    if (vmOn && homeV3On(env)) VM.loadChosen(vmStore).then((m) => { if (m) setVm(m); }); // v3: mode screens may have switched it
  }, []));
  const go = (r, p) => navigation.navigate(r, p);

  if (vmOn && vm === 'loading') return <View style={st.screen} />;
  if (vmOn && !vm) return <ScrollView style={st.screen} contentContainerStyle={st.scroll}><ViewChoice onPick={pickView} /></ScrollView>;
  if (homeV3On(env)) {
    // v3 toggle only switches the mode (saved to the same key); the Check My Car card opens the guide in Simple.
    const setMode = (m) => { setVm(m); VM.saveViewMode(vmStore, m); if (navigation) navigation.navigate(m === 'simple' ? 'SimpleHome' : 'MechanicHome'); };
    return <HomeV3 route={route} navigation={navigation} vmOn={vmOn} vm={vm} setMode={setMode} device={device} setDevice={setDevice} hero={hero}
      noAdapter={noAdapter} demoOn={demoOn} crashOn={crashOn} colOn={colOn} setupOn={setupOn} />;
  }
  return (
    <ScrollView style={st.screen} contentContainerStyle={st.scroll}>
      {vmOn ? <ViewSwitch mode={vm} onChange={pickView} /> : null}
      {vmOn && vm === 'simple' ? <BigActionButton testID="vm-start-guide" title="Start: check my car step by step" subtitle="We'll walk you through it" onPress={() => go('Guide')} /> : null}
      <View style={st.header} testID="brand-header">
        <Image source={require('../../../../baseline/mobile/assets/app-icon.png')} style={st.logo} accessibilityLabel="LYLO Mechanic logo" />
        <Text style={st.brand}>LYLO Mechanic</Text>
        <Text style={st.powered}>Powered by Meta AI</Text>
      </View>
      <Text style={st.hero}>The car AI that shows its proof.</Text>
      <Text style={st.sub}>And can't talk you out of a safety warning.</Text>

      {device ? (
        <View style={st.connected} testID="connected">
          <Text style={st.connLabel}>{'\u25CF  CONNECTED'}</Text>
          <Text style={st.connName}>{device.name}</Text>
          <BigActionButton testID="primary-action" title="Scan my car" subtitle="Read codes and live data, then explain them" onPress={() => go('Scan', { mode: 'codes' })} />
          <BigActionButton kind="secondary" title="Used-car check" subtitle="Thinking of buying it? Check it first" onPress={() => go('Scan', { mode: 'usedcar' })} />
          <Pressable onPress={async () => { await OBDService.disconnect(); setDevice(null); }} accessibilityRole="button" style={st.small}><Text style={st.smallText}>Disconnect</Text></Pressable>
        </View>
      ) : hero ? (
        <>
          <BigActionButton testID="primary-action" title="Tell LYLO what's wrong" subtitle="Say it, type it, or snap the dash. No adapter needed"
            onPress={() => (noAdapter ? go('NoAdapter') : go('Lookup'))} />
          <BigActionButton kind="secondary" title="Have an OBD adapter? Scan" subtitle="Plug in your OBDLink, ignition ON" onPress={() => go('Connect')} />
        </>
      ) : (
        <BigActionButton testID="primary-action" title="Scan with adapter" subtitle="Plug in your OBDLink, ignition ON" onPress={() => go('Connect')} />
      )}
      {hero && !device ? null : (
      <BigActionButton kind="secondary" title="No adapter? Start here" subtitle="Describe it, type a code, or snap the dash"
        onPress={() => (noAdapter ? go('NoAdapter') : go('Lookup'))} />)}
      {crashOn ? <BigActionButton kind="secondary" title="Crash Guard" subtitle="Turn on for this drive. Not a replacement for 911. Can miss a crash or false-alarm; untested on real crashes" onPress={() => go('CrashGuard')} /> : null}
      {colOn ? <BigActionButton kind="secondary" title="I was in a collision" subtitle="Step-by-step checklist and photos for your insurer" onPress={() => go('Collision')} /> : null}
      <BigActionButton kind="secondary" title="Try a demo" subtitle="No car needed. Clearly marked as a replay"
        onPress={() => (demoOn ? go('Demo') : go('Codes', { scan: DEMO_SCANS.checkengine }))} />

      <Pressable onPress={() => setMore(!more)} accessibilityRole="button" accessibilityState={{ expanded: more }} style={st.moreBtn}>
        <Text style={st.moreText}>{more ? 'Fewer tools \u25B2' : 'More tools \u25BC'}</Text>
      </Pressable>
      {more ? (
        <View style={st.moreBox}>
          <Link title="Photo Helper: find a part" onPress={() => go('PhotoHelper')} />
          <Link title="Your car: add your VIN" onPress={() => go('Vin')} />
          <Link title="Look up a trouble code" onPress={() => go('Lookup')} />
          <Link title="Demo: used car, codes cleared" onPress={() => go('UsedCar', { scan: DEMO_SCANS.usedcar })} />
          {setupOn ? <Link title="Setup" onPress={() => go('Setup')} /> : null}
          <Link title="Debug log" onPress={() => go('Log')} />
        </View>
      ) : null}
      <Text style={st.foot}>{`Repair prices are LYLO estimates, not quotes. v${APP_VERSION}${(() => { try { const b = String(process.env.EXPO_PUBLIC_LYLO_BUILD_ID || '').trim(); return b ? ' · build ' + b : ''; } catch (e) { return ''; } })()}`}</Text>
    </ScrollView>
  );
}

const st = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  scroll: { padding: space.xl, paddingTop: 56, paddingBottom: 56 },
  header: { alignItems: 'center', marginBottom: space.xxl },
  logo: { width: 132, height: 132, borderRadius: 28, marginBottom: space.lg },
  brand: { color: color.text, ...type.h, textAlign: 'center' },
  powered: { color: color.textDim, ...type.small, textAlign: 'center', marginTop: space.xs },
  hero: { color: color.text, ...type.hero, textAlign: 'center' },
  sub: { color: color.textDim, ...type.body, textAlign: 'center', marginTop: space.sm, marginBottom: space.xl },
  connected: { backgroundColor: color.surface, borderRadius: radius.lg, padding: space.lg, borderWidth: 1.5, borderColor: color.line },
  connLabel: { color: color.green, ...type.label },
  connName: { color: color.text, ...type.h, marginTop: space.xs },
  small: { minHeight: touch.min, justifyContent: 'center', alignItems: 'center' },
  smallText: { color: color.textDim, ...type.small, fontWeight: '700' },
  moreBtn: { minHeight: touch.min, justifyContent: 'center', alignItems: 'center', marginTop: space.lg },
  moreText: { color: color.accent, ...type.small, fontWeight: '800' },
  moreBox: { backgroundColor: color.surface, borderRadius: radius.lg, overflow: 'hidden' },
  link: { minHeight: touch.min, flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.lg, borderBottomWidth: 1, borderBottomColor: color.line },
  linkText: { color: color.text, ...type.body, flex: 1 },
  chev: { color: color.textDim, fontSize: 28 },
  foot: { color: color.textDim, ...type.small, textAlign: 'center', marginTop: space.xl },
});
