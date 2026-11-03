/*
 * Home v3 "polish" look (flag EXPO_PUBLIC_LYLO_HOME_V3=1, on top of UI v2). Presentation only:
 * same routes, same flags, same view-mode key as HomeV2. With the flag unset HomeV2 renders as before.
 * Tabs: Home (this screen), My Garage -> existing 'Vin' screen, More -> existing tools list.
 * No History tab: the app has no saved scan-history screen, so we don't fake one.
 */
import React, { useEffect, useState } from 'react';
import { Image, ImageBackground, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import OBDService from '../../../../baseline/mobile/src/services/OBDService';
import { DEMO_SCANS } from '../../../../baseline/mobile/src/data/demoScans';

let APP_VERSION = '?';
try { APP_VERSION = require('../../../../baseline/mobile/app.json').expo.version || '?'; } catch (e) { APP_VERSION = '?'; }

export function homeV3On(env) {
  const e = env || { EXPO_PUBLIC_LYLO_HOME_V3: process.env.EXPO_PUBLIC_LYLO_HOME_V3 };
  return e.EXPO_PUBLIC_LYLO_HOME_V3 === '1';
}

export const C = { bg: '#070B12', card: 'rgba(16,24,36,0.92)', text: '#F2F5F8', dim: '#B4C0CC', blue: '#2E9BFF', cyan: '#3FD8FF', orange: '#FF7A3D', purple: '#A98BFF', green: '#2BD47D' };

export function Card({ testID, glyph, tint, title, sub, onPress }) {
  return (
    <Pressable testID={testID} onPress={onPress} accessibilityRole="button" accessibilityLabel={title + '. ' + sub}
      style={({ pressed }) => [st.card, { borderColor: tint, shadowColor: tint }, pressed && { opacity: 0.8 }]}>
      <Text style={[st.glyph, { color: tint }]}>{glyph}</Text>
      <View style={st.cardRow}>
        <View style={{ flex: 1 }}>
          <Text style={st.cardTitle}>{title}</Text>
          <Text style={st.cardSub}>{sub}</Text>
        </View>
        <Text style={st.chev}>{'\u203A'}</Text>
      </View>
    </Pressable>
  );
}

export function Mode({ id, on, icon, title, sub, onPress }) {
  return (
    <Pressable testID={'vm-toggle-' + id} onPress={onPress} accessibilityRole="tab" accessibilityState={{ selected: on }} style={[st.mode, on && st.modeOn]}>
      <Text style={st.modeIcon}>{icon}</Text>
      <View style={{ flexShrink: 1 }}>
        <Text style={st.modeTitle}>{title}</Text>
        <Text style={[st.modeSub, on && { color: '#EAF4FF' }]}>{sub}</Text>
      </View>
    </Pressable>
  );
}


export function Brand() {
  return (
    <View style={st.header} testID="brand-header">
      <Image source={require('../../assets/home-logo.png')} style={st.logo} accessibilityLabel="LYLO Mechanic logo" />
      <View style={st.divider} />
      <View style={{ flexShrink: 1 }}>
        <Text style={st.brand}>LYLO Mechanic</Text>
        <Text style={st.powered}><Text style={{ color: C.blue, fontWeight: '900' }}>{'\u221E '}</Text>Powered by Meta AI</Text>
      </View>
    </View>
  );
}

export function ModeToggle({ vm, onPick }) {
  return (
    <View style={st.toggle} testID="vm-toggle">
      <Mode id="simple" on={vm === 'simple'} icon={'\u{1F464}'} title="Simple Mode" sub="Step-by-step help" onPress={() => onPick('simple')} />
      <Mode id="mechanic" on={vm === 'mechanic'} icon={'\u{1F6E0}\uFE0F'} title="Mechanic Mode" sub="Advanced tools & data" onPress={() => onPick('mechanic')} />
    </View>
  );
}

/** Home / My Garage (existing 'Vin' screen) / More. No History tab: no scan-history screen exists. */
export function TabBar({ navigation, active, onHome, onMore }) {
  const tabs = [
    ['home', '\u2302', 'Home', onHome || (() => navigation.navigate('Home'))],
    ['garage', '\u{1F698}', 'My Garage', () => navigation.navigate('Vin')],
    ['more', '\u2022\u2022\u2022', 'More', onMore || (() => navigation.navigate('Home', { more: true }))],
  ];
  return (
    <View style={st.tabs} testID="tab-bar">
      {tabs.map(([id, ic, label, f]) => {
        const on = active === id;
        return (
          <Pressable key={id} testID={'tab-' + id} onPress={f} accessibilityRole="tab" accessibilityState={{ selected: on }} style={[st.tab, on && st.tabOn]}>
            <Text style={[st.tabIcon, on && { color: C.blue }]}>{ic}</Text>
            <Text style={[st.tabText, on && { color: C.blue }]}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** props from HomeV2: navigation, vm ('simple'|'mechanic'|null when the view flag is off), setMode,
 * device, setDevice, hero, noAdapter, demoOn, crashOn, colOn, setupOn
 */
export default function HomeV3({ route, navigation, vmOn, vm, setMode, device, setDevice, hero, noAdapter, demoOn, crashOn, colOn, setupOn }) {
  const [more, setMore] = useState(!!(route && route.params && route.params.more));
  useEffect(() => { if (route && route.params && route.params.more) setMore(true); }, [route && route.params && route.params.more]);
  const go = (r, p) => navigation.navigate(r, p);
  const noAdapterGo = () => (noAdapter ? go('NoAdapter') : go('Lookup'));
  const checkCar = () => {
    if (vmOn && vm === 'simple') return go('Guide');
    if (device) return go('Scan', { mode: 'codes' });
    return hero ? noAdapterGo() : go('Connect');
  };
  return (
    <View style={st.screen} testID="home-v3">
      <ScrollView contentContainerStyle={st.scroll}>
        <ImageBackground source={require('../../assets/home-car.jpg')} style={st.top} imageStyle={st.carImg} resizeMode="cover">
          <Brand />
          <Text style={st.hero}>The car AI that shows its proof.</Text>
          <Text style={st.sub}>{'Real answers. Evidence you can see.\nNo guesswork.'}</Text>
        </ImageBackground>

        {vmOn ? <ModeToggle vm={vm} onPick={setMode} /> : null}

        {device ? (
          <View style={st.conn} testID="connected">
            <Text style={st.connText}>{'\u25CF  Connected: ' + device.name}</Text>
            <Pressable onPress={async () => { await OBDService.disconnect(); setDevice(null); }} accessibilityRole="button"><Text style={st.connBtn}>Disconnect</Text></Pressable>
          </View>
        ) : null}

        <View style={st.grid}>
          <Card testID="primary-action" glyph={'\u2699\uFE0F'} tint={C.cyan} title="Check My Car" sub="Scan, read codes, and get a clear answer" onPress={checkCar} />
          {crashOn ? <Card testID="card-crash" glyph={'\u{1F6E1}\uFE0F'} tint={C.orange} title="Crash Guard" sub="Monitor this drive for a crash or false alarm" onPress={() => go('CrashGuard')} /> : null}
          {colOn ? <Card testID="card-collision" glyph={'\u{1F697}'} tint={C.purple} title="I Was in a Collision" sub="Step-by-step checklist, photos, and a summary" onPress={() => go('Collision')} /> : null}
          <Card testID="card-demo" glyph={'\u25B6\uFE0E'} tint={C.green} title="Try a Demo" sub="See how it works (no car needed)"
            onPress={() => (demoOn ? go('Demo') : go('Codes', { scan: DEMO_SCANS.checkengine }))} />
        </View>
        {crashOn ? <Text style={st.note}>Crash Guard is not a replacement for 911. It can miss a crash or false-alarm; untested on real crashes.</Text> : null}

        {more ? (
          <View style={st.moreBox} testID="more-tools">
            {[
              ['Scan with an OBD adapter', () => (device ? go('Scan', { mode: 'codes' }) : go('Connect'))],
              ['No adapter? Describe it, type a code, or snap the dash', noAdapterGo],
              ['Used-car check', () => (device ? go('Scan', { mode: 'usedcar' }) : go('Connect'))],
              ['Photo Helper: find a part', () => go('PhotoHelper')],
              ['Look up a trouble code', () => go('Lookup')],
              ['Demo: used car, codes cleared', () => go('UsedCar', { scan: DEMO_SCANS.usedcar })],
              ...(setupOn ? [['Setup', () => go('Setup')]] : []),
              ['Debug log', () => go('Log')],
            ].map(([t, f]) => (
              <Pressable key={t} onPress={f} accessibilityRole="button" style={st.link}><Text style={st.linkText}>{t}</Text><Text style={st.chevSm}>{'\u203A'}</Text></Pressable>
            ))}
          </View>
        ) : null}
        <Text style={st.foot}>Repair prices are LYLO estimates, not quotes.</Text>
        <Text style={st.ver}>{'v' + APP_VERSION}</Text>
      </ScrollView>

      <TabBar navigation={navigation} active={more ? 'more' : 'home'} onHome={() => setMore(false)} onMore={() => setMore(!more)} />
    </View>
  );
}

export const st = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  scroll: { padding: 18, paddingTop: 44, paddingBottom: 110 },
  top: { marginHorizontal: -18, paddingHorizontal: 18, paddingBottom: 12 },
  carImg: { left: undefined, right: 0, width: '45%', opacity: 0.85 },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  logo: { width: 96, height: 96 },
  divider: { width: 1, height: 56, backgroundColor: '#3A4656', marginHorizontal: 14 },
  brand: { color: C.text, fontSize: 24, fontWeight: '800' },
  powered: { color: C.dim, fontSize: 15, marginTop: 2 },
  hero: { color: C.text, fontSize: 36, lineHeight: 40, fontWeight: '900', maxWidth: '85%' },
  sub: { color: C.dim, fontSize: 16, lineHeight: 22, marginTop: 10 },
  toggle: { flexDirection: 'row', backgroundColor: 'rgba(20,28,40,0.95)', borderRadius: 18, padding: 4, marginVertical: 14, borderWidth: 1, borderColor: '#243042' },
  mode: { flex: 1, flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 14, minHeight: 60 },
  modeOn: { backgroundColor: C.blue, shadowColor: C.blue, shadowOpacity: 0.8, shadowRadius: 12, elevation: 8 },
  modeIcon: { fontSize: 20, marginRight: 8, color: C.text },
  modeTitle: { color: C.text, fontSize: 16, fontWeight: '800' },
  modeSub: { color: C.dim, fontSize: 12 },
  conn: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  connText: { color: C.green, fontWeight: '800', flexShrink: 1 },
  connBtn: { color: C.dim, fontWeight: '700', padding: 10 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  card: { width: '48.5%', backgroundColor: C.card, borderRadius: 18, borderWidth: 1.5, padding: 14, marginBottom: 12, minHeight: 150, shadowOpacity: 0.6, shadowRadius: 10, elevation: 4 },
  glyph: { fontSize: 32, marginBottom: 8 },
  cardRow: { flexDirection: 'row', alignItems: 'center' },
  cardTitle: { color: C.text, fontSize: 17, fontWeight: '800' },
  cardSub: { color: C.dim, fontSize: 13, lineHeight: 18, marginTop: 2 },
  chev: { color: C.dim, fontSize: 26, marginLeft: 4 },
  note: { color: C.dim, fontSize: 12, textAlign: 'center', marginBottom: 6 },
  moreBox: { backgroundColor: C.card, borderRadius: 16, overflow: 'hidden', marginTop: 6 },
  link: { minHeight: 48, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: '#243042' },
  linkText: { color: C.text, fontSize: 15, flex: 1 },
  chevSm: { color: C.dim, fontSize: 22 },
  foot: { color: C.dim, fontSize: 13, textAlign: 'center', marginTop: 16 },
  ver: { color: C.dim, fontSize: 13, textAlign: 'center', marginTop: 4 },
  tabs: { position: 'absolute', left: 12, right: 12, bottom: 14, flexDirection: 'row', backgroundColor: 'rgba(14,20,30,0.97)', borderRadius: 20, borderWidth: 1, borderColor: '#243042', padding: 4 },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 16, minHeight: 52 },
  tabOn: { backgroundColor: 'rgba(46,155,255,0.15)' },
  tabIcon: { color: C.dim, fontSize: 20 },
  tabText: { color: C.dim, fontSize: 12, fontWeight: '700', marginTop: 2 },
});
