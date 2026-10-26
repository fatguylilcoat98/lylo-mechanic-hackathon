/*
 * LYLO Mechanic — run the scan (Used-Car Check or code read).
 */
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, ActivityIndicator, StyleSheet } from 'react-native';
import OBDService from '../services/OBDService';
import * as BT from '../services/BluetoothService';
import { Button, Card, u } from '../components/ui';
import { C } from '../constants/colors';

export default function ScanScreen({ route, navigation }) {
  const mode = route.params?.mode || 'usedcar';
  const [progress, setProgress] = useState({ i: 0, n: 8, msg: 'Starting...' });
  const [error, setError] = useState(null);
  const [logLines, setLogLines] = useState([]);
  const running = useRef(false);

  const run = async () => {
    if (running.current) return;
    running.current = true;
    setError(null);
    setProgress({ i: 0, n: 8, msg: 'Starting...' });
    try {
      const scan = await OBDService.fullScan((i, n, msg) => setProgress({ i, n, msg }));
      navigation.replace(mode === 'usedcar' ? 'UsedCar' : 'Codes', { scan });
    } catch (e) {
      BT.log('scan failed: ' + (e.message || e));
      setError(e.message || String(e));
    } finally {
      running.current = false;
    }
  };

  useEffect(() => {
    const off = BT.onLog((line) => setLogLines((prev) => prev.concat([line]).slice(-12)));
    run();
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pct = Math.round((progress.i / progress.n) * 100);

  return (
    <ScrollView style={u.screen} contentContainerStyle={u.scroll}>
      {!error ? (
        <Card>
          <ActivityIndicator size="large" color={C.accent} />
          <Text style={[u.h2, { textAlign: 'center', marginTop: 12 }]}>{mode === 'usedcar' ? 'Running Used-Car Check' : 'Reading trouble codes'}</Text>
          <Text style={[u.body, { textAlign: 'center', marginTop: 6 }]}>{progress.msg}</Text>
          <View style={s.bar}><View style={[s.fill, { width: pct + '%' }]} /></View>
          <Text style={[u.small, { textAlign: 'center' }]}>Step {progress.i} of {progress.n} · keep the ignition ON</Text>
        </Card>
      ) : (
        <Card title="Scan didn't finish" accent={C.red}>
          <Text style={u.body}>{error}</Text>
          <Button title="Try again" onPress={run} />
          <Button title="Back to adapter list" kind="secondary" onPress={async () => { await OBDService.disconnect(); navigation.replace('Connect'); }} />
          <Button title="Home" kind="secondary" onPress={() => navigation.popToTop()} />
        </Card>
      )}
      <Card title="Live log">
        {logLines.map((l, i) => <Text key={i} style={u.mono}>{l}</Text>)}
      </Card>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  bar: { height: 6, backgroundColor: C.border, borderRadius: 3, overflow: 'hidden', marginVertical: 12 },
  fill: { height: '100%', backgroundColor: C.accent },
});
