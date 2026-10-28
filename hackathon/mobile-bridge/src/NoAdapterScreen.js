/*
 * LYLO Mechanic hackathon v0.4.5: "No adapter? Start here".
 * Everything here works without an OBD adapter and never asks for Bluetooth:
 *   describe what's happening (type or speak) -> fixed safety rules on the phone, then Meta AI on the server (optional)
 *   type a trouble code -> offline code library + price links
 *   snap the dash -> same "Snap the dash" panel (no scan needed)
 *   your car: VIN + recalls (VinScreen)
 *   OBDLink suggestion card (what an adapter adds; the app works without one)
 * Shown only when EXPO_PUBLIC_LYLO_NO_ADAPTER=1 (Home entry is hidden otherwise).
 */
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { C } from '../../../baseline/mobile/src/constants/colors';
import { buildCodeResult } from '../../../baseline/mobile/src/engine/diagnose';
import { configuredUrl, configuredKey } from './scanHook';
import { features as dvFeatures, higher, recordingOptions, audioFile, MAX_RECORD_MS } from './dashVoice';
import { NO_SENSOR_NOTE, MSG, OBDLINK, features, matchRules, localLevel, parseCodes, codeFloor, requestCheck, checkView, label } from './noAdapter';
import { forCode } from './priceLinks';
import { PriceButtons } from './PriceButtons';
import { loadVehicle } from './vin';
import DashVoicePanel from './DashVoicePanel';

let defaultStorage = null;
try { defaultStorage = require('@react-native-async-storage/async-storage').default; } catch (e) { defaultStorage = null; }
let defaultAudio = null;
try { defaultAudio = require('expo-av').Audio; } catch (e) { defaultAudio = null; }

const TONE = { SAFE_TO_DRIVE: '#2a9d8f', INSPECT_SOON: '#f5c518', DRIVE_SHORT_DISTANCE_ONLY: '#f4a261', DO_NOT_DRIVE: '#e5383b', TOW_RECOMMENDED: '#e5383b', EMERGENCY_STOP_IMMEDIATELY: '#ff1f3d' };

function Big({ title, onPress, kind, testID, disabled }) {
  return (
    <Pressable onPress={disabled ? undefined : onPress} testID={testID} accessibilityRole="button" accessibilityState={{ disabled: !!disabled }}
      style={[s.btn, kind === 'secondary' && s.btn2, kind === 'stop' && s.stop, disabled && s.dis]}>
      <Text style={[s.btnText, kind === 'secondary' && s.btn2Text]}>{title}</Text>
    </Pressable>
  );
}

