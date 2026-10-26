/* Hackathon: one-line note in the Codes summary card when the server is stricter. Renders nothing otherwise. */
import React from 'react';
import { Text } from 'react-native';
import { u } from '../../../baseline/mobile/src/components/ui';
import { C } from '../../../baseline/mobile/src/constants/colors';
import { codesNote } from './verdictView';

export const NOTE_COLOR = { amber: C.amber, red: C.red, green: C.green };

export default function CodesVerdictNote({ scan, count, mil }) {
  const n = codesNote(scan, count, mil);
  if (!n) return null;
  return <Text style={[u.body, { marginTop: 6, color: NOTE_COLOR[n.tone] || C.amber, fontWeight: '700' }]}>{n.text}</Text>;
}
