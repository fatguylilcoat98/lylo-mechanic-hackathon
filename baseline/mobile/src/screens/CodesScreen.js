/*
 * LYLO Mechanic — trouble codes explained + clear codes (behind warnings).
 */
import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert, Share, StyleSheet } from 'react-native';
import { analyzeCodes, KIND_LABEL } from '../engine/diagnose';
import { buildReport } from '../engine/report';
import OBDService from '../services/OBDService';
import { Button, Card, Badge, DemoBanner, LEVEL_COLORS, u } from '../components/ui';
import { C } from '../constants/colors';

const DIFF_COLOR = { Easy: C.green, Moderate: C.amber, Pro: C.red, Unknown: C.textDim };

export default function CodesScreen({ route, navigation }) {
  const scan = route.params?.scan;
  const results = useMemo(() => analyzeCodes(scan), [scan]);
  const [clearing, setClearing] = useState(false);
  const isDemo = !!scan.demoLabel;
  const mil = scan.monitor ? scan.monitor.milOn : null;

  const doClear = async () => {
    setClearing(true);
    try {
      const ok = await OBDService.clearCodes();
      Alert.alert(ok ? 'Codes cleared' : 'Car did not confirm',
        ok ? 'Run a new scan in a minute to confirm. If a code comes back, the problem is still there.' : 'The car didn\'t acknowledge the clear command. Try with the engine OFF and the ignition ON.',
        [{ text: 'Scan again', onPress: () => navigation.replace('Scan', { mode: 'codes' }) }, { text: 'OK' }]);
    } catch (e) {
      Alert.alert('Clear failed', e.message || String(e));
    } finally {
      setClearing(false);
    }
  };

  const confirmClear = () => {
    if (isDemo) { Alert.alert('Demo mode', 'Clearing codes only works when connected to a real car.'); return; }
    if (!OBDService.connected) { Alert.alert('Not connected', 'Connect to your adapter first.'); return; }
    Alert.alert(
      'Clear codes? Read this first',
      'Clearing does NOT fix anything.\n\n' +
      '• The check-engine light will come back if the problem is still there.\n' +
      '• It erases freeze-frame info a mechanic could use.\n' +
      '• It resets the emissions self-tests, so the car will FAIL a smog check until it\'s driven for several days.\n' +
      '• Never clear codes right before selling a car — that hides problems from the buyer.\n\n' +
      'Only clear codes after a repair, to confirm the fix worked.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'I understand',
          style: 'destructive',
          onPress: () => Alert.alert('Clear codes now?', 'Best with the engine OFF and the ignition ON. This can\'t be undone.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Clear codes', style: 'destructive', onPress: doClear },
          ]),
        },
      ]);
  };

  return (
    <ScrollView style={u.screen} contentContainerStyle={u.scroll}>
      <DemoBanner label={scan.demoLabel} />
      <Card accent={mil ? C.red : results.length ? C.amber : C.green}>
        <Text style={u.h2}>{mil ? 'Check-engine light is ON' : mil === false ? 'Check-engine light is off' : 'Check-engine light status unknown'}</Text>
        <Text style={u.body}>{results.length ? results.length + ' code(s) found. Tap one for the full explanation, how hard it is to fix, and a fair price range.' : 'No trouble codes found.'}</Text>
      </Card>

      {results.map((r) => (
        <TouchableOpacity key={r.code} activeOpacity={0.8} onPress={() => navigation.navigate('CodeDetail', { code: r.code, result: r })}>
          <Card>
            <View style={[u.row, { justifyContent: 'space-between' }]}>
              <Text style={s.code}>{r.code}</Text>
              <Badge text={r.urgency.level} color={LEVEL_COLORS[r.urgency.color]} />
            </View>
            <Text style={[u.h2, { marginTop: 4 }]}>{r.title}</Text>
            <Text style={[u.body, { marginTop: 4 }]}>{r.plain}</Text>
            <View style={[u.row, { marginTop: 6 }]}>
              <Badge text={'Difficulty: ' + r.difficulty.level} color={DIFF_COLOR[r.difficulty.level]} />
              <Badge text={'Shop est. ' + r.priceText.shop} color={C.accent} />
            </View>
            {r.alsoKinds.map((k) => <Text key={k} style={[u.small, { marginTop: 4 }]}>{'\u2022 ' + KIND_LABEL[k]}</Text>)}
          </Card>
        </TouchableOpacity>
      ))}

      <Button title="Used-Car Check view" kind="secondary" onPress={() => navigation.navigate('UsedCar', { scan })} />
      <Button title="Share report" onPress={() => Share.share({ message: buildReport(scan) })} />
      <Button title="Clear codes (after a repair)" kind="danger" busy={clearing} onPress={confirmClear} />
      <Button title="Home" kind="secondary" onPress={() => navigation.popToTop()} />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  code: { color: C.accent, fontSize: 22, fontWeight: '900' },
});
