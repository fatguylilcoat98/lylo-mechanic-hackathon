/*
 * LYLO Mechanic hackathon v0.4.6: first-run setup. 3 questions, every one skippable:
 *   1. Do you have an OBD adapter?  2. Simple or Mechanic view  3. Your vehicle (VIN or year/make/model)
 * Shown once (lylo.setupDone); re-open from Home > Tools > Setup. Saves to lylo.viewMode / lylo.vehicle.
 */
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { C } from '../../../baseline/mobile/src/constants/colors';
import { firstRunOn, isSetupDone, saveAnswers, skip, manualVehicle, nextRoute } from './setup';
import { decodeVin, validateVin, vehicleSummary } from './vin';
import { configuredUrl, configuredKey } from './scanHook';
import { features } from './noAdapter';

let defaultStorage = null;
try { defaultStorage = require('@react-native-async-storage/async-storage').default; } catch (e) { defaultStorage = null; }

const Y = '#f5c518';

function Big({ title, onPress, kind, testID }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" testID={testID} style={[s.btn, kind === 'secondary' ? s.btn2 : null]}>
      <Text style={[s.btnText, kind === 'secondary' ? s.btnText2 : null]}>{title}</Text>
    </Pressable>
  );
}

/** Home calls this: opens Setup once on first launch (only when EXPO_PUBLIC_LYLO_FIRST_RUN=1). */
export function useFirstRunSetup(navigation, storage, on) {
  const store = storage === undefined ? defaultStorage : storage;
  const enabled = on === undefined ? firstRunOn() : on;
  useEffect(() => {
    if (!enabled || !navigation) return undefined;
    let live = true;
    isSetupDone(store).then((done) => { if (live && !done) navigation.navigate('Setup'); });
    return () => { live = false; };
  }, [enabled, store]);
  return enabled;
}

