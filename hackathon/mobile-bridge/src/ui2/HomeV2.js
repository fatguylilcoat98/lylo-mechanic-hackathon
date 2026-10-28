/*
 * UI v2 home (flag EXPO_PUBLIC_LYLO_UI_V2=1). One clear primary action, two backups,
 * everything else tucked under "More tools". Same routes and flags as the v1 home.
 */
import React, { useCallback, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import OBDService from '../../../../baseline/mobile/src/services/OBDService';
import { DEMO_SCANS } from '../../../../baseline/mobile/src/data/demoScans';
import { features as noAdapterFeatures } from '../noAdapter';
import { useFirstRunSetup } from '../SetupScreen';
import { features as demoFeatures } from '../demo';
import { color, space, radius, type, touch } from './theme';
import { BigActionButton } from './components';

function Link({ title, onPress }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [st.link, pressed && { backgroundColor: color.surfaceHi }]}>
      <Text style={st.linkText}>{title}</Text><Text style={st.chev}>{'\u203A'}</Text>
    </Pressable>
  );
}

export default function HomeV2({ navigation, noAdapterOn, demoOn: demoOnProp }) {
  const noAdapter = noAdapterOn === undefined ? noAdapterFeatures().on : noAdapterOn;
  const demoOn = demoOnProp === undefined ? demoFeatures().on : demoOnProp;
  const setupOn = useFirstRunSetup(navigation);
  const [device, setDevice] = useState(OBDService.device);
  const [more, setMore] = useState(false);
  useFocusEffect(useCallback(() => { setDevice(OBDService.connected ? OBDService.device : null); }, []));
  const go = (r, p) => navigation.navigate(r, p);

  return (
    <ScrollView style={st.screen} contentContainerStyle={st.scroll}>
      <View style={st.header}>
        <Image source={require('../../../../baseline/mobile/assets/app-icon.png')} style={st.logo} accessibilityIgnoresInvertColors />
        <View style={{ flex: 1 }}>
          <Text style={st.brand}>LYLO Mechanic</Text>
          <Text style={st.powered}>Powered by Meta AI</Text>
        </View>
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
      ) : (
        <BigActionButton testID="primary-action" title="Scan with adapter" subtitle="Plug in your OBDLink, ignition ON" onPress={() => go('Connect')} />
      )}
      <BigActionButton kind="secondary" title="No adapter? Start here" subtitle="Describe it, type a code, or snap the dash"
        onPress={() => (noAdapter ? go('NoAdapter') : go('Lookup'))} />
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
      <Text style={st.foot}>Repair prices are LYLO estimates, not quotes. v0.4.8</Text>
    </ScrollView>
  );
}

const st = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  scroll: { padding: space.xl, paddingTop: 56, paddingBottom: 56 },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: space.xxl },
  logo: { width: 48, height: 48, borderRadius: radius.md, marginRight: space.md },
  brand: { color: color.text, ...type.h },
  powered: { color: color.textDim, ...type.small },
  hero: { color: color.text, ...type.hero },
  sub: { color: color.textDim, ...type.body, marginTop: space.sm, marginBottom: space.xl },
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
