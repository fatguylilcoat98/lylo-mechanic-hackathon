/*
 * LYLO Mechanic — Home
 */
import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, Image, StyleSheet } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import OBDService from '../services/OBDService';
import { DEMO_SCANS } from '../data/demoScans';
import { Button, Card, u } from '../components/ui';
import { C } from '../constants/colors';
import { features as noAdapterFeatures } from '../../../../hackathon/mobile-bridge/src/noAdapter'; // hackathon v0.4.5
import { useFirstRunSetup } from '../../../../hackathon/mobile-bridge/src/SetupScreen'; // hackathon v0.4.6
import { uiV2On } from '../../../../hackathon/mobile-bridge/src/ui2/theme'; // UI v2, flag EXPO_PUBLIC_LYLO_UI_V2=1
import { features as demoFeatures } from '../../../../hackathon/mobile-bridge/src/demo'; // hackathon v0.4.7

function HomeScreenV1({ navigation }) {
  const noAdapter = noAdapterFeatures().on;
  const demoOn = demoFeatures().on; // hackathon v0.4.7: judge demo, flag EXPO_PUBLIC_LYLO_DEMO=1
  const setupOn = useFirstRunSetup(navigation); // hackathon v0.4.6: first-run setup, once
  const [device, setDevice] = useState(OBDService.device);
  useFocusEffect(useCallback(() => { setDevice(OBDService.connected ? OBDService.device : null); }, []));

  const disconnect = async () => { await OBDService.disconnect(); setDevice(null); };

  return (
    <ScrollView style={u.screen} contentContainerStyle={[u.scroll, { paddingTop: 48 }]}>
      <View style={s.header}>
        <Image source={require('../../assets/app-icon.png')} style={s.logo} />
        <Text style={s.title}>LYLO Mechanic</Text>
        <Text style={s.tag}>Know what's wrong before you buy or walk into a shop.</Text>
        <Text style={s.powered}>Powered by Meta AI</Text>
        <Text style={s.build}>TEST BUILD v0.5.1 · works offline · no login</Text>
      </View>

      {device ? (
        <Card title="Connected" accent={C.green}>
          <Text style={u.h2}>{device.name}</Text>
          <Text style={u.small}>{device.model || 'OBD adapter'} · {device.kind === 'ble' ? 'Bluetooth LE' : 'Classic Bluetooth'}</Text>
          <Button title="Run Used-Car Check" onPress={() => navigation.navigate('Scan', { mode: 'usedcar' })} />
          <Button title="Read & explain trouble codes" kind="secondary" onPress={() => navigation.navigate('Scan', { mode: 'codes' })} />
          <Button title="Disconnect" kind="secondary" onPress={disconnect} />
        </Card>
      ) : (
        <Card title="Start here">
          <Text style={u.body}>Plug your OBDLink into the car's OBD port (under the dash, driver side), turn the ignition ON, then connect.</Text>
          <Button title="Connect OBDLink adapter" onPress={() => navigation.navigate('Connect')} />
        </Card>
      )}

      {demoOn ? (
        <Card title="No car? No adapter?">
          <Button title="Try a demo scan" onPress={() => navigation.navigate('Demo')} />
        </Card>
      ) : null}

      {noAdapter ? (
        <Card title="No adapter? Start here" accent={C.green}>
          <Text style={u.body}>Describe what the car is doing, type a trouble code, snap the dash, or check your car's recalls. No adapter or Bluetooth needed.</Text>
          <Button title="No adapter? Start here" onPress={() => navigation.navigate('NoAdapter')} />
        </Card>
      ) : null}

      <Card title="No adapter? Try the demos">
        <Button title="Demo: Used-Car Check" kind="secondary" onPress={() => navigation.navigate('UsedCar', { scan: DEMO_SCANS.usedcar })} />
        <Button title="Demo: Check-engine light on" kind="secondary" onPress={() => navigation.navigate('Codes', { scan: DEMO_SCANS.checkengine })} />
      </Card>

      <Card title="Tools">
        <Button title="Photo Helper: find a part on your car" onPress={() => navigation.navigate('PhotoHelper')} />
        <Button title="Your car: add your VIN" onPress={() => navigation.navigate('Vin')} />
        <Button title="Look up a trouble code" kind="secondary" onPress={() => navigation.navigate('Lookup')} />
        {setupOn ? <Button title="Setup: adapter, view, your car" kind="secondary" onPress={() => navigation.navigate('Setup')} /> : null}
        <Button title="Debug log (for testing)" kind="secondary" onPress={() => navigation.navigate('Log')} />
      </Card>

      <Text style={s.footer}>The Good Neighbor Guard · Truth · Safety · We Got Your Back</Text>
      <Text style={s.footerSmall}>Repair prices shown are LYLO estimates, not quotes.</Text>
    </ScrollView>
  );
}

/** UI v2 switch (presentation only). uiV2 prop overrides the build flag (tests). */
export default function HomeScreen(props) {
  const on = props.uiV2 === undefined ? uiV2On({ EXPO_PUBLIC_LYLO_UI_V2: process.env.EXPO_PUBLIC_LYLO_UI_V2 }) : !!props.uiV2;
  if (on) { const HomeV2 = require('../../../../hackathon/mobile-bridge/src/ui2/HomeV2').default; return <HomeV2 {...props} />; }
  return <HomeScreenV1 {...props} />;
}

const s = StyleSheet.create({
  header: { alignItems: 'center', marginBottom: 20 },
  logo: { width: 110, height: 110, borderRadius: 24, marginBottom: 12 },
  title: { color: C.textBright, fontSize: 30, fontWeight: '800' },
  tag: { color: C.text, fontSize: 15, marginTop: 6, textAlign: 'center' },
  powered: { color: C.textMuted, fontSize: 12, fontWeight: '600', marginTop: 6 },
  build: { color: C.gold, fontSize: 11, fontWeight: '800', marginTop: 10, letterSpacing: 0.5 },
  footer: { color: C.textMuted, fontSize: 12, textAlign: 'center', marginTop: 16 },
  footerSmall: { color: C.textMuted, fontSize: 11, textAlign: 'center', marginTop: 4 },
});
