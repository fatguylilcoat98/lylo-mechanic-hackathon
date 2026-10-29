/*
 * LYLO Mechanic hackathon v0.5.1: "Run the proof" entry (was: prove.js not imported by any screen).
 * ProveReplay (Demo screen): POST /api/v1/prove/replay, shown with the REPLAY badge (always) and the
 * server's HELD/FAILED prediction banner, then the full results body.
 * ProveCheck (results screen, flag EXPO_PUBLIC_LYLO_PROVE=1 only): POST /api/v1/prove/check for the scan's
 * locked prediction. The server's checker decides; the phone never sets a status.
 */
import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { REPLAY_CASES, replay, check, asScan, features, samplesSince } from './prove';
import { PredictionBanner, ReplayBadge } from './ui2/components';
import { buildV2 } from './ui2/model';
import { ResultsV2Body } from './ui2/ResultsV2';
import { configuredUrl, configuredKey } from './scanHook';

const defaultOpts = () => ({ baseUrl: configuredUrl(), appKey: configuredKey() });

const bannerOf = (p) => (p && p.text ? { text: String(p.text), status: String(p.status || '').toLowerCase() === 'held' ? 'held' : String(p.status || '').toLowerCase() === 'failed' ? 'failed' : 'pending', measured: p.measured ? String(p.measured) : null } : null);

export function ProveReplay({ opts }) {
  const [busy, setBusy] = useState(null);
  const [msg, setMsg] = useState(null);
  const [m, setM] = useState(null);
  async function run(id) {
    setBusy(id); setMsg(null); setM(null);
    const r = await replay(id, opts);
    setBusy(null);
    if (!r.ok) { setMsg(r.error); return; }
    const built = buildV2(asScan(r.body), { screen: 'codes' });
    if (built) setM(built); else setMsg('The server answered, but not with a result this app can show.');
  }
  return (
    <View testID="prove-replay">
      <Text style={s.h2}>Run the proof</Text>
      <Text style={s.body}>The AI locks a prediction before the readings arrive. Then the server's checker, not the AI, decides if it HELD or FAILED.</Text>
      {REPLAY_CASES.map((c) => (
        <Pressable key={c.id} onPress={() => run(c.id)} style={s.case} accessibilityRole="button" testID={'prove-' + c.id}>
          <Text style={s.caseT}>{c.title}</Text><Text style={s.caseS}>{c.short}</Text>
        </Pressable>
      ))}
      {busy ? <ActivityIndicator size="large" color="#f5c518" style={{ marginTop: 12 }} /> : null}
      {msg ? <Text style={s.msg} testID="prove-msg">{msg}</Text> : null}
      {m ? <View style={s.card} testID="prove-result"><ResultsV2Body m={m} /></View> : null}
    </View>
  );
}

export function ProveCheck({ scan, opts, env }) {
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);
  const [msg, setMsg] = useState(null);
  if (!features(env).on) return null;
  const r = scan && scan.serverDiagnosis && scan.serverDiagnosis.result;
  const sid = r && r.detective && r.detective.prove && r.detective.prove.session_id;
  if (!sid) return null;
  async function run() {
    setBusy(true); setMsg(null);
    const out = await check(sid, samplesSince(scan.proveReadings || [], Number(scan.proveLockedAtMs) || 0), opts || defaultOpts());
    setBusy(false);
    if (out.ok) setRes(out.body); else setMsg(out.error);
  }
  return (
    <View style={s.card} testID="prove-check">
      {scan.replay ? <ReplayBadge label={scan.demoLabel} /> : null}
      <Pressable onPress={run} style={s.case} accessibilityRole="button" testID="prove-check-btn">
        <Text style={s.caseT}>Run the proof</Text><Text style={s.caseS}>Ask the server's checker whether the locked prediction held.</Text>
      </Pressable>
      {busy ? <ActivityIndicator size="large" color="#f5c518" /> : null}
      {msg ? <Text style={s.msg} testID="prove-msg">{msg}</Text> : null}
      {res ? <PredictionBanner prediction={bannerOf(res.prediction)} /> : null}
    </View>
  );
}

const s = StyleSheet.create({
  h2: { color: '#fff', fontSize: 20, fontWeight: '800', marginTop: 24, marginBottom: 6 },
  body: { color: '#c5d1dc', fontSize: 17, lineHeight: 24, marginTop: 6 },
  msg: { color: '#ffb4a2', fontSize: 16, marginTop: 12 },
  case: { backgroundColor: '#121a24', borderRadius: 14, padding: 16, marginTop: 10 },
  caseT: { color: '#fff', fontSize: 18, fontWeight: '800' },
  caseS: { color: '#9fb0c0', fontSize: 14, marginTop: 4 },
  card: { backgroundColor: '#0f151d', borderRadius: 16, padding: 12, marginTop: 16 },
});