export default function NoAdapterScreen({ navigation, env, fetchImpl, baseUrl, appKey, storage, audio, open }) {
  const f = features(env);
  const url = baseUrl === undefined ? configuredUrl(env) : baseUrl;
  const key = appKey === undefined ? configuredKey(env) : appKey;
  const store = storage === undefined ? defaultStorage : storage;
  const Audio = audio === undefined ? defaultAudio : audio;
  const go = open || ((u) => Linking.openURL(u).catch(() => {}));
  const dv = dvFeatures(env);

  const [text, setText] = useState('');
  const [codesText, setCodesText] = useState('');
  const [vehicle, setVehicle] = useState(null);
  const [checked, setChecked] = useState(null); // { level, hits, codes: [result], bad }
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState(null);
  const [note, setNote] = useState(null);
  const [rec, setRec] = useState(null);
  const [photo, setPhoto] = useState(null); // dash-photo view: { level, photoEvidence, reasons }
  const recRef = useRef(null);
  const stopTimer = useRef(null);

  useEffect(() => { let live = true; loadVehicle(store).then((v) => { if (live) setVehicle(v); }); return () => { live = false; }; }, [store]);
  useEffect(() => () => { clearTimeout(stopTimer.current); if (recRef.current) { try { recRef.current.stopAndUnloadAsync(); } catch (e) { /* ignore */ } } }, []);

  function runLocal(words) {
    const { good, bad } = parseCodes(codesText);
    const codes = good.map((c) => buildCodeResult(c));
    let level = localLevel(words);
    if (photo && photo.ok) level = higher(level, photo.level);
    codes.forEach((r) => { level = higher(level, codeFloor(r.urgency)); });
    const c = { level, hits: matchRules(words), codes, good, bad };
    setChecked(c);
    return c;
  }

  async function check(audioFileObj) {
    setNote(null); setView(null);
    if (!text.trim() && !codesText.trim() && !audioFileObj) { setNote(MSG.empty); return; }
    const c = runLocal(text);
    if (!f.server) return;
    setBusy(true);
    try {
      const res = await requestCheck({ baseUrl: url, appKey: key, fetchImpl, text: text.trim(), codes: c.good, vehicle, audio: audioFileObj, photoEvidence: photo && photo.ok ? photo.photoEvidence : [] });
      const v = checkView(res, c.level);
      setView(v);
      if (v.ok && v.transcript) { const merged = runLocal(text + ' ' + v.transcript); v.level = higher(v.level, merged.level); v.levelText = label(v.level); }
    } finally { setBusy(false); }
  }

  async function startRec() {
    setNote(null);
    if (!Audio || !Audio.Recording) { setNote(MSG.noMic); return; }
    try {
      const perm = await Audio.requestPermissionsAsync();
      if (!perm || !perm.granted) { setNote(MSG.micDenied); return; }
      if (Audio.setAudioModeAsync) await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const { recording } = await Audio.Recording.createAsync(recordingOptions(Audio));
      recRef.current = recording; setRec(recording);
      stopTimer.current = setTimeout(() => { stopRec(); }, MAX_RECORD_MS);
    } catch (e) { setNote('Could not start recording. Please try again.'); }
  }

  async function stopRec() {
    clearTimeout(stopTimer.current);
    const r = recRef.current;
    if (!r) return;
    recRef.current = null; setRec(null);
    let uri = null;
    try { await r.stopAndUnloadAsync(); uri = r.getURI(); } catch (e) { uri = null; }
    try { if (Audio.setAudioModeAsync) await Audio.setAudioModeAsync({ allowsRecordingIOS: false }); } catch (e) { /* ignore */ }
    if (!uri) { setNote('The recording did not save. Please try again.'); return; }
    const a = audioFile(uri);
    await check({ ...a, name: a.name.replace('question', 'symptoms') });
  }

  if (!f.on) return null;
  let level = view && view.ok ? view.level : (checked ? checked.level : null);
  if (photo && photo.ok && photo.findings.length) level = higher(level || 'INSPECT_SOON', photo.level);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg || '#0a0c0f' }} contentContainerStyle={s.scroll} testID="no-adapter-screen">
      <View style={s.hero}>
        <Text style={s.h1}>No adapter? Start here</Text>
        <Text style={s.body}>You don't need an OBD adapter or Bluetooth for anything on this screen.</Text>
      </View>

      <Text style={s.h2}>{'\uD83D\uDDE3\uFE0F  '}What's happening with your car?</Text>
      <TextInput testID="symptom-text" style={[s.input, { minHeight: 90 }]} multiline value={text} onChangeText={setText} maxLength={1000}
        placeholder="e.g. grinding when I brake, oil light came on, smells like something burning" placeholderTextColor="#7f8b97" />
      <Text style={s.small}>Trouble code from a dash, a shop or a parts store? (optional)</Text>
      <TextInput testID="code-text" style={s.input} value={codesText} onChangeText={setCodesText} autoCapitalize="characters" autoCorrect={false}
        placeholder="e.g. P0300, P0171" placeholderTextColor="#7f8b97" />
      <View style={s.row}>
        <Big title={f.server ? 'Check it' : 'Check it (offline)'} testID="check-it" onPress={() => check(null)} disabled={busy || !!rec} />
        {f.server ? (rec ? <Big title="Stop and send" kind="stop" testID="stop-say" onPress={stopRec} />
          : <Big title="Say it instead" kind="secondary" testID="say-it" onPress={startRec} disabled={busy} />) : null}
      </View>
      {rec ? <Text style={s.small}>Listening... tell us what the car is doing, then tap Stop.</Text> : null}
      {busy ? <View style={s.busy}><ActivityIndicator color="#8cc8ff" /><Text style={s.small}>{'  '}Checking with Meta AI (up to 30 seconds)...</Text></View> : null}
      {note ? <Text style={s.note}>{note}</Text> : null}

      {level ? (
        <View style={[s.verdict, { borderColor: TONE[level] || '#f5c518' }]} testID="na-verdict">
          <Text style={s.small}>Safety check</Text>
          <Text style={[s.level, { color: TONE[level] || '#f5c518' }]}>{label(level)}</Text>
          {(checked ? checked.hits : []).map((h) => <Text key={h.id} style={s.body}>{'\u26A0\uFE0F  '}{h.reason}</Text>)}
          {photo && photo.ok ? photo.reasons.map((r) => <Text key={r} style={s.body}>{'\uD83D\uDCF7  '}{r}</Text>) : null}
          <Text style={s.small}>{NO_SENSOR_NOTE}</Text>
          <Text style={s.small}>From LYLO's fixed safety rules. Meta AI can make this stricter, never more relaxed.</Text>
        </View>
      ) : null}

      {view && !view.ok ? <Text style={s.note}>{view.message}</Text> : null}
      {view && view.ok ? (
        <View style={s.card} testID="na-answer">
          {view.transcript ? <><Text style={s.small}>You said:</Text><Text style={s.body}>{'\u201C'}{view.transcript}{'\u201D'}</Text></> : null}
          {view.answer ? <Text style={[s.body, { marginTop: 8 }]}>{view.answer}</Text> : null}
          {view.withheldText ? <Text style={s.note}>{view.withheldText}</Text> : null}
          {view.followUps.map((t) => <Text key={t} style={s.small}>{'\u2022 '}{t}</Text>)}
          {view.unverified ? <Text style={s.small}>{view.unverified} claim(s) Meta AI could not back up were left out.</Text> : null}
          {view.receipt ? <Text style={s.mono}>{view.receipt}</Text> : null}
        </View>
      ) : null}

      {checked && checked.bad.length ? <Text style={s.note}>Not a trouble code: {checked.bad.join(', ')}. Codes look like P0300.</Text> : null}
      {(checked ? checked.codes : []).map((r) => {
        const p = forCode(r, vehicle);
        return (
          <View key={r.code} style={s.card} testID={'na-code-' + r.code}>
            <Text style={s.h3}>{r.code}: {r.title}</Text>
            <Text style={s.body}>{r.plain}</Text>
            {r.priceText && r.priceText.shop ? <Text style={s.small}>Typical shop price (LYLO estimate, not a quote): {r.priceText.shop}</Text> : null}
            {p ? <PriceButtons p={p} open={open} /> : null}
            <Big title="Full details" kind="secondary" onPress={() => navigation && navigation.navigate('CodeDetail', { code: r.code, result: r })} />
          </View>
        );
      })}

      {dv.dash ? <DashVoicePanel scan={null} onDash={setPhoto} enabled={{ dash: true, voice: false }} env={env} fetchImpl={fetchImpl} baseUrl={url} appKey={key} /> : null}

      <Text style={s.h2}>{'\uD83D\uDD27  '}More without an adapter</Text>
      <Big title={vehicle ? `Your car: ${vehicle.name} (recalls)` : 'Your car: add your VIN + check recalls'} testID="na-vin" onPress={() => navigation && navigation.navigate('Vin')} />
      <Big title="Look up any trouble code" kind="secondary" testID="na-lookup" onPress={() => navigation && navigation.navigate('Lookup')} />
      <Big title="Photo Helper: find a part on your car" kind="secondary" testID="na-photo" onPress={() => navigation && navigation.navigate('PhotoHelper')} />

      <View style={s.obd} testID="obdlink-card">
        <Text style={s.h2}>{'\uD83D\uDD0C  '}{OBDLINK.title}</Text>
        <Text style={s.body}>{OBDLINK.worksWithout}</Text>
        <Text style={[s.small, { marginTop: 8 }]}>With an adapter plugged into the OBD port you also get:</Text>
        {OBDLINK.gets.map((g) => <Text key={g} style={s.body}>{'\u2022  '}{g}</Text>)}
        {OBDLINK.models.map((m) => (
          <Pressable key={m.name} onPress={() => go(m.url)} accessibilityRole="link" style={s.model} testID={'obdlink-' + m.name.replace(/\W/g, '')}>
            <Text style={s.h3}>{m.name} <Text style={s.small}>({m.kind})</Text></Text>
            <Text style={s.small}>{m.facts}</Text>
            <Text style={s.link}>See it on obdlink.com {'\u2197'}</Text>
          </Pressable>
        ))}
        <Text style={s.small}>{OBDLINK.appNote}</Text>
        <Text style={s.small}>{OBDLINK.disclaimer}</Text>
        <Big title="I have an adapter: connect it" kind="secondary" testID="na-connect" onPress={() => navigation && navigation.navigate('Connect')} />
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  scroll: { padding: 20, paddingBottom: 60 },
  hero: { backgroundColor: '#121a24', borderRadius: 16, padding: 18, marginBottom: 10 },
  h1: { color: '#ffffff', fontSize: 26, fontWeight: '800', marginBottom: 6 },
  h2: { color: '#ffffff', fontSize: 20, fontWeight: '800', marginTop: 22, marginBottom: 8 },
  h3: { color: '#ffffff', fontSize: 18, fontWeight: '800' },
  body: { color: '#eef3f8', fontSize: 17, lineHeight: 25, marginTop: 4 },
  small: { color: '#c5d1dc', fontSize: 15, lineHeight: 22, marginTop: 4 },
  note: { color: '#ffd6a0', fontSize: 16, lineHeight: 23, marginTop: 10 },
  mono: { color: '#7f8b97', fontSize: 12, marginTop: 8 },
  link: { color: '#8cc8ff', fontSize: 16, fontWeight: '700', marginTop: 6 },
  input: { backgroundColor: '#121a24', color: '#ffffff', fontSize: 18, borderRadius: 12, padding: 14, marginTop: 8, borderWidth: 1, borderColor: '#1e2a38' },
  row: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  btn: { backgroundColor: '#ffd60a', paddingVertical: 16, paddingHorizontal: 18, borderRadius: 14, marginTop: 12, alignItems: 'center', minWidth: 150 },
  btn2: { backgroundColor: '#1b2330' },
  stop: { backgroundColor: '#e5383b' },
  dis: { opacity: 0.5 },
  btnText: { color: '#0a0c0f', fontSize: 18, fontWeight: '800' },
  btn2Text: { color: '#8cc8ff' },
  busy: { marginTop: 12, flexDirection: 'row', alignItems: 'center' },
  verdict: { marginTop: 16, backgroundColor: '#121a24', borderRadius: 14, padding: 16, borderWidth: 2 },
  level: { fontSize: 24, fontWeight: '900', marginTop: 2, marginBottom: 6 },
  card: { marginTop: 12, backgroundColor: '#121a24', borderRadius: 14, padding: 16 },
  obd: { marginTop: 26, backgroundColor: '#0f1620', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '#24364a' },
  model: { marginTop: 12, backgroundColor: '#121a24', borderRadius: 12, padding: 14 },
});
