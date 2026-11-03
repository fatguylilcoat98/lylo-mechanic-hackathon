/*
 * v0.6 Crash Guard screen (flag EXPO_PUBLIC_LYLO_CRASH_GUARD=1). Logic in ./crashGuard.js.
 * Works only while this screen is open and the phone is awake (foreground). OFF until the driver turns it on.
 * Alert: server email to contacts (POST /api/v1/crash/alert, fixed text); if that fails or a contact only has a phone,
 * the phone's SMS app opens pre-filled (Android needs one tap to send; we can't send SMS silently).
 */
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, Vibration, View } from 'react-native';
let AsyncStorage = null;
try { AsyncStorage = require('@react-native-async-storage/async-storage').default; } catch (e) { AsyncStorage = null; }
const mem = {}; // fallback when storage is unavailable (tests): nothing persists
const Store = { getItem: async (k) => { try { return AsyncStorage ? await AsyncStorage.getItem(k) : (mem[k] || null); } catch (e) { return mem[k] || null; } },
  setItem: async (k, v) => { try { if (AsyncStorage) await AsyncStorage.setItem(k, v); else mem[k] = v; } catch (e) { mem[k] = v; } } };
import { configuredUrl, configuredKey } from './scanHook';
import * as CG from './crashGuard';

const KEY = 'lylo.crash.contacts.v1';
let Sensors = null; let Location = null; let SMS = null; let KeepAwake = null;
try { Sensors = require('expo-sensors'); } catch (e) { Sensors = null; }
try { Location = require('expo-location'); } catch (e) { Location = null; }
try { SMS = require('expo-sms'); } catch (e) { SMS = null; }
try { KeepAwake = require('expo-keep-awake'); } catch (e) { KeepAwake = null; }

async function where() {
  try {
    if (!Location) return null;
    const p = await Location.getLastKnownPositionAsync() || await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
    return p ? { lat: p.coords.latitude, lon: p.coords.longitude, accuracyM: p.coords.accuracy } : null;
  } catch (e) { return null; }
}

