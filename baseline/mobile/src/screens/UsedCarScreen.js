/*
 * LYLO Mechanic — Used-Car Check result.
 */
import React, { useMemo } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Share, StyleSheet } from 'react-native';
import { assessUsedCar } from '../engine/usedCarCheck';
import { buildReport } from '../engine/report';
import { Button, Card, Badge, DemoBanner, LEVEL_COLORS, u } from '../components/ui';
import { C } from '../constants/colors';
// Hackathon (Oct 26, 2026): renders nothing unless the scan has serverDiagnosis.
import ServerDiagnosisCard from '../../../../hackathon/mobile-bridge/src/ServerDiagnosisCard';
import SimpleResults from '../../../../hackathon/mobile-bridge/src/SimpleResults'; // v0.4.1 redesign
import { hasServerResult, buildResults, shareText } from '../../../../hackathon/mobile-bridge/src/resultsView';
import { analyzeCodes } from '../engine/diagnose';
import { reconcileVerdict } from '../../../../hackathon/mobile-bridge/src/verdictView'; // v0.4.1: one consistent verdict

const ICON = { red: '\u26A0\uFE0F', yellow: '\u2753', green: '\u2705', info: '\u2139\uFE0F' };

export default function UsedCarScreen({ route, navigation }) {
  const scan = route.params?.scan;
  const a = useMemo(() => { const x = assessUsedCar(scan); return { ...x, verdict: reconcileVerdict(x.verdict, scan) }; }, [scan]);
  const vColor = LEVEL_COLORS[a.verdict.level];
  const veh = scan.vehicle || {};
  const c = a.counters;
  if (hasServerResult(scan)) { // v0.4.1: server answered -> the one-verdict results screen
    const opts = { codes: analyzeCodes(scan), screen: 'usedcar', baselineCleared: a.recentlyCleared };
    return <SimpleResults scan={scan} {...opts} footer={<><Button title="Share this report" onPress={() => Share.share({ message: shareText(buildResults(scan, opts)) })} /><Button title="Home" kind="secondary" onPress={() => navigation.popToTop()} /></>} />;
  }

  return (
    <ScrollView style={u.screen} contentContainerStyle={u.scroll}>
      <DemoBanner label={scan.demoLabel} />
      <ServerDiagnosisCard scan={scan} />

      <Card accent={vColor}>
        <Text style={[s.verdict, { color: vColor }]}>{a.verdict.label}</Text>
        <Text style={u.body}>{a.verdict.summary}</Text>
      </Card>

      <Card title="Vehicle">
        <Text style={u.h2}>{[veh.year, veh.make].filter(Boolean).join(' ') || 'Unknown vehicle'}</Text>
        <Text style={u.small}>VIN: {scan.vin || 'not reported'}</Text>
        <Text style={u.small}>Adapter: {scan.deviceName || '?'}{scan.adapter ? ' · ' + scan.adapter : ''}</Text>
      </Card>

      <Card title="Since codes were last cleared">
        <View style={s.stats}>
          <Stat label="Miles" value={c.miSinceClear} warn={c.miSinceClear !== null && c.miSinceClear !== undefined && c.miSinceClear < 200} />
          <Stat label="Warm-ups" value={c.warmups} warn={c.warmups !== null && c.warmups !== undefined && c.warmups < 15} />
          <Stat label="Engine hrs" value={c.minSinceClear !== null && c.minSinceClear !== undefined ? Math.round(c.minSinceClear / 6) / 10 : null} warn={c.minSinceClear > 0 && c.minSinceClear < 300} />
          <Stat label="Mi w/ light on" value={c.miMilOn} warn={c.miMilOn > 0} />
        </View>
        <Text style={u.small}>Low numbers mean the codes were erased recently (or the battery was disconnected). "—" means this car doesn't report it.</Text>
      </Card>

      <Card title="What we found">
        {a.findings.map((f, i) => (
          <View key={i} style={[s.finding, { borderLeftColor: LEVEL_COLORS[f.level] }]}>
            <Text style={[s.fTitle, { color: f.level === 'info' ? C.textBright : LEVEL_COLORS[f.level] }]}>{ICON[f.level]} {f.title}</Text>
            {f.detail ? <Text style={u.small}>{f.detail}</Text> : null}
          </View>
        ))}
      </Card>

      {scan.monitor && scan.monitor.monitors.length ? (
        <Card title="Emissions readiness monitors">
          {scan.monitor.monitors.map((m, i) => (
            <View key={i} style={s.monRow}>
              <Text style={[s.monState, { color: m.complete ? C.green : C.amber }]}>{m.complete ? 'READY' : 'NOT READY'}</Text>
              <Text style={u.body}>{m.name}</Text>
            </View>
          ))}
          <Text style={[u.small, { marginTop: 6 }]}>Monitors are the car's own self-tests. After codes are cleared they reset to "not ready" and take days of normal driving to finish.</Text>
        </Card>
      ) : null}

      {a.codes.length ? (
        <Card title={'Trouble codes (' + a.codes.length + ')'}>
          {a.codes.map((r) => (
            <TouchableOpacity key={r.code} style={s.codeRow} onPress={() => navigation.navigate('CodeDetail', { code: r.code, result: r })}>
              <Text style={s.code}>{r.code}</Text>
              <View style={{ flex: 1 }}>
                <Text style={u.body}>{r.title}</Text>
                <View style={u.row}>{r.alsoKinds.map((k) => <Badge key={k} text={k.toUpperCase()} color={k === 'stored' ? C.red : k === 'permanent' ? C.gold : C.amber} />)}</View>
              </View>
              <Text style={s.chev}>{'\u203A'}</Text>
            </TouchableOpacity>
          ))}
          <Button title="All codes explained" kind="secondary" onPress={() => navigation.navigate('Codes', { scan })} />
        </Card>
      ) : null}

      <Button title="Share this report" onPress={() => Share.share({ message: buildReport(scan) })} />
      <Button title="Home" kind="secondary" onPress={() => navigation.popToTop()} />
      <Text style={[u.small, { marginTop: 14, textAlign: 'center' }]}>A computer check can't see brakes, tires, leaks, rust or accident history. Always get a pre-purchase inspection.</Text>
    </ScrollView>
  );
}

function Stat({ label, value, warn }) {
  const has = value !== null && value !== undefined;
  return (
    <View style={s.stat}>
      <Text style={[s.statVal, { color: !has ? C.textDim : warn ? C.amber : C.green }]}>{has ? String(value) : '\u2014'}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  verdict: { fontSize: 24, fontWeight: '900', marginBottom: 6, letterSpacing: 0.5 },
  stats: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  stat: { alignItems: 'center', flex: 1 },
  statVal: { fontSize: 22, fontWeight: '800' },
  statLabel: { color: C.textDim, fontSize: 11, marginTop: 2, textAlign: 'center' },
  finding: { borderLeftWidth: 3, paddingLeft: 10, marginBottom: 12 },
  fTitle: { fontSize: 15, fontWeight: '700', marginBottom: 2 },
  monRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  monState: { width: 92, fontSize: 12, fontWeight: '800' },
  codeRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderTopWidth: 1, borderTopColor: C.border },
  code: { color: C.accent, fontSize: 17, fontWeight: '800', width: 72 },
  chev: { color: C.textDim, fontSize: 26, marginLeft: 8 },
});
