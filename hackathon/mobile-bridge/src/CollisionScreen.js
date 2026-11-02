/*
 * v0.6 After-a-collision checklist (flag EXPO_PUBLIC_LYLO_COLLISION=1). Logic in ./collision.js.
 * Photos stay on the phone; "Send to my email" opens the phone's mail app with the report and photos attached
 * (expo-mail-composer), addressed to the user's own email. Nothing goes to LYLO's server. Not legal/insurance advice.
 */
import React, { useEffect, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
let AsyncStorage = null;
try { AsyncStorage = require('@react-native-async-storage/async-storage').default; } catch (e) { AsyncStorage = null; }
const mem = {}; // fallback when storage is unavailable (tests): nothing persists
const Store = { getItem: async (k) => { try { return AsyncStorage ? await AsyncStorage.getItem(k) : (mem[k] || null); } catch (e) { return mem[k] || null; } },
  setItem: async (k, v) => { try { if (AsyncStorage) await AsyncStorage.setItem(k, v); else mem[k] = v; } catch (e) { mem[k] = v; } } };
import * as COL from './collision';

let ImagePicker = null; let Mail = null; let Location = null;
try { ImagePicker = require('expo-image-picker'); } catch (e) { ImagePicker = null; }
try { Mail = require('expo-mail-composer'); } catch (e) { Mail = null; }
try { Location = require('expo-location'); } catch (e) { Location = null; }
const KEY = 'lylo.collision.myemail.v1';

export default function CollisionScreen({ navigation, route, env }) {
  const [asked, setAsked] = useState(!(route && route.params && route.params.ask));
  const [at] = useState(Date.now());
  const [loc, setLoc] = useState(null);
  const [photos, setPhotos] = useState({});
  const [fields, setFields] = useState({});
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState(null);

  useEffect(() => { Store.getItem(KEY).then((v) => setEmail(v || '')); }, []);
  useEffect(() => { if (!asked || !Location) return; (async () => {
    try { const p = await Location.requestForegroundPermissionsAsync(); if (p.granted) { const c = (await Location.getCurrentPositionAsync({})).coords; setLoc({ lat: c.latitude, lon: c.longitude }); } } catch (e) { /* no GPS: report says not available */ }
  })(); }, [asked]);

  async function snap(id) {
    if (!ImagePicker) return;
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) { setMsg('Camera permission is off. You can still fill in the fields.'); return; }
    const r = await ImagePicker.launchCameraAsync({ quality: 0.6, exif: false });
    if (!r.canceled && r.assets && r.assets[0]) setPhotos({ ...photos, [id]: [...(photos[id] || []), r.assets[0].uri] });
  }

  async function send() {
    const rep = COL.buildReport({ at, loc, photos, fields });
    if (email) Store.setItem(KEY, email);
    if (Mail && await Mail.isAvailableAsync()) {
      await Mail.composeAsync({ recipients: email ? [email] : [], subject: rep.subject, body: rep.body, attachments: rep.attachments });
    } else {
      setMsg('No mail app is set up on this phone. Opening a plain email without photos instead.');
      Linking.openURL(`mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(rep.subject)}&body=${encodeURIComponent(rep.body)}`).catch(() => {});
    }
  }

  if (!COL.features(env).on) return null;
  if (!asked) {
    return (
      <View style={st.center} testID="col-ask">
        <Text style={st.big}>Glad you're OK.</Text>
        <Text style={st.big}>Were you in a collision?</Text>
        <Pressable style={st.btn} onPress={() => setAsked(true)} testID="col-yes"><Text style={st.btnText}>Yes, help me with the next steps</Text></Pressable>
        <Pressable style={st.btn2} onPress={() => navigation && navigation.goBack()} testID="col-no"><Text style={st.btnText}>No, false alarm</Text></Pressable>
      </View>
    );
  }
  return (
    <ScrollView style={{ flex: 1, backgroundColor: '#0a0c0f' }} contentContainerStyle={{ padding: 20, paddingBottom: 60 }} testID="col-screen">
      <Text style={st.note}>{COL.NOT_ADVICE}</Text>
      <Text style={st.h}>1. Safety first</Text>
      <Pressable style={st.red} onPress={() => Linking.openURL('tel:911')}><Text style={st.btnText}>Call 911</Text></Pressable>
      {COL.SAFETY.map((t) => <Text key={t} style={st.body}>{'\u2022 '}{t}</Text>)}
      <Text style={st.small}>Time: {new Date(at).toLocaleString()} {'\u00B7'} GPS: {loc ? `${loc.lat.toFixed(5)}, ${loc.lon.toFixed(5)}` : 'not available yet'}</Text>
      <Text style={st.h}>2. Photos (stay on your phone)</Text>
      {COL.PHOTO_STEPS.map((s) => (
        <Pressable key={s.id} style={st.step} onPress={() => snap(s.id)} testID={'col-photo-' + s.id}>
          <Text style={st.body}>{(photos[s.id] || []).length ? '\u2705 ' : '\uD83D\uDCF7 '}{s.label}</Text>
          <Text style={st.small}>{(photos[s.id] || []).length} photo(s). Tap to add.</Text>
        </Pressable>))}
      <Text style={st.h}>3. Details</Text>
      {COL.FIELDS.map(([k, label]) => (
        <TextInput key={k} testID={'col-field-' + k} style={st.input} placeholder={label} placeholderTextColor="#777" multiline={k === 'notes' || k === 'witnesses'}
          value={fields[k] || ''} onChangeText={(v) => setFields({ ...fields, [k]: v.slice(0, 500) })} />))}
      <Text style={st.h}>4. Send it to yourself</Text>
      <TextInput style={st.input} placeholder="My email" placeholderTextColor="#777" autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} />
      <Pressable style={st.btn} onPress={send} testID="col-send"><Text style={st.btnText}>Send to my email</Text></Pressable>
      <Text style={st.small}>Opens your mail app with the report and photos attached. Forward it to your insurer. LYLO does not keep a copy.</Text>
      {msg ? <Text style={st.note}>{msg}</Text> : null}
    </ScrollView>
  );
}

const st = StyleSheet.create({
  center: { flex: 1, backgroundColor: '#0a0c0f', justifyContent: 'center', padding: 24 },
  big: { color: '#fff', fontSize: 28, fontWeight: '900', textAlign: 'center', marginBottom: 12 },
  h: { color: '#fff', fontSize: 20, fontWeight: '800', marginTop: 20 },
  body: { color: '#eef3f8', fontSize: 16, lineHeight: 23, marginTop: 4 },
  small: { color: '#c5d1dc', fontSize: 14, marginTop: 4 },
  note: { color: '#ffd6a0', fontSize: 14, lineHeight: 20 },
  input: { backgroundColor: '#161b22', color: '#fff', borderRadius: 8, padding: 10, marginTop: 8, fontSize: 16 },
  step: { backgroundColor: '#121a24', borderRadius: 10, padding: 12, marginTop: 8 },
  btn: { backgroundColor: '#1f6feb', borderRadius: 12, padding: 16, marginTop: 12, alignItems: 'center' },
  btn2: { backgroundColor: '#30363d', borderRadius: 12, padding: 16, marginTop: 12, alignItems: 'center' },
  red: { backgroundColor: '#b00020', borderRadius: 12, padding: 16, marginTop: 10, alignItems: 'center' },
  btnText: { color: '#fff', fontSize: 18, fontWeight: '800' },
});
