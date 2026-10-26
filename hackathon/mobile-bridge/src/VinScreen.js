/*
 * LYLO Mechanic hackathon v0.4.3: "Your car" (VIN-first).
 * Type the VIN, or take a photo of it (Meta AI reads it; only accepted if the check digit passes).
 * The server decodes it with NHTSA vPIC. Saved on the phone under 'lylo.vehicle'.
 */
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { C } from '../../../baseline/mobile/src/constants/colors';
import { configuredUrl, configuredKey } from './scanHook';
import { validateVin, decodeVin, readVinPhoto, vehicleSummary, loadVehicle, saveVehicle } from './vin';
import { VehicleLine } from './PriceButtons';

let defaultStorage = null;
try { defaultStorage = require('@react-native-async-storage/async-storage').default; } catch (e) { defaultStorage = null; }
let defaultPicker = null;
try { defaultPicker = require('expo-image-picker'); } catch (e) { defaultPicker = null; }

function Big({ title, onPress, kind, testID }) {
  return (
    <Pressable onPress={onPress} testID={testID} accessibilityRole="button" style={[s.btn, kind === 'secondary' && s.btn2]}>
      <Text style={s.btnText}>{title}</Text>
    </Pressable>
  );
}

export default function VinScreen({ navigation, storage, picker, fetchImpl, baseUrl, appKey }) {
  const store = storage === undefined ? defaultStorage : storage;
  const pick = picker === undefined ? defaultPicker : picker;
  const url = baseUrl === undefined ? configuredUrl() : baseUrl;
  const key = appKey === undefined ? configuredKey() : appKey;
  const [vin, setVin] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [vehicle, setVehicle] = useState(null);
  useEffect(() => { let live = true; loadVehicle(store).then((v) => { if (live && v) { setVehicle(v); setVin(v.vin || ''); } }); return () => { live = false; }; }, [store]);

  async function lookUp(value) {
    const v = validateVin(value);
    if (!v.ok) { setMsg(v.reason); return; }
    setBusy(true); setMsg(null);
    const r = await decodeVin(v.vin, { baseUrl: url, appKey: key, fetchImpl });
    setBusy(false);
    const sum = vehicleSummary(r);
    if (sum) { setVehicle(sum); await saveVehicle(store, sum); setMsg(null); } else setMsg(r.message);
  }

  async function photo() {
    setMsg(null);
    if (!pick) { setMsg('The camera is not available in this build. Type the VIN instead.'); return; }
    try {
      const perm = await pick.requestCameraPermissionsAsync();
      if (!perm || !perm.granted) { setMsg('LYLO needs camera permission for this. You can type the VIN instead.'); return; }
      const r = await pick.launchCameraAsync({ quality: 0.8, exif: false });
      if (!r || r.canceled || !r.assets || !r.assets[0]) return;
      const a = r.assets[0];
      setBusy(true);
      const out = await readVinPhoto({ uri: a.uri, type: a.mimeType || 'image/jpeg', name: 'vin.jpg' }, { baseUrl: url, appKey: key, fetchImpl });
      setBusy(false);
      if (out.status === 'read') { setVin(out.vin); setMsg(out.message); } else setMsg(out.message);
    } catch (e) { setBusy(false); setMsg("I couldn't read the VIN clearly. Type it in instead, or try a sharper photo."); }
  }

  const forget = async () => { await saveVehicle(store, null); setVehicle(null); setVin(''); setMsg('Removed your car from this phone.'); };

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.scroll}>
      <Text style={s.h}>Your car</Text>
      <Text style={s.body}>Your VIN tells LYLO the exact year, make, model and engine, so the help fits your car. It's 17 characters, on the dashboard by the windshield (driver side) or on the driver door frame sticker.</Text>
      {vehicle ? <VehicleLine v={{ name: vehicle.name, caveat: `${vehicle.engine ? vehicle.engine + ', ' : ''}${vehicle.caveat}. Source: ${vehicle.source}.`, recalls: vehicle.recalls }} /> : null}
      <Text style={s.label}>Type VIN</Text>
      <TextInput value={vin} onChangeText={(t) => setVin(t.toUpperCase())} autoCapitalize="characters" autoCorrect={false} maxLength={20}
        placeholder="17 characters" placeholderTextColor="#6b7a89" style={s.input} testID="vin-input" accessibilityLabel="VIN" />
      {busy ? <ActivityIndicator size="large" color="#ffd60a" style={{ marginVertical: 16 }} /> : (
        <>
          <Big title="Look up my car" onPress={() => lookUp(vin)} testID="vin-lookup" />
          <Big title="Photo of VIN" onPress={photo} kind="secondary" testID="vin-photo" />
        </>
      )}
      {msg ? <Text style={s.msg} testID="vin-msg">{msg}</Text> : null}
      {vehicle ? <Big title="Forget my car" onPress={forget} kind="secondary" /> : null}
      <Text style={s.fine}>Lookup by NHTSA (U.S. government, free). The VIN itself is never sent to Meta AI; only the year, make, model and engine are. Powered by Meta AI for reading a VIN photo.</Text>
      <Big title="Home" onPress={() => navigation && navigation.navigate('Home')} kind="secondary" />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  scroll: { padding: 20, paddingBottom: 48 },
  h: { color: '#ffffff', fontSize: 28, fontWeight: '900', marginBottom: 12 },
  body: { color: '#eef3f8', fontSize: 17, lineHeight: 25, marginBottom: 16 },
  label: { color: '#c5d1dc', fontSize: 17, marginBottom: 6, marginTop: 6 },
  input: { backgroundColor: '#ffffff', color: '#0a0c0f', fontSize: 22, fontWeight: '700', letterSpacing: 2, borderRadius: 12, padding: 14, fontFamily: 'monospace' },
  btn: { backgroundColor: '#1f6feb', borderRadius: 14, padding: 18, alignItems: 'center', marginTop: 12 },
  btn2: { backgroundColor: '#1b2330' },
  btnText: { color: '#ffffff', fontSize: 19, fontWeight: '800' },
  msg: { color: '#ffd60a', fontSize: 17, fontWeight: '700', marginTop: 14, lineHeight: 24 },
  fine: { color: '#a9b7c4', fontSize: 14, lineHeight: 20, marginTop: 20 },
});
