/*
 * LYLO Mechanic hackathon v0.4.3: "Check the price" buttons + the VIN-decoded car line.
 * Buttons open the store's own public search page in the browser (Linking). Nothing is fetched.
 */
import React, { useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

/** Only https links ever leave the app (store, YouTube, Maps); anything else is refused. */
export function safeOpen(open) {
  const raw = open || ((u) => Linking.openURL(u).catch(() => {}));
  return (u) => (typeof u === 'string' && /^https:\/\//i.test(u) ? raw(u) : false);
}

export function PriceButtons({ p, open }) {
  const [near, setNear] = useState(false);
  if (!p) return null;
  const go = safeOpen(open);
  return (
    <View style={s.box} testID="price-buttons">
      <Text style={s.title}>{p.title}</Text>
      {p.estimate ? <Text style={s.est}>{p.estimate}</Text> : null}
      <View style={s.wrap}>
        {p.buttons.map((b) => (
          <Pressable key={b.store} onPress={() => go(b.url)} accessibilityRole="link" style={[s.btn, b.kind === 'online' && s.online]}>
            <Text style={s.btnText}>{b.store}</Text>
          </Pressable>
        ))}
      </View>
      {p.note ? <Text style={s.note}>{p.note}</Text> : null}
      {p.nearby ? (
        <>
          <Pressable onPress={() => setNear(!near)} accessibilityRole="button" style={s.wide} testID="find-nearest">
            <Text style={s.wideText}>{'\uD83D\uDCCD  '}Find nearest store</Text>
          </Pressable>
          {near ? (
            <View testID="nearest-list">
              <View style={s.wrap}>
                {p.nearby.map((n) => (
                  <Pressable key={n.id} onPress={() => go(n.url)} accessibilityRole="link" style={s.btn} testID={'near-' + n.id}>
                    <Text style={s.btnText}>{n.name}</Text>
                  </Pressable>
                ))}
              </View>
              <Text style={s.note}>Opens Google Maps near you. Maps uses your phone's location; LYLO doesn't see it.</Text>
            </View>
          ) : null}
        </>
      ) : null}
      {p.watch && p.watch.url ? (
        <>
          <Pressable onPress={() => go(p.watch.url)} accessibilityRole="link" style={[s.wide, s.yt]} testID="watch-how">
            <Text style={[s.wideText, { color: '#ffffff' }]}>{'\u25B6\uFE0F  '}{p.watch.text}</Text>
          </Pressable>
          <Text style={s.note}>{p.watch.note}</Text>
        </>
      ) : null}
    </View>
  );
}

export function VehicleLine({ v, open }) {
  if (!v) return null;
  const go = safeOpen(open);
  return (
    <View style={s.car} testID="vehicle-line">
      <Text style={s.carName}>{'\uD83D\uDE97  '}{v.name}</Text>
      <Text style={s.note}>{v.caveat}</Text>
      {v.recalls ? (
        <Pressable onPress={() => v.recalls.checkUrl && go(v.recalls.checkUrl)} accessibilityRole="link">
          <Text style={s.recall}>{v.recalls.text}</Text>
          <Text style={s.note}>Source: {v.recalls.source}. These are recalls for your model. Check your exact VIN at nhtsa.gov/recalls.</Text>
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
  wide: { backgroundColor: '#1b2330', borderRadius: 12, paddingVertical: 14, paddingHorizontal: 14, marginTop: 10, alignItems: 'center' },
  wideText: { color: '#8cc8ff', fontSize: 17, fontWeight: '800' },
  yt: { backgroundColor: '#c4302b' },
  btnText: { color: '#0a0c0f', fontSize: 16, fontWeight: '800' },
  note: { color: '#a9b7c4', fontSize: 14, lineHeight: 20, marginTop: 4 },
  car: { backgroundColor: '#141b24', borderRadius: 14, padding: 14, marginBottom: 16 },
  carName: { color: '#ffffff', fontSize: 20, fontWeight: '800' },
  recall: { color: '#ffb020', fontSize: 16, fontWeight: '700', marginTop: 8 },
});
