/*
 * LYLO Mechanic — shared UI pieces.
 */
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { C } from '../constants/colors';

export const LEVEL_COLORS = {
  red: C.red, orange: C.amber, yellow: C.amber, green: C.green, info: C.accent,
};

export function Card({ title, children, style, accent }) {
  return (
    <View style={[u.card, accent && { borderColor: accent + '88', backgroundColor: accent + '12' }, style]}>
      {title ? <Text style={u.cardTitle}>{title}</Text> : null}
      {children}
    </View>
  );
}

export function Badge({ text, color }) {
  const c = color || C.accent;
  return (
    <View style={[u.badge, { borderColor: c + '88', backgroundColor: c + '1f' }]}>
      <Text style={[u.badgeText, { color: c }]}>{text}</Text>
    </View>
  );
}

export function Button({ title, onPress, kind, disabled, busy, style }) {
  const secondary = kind === 'secondary';
  const danger = kind === 'danger';
  return (
    <TouchableOpacity
      activeOpacity={0.8}
      onPress={onPress}
      disabled={disabled || busy}
      style={[u.btn, secondary && u.btnSecondary, danger && u.btnDanger, (disabled || busy) && { opacity: 0.5 }, style]}>
      {busy ? <ActivityIndicator color="#fff" /> : (
        <Text style={[u.btnText, secondary && { color: C.text }, danger && { color: C.red }]}>{title}</Text>
      )}
    </TouchableOpacity>
  );
}

export function Bullet({ children, color }) {
  return (
    <View style={u.bulletRow}>
      <Text style={[u.bulletDot, color && { color }]}>{'\u2022'}</Text>
      <Text style={u.bulletText}>{children}</Text>
    </View>
  );
}

export function DemoBanner({ label }) {
  if (!label) return null;
  return (
    <View style={u.demo}>
      <Text style={u.demoText}>DEMO DATA — {label}</Text>
    </View>
  );
}

export const u = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  scroll: { padding: 16, paddingBottom: 48 },
  card: { backgroundColor: C.card, borderRadius: 12, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: C.border },
  cardTitle: { color: C.textDim, fontSize: 12, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 },
  h1: { color: C.textBright, fontSize: 22, fontWeight: '800' },
  h2: { color: C.textBright, fontSize: 17, fontWeight: '700' },
  body: { color: C.text, fontSize: 15, lineHeight: 22 },
  small: { color: C.textDim, fontSize: 13, lineHeight: 19 },
  mono: { color: C.text, fontSize: 11, fontFamily: 'monospace', lineHeight: 16 },
  badge: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, alignSelf: 'flex-start', marginRight: 6, marginTop: 4 },
  badgeText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
  btn: { backgroundColor: C.accent, borderRadius: 12, paddingVertical: 15, paddingHorizontal: 18, alignItems: 'center', marginTop: 10 },
  btnSecondary: { backgroundColor: C.card, borderWidth: 1, borderColor: C.borderLight },
  btnDanger: { backgroundColor: C.red + '14', borderWidth: 1, borderColor: C.red + '88' },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  bulletRow: { flexDirection: 'row', marginTop: 4 },
  bulletDot: { color: C.accent, fontSize: 15, width: 16, lineHeight: 22 },
  bulletText: { color: C.text, fontSize: 15, lineHeight: 22, flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  demo: { backgroundColor: C.gold + '22', borderColor: C.gold, borderWidth: 1, borderRadius: 8, padding: 8, marginBottom: 12 },
  demoText: { color: C.gold, fontSize: 12, fontWeight: '800', textAlign: 'center' },
});
