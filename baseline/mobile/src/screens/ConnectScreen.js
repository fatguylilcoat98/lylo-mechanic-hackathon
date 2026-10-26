/*
 * LYLO Mechanic — Connect: find and pick an OBDLink adapter.
 */
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Switch, StyleSheet, Linking, Platform } from 'react-native';
import * as BT from '../services/BluetoothService';
import OBDService from '../services/OBDService';
import { Button, Card, Badge, Bullet, u } from '../components/ui';
import { C } from '../constants/colors';

export default function ConnectScreen({ navigation }) {
  const [devices, setDevices] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [connectingKey, setConnectingKey] = useState(null);
  const [error, setError] = useState(null);
  const [hint, setHint] = useState(null);
  const stopRef = useRef(null);

  const startScan = async () => {
    setError(null);
    setHint(null);
    const perm = await BT.requestPermissions();
    if (!perm.ok) {
      setError('Bluetooth permission was denied. Allow "Nearby devices" for LYLO Mechanic in Android Settings > Apps, then try again.');
      return;
    }
    if (!perm.locationOk) setHint('Location permission was not granted. If your OBDLink CX does not show up, allow Location for LYLO Mechanic and scan again.');
    if (!(await BT.isBluetoothOn())) {
      setError('Bluetooth is off. Turn it on and scan again.');
      return;
    }
    if (stopRef.current) stopRef.current();
    setDevices([]);
    setScanning(true);
    stopRef.current = BT.scan(setDevices, { seconds: 12, includeAll: showAll });
    setTimeout(() => setScanning(false), 12000);
  };

  useEffect(() => {
    startScan();
    return () => { if (stopRef.current) stopRef.current(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAll]);

  const pick = async (d) => {
    if (stopRef.current) stopRef.current();
    setScanning(false);
    setError(null);
    setConnectingKey(d.key);
    try {
      await OBDService.connect(d);
      navigation.navigate('Home');
    } catch (e) {
      BT.log('connect failed: ' + (e.message || e));
      let msg = e.message || String(e);
      if (d.model === 'OBDLink CX') msg += '\n\nOBDLink CX tip: unplug the CX, plug it back in, and connect within 5 minutes. Accept the "Pair" prompt if Android shows one.';
      if (d.kind === 'classic') msg += '\n\nMX+/LX tip: make sure it is paired in Android Bluetooth settings and no other app (like the OBDLink app) is connected to it.';
      setError(msg);
    } finally {
      setConnectingKey(null);
    }
  };

  const obdlink = devices.filter((d) => d.isOBDLink);
  const others = devices.filter((d) => !d.isOBDLink);

  const Row = ({ d }) => (
    <TouchableOpacity style={[s.row, d.isOBDLink && s.rowObd]} onPress={() => pick(d)} disabled={!!connectingKey} activeOpacity={0.7}>
      <View style={{ flex: 1 }}>
        <Text style={s.name}>{d.name}</Text>
        <View style={u.row}>
          {d.model ? <Badge text={d.model} color={d.isOBDLink ? C.green : C.amber} /> : null}
          <Badge text={d.kind === 'ble' ? 'Bluetooth LE' : 'Classic (paired)'} color={C.accent} />
          {d.rssi ? <Badge text={d.rssi + ' dBm'} color={C.textDim} /> : null}
        </View>
        {d.note ? <Text style={[u.small, { marginTop: 6 }]}>{d.note}</Text> : null}
      </View>
      <Text style={s.go}>{connectingKey === d.key ? '...' : 'Connect'}</Text>
    </TouchableOpacity>
  );

  return (
    <ScrollView style={u.screen} contentContainerStyle={u.scroll}>
      <Card title="Before you connect" accent={C.amber}>
        <Bullet>Plug the adapter into the OBD port and turn the ignition ON (engine running is best).</Bullet>
        <Bullet><Text style={{ fontWeight: '800', color: C.amber }}>OBDLink CX:</Text> it only accepts a NEW pairing during the first 5 minutes after it's plugged in. If it won't connect, unplug it, plug it back in, and try again right away. Tap "Pair" if Android asks.</Bullet>
        <Bullet><Text style={{ fontWeight: '800' }}>OBDLink MX+ / LX:</Text> pair it first in Android Settings &gt; Bluetooth (press the button on the adapter), then come back here.</Bullet>
        <Bullet>Close the OBDLink app or any other OBD app — the adapter can talk to only one app at a time.</Bullet>
        <Bullet>OBDLink EX is a USB cable adapter and isn't supported in this test build.</Bullet>
      </Card>

      {error ? <Card accent={C.red}><Text style={[u.body, { color: C.red }]}>{error}</Text></Card> : null}
      {hint ? <Card accent={C.amber}><Text style={u.small}>{hint}</Text></Card> : null}

      <Card title={scanning ? 'Searching for adapters...' : 'OBDLink adapters'}>
        {obdlink.length === 0 ? (
          <Text style={u.small}>{scanning ? 'Looking...' : 'No OBDLink found yet. Check the steps above and scan again.'}</Text>
        ) : obdlink.map((d) => <Row key={d.key} d={d} />)}
      </Card>

      {others.length ? (
        <Card title={showAll ? 'Other Bluetooth devices' : 'Other OBD adapters'}>
          {others.map((d) => <Row key={d.key} d={d} />)}
        </Card>
      ) : null}

      <View style={[u.row, { justifyContent: 'space-between', marginVertical: 6 }]}>
        <Text style={u.small}>Show all Bluetooth devices</Text>
        <Switch value={showAll} onValueChange={setShowAll} />
      </View>

      <Button title={scanning ? 'Scanning...' : 'Scan again'} onPress={startScan} disabled={scanning || !!connectingKey} />
      {Platform.OS === 'android' ? (
        <Button title="Open Android Bluetooth settings" kind="secondary" onPress={() => Linking.sendIntent('android.settings.BLUETOOTH_SETTINGS').catch(() => Linking.openSettings())} />
      ) : null}
      <Button title="Show debug log" kind="secondary" onPress={() => navigation.navigate('Log')} />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderTopWidth: 1, borderTopColor: C.border },
  rowObd: { },
  name: { color: C.textBright, fontSize: 16, fontWeight: '700' },
  go: { color: C.accent, fontWeight: '800', fontSize: 15, marginLeft: 10 },
});
