/*
 * LYLO Mechanic hackathon (v0.4.4): "Snap the dash" and "Ask out loud" on the results screen.
 * Renders nothing unless EXPO_PUBLIC_LYLO_DASH_PHOTO=1 / EXPO_PUBLIC_LYLO_VOICE_ASK=1 and a server URL
 * are set at build time, so with the flags unset the results screen is exactly as before.
 * A dash photo can only raise the verdict (onScan gets a scan with the stricter level); voice never changes it.
 */
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { MSG, SLOW_MS, MAX_RECORD_MS, features, requestDash, requestVoice, dashView, applyDash, voiceView, recordingOptions, audioFile } from './dashVoice';
import { configuredUrl, configuredKey } from './scanHook';

let defaultPicker = null;
try { defaultPicker = require('expo-image-picker'); } catch (e) { defaultPicker = null; }
let defaultAudio = null;
try { defaultAudio = require('expo-av').Audio; } catch (e) { defaultAudio = null; }

function Btn({ title, onPress, testID, disabled, kind }) {
  return (
    <Pressable onPress={disabled ? undefined : onPress} testID={testID} accessibilityRole="button" accessibilityState={{ disabled: !!disabled }}
      style={[s.btn, kind === 'stop' && s.stop, kind === 'secondary' && s.btn2, disabled && s.dis]}>
      <Text style={[s.btnText, kind === 'secondary' && s.btn2Text]}>{title}</Text>
    </Pressable>
  );
}

function Busy({ text, slow }) {
  return (
    <View style={s.busy}><ActivityIndicator color="#8cc8ff" /><Text style={s.small}>{'  '}{text}</Text>
      {slow ? <Text style={[s.small, { marginTop: 6 }]}>{MSG.slow}</Text> : null}</View>
  );
}

function useSlow(active) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!active) { setSlow(false); return undefined; }
    const t = setTimeout(() => setSlow(true), SLOW_MS);
    return () => clearTimeout(t);
  }, [active]);
  return slow;
}