export default function SetupScreen({ navigation, storage, fetchImpl, baseUrl, appKey, noAdapterOn }) {
  const store = storage === undefined ? defaultStorage : storage;
  const naOn = noAdapterOn === undefined ? features().on : noAdapterOn;
  const [step, setStep] = useState(0);
  const [a, setA] = useState({ hasAdapter: null, viewMode: null, vehicle: null });
  const [vin, setVin] = useState('');
  const [ymm, setYmm] = useState({ year: '', make: '', model: '' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const go = (route) => { if (!navigation) return; if (navigation.reset) navigation.reset({ index: 0, routes: [{ name: route }] }); else navigation.navigate(route); };
  async function finish(ans) { await saveAnswers(store, ans); go(nextRoute(ans.hasAdapter, naOn)); }
  async function skipAll() { await skip(store); go('Home'); }
  const pick = (k, v) => { const n = { ...a, [k]: v }; setA(n); setStep(step + 1); };

  async function lookUp() {
    const v = validateVin(vin);
    if (!v.ok) { setMsg(v.reason); return; }
    setBusy(true); setMsg(null);
    const r = await decodeVin(v.vin, { baseUrl: baseUrl === undefined ? configuredUrl() : baseUrl, appKey: appKey === undefined ? configuredKey() : appKey, fetchImpl });
    setBusy(false);
    const sum = vehicleSummary(r);
    if (sum) await finish({ ...a, vehicle: sum }); else setMsg(r.message || "Couldn't look up that VIN. Try year, make and model instead.");
  }
  async function useYmm() {
    const v = manualVehicle(ymm.year, ymm.make, ymm.model);
    if (!v) { setMsg('Enter a 4-digit year, a make and a model (for example 2015 Ford F-150).'); return; }
    await finish({ ...a, vehicle: v });
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg || '#0a0c0f' }} contentContainerStyle={s.scroll} testID="setup-screen">
      <Text style={s.step}>Quick setup · {step + 1} of 3</Text>
      {step === 0 ? (
        <>
          <Text style={s.h1}>Do you have an OBD adapter?</Text>
          <Text style={s.body}>It's a small plug-in for the port under your dashboard. You don't need one to use LYLO.</Text>
          <Big title="Yes, I have one" onPress={() => pick('hasAdapter', true)} testID="setup-adapter-yes" />
          <Big title="No, not yet" onPress={() => pick('hasAdapter', false)} kind="secondary" testID="setup-adapter-no" />
        </>
      ) : step === 1 ? (
        <>
          <Text style={s.h1}>How should LYLO talk to you?</Text>
          <Big title="Simple: plain words, what to do next" onPress={() => pick('viewMode', 'simple')} testID="setup-view-simple" />
          <Big title="Mechanic: codes, readings and evidence" onPress={() => pick('viewMode', 'mechanic')} kind="secondary" testID="setup-view-mechanic" />
        </>
      ) : (
        <>
          <Text style={s.h1}>Your vehicle</Text>
          <Text style={s.body}>Your VIN gets recalls for your model and parts that fit. It's on the driver's door frame or the dash by the windshield.</Text>
          <TextInput testID="setup-vin" style={s.input} value={vin} onChangeText={(t) => setVin(t.toUpperCase())} placeholder="17-character VIN" placeholderTextColor="#7a8794" autoCapitalize="characters" maxLength={20} />
          {busy ? <ActivityIndicator color={Y} /> : <Big title="Look up my VIN" onPress={lookUp} testID="setup-vin-go" />}
          <Text style={s.or}>or</Text>
          <View style={s.row}>
            <TextInput testID="setup-year" style={[s.input, { flex: 1 }]} value={ymm.year} onChangeText={(t) => setYmm({ ...ymm, year: t })} placeholder="Year" placeholderTextColor="#7a8794" keyboardType="number-pad" maxLength={4} />
            <TextInput testID="setup-make" style={[s.input, { flex: 1.4 }]} value={ymm.make} onChangeText={(t) => setYmm({ ...ymm, make: t })} placeholder="Make" placeholderTextColor="#7a8794" />
            <TextInput testID="setup-model" style={[s.input, { flex: 1.4 }]} value={ymm.model} onChangeText={(t) => setYmm({ ...ymm, model: t })} placeholder="Model" placeholderTextColor="#7a8794" />
          </View>
          <Big title="Use year, make and model" onPress={useYmm} kind="secondary" testID="setup-ymm-go" />
          {msg ? <Text style={s.msg}>{msg}</Text> : null}
          <Big title="Skip this question" onPress={() => finish(a)} kind="secondary" testID="setup-skip-vehicle" />
        </>
      )}
      {step < 2 ? <Big title="Skip this question" onPress={() => setStep(step + 1)} kind="secondary" testID="setup-skip-q" /> : null}
      <Pressable onPress={skipAll} accessibilityRole="button" testID="setup-skip-all"><Text style={s.link}>Skip setup. You can open it any time from Home → Tools.</Text></Pressable>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  scroll: { padding: 18, paddingBottom: 48 },
  step: { color: '#8a97a4', fontSize: 15, marginBottom: 6 },
  h1: { color: '#ffffff', fontSize: 26, fontWeight: '800', marginBottom: 10 },
  body: { color: '#c5d1dc', fontSize: 17, lineHeight: 24, marginBottom: 12 },
  btn: { backgroundColor: Y, borderRadius: 14, paddingVertical: 18, paddingHorizontal: 16, marginTop: 10, alignItems: 'center' },
  btn2: { backgroundColor: '#1b2330' },
  btnText: { color: '#0a0c0f', fontSize: 19, fontWeight: '800', textAlign: 'center' },
  btnText2: { color: '#ffffff' },
  input: { backgroundColor: '#121a24', color: '#ffffff', borderRadius: 12, padding: 14, fontSize: 18, marginTop: 8, marginRight: 6 },
  row: { flexDirection: 'row' },
  or: { color: '#8a97a4', textAlign: 'center', marginTop: 12 },
  msg: { color: '#ffb4a2', fontSize: 16, marginTop: 10 },
  link: { color: '#8cc8ff', fontSize: 16, textAlign: 'center', marginTop: 22, textDecorationLine: 'underline' },
});
