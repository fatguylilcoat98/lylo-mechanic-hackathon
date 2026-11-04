/** v0.7.5: says plainly whether Meta AI ran on THIS scan. Reads only server fields; invents nothing. */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

export function metaInfo(scan) {
  const r = scan && scan.serverDiagnosis && scan.serverDiagnosis.result;
  const det = (r && r.detective) || {};
  const status = det.muse_status == null ? 'off' : String(det.muse_status);
  const ran = status === 'ok';
  const timedOut = !ran && /^error/i.test(status); // 'error', 'error: TIMEOUT', ...
  const rc = det.receipt || {};
  const pv = det.prove || {};
  const pred = det.prediction && det.prediction.text ? det.prediction.text : null;
  return {
    ran, status, timedOut,
    model: ran && rc.model ? String(rc.model) : null,
    secs: ran && typeof rc.latency_ms === 'number' ? Math.round(rc.latency_ms / 100) / 10 : null,
    explanation: ran && det.explanation && det.explanation.text ? det.explanation.text : null,
    causes: ran && Array.isArray(det.hypotheses) ? det.hypotheses.length : 0,
    raised: det.safety_action === 'raised_by_detective',
    prediction: pred,
    predictionBy: pred ? (pv.proposed_by === 'model' && ran ? 'Meta AI' : 'the safety rules') : null,
    replay: !!(scan && scan.demoLabel),
  };
}

const OV = require('./oneVerdict');

export default function MetaAiCard({ scan, env }) {
  if (!OV.on(env)) return null; // r2 (Vera 1): behind EXPO_PUBLIC_LYLO_ONE_VERDICT=1; flag off = unchanged
  if (!scan || !scan.serverDiagnosis) return null;
  const i = metaInfo(scan);
  if (!i.ran) {
    return (
      <View style={s.off} testID="meta-ai-off">
        {i.timedOut
          ? <Text style={s.t} testID="meta-ai-timeout">Meta AI didn't answer in time, so this is the safety rules' answer.</Text>
          : <Text style={s.t}>Meta AI didn't run on this scan. This answer comes from the safety rules only.</Text>}
        {i.prediction ? <Text style={s.b}>{`Locked prediction (made by ${i.predictionBy}): ${i.prediction}`}</Text> : null}
      </View>
    );
  }
  return (
    <View style={s.on} testID="meta-ai-on">
      <Text style={s.t}>What Meta AI did on this scan</Text>
      {i.model ? <Text style={s.m}>{`Model: ${i.model}${i.secs != null ? ` \u00b7 ${i.secs}s` : ''}`}</Text> : null}
      {i.explanation ? <Text style={s.b}>{i.explanation}</Text> : null}
      {i.causes ? <Text style={s.b}>{`Ranked ${i.causes} possible ${i.causes === 1 ? 'cause' : 'causes'}, each tied to ${i.replay ? 'readings from this saved scan' : 'readings from your car'}.`}</Text> : null}
      {i.prediction ? <Text style={s.b}>{`Locked prediction, made by ${i.predictionBy} before the rules checked it: ${i.prediction}`}</Text> : null}
      <Text style={s.b}>{i.raised ? 'It raised the safety level. It can never lower it.' : 'The safety level comes from the rules. Meta AI can raise it, never lower it.'}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  on: { borderWidth: 1, borderColor: '#4C8DFF', borderRadius: 12, padding: 14, marginVertical: 10 },
  off: { borderWidth: 1, borderColor: '#666', borderRadius: 12, padding: 14, marginVertical: 10 },
  t: { color: '#fff', fontSize: 18, fontWeight: '700', marginBottom: 6 },
  m: { color: '#9FB3C8', fontSize: 13, marginBottom: 6 },
  b: { color: '#E6EDF3', fontSize: 15, lineHeight: 21, marginTop: 4 },
});