export default function DashVoicePanel({ scan, onScan, onDash, env, enabled, picker, audio, fetchImpl, baseUrl, appKey }) {
  const on = enabled || features(env);
  const pick = picker === undefined ? defaultPicker : picker;
  const Audio = audio === undefined ? defaultAudio : audio;
  const url = baseUrl === undefined ? configuredUrl(env) : baseUrl;
  const key = appKey === undefined ? configuredKey(env) : appKey;

  const [dashBusy, setDashBusy] = useState(false);
  const [dash, setDash] = useState(null);
  const [dashNote, setDashNote] = useState(null);
  const [rec, setRec] = useState(null); // active Audio.Recording
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [voice, setVoice] = useState(null);
  const [voiceNote, setVoiceNote] = useState(null);
  const stopTimer = useRef(null);
  const recRef = useRef(null);
  const dashSlow = useSlow(dashBusy);
  const voiceSlow = useSlow(voiceBusy);

  useEffect(() => () => {
    clearTimeout(stopTimer.current);
    if (recRef.current) { try { recRef.current.stopAndUnloadAsync(); } catch (e) { /* ignore */ } }
  }, []);

  if (!on || (!on.dash && !on.voice)) return null;
  const level = scan && scan.serverDiagnosis && scan.serverDiagnosis.result && scan.serverDiagnosis.result.safety
    ? scan.serverDiagnosis.result.safety.level : null;

  async function snap(camera) {
    setDashNote(null);
    if (!pick) { setDashNote(MSG.noCamera); return; }
    try {
      const perm = camera ? await pick.requestCameraPermissionsAsync() : (pick.requestMediaLibraryPermissionsAsync ? await pick.requestMediaLibraryPermissionsAsync() : { granted: true });
      if (!perm || !perm.granted) { setDashNote(camera ? MSG.cameraDenied : 'LYLO needs permission to read your photos. You can take a picture instead.'); return; }
      const opts = { mediaTypes: pick.MediaTypeOptions ? pick.MediaTypeOptions.Images : 'Images', quality: 0.7, exif: false, allowsEditing: false };
      const r = camera ? await pick.launchCameraAsync(opts) : await pick.launchImageLibraryAsync(opts);
      if (!r || r.canceled || !r.assets || !r.assets[0]) return;
      const a = r.assets[0];
      setDashBusy(true); setDash(null);
      const res = await requestDash({ baseUrl: url, appKey: key, fetchImpl, scan, photo: { uri: a.uri, type: a.mimeType || 'image/jpeg', name: a.fileName || 'dash.jpg' } });
      const v = dashView(res, level);
      setDash(v);
      if (onDash) onDash(v); // v0.4.5 no-adapter screen: photo floor + evidence
      const next = applyDash(scan, v);
      if (next !== scan && onScan) onScan(next);
    } catch (e) {
      setDashNote('Something went wrong getting the photo. Please try again.');
    } finally { setDashBusy(false); }
  }

  async function startRec() {
    setVoiceNote(null); setVoice(null);
    if (!Audio || !Audio.Recording) { setVoiceNote(MSG.noMic); return; }
    try {
      const perm = await Audio.requestPermissionsAsync();
      if (!perm || !perm.granted) { setVoiceNote(MSG.micDenied); return; }
      if (Audio.setAudioModeAsync) await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const { recording } = await Audio.Recording.createAsync(recordingOptions(Audio));
      recRef.current = recording; setRec(recording);
      stopTimer.current = setTimeout(() => { stopRec(); }, MAX_RECORD_MS);
    } catch (e) {
      setVoiceNote('Could not start recording. Please try again.');
    }
  }

  async function stopRec() {
    clearTimeout(stopTimer.current);
    const r = recRef.current;
    if (!r) return;
    recRef.current = null; setRec(null);
    let uri = null;
    try { await r.stopAndUnloadAsync(); uri = r.getURI(); } catch (e) { uri = null; }
    try { if (Audio.setAudioModeAsync) await Audio.setAudioModeAsync({ allowsRecordingIOS: false }); } catch (e) { /* ignore */ }
    if (!uri) { setVoiceNote('The recording did not save. Please try again.'); return; }
    setVoiceBusy(true);
    try {
      const res = await requestVoice({ baseUrl: url, appKey: key, fetchImpl, scan, audio: audioFile(uri), photoEvidence: dash && dash.ok ? dash.photoEvidence : [] });
      setVoice(voiceView(res));
    } finally { setVoiceBusy(false); }
  }

  return (
    <View style={s.panel} testID="dash-voice-panel">
      <Text style={s.h}>Add more to this check</Text>
      {on.dash ? (
        <View style={s.block}>
          <Text style={s.h2}>{'\uD83D\uDCF7  '}Snap the dash</Text>
          <Text style={s.small}>Engine running, take a clear picture of the gauges and warning lights.</Text>
          <View style={s.row}>
            <Btn title="Snap the dash" testID="snap-dash" onPress={() => snap(true)} disabled={dashBusy} />
            <Btn title="Choose photo" kind="secondary" testID="choose-dash" onPress={() => snap(false)} disabled={dashBusy} />
          </View>
          {dashBusy ? <Busy text="Meta AI is reading your dash..." slow={dashSlow} /> : null}
          {dashNote ? <Text style={s.note}>{dashNote}</Text> : null}
          {dash ? (
            <View style={s.card} testID="dash-result">
              {!dash.ok ? <Text style={s.note}>{dash.message}</Text> : (
                <>
                  {dash.raisedText ? <View style={s.raised}><Text style={s.raisedText}>{'\u26A0\uFE0F  '}{dash.raisedText}</Text></View> : null}
                  {dash.message ? <Text style={s.body}>{dash.message}</Text> : null}
                  {dash.findings.map((f) => <Text key={f.id} style={s.body}>{'\u2022  '}{f.text}{f.color ? ` (${f.color})` : ''}</Text>)}
                  <Text style={s.small}>{dash.note}</Text>
                  {dash.receipt ? <Text style={s.mono}>{dash.receipt}</Text> : null}
                </>
              )}
            </View>
          ) : null}
        </View>
      ) : null}
      {on.voice ? (
        <View style={s.block}>
          <Text style={s.h2}>{'\uD83C\uDF99\uFE0F  '}Ask out loud</Text>
          <Text style={s.small}>Ask a question about this scan, like "Is it safe to drive home?" Up to 30 seconds.</Text>
          {rec ? <Btn title="Stop and send" kind="stop" testID="stop-ask" onPress={stopRec} />
            : <Btn title="Ask out loud" testID="ask-out-loud" onPress={startRec} disabled={voiceBusy} />}
          {rec ? <Text style={s.small}>Listening... tap Stop when you are done.</Text> : null}
          {voiceBusy ? <Busy text="Meta AI is listening and checking your scan..." slow={voiceSlow} /> : null}
          {voiceNote ? <Text style={s.note}>{voiceNote}</Text> : null}
          {voice ? (
            <View style={s.card} testID="voice-result">
              {!voice.ok ? <Text style={s.note}>{voice.message}</Text> : (
                <>
                  <View style={s.notice}><Text style={s.noticeText}>{voice.safetyNotice}</Text></View>
                  <Text style={s.small}>You asked:</Text>
                  <Text style={s.body}>{'\u201C'}{voice.transcript}{'\u201D'}</Text>
                  {voice.answer ? <Text style={[s.body, { marginTop: 10 }]}>{voice.answer}</Text> : <Text style={s.note}>{voice.withheldText}</Text>}
                  {voice.cites.length ? <Text style={s.small}>Based on: {voice.cites.join(', ')}</Text> : null}
                  {voice.followUps.map((f) => <Text key={f.text} style={s.small}>{'\u2022 '}{f.text}</Text>)}
                  {voice.receipt ? <Text style={s.mono}>{voice.receipt}</Text> : null}
                </>
              )}
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  panel: { marginTop: 28, paddingTop: 18, borderTopWidth: 1, borderTopColor: '#1e2a38' },
  h: { color: '#ffffff', fontSize: 22, fontWeight: '800', marginBottom: 8 },
  h2: { color: '#ffffff', fontSize: 19, fontWeight: '800', marginTop: 14, marginBottom: 6 },
  block: { marginBottom: 8 },
  row: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  btn: { backgroundColor: '#ffd60a', paddingVertical: 16, paddingHorizontal: 18, borderRadius: 14, marginTop: 10, alignItems: 'center', minWidth: 150 },
  btn2: { backgroundColor: '#1b2330' },
  stop: { backgroundColor: '#e5383b' },
  dis: { opacity: 0.5 },
  btnText: { color: '#0a0c0f', fontSize: 18, fontWeight: '800' },
  btn2Text: { color: '#8cc8ff' },
  busy: { marginTop: 12, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  card: { marginTop: 12, backgroundColor: '#121a24', borderRadius: 14, padding: 16 },
  raised: { backgroundColor: '#3a0d0f', borderColor: '#e5383b', borderWidth: 2, borderRadius: 12, padding: 12, marginBottom: 10 },
  raisedText: { color: '#ffd6d6', fontSize: 17, fontWeight: '800', lineHeight: 24 },
  notice: { backgroundColor: '#2a2205', borderColor: '#f5c518', borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 10 },
  noticeText: { color: '#ffe9a0', fontSize: 16, fontWeight: '700', lineHeight: 22 },
  body: { color: '#eef3f8', fontSize: 17, lineHeight: 25, marginTop: 4 },
  small: { color: '#c5d1dc', fontSize: 15, lineHeight: 22, marginTop: 4 },
  note: { color: '#ffb020', fontSize: 16, lineHeight: 23, marginTop: 10 },
  mono: { color: '#8a99a8', fontSize: 12, fontFamily: 'monospace', marginTop: 8 },
});
