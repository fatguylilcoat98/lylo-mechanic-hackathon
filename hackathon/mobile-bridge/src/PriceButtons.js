/*
 * LYLO Mechanic hackathon v0.4.3: "Check the price" buttons + the VIN-decoded car line.
 * Buttons open the store's own public search page in the browser (Linking). Nothing is fetched.
 */
import React from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

export function PriceButtons({ p, open }) {
  if (!p) return null;
  const go = open || ((u) => Linking.openURL(u).catch(() => {}));
  return (
    <View style={s.box} testID="price-buttons">
      <Text style={s.title}>{p.title}</Text>
      <Text style={s.est}>{p.estimate}</Text>
      <View style={s.wrap}>
        {p.buttons.map((b) => (
          <Pressable key={b.store} onPress={() => go(b.url)} accessibilityRole="link" style={[s.btn, b.kind === 'online' && s.online]}>
            <Text style={s.btnText}>{b.store}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={s.note}>{p.note}</Text>
    </View>
  );
}

export function VehicleLine({ v, open }) {
  if (!v) return null;
  const go = open || ((u) => Linking.openURL(u).catch(() => {}));
  return (
    <View style={s.car} testID="vehicle-line">
      <Text style={s.carName}>{'\uD83D\uDE97  '}{v.name}</Text>
      <Text style={s.note}>{v.caveat}</Text>
      {v.recalls ? (
        <Pressable onPress={() => v.recalls.checkUrl && go(v.recalls.checkUrl)} accessibilityRole="link">
          <Text style={s.recall}>{v.recalls.text}</Text>
          <Text style={s.note}>Source: {v.recalls.source}. Check your exact VIN at nhtsa.gov/recalls.</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  box: { backgroundColor: '#141b24', borderRadius: 16, padding: 16, marginTop: 14 },
  title: { color: '#ffffff', fontSize: 18, fontWeight: '800' },
  est: { color: '#ffd60a', fontSize: 16, fontWeight: '700', marginTop: 4 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 10 },
  btn: { backgroundColor: '#ffffff', borderRadius: 12, paddingVertical: 12, paddingHorizontal: 14, marginRight: 8, marginBottom: 8 },
  online: { backgroundColor: '#cfe6ff' },
  btnText: { color: '#0a0c0f', fontSize: 16, fontWeight: '800' },
  note: { color: '#a9b7c4', fontSize: 14, lineHeight: 20, marginTop: 4 },
  car: { backgroundColor: '#141b24', borderRadius: 14, padding: 14, marginBottom: 16 },
  carName: { color: '#ffffff', fontSize: 20, fontWeight: '800' },
  recall: { color: '#ffb020', fontSize: 16, fontWeight: '700', marginTop: 8 },
});
