/*
 * v0.7.3 (flag EXPO_PUBLIC_LYLO_SESSION_V2=1): vehicle identification + scan facts, shown first on results.
 * Raw car facts only (no AI text here). Renders nothing when the flag is off.
 */
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as S from './sessionV2';

const fmt = (iso) => { const d = new Date(iso); return isNaN(d.getTime()) ? '?' : d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };

export function StaleNotice() {
  return <View style={s.card} testID="session-stale"><Text style={s.warn}>This result is from an earlier scan, so it is hidden. Run a new scan.</Text></View>;
}

export default function SessionCard({ model, saved, onConfirm, onEnterVin, onScanAnother }) {
  const [raw, setRaw] = useState(false);
  if (!model) return null;
  const { idv, codes, session } = model;
  const Row = ({ l, v, id }) => <View style={s.row} testID={id}><Text style={s.label}>{l}</Text><Text style={s.val}>{v}</Text></View>;
  return (
    <View testID="session-card">
      <View style={s.card} testID="vehicle-id">
        <Text style={s.title}>VEHICLE IDENTIFICATION</Text>
        <Text style={idv.status === 'unknown' ? s.warn : s.ok} testID="vehicle-status">{S.STATUS_LABEL[idv.status]}</Text>
        <Row l="VIN" v={idv.vin || 'Not read from the car'} id="vehicle-vin" />
        <Row l="Vehicle" v={idv.name || 'Unknown'} />
        {idv.engine ? <Row l="Engine (VIN decoder, unverified)" v={idv.engine} /> : null}
        {idv.source ? <Text style={s.small}>{'Source: ' + idv.source}</Text> : null}
        {idv.status === 'unknown' ? <>
          <Text style={s.small}>LYLO could not read a valid VIN from this car, so it will not guess which car this is.</Text>
          {saved && saved.name && onConfirm ? <Pressable accessibilityRole="button" testID="confirm-saved" style={s.btn} onPress={onConfirm}><Text style={s.btnText}>{'This is my ' + saved.name}</Text></Pressable> : null}
          {onEnterVin ? <Pressable accessibilityRole="button" testID="enter-vin" style={s.btn} onPress={onEnterVin}><Text style={s.btnText}>Enter this car's VIN</Text></Pressable> : null}
        </> : null}
      </View>
      <View style={s.card} testID="scan-status">
        <Text style={s.title}>THIS SCAN</Text>
        {session ? <Text style={s.small} testID="session-line">{`Scan ${session.id} · ${fmt(session.scannedAt)} · adapter ${session.adapterId}`}</Text> : null}
        <Text style={codes.mil ? s.warn : s.ok} testID="mil-status">{codes.milText}</Text>
        <Row l="Stored (confirmed)" v={codes.stored.join(', ') || 'None'} id="codes-stored" />
        <Row l="Pending" v={codes.pending.join(', ') || 'None'} id="codes-pending" />
        <Row l="Permanent" v={codes.permanentSupported ? (codes.permanent.join(', ') || 'None') : 'Not supported'} id="codes-permanent" />
        {codes.notes.map((n) => <Text key={n} style={s.small}>{n}</Text>)}
        {model.afterClear ? <View testID="after-clear"><Text style={s.h}>After clearing</Text>{model.afterClear.map((t) => <Text key={t} style={s.small}>{t}</Text>)}<Text style={s.small}>Clearing codes does not fix the fault.</Text></View> : null}
      </View>
      <View style={s.card} testID="counters">
        <Text style={s.title}>CAR COUNTERS</Text>
        {model.counters.map((c) => <Row key={c.pid} l={`${c.label} (PID ${c.pid})`} v={c.value} />)}
        <Text style={s.small}>{model.counterNote}</Text>
      </View>
      <View style={s.card} testID="live-readings">
        <Text style={s.title}>LIVE READINGS</Text>
        {model.readings.map((g) => <View key={g.group}><Text style={s.h}>{g.group}</Text>{g.rows.map((r) => <Row key={r.pid} l={`${r.label} (${r.pid})`} v={r.value} />)}</View>)}
        <Pressable accessibilityRole="button" testID="raw-toggle" style={s.btn} onPress={() => setRaw(!raw)}><Text style={s.btnText}>{raw ? 'Hide raw data' : 'Show raw data'}</Text></Pressable>
        {raw ? <Text style={s.mono} testID="raw-data">{JSON.stringify(model.raw, null, 1)}</Text> : null}
      </View>
      {onScanAnother ? <Pressable accessibilityRole="button" testID="scan-another" style={[s.btn, s.big]} onPress={onScanAnother}><Text style={s.btnText}>Scan another vehicle / Start fresh scan</Text></Pressable> : null}
    </View>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: '#11161f', borderColor: '#24406a', borderWidth: 1, borderRadius: 16, padding: 16, marginBottom: 14 },
  title: { color: '#7fb8ff', fontSize: 14, fontWeight: '900', letterSpacing: 1, marginBottom: 8 },
  h: { color: '#ffffff', fontSize: 16, fontWeight: '800', marginTop: 10 },
  ok: { color: '#7be3a0', fontSize: 17, fontWeight: '800', marginBottom: 6 },
  warn: { color: '#ffb4a8', fontSize: 17, fontWeight: '800', marginBottom: 6 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, gap: 12 },
  label: { color: '#c5d1dc', fontSize: 15, flex: 1 },
  val: { color: '#ffffff', fontSize: 15, fontWeight: '700', flexShrink: 1, textAlign: 'right' },
  small: { color: '#aebbc8', fontSize: 14, lineHeight: 20, marginTop: 4 },
  mono: { color: '#c5d1dc', fontFamily: 'monospace', fontSize: 12, marginTop: 8 },
  btn: { minHeight: 48, justifyContent: 'center', alignItems: 'center', borderRadius: 12, backgroundColor: '#1d3557', marginTop: 10, paddingHorizontal: 12 },
  big: { backgroundColor: '#2563eb', marginBottom: 14 },
  btnText: { color: '#ffffff', fontSize: 16, fontWeight: '800' },
});
