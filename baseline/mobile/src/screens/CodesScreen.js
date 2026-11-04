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
// Hackathon (Oct 26, 2026): renders nothing unless the scan has serverDiagnosis.
import ServerDiagnosisCard from '../../../../hackathon/mobile-bridge/src/ServerDiagnosisCard';
import CodesVerdictNote, { NOTE_COLOR } from '../../../../hackathon/mobile-bridge/src/CodesVerdictNote'; // v0.4.1
import * as SV from '../../../../hackathon/mobile-bridge/src/sessionV2';
import * as CP from '../../../../hackathon/mobile-bridge/src/clearPolicy'; // v0.7.3 clear policy (same flag) // v0.7.3 flag EXPO_PUBLIC_LYLO_SESSION_V2
import SimpleResults from '../../../../hackathon/mobile-bridge/src/SimpleResults'; // v0.4.1 redesign
import { hasServerResult, buildResults, shareText } from '../../../../hackathon/mobile-bridge/src/resultsView';
import { codesNote } from '../../../../hackathon/mobile-bridge/src/verdictView';

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
      if (SV.on()) { try { const AS = require('@react-native-async-storage/async-storage').default; const k = 'lylo.clearLog'; const prev = JSON.parse((await AS.getItem(k)) || '[]'); prev.push({ ...CP.clearRecord(scan, 'After a repair, to confirm the fix'), accepted: !!ok }); await AS.setItem(k, JSON.stringify(prev.slice(-50))); } catch (e) {} } // v0.7.3 before/when/why, append-only
      if (SV.on()) { // v0.7.3: honest result = rescan right away and show what is still there
        Alert.alert(ok ? 'Clear command accepted' : 'Car did not confirm', (ok ? 'Clearing does not fix the fault. ' : 'The car did not acknowledge the clear. Most cars only clear with the engine OFF and the key ON (dash lights on, engine not started). Try again that way. ') + 'LYLO will now rescan and show what is still there, including permanent codes.',
          [{ text: 'Rescan now', onPress: () => navigation.replace('Scan', { mode: 'codes', afterClear: true }) }]);
        return;
      }
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
    if (SV.on()) { // v0.7.3: blocked on safety codes; two explicit confirms; readiness + not-a-fix warning
      const off = CP.canOffer(scan);
      if (!off.ok) { Alert.alert('Clearing not offered', off.reason); return; }
      Alert.alert(CP.WARNING.title, CP.WARNING.body, [
        { text: 'Cancel', style: 'cancel' },
        { text: CP.WARNING.confirm, style: 'destructive', onPress: () => Alert.alert(CP.WARNING.final.title, CP.WARNING.final.body, [
          { text: 'Cancel', style: 'cancel' },
          { text: CP.WARNING.final.confirm, style: 'destructive', onPress: doClear },
        ]) },
      ]);
      return;
    }
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

  if (hasServerResult(scan)) { // v0.4.1: server answered -> the one-verdict results screen
    const opts = { codes: results, screen: 'codes' };
    return <SimpleResults scan={scan} {...opts} navigation={navigation} onScanAnother={SV.on() ? async () => { SV.resetActive(); try { await OBDService.disconnect(); } catch (e) {} navigation.replace('Connect'); } : undefined} footer={<><Button title="Share report" onPress={() => Share.share({ message: shareText(buildResults(scan, opts)) })} />{SV.on() && !CP.canOffer(scan).ok ? null : <Button title="Clear codes (after a repair)" kind="danger" busy={clearing} onPress={confirmClear} />}<Button title="Home" kind="secondary" onPress={() => navigation.popToTop()} /></>} />;
  }
  return (
    <ScrollView style={u.screen} contentContainerStyle={u.scroll}>
      <DemoBanner label={scan.demoLabel} />
      <ServerDiagnosisCard scan={scan} />
      <Card accent={mil ? C.red : (codesNote(scan, results.length, mil) && NOTE_COLOR[codesNote(scan, results.length, mil).tone]) || (results.length ? C.amber : C.green)}>
        <Text style={u.h2}>{mil ? 'Check-engine light is ON' : mil === false ? 'Check-engine light is off' : 'Check-engine light status unknown'}</Text>
        <Text style={u.body}>{results.length ? results.length + ' code(s) found. Tap one for the full explanation, how hard it is to fix, and a fair price range.' : 'No trouble codes found.'}</Text>
        <CodesVerdictNote scan={scan} count={results.length} mil={mil} />
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
      {SV.on() && !CP.canOffer(scan).ok ? null : <Button title="Clear codes (after a repair)" kind="danger" busy={clearing} onPress={confirmClear} />}
      <Button title="Home" kind="secondary" onPress={() => navigation.popToTop()} />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  code: { color: C.accent, fontSize: 22, fontWeight: '900' },
});