export default function CrashGuardScreen({ navigation, fetchImpl, env }) {
  const [contacts, setContacts] = useState([]);
  const [name, setName] = useState('');
  const [draft, setDraft] = useState({ name: '', email: '', phone: '' });
  const [armed, setArmed] = useState(false);
  const [crashAt, setCrashAt] = useState(null);
  const [test, setTest] = useState(false);
  const [sendRealTest, setSendRealTest] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [status, setStatus] = useState(null);
  const det = useRef(CG.createDetector());
  const subs = useRef([]);

  useEffect(() => { Store.getItem(KEY).then((v) => { try { const j = JSON.parse(v || '{}'); setContacts(CG.cleanContacts(j.contacts)); setName(j.name || ''); } catch (e) { /* ignore */ } }); }, []);
  const save = (c, n) => { setContacts(c); Store.setItem(KEY, JSON.stringify({ contacts: c, name: n })); };

  function startPrompt(isTest) { const t = Date.now(); setTest(isTest); setStatus(null); setNow(t); setCrashAt(t); }
  function onEvent(ev) { if (ev && ev.type === 'crash') startPrompt(false); }

  async function arm(on) {
    subs.current.forEach((s) => { try { s.remove(); } catch (e) { /* ignore */ } }); subs.current = [];
    det.current.reset(); setArmed(on); setStatus(null);
    if (KeepAwake) { try { on ? KeepAwake.activateKeepAwakeAsync('crash') : KeepAwake.deactivateKeepAwake('crash'); } catch (e) { /* ignore */ } }
    if (!on) return;
    if (Sensors && Sensors.Accelerometer) {
      Sensors.Accelerometer.setUpdateInterval(20);
      subs.current.push(Sensors.Accelerometer.addListener((a) => onEvent(det.current.feedAccel({ t: Date.now(), x: a.x, y: a.y, z: a.z }))));
    } else setStatus('Motion sensor not available on this phone.');
    if (Location) {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm && perm.granted) {
        subs.current.push(await Location.watchPositionAsync({ accuracy: Location.Accuracy.High, timeInterval: 1000, distanceInterval: 0 },
          (p) => { if (p.coords.speed != null && p.coords.speed >= 0) onEvent(det.current.feedSpeed({ t: Date.now(), mph: p.coords.speed * 2.23694 })); }));
      } else setStatus('No location permission: speed check and location in the alert are off.');
    }
  }
  useEffect(() => () => arm(false), []);

  useEffect(() => {
    if (!crashAt) return undefined;
    Vibration.vibrate([0, 600, 400], true);
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => { clearInterval(id); Vibration.cancel(); };
  }, [crashAt]);

  const ps = crashAt ? CG.promptState(Math.max(0, now - crashAt)) : null;
  useEffect(() => { if (ps && ps.phase === 'alert') { const at = crashAt; setCrashAt(null); sendAlert(at); } }, [ps && ps.phase]);

  async function sendAlert(at) {
    const loc = await where();
    const msg = CG.alertMessage({ userName: name, loc, at, test });
    if (test && !sendRealTest) { setStatus('TEST: nothing was sent. This is what your contacts would get:\n\n' + msg); return; }
    const emails = contacts.map((c) => c.email).filter(Boolean);
    const phones = contacts.map((c) => c.phone).filter(Boolean);
    let sent = 0;
    const url = configuredUrl(env); const key = configuredKey(env);
    if (emails.length && url) {
      try {
        const r = await (fetchImpl || fetch)(url.replace(/\/$/, '') + '/api/v1/crash/alert', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-LYLO-App-Key': key || '' },
          body: JSON.stringify({ emails, name, lat: loc && loc.lat, lon: loc && loc.lon, accuracy_m: loc && loc.accuracyM, at, test }) });
        const b = await r.json(); sent = (r.ok && b.sent) || 0;
      } catch (e) { sent = 0; }
    }
    let smsOpened = false;
    if ((phones.length || !sent) && SMS && phones.length) {
      try { if (await SMS.isAvailableAsync()) { await SMS.sendSMSAsync(phones, msg); smsOpened = true; } } catch (e) { /* ignore */ }
    }
    setStatus((sent ? `Email alert sent to ${sent} contact(s). ` : 'Email alert was NOT sent. ') + (smsOpened ? 'Text message opened: tap Send.' : '') + (test ? ' (Test)' : ''));
  }

  function imOk() { setCrashAt(null); Vibration.cancel(); navigation && navigation.navigate('Collision', { ask: true }); }

  if (!CG.features(env).on) return null;
  if (ps && ps.phase === 'asking') {
    return (
      <View style={st.alarm} testID="cg-prompt">
        <Text style={st.alarmTitle}>{ps.text}</Text>
        <Text style={st.count}>{ps.secondsLeft}</Text>
        <Text style={st.alarmSub}>{test ? 'TEST (simulated crash). ' : ''}Prompt {ps.prompt} of 2. If you don't answer, we alert your emergency contacts.</Text>
        <Pressable onPress={imOk} accessibilityRole="button" style={st.ok} testID="cg-ok"><Text style={st.okText}>I'm OK</Text></Pressable>
        <Text style={st.alarmSub}>{CG.NOT_911}</Text>
      </View>
    );
  }
  return (
    <ScrollView contentContainerStyle={st.scroll} style={{ flex: 1, backgroundColor: '#0a0c0f' }} testID="cg-screen">
      <Text style={st.warn} testID="cg-not911">{CG.NOT_911}</Text>
      <View style={st.row}><Text style={st.h}>Crash Guard for this drive</Text><Switch value={armed} onValueChange={arm} testID="cg-arm" /></View>
      <Text style={st.small}>Keep LYLO open with the screen on (we keep it awake). It listens for a hard impact followed by stillness, or a sudden stop from speed. Turns off when you leave this screen.</Text>
      {status ? <Text style={st.note}>{status}</Text> : null}
      <Text style={st.h}>Your first name (for the alert)</Text>
      <TextInput style={st.input} value={name} testID="cg-name" placeholder="Your first name" placeholderTextColor="#777" onChangeText={(n) => { setName(n); save(contacts, n); }} maxLength={40} />
      <Text style={st.h}>Emergency contacts ({contacts.length}/{CG.MAX_CONTACTS}, stored on this phone only)</Text>
      {contacts.map((c, i) => (
        <View key={i} style={st.row}><Text style={st.body}>{c.name}: {c.email || ''} {c.phone || ''}</Text>
          <Pressable onPress={() => save(contacts.filter((_, j) => j !== i), name)}><Text style={st.link}>Remove</Text></Pressable></View>))}
      {contacts.length < CG.MAX_CONTACTS ? <>
        <TextInput style={st.input} placeholder="Name" placeholderTextColor="#777" value={draft.name} onChangeText={(v) => setDraft({ ...draft, name: v })} />
        <TextInput style={st.input} placeholder="Email" placeholderTextColor="#777" autoCapitalize="none" keyboardType="email-address" value={draft.email} onChangeText={(v) => setDraft({ ...draft, email: v })} />
        <TextInput style={st.input} placeholder="Mobile number" placeholderTextColor="#777" keyboardType="phone-pad" value={draft.phone} onChangeText={(v) => setDraft({ ...draft, phone: v })} />
        <Pressable style={st.btn} onPress={() => { const c = CG.cleanContacts([...contacts, draft]); if (c.length > contacts.length) { save(c, name); setDraft({ name: '', email: '', phone: '' }); } else setStatus('Add a valid email or a 10+ digit phone number.'); }}><Text style={st.btnText}>Add contact</Text></Pressable>
      </> : null}
      <Text style={st.h}>Try it safely</Text>
      <View style={st.row}><Text style={st.body}>Really send a TEST alert to my contacts</Text><Switch value={sendRealTest} onValueChange={setSendRealTest} testID="cg-realtest" /></View>
      <Pressable style={st.btn} testID="cg-simulate" onPress={() => startPrompt(true)}><Text style={st.btnText}>Simulate a crash (test)</Text></Pressable>
      <Pressable style={st.btn} onPress={() => navigation && navigation.navigate('Collision', { ask: false })}><Text style={st.btnText}>I was in a collision: checklist</Text></Pressable>
    </ScrollView>
  );
}

