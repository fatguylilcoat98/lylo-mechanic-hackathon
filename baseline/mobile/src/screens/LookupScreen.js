/*
 * LYLO Mechanic — offline code lookup.
 */
import React, { useMemo, useState } from 'react';
import { Text, TextInput, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { searchCodes, buildCodeResult } from '../engine/diagnose';
import { CODES } from '../data/dtcCodes';
import { Card, Button, u } from '../components/ui';
import { C } from '../constants/colors';

export default function LookupScreen({ navigation }) {
  const [q, setQ] = useState('');
  const hits = useMemo(() => searchCodes(q), [q]);
  const exact = /^[PCBU][0-9A-F]{4}$/i.test(q.trim());
  return (
    <ScrollView style={u.screen} contentContainerStyle={u.scroll} keyboardShouldPersistTaps="handled">
      <TextInput
        style={s.input}
        value={q}
        onChangeText={setQ}
        placeholder="Type a code (P0420) or words (gas cap)"
        placeholderTextColor={C.textDim}
        autoCapitalize="characters"
        autoCorrect={false}
      />
      <Text style={[u.small, { marginBottom: 10 }]}>{CODES.length} common codes available offline.</Text>
      {exact && !hits.some((h) => h.code === q.trim().toUpperCase()) ? (
        <Button title={'Explain ' + q.trim().toUpperCase()} onPress={() => navigation.navigate('CodeDetail', { code: q.trim().toUpperCase(), result: buildCodeResult(q) })} />
      ) : null}
      {hits.map((h) => (
        <TouchableOpacity key={h.code} onPress={() => navigation.navigate('CodeDetail', { code: h.code, result: buildCodeResult(h.code) })}>
          <Card>
            <Text style={s.code}>{h.code}</Text>
            <Text style={u.body}>{h.t}</Text>
          </Card>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  input: { backgroundColor: C.input, color: C.textBright, borderWidth: 1, borderColor: C.borderLight, borderRadius: 10, padding: 14, fontSize: 17, marginBottom: 8 },
  code: { color: C.accent, fontSize: 17, fontWeight: '800' },
});
