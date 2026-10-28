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
import * as EO from './engineOverride';

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

/** v0.4.8 "Not my engine?": fuel + optional engine name, saved on the phone. Shown only with the flag. */
export function EngineEditor({ vin, current, onSave }) {
  const [open, setOpen] = useState(false);
  const [fuel, setFuel] = useState(current ? current.fuel : '');
  const [name, setName] = useState(current ? current.engine : '');
  if (!open) {
    return <Big title={current ? 'Change my engine' : 'Not my engine?'} onPress={() => { setFuel(current ? current.fuel : ''); setName(current ? current.engine : ''); setOpen(true); }} kind="secondary" testID="eo-open" />;
  }
  return (
    <View style={s.eoBox} testID="eo-editor">
      <Text style={s.label}>What fuel does your engine use?</Text>
      <View style={s.eoRow}>
        {EO.FUELS.map((f) => (
          <Pressable key={f.id} onPress={() => setFuel(f.id)} accessibilityRole="button" accessibilityState={{ selected: fuel === f.id }} testID={`eo-fuel-${f.id}`}
            style={[s.chip, fuel === f.id && s.chipOn]}><Text style={[s.chipText, fuel === f.id && s.chipTextOn]}>{f.label}</Text></Pressable>
        ))}
      </View>
      <Text style={s.label}>Engine size or name (optional)</Text>
      <TextInput value={name} onChangeText={setName} maxLength={EO.MAX_ENGINE} placeholder="for example 6.8L V10 Triton" placeholderTextColor="#6b7a89" style={s.input2} testID="eo-name" accessibilityLabel="Engine" />
      <Big title="Save my engine" testID="eo-save" onPress={async () => { const o = EO.makeOverride(fuel, name, vin); if (o) { await onSave(o); setOpen(false); } }} />
      {current ? <Big title="Use the NHTSA engine instead" kind="secondary" testID="eo-clear" onPress={async () => { await onSave(null); setOpen(false); }} /> : null}
      <Big title="Cancel" kind="secondary" testID="eo-cancel" onPress={() => setOpen(false)} />
    </View>
  );
}

export default function VinScreen({ navigation, storage, picker, fetchImpl, baseUrl, appKey, engineOverrideOn }) {
  const store = storage === undefined ? defaultStorage : storage;
  const pick = picker === undefined ? defaultPicker : picker;
  const url = baseUrl === undefined ? configuredUrl() : baseUrl;
  const key = appKey === undefined ? configuredKey() : appKey;
  const [vin, setVin] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [vehicle, setVehicle] = useState(null);
  const eoOn = engineOverrideOn === undefined ? EO.features().on : !!engineOverrideOn;
  const [eo, setEo] = useState(null); // v0.4.8 owner-set engine (flag only)
  const [hint, setHint] = useState(null);
  useEffect(() => { if (!eoOn) return undefined; let live = true; EO.load(store).then((o) => { if (live) setEo(o); }); return () => { live = false; }; }, [store, eoOn]);
  useEffect(() => { let live = true; loadVehicle(store).then((v) => { if (live && v) { setVehicle(v); setVin(v.vin || ''); } }); return () => { live = false; }; }, [store]);

  async function lookUp(value) {
    const v = validateVin(value);
    if (!v.ok) { setMsg(v.reason); return; }
    setBusy(true); setMsg(null);
    const r = await decodeVin(v.vin, { baseUrl: url, appKey: key, fetchImpl });
    setBusy(false);
    const sum = vehicleSummary(r);
    if (eoOn) setHint(sum && r.engineHint ? r.engineHint : null);
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

  const forget = async () => { await saveVehicle(store, null); if (eoOn) { await EO.save(store, null); setEo(null); setHint(null); } setVehicle(null); setVin(''); setMsg('Removed your car from this phone.'); };
  const myEo = eoOn && eo && vehicle && (!eo.vin || eo.vin === vehicle.vin) ? eo : null;

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.scroll}>
      <Text style={s.h}>Your car</Text>
      <Text style={s.body}>Your VIN tells LYLO the exact year, make, model and engine, so the help fits your car. It's 17 characters, on the dashboard by the windshield (driver side) or on the driver door frame sticker.</Text>
      {vehicle && !myEo ? <VehicleLine v={{ name: vehicle.name, caveat: `${vehicle.engine ? vehicle.engine + ', ' : ''}${vehicle.caveat}. Source: ${vehicle.source}.`, recalls: vehicle.recalls }} /> : null}
      {vehicle && myEo ? <VehicleLine v={{ name: vehicle.name, caveat: `Engine set by you: ${EO.label(myEo)}`, recalls: vehicle.recalls }} /> : null}
      {vehicle && myEo ? <Text style={s.fine2} testID="eo-nhtsa">NHTSA decode: {vehicle.engine || 'no engine listed'} (may be wrong for this VIN). Source: {vehicle.source}.</Text> : null}
      {vehicle && eoOn && hint && !myEo ? <Text style={s.msg} testID="eo-hint">{hint}</Text> : null}
      {vehicle && eoOn ? <EngineEditor vin={vehicle.vin} current={myEo} onSave={async (o) => { await EO.save(store, o); setEo(o); }} /> : null}
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
  fine2: { color: '#a9b7c4', fontSize: 13, lineHeight: 18, marginTop: -8, marginBottom: 8 },
  eoBox: { backgroundColor: '#141b24', borderRadius: 14, padding: 14, marginTop: 12 },
  eoRow: { flexDirection: 'row', flexWrap: 'wrap' },
  chip: { backgroundColor: '#1b2330', borderRadius: 12, paddingVertical: 12, paddingHorizontal: 14, marginRight: 8, marginBottom: 8 },
  chipOn: { backgroundColor: '#ffd60a' },
  chipText: { color: '#ffffff', fontSize: 17, fontWeight: '700' },
  chipTextOn: { color: '#0a0c0f' },
  input2: { backgroundColor: '#ffffff', color: '#0a0c0f', fontSize: 18, borderRadius: 12, padding: 12 },
});