const st = StyleSheet.create({
  scroll: { padding: 20, paddingBottom: 60 },
  warn: { color: '#ffd6a0', fontSize: 15, lineHeight: 22, backgroundColor: '#2a1a0a', padding: 12, borderRadius: 10 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, gap: 8 },
  h: { color: '#fff', fontSize: 18, fontWeight: '800', marginTop: 16 },
  body: { color: '#eef3f8', fontSize: 16, flex: 1 },
  small: { color: '#c5d1dc', fontSize: 14, marginTop: 6 },
  note: { color: '#ffd6a0', fontSize: 15, marginTop: 10 },
  link: { color: '#8cc8ff', fontWeight: '700' },
  input: { backgroundColor: '#161b22', color: '#fff', borderRadius: 8, padding: 10, marginTop: 8, fontSize: 16 },
  btn: { backgroundColor: '#30363d', borderRadius: 12, padding: 14, marginTop: 10, alignItems: 'center' },
  btnText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  alarm: { flex: 1, backgroundColor: '#b00020', alignItems: 'center', justifyContent: 'center', padding: 24 },
  alarmTitle: { color: '#fff', fontSize: 34, fontWeight: '900', textAlign: 'center' },
  count: { color: '#fff', fontSize: 96, fontWeight: '900' },
  alarmSub: { color: '#fff', fontSize: 15, textAlign: 'center', marginTop: 12 },
  ok: { backgroundColor: '#fff', borderRadius: 999, paddingVertical: 28, paddingHorizontal: 60, marginTop: 20 },
  okText: { color: '#b00020', fontSize: 34, fontWeight: '900' },
});
