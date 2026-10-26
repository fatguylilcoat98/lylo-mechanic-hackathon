/*
 * LYLO Mechanic hackathon (v0.4.2): Photo Helper screen.
 * Pick a simple job -> plain photo instruction -> take/choose a photo -> Meta AI marks
 * the parts on THAT photo (numbered circles) + fixed steps. Simple view | Mechanic view
 * (shares the lylo.viewMode key). Always shows the "not a guarantee" line.
 */
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { C } from '../../../baseline/mobile/src/constants/colors';
import { Toggle } from './SimpleResults';
import { loadViewMode, saveViewMode } from './viewMode';
import { JOBS, PRO_JOBS, GET_A_PRO, layoutMarks, viewModel, requestHelper } from './photoHelper';
import { configuredUrl, configuredKey } from './scanHook';

let defaultStorage = null;
try { defaultStorage = require('@react-native-async-storage/async-storage').default; } catch (e) { defaultStorage = null; }
let defaultPicker = null;
try { defaultPicker = require('expo-image-picker'); } catch (e) { defaultPicker = null; }

const Y = '#ffd60a';

function Big({ title, onPress, kind, testID }) {
  return (
    <Pressable onPress={onPress} testID={testID} accessibilityRole="button" style={[s.btn, kind === 'secondary' && s.btn2]}>
      <Text style={[s.btnText, kind === 'secondary' && s.btn2Text]}>{title}</Text>
    </Pressable>
  );
}

export function Overlay({ photo, marks }) {
  const { width } = useWindowDimensions();
  const w = Math.max(200, (width || 400) - 40);
  const h = photo.width && photo.height ? Math.round((w * photo.height) / photo.width) : Math.round(w * 0.75);
  return (
    <View style={{ width: w, height: h, marginBottom: 16, borderRadius: 12, overflow: 'hidden' }}>
      <Image source={{ uri: photo.uri }} style={{ width: w, height: h }} resizeMode="stretch" />
      {layoutMarks(marks, w, h).map((m) => (
        <React.Fragment key={m.n}>
          <View pointerEvents="none" style={{ position: 'absolute', left: m.cx - m.r, top: m.cy - m.r, width: m.r * 2, height: m.r * 2, borderRadius: m.r, borderWidth: 4, borderColor: Y }} />
          <View pointerEvents="none" style={[s.badge, { left: m.badgeX - 16, top: m.badgeY - 16 }]}><Text style={s.badgeText}>{m.n}</Text></View>
        </React.Fragment>
      ))}
    </View>
  );
}

export function HelperResult({ vm, photo, mode, onMode }) {
  return (
    <>
      <Toggle mode={mode} onChange={onMode} />
      <Text style={s.h}>{vm.title}</Text>
      {photo ? <Overlay photo={photo} marks={vm.marks} /> : null}
      {vm.message ? <View style={vm.refused ? s.pro : s.miss}><Text style={s.missText}>{vm.message}</Text></View> : null}
      {vm.warnings.map((w) => <View key={w} style={s.warn}><Text style={s.warnText}>{'\u26A0\uFE0F  '}{w}</Text></View>)}
      {mode === 'mechanic' ? (
        <View>
          <Text style={s.h2}>Marks (confidence)</Text>
          {vm.mechanic.marks.length ? vm.mechanic.marks.map((m) => (
            <Text key={m.n} style={s.small}>{`${m.n}. ${m.label} \u2014 ${Math.round(Number(m.confidence) * 100)}% \u00B7 x ${m.x}, y ${m.y}, r ${m.radius}${m.seen ? '\n   ' + m.seen : ''}`}</Text>
          )) : <Text style={s.small}>None above the confidence threshold.</Text>}
          <Text style={s.small}>{`Status: ${vm.mechanic.status} \u00B7 threshold ${vm.mechanic.minConfidence ?? '?'} \u00B7 dropped ${vm.mechanic.dropped} \u00B7 image ${vm.mechanic.imageQuality || '?'}`}</Text>
        </View>
      ) : (
        <View>
          {vm.marks.map((m) => <Text key={m.n} style={s.mark}>{m.text}</Text>)}
          {vm.steps.length ? <Text style={s.h2}>Steps</Text> : null}
          {vm.steps.map((st, i) => <Text key={st} style={s.bullet}>{`${i + 1}.  ${st}`}</Text>)}
        </View>
      )}
      <Text style={s.disc}>{vm.disclaimer}</Text>
      <View style={s.receipt}>
        <Text style={s.powered}>{vm.poweredBy}</Text>
        {vm.mechanic.receipt ? <Text style={s.mono}>{vm.mechanic.receipt}</Text> : null}
      </View>
    </>
  );
}

