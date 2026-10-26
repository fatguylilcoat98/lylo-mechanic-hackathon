/*
 * LYLO Mechanic hackathon build (Oct 26, 2026 onward).
 * Card showing scan.serverDiagnosis on the results screens.
 * Renders nothing when serverDiagnosis is absent (flag unset = old screens).
 * Also shows the Muse Detective card when the server ran it (see DetectiveCard).
 */
import React from 'react';
import { Text } from 'react-native';
import { Card, u } from '../../../baseline/mobile/src/components/ui';
import { C } from '../../../baseline/mobile/src/constants/colors';
import { diagnosisView } from './diagnosisView';
import DetectiveCard from './DetectiveCard';

const TONE = { red: C.red, amber: C.amber, green: C.green, info: C.accent };

export default function ServerDiagnosisCard({ scan }) {
  const v = diagnosisView(scan);
  if (!v) return null;
  const color = TONE[v.tone] || C.accent;
  return (
    <>
    <Card title="Safety check" accent={color}>
      <Text style={[u.h2, { color }]}>{v.levelLabel}</Text>
      <Text style={u.small}>Source: {v.sourceLabel}</Text>
      {v.reason ? <Text style={u.small}>Why: {v.reason}</Text> : null}
    </Card>
    <DetectiveCard scan={scan} />
    </>
  );
}