export default function PhotoHelperScreen({ navigation, storage, picker, fetchImpl, baseUrl, appKey }) {
  const store = storage === undefined ? defaultStorage : storage;
  const pick = picker === undefined ? defaultPicker : picker;
  const [mode, setMode] = useState('simple');
  const [job, setJob] = useState(null);
  const [photo, setPhoto] = useState(null);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);
  const [note, setNote] = useState(null);
  useEffect(() => { let live = true; loadViewMode(store).then((m) => { if (live) setMode(m); }); return () => { live = false; }; }, [store]);
  const changeMode = (m) => { setMode(m); saveViewMode(store, m); };

  async function getPhoto(camera) {
    setNote(null);
    if (!pick) { setNote('The camera is not available in this build.'); return; }
    try {
      const perm = camera ? await pick.requestCameraPermissionsAsync() : { granted: true };
      if (!perm || !perm.granted) { setNote('LYLO needs camera permission to take the picture. You can also choose a photo instead.'); return; }
      const opts = { mediaTypes: pick.MediaTypeOptions ? pick.MediaTypeOptions.Images : 'Images', quality: 0.7, exif: false, allowsEditing: false };
      const r = camera ? await pick.launchCameraAsync(opts) : await pick.launchImageLibraryAsync(opts);
      if (!r || r.canceled || !r.assets || !r.assets[0]) return;
      const a = r.assets[0];
      const p = { uri: a.uri, width: a.width, height: a.height, type: a.mimeType || 'image/jpeg', name: a.fileName || 'photo.jpg' };
      setPhoto(p); setBusy(true); setRes(null);
      const out = await requestHelper({ baseUrl: baseUrl === undefined ? configuredUrl() : baseUrl, appKey: appKey === undefined ? configuredKey() : appKey, fetchImpl, job: job.id, photo: p });
      setRes(out);
    } catch (e) {
      setNote('Something went wrong getting the photo. Please try again.');
    } finally { setBusy(false); }
  }

  const reset = () => { setJob(null); setPhoto(null); setRes(null); setNote(null); };

  if (!job) {
    return (
      <ScrollView style={s.screen} contentContainerStyle={s.scroll}>
        <Text style={s.h}>What do you want to do?</Text>
        <Text style={s.body}>Pick a job. You take one picture, and Meta AI shows you where to look on your own car.</Text>
        {JOBS.map((j) => (
          <Pressable key={j.id} onPress={() => setJob(j)} style={s.job} accessibilityRole="button">
            <Text style={s.jobText}>{j.icon}  {j.title}</Text>
          </Pressable>
        ))}
        <Pressable onPress={() => setJob(PRO_JOBS)} style={[s.job, s.jobPro]} accessibilityRole="button">
          <Text style={s.jobText}>{PRO_JOBS.icon}  {PRO_JOBS.title}</Text>
        </Pressable>
        <Text style={s.powered}>Powered by Meta AI</Text>
      </ScrollView>
    );
  }
  if (job.id === 'pro') {
    return (
      <ScrollView style={s.screen} contentContainerStyle={s.scroll}>
        <View style={s.pro}><Text style={s.proText}>{'\uD83D\uDED1  '}{GET_A_PRO}</Text></View>
        <Text style={s.body}>Brakes, fuel lines, airbags and hybrid or electric car batteries can hurt you or others if a step goes wrong. A shop has the tools to do it safely.</Text>
        <Big title="Pick another job" onPress={reset} kind="secondary" />
      </ScrollView>
    );
  }
  const vm = res ? viewModel(res, job.id) : null;
  return (
    <ScrollView style={s.screen} contentContainerStyle={s.scroll}>
      {!vm ? (
        <>
          <Text style={s.h}>{job.icon}  {job.title}</Text>
          <Text style={s.label}>Take this picture:</Text>
          <Text style={s.instr}>{job.photo}</Text>
          {job.id === 'battery' ? <View style={s.warn}><Text style={s.warnText}>{'\u26A0\uFE0F  '}{viewModel({}, 'battery').warnings[0]}</Text></View> : null}
          {busy ? (
            <View style={{ alignItems: 'center', marginVertical: 24 }}>
              <ActivityIndicator size="large" color={Y} />
              <Text style={s.body}>Meta AI is looking at your photo…</Text>
            </View>
          ) : (
            <>
              <Big title="Take a picture" onPress={() => getPhoto(true)} testID="take-photo" />
              <Big title="Choose a photo" onPress={() => getPhoto(false)} kind="secondary" />
            </>
          )}
          {note ? <Text style={s.note}>{note}</Text> : null}
          <Text style={s.disc}>This is not a guarantee. It gives you an idea of where to look.</Text>
        </>
      ) : (
        <>
          <HelperResult vm={vm} photo={photo} mode={mode} onMode={changeMode} />
          <Big title="Try another picture" onPress={() => { setRes(null); setPhoto(null); }} />
          <Big title="Pick another job" onPress={reset} kind="secondary" />
        </>
      )}
      <Big title="Home" onPress={() => navigation && navigation.navigate('Home')} kind="secondary" />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  scroll: { padding: 20, paddingBottom: 48 },
  h: { color: '#ffffff', fontSize: 28, fontWeight: '900', marginBottom: 12 },
  h2: { color: '#ffffff', fontSize: 20, fontWeight: '800', marginTop: 18, marginBottom: 8 },
  body: { color: '#eef3f8', fontSize: 17, lineHeight: 25, marginBottom: 16 },
  label: { color: '#c5d1dc', fontSize: 17, marginBottom: 6 },
  instr: { color: '#ffffff', fontSize: 22, fontWeight: '700', lineHeight: 30, marginBottom: 20 },
  job: { backgroundColor: '#1b2330', borderRadius: 14, padding: 18, marginBottom: 12 },
  jobPro: { backgroundColor: '#3a0d0f' },
  jobText: { color: '#ffffff', fontSize: 19, fontWeight: '700' },
  btn: { backgroundColor: '#1f6feb', borderRadius: 14, padding: 18, alignItems: 'center', marginTop: 12 },
  btn2: { backgroundColor: '#1b2330' },
  btnText: { color: '#ffffff', fontSize: 19, fontWeight: '800' },
  btn2Text: { color: '#eef3f8' },
  badge: { position: 'absolute', width: 32, height: 32, borderRadius: 16, backgroundColor: Y, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#000' },
  badgeText: { color: '#000', fontSize: 17, fontWeight: '900' },
  mark: { color: Y, fontSize: 20, fontWeight: '800', marginBottom: 8 },
  bullet: { color: '#eef3f8', fontSize: 18, lineHeight: 27, marginBottom: 10 },
  small: { color: '#c5d1dc', fontSize: 15, lineHeight: 22, marginBottom: 6 },
  miss: { backgroundColor: '#13283d', borderRadius: 14, padding: 16, marginBottom: 16 },
  missText: { color: '#ffffff', fontSize: 19, fontWeight: '700', lineHeight: 27 },
  pro: { backgroundColor: '#3a0d0f', borderColor: '#e5383b', borderWidth: 2, borderRadius: 16, padding: 18, marginBottom: 16 },
  proText: { color: '#ffd6d6', fontSize: 24, fontWeight: '900' },
  warn: { backgroundColor: '#3a2a00', borderColor: '#f5c518', borderWidth: 2, borderRadius: 14, padding: 14, marginBottom: 16 },
  warnText: { color: '#fff3c4', fontSize: 17, fontWeight: '700', lineHeight: 25 },
  note: { color: '#ffb4a8', fontSize: 17, marginTop: 12 },
  disc: { color: '#ffffff', fontSize: 17, fontWeight: '700', marginTop: 20, lineHeight: 24 },
  receipt: { marginTop: 20, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#1e2a38' },
  powered: { color: '#c5d1dc', fontSize: 14, fontWeight: '700', marginTop: 16 },
  mono: { color: '#8a99a8', fontSize: 12, fontFamily: 'monospace', marginTop: 4 },
});
