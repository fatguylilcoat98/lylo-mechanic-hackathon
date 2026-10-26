/*
 * LYLO Mechanic hackathon build (Oct 26, 2026 onward).
 * Muse Detective card: cleared-codes red flag, ranked hypotheses with confidence,
 * tap a claim to see its cited evidence, unverified labels, and a receipt line.
 * Renders nothing unless result.detective.muse_status is 'ok' (see detectiveView).
 */
import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Card, u } from '../../../baseline/mobile/src/components/ui';
import { C } from '../../../baseline/mobile/src/constants/colors';
import { detectiveView } from './detectiveView';

const CONF_COLOR = { high: C.red, medium: C.amber, low: C.accent };

function Evidence({ items }) {
  return (
    <View style={{ marginTop: 6, paddingLeft: 10, borderLeftWidth: 2, borderLeftColor: C.borderLight }}>
      {items.length === 0 ? <Text style={u.small}>No evidence cited.</Text> : null}
      {items.map((e) => (
        <Text key={e.id} style={[u.small, { color: e.found ? C.text : C.amber }]}>
          {e.found ? '• ' : '⚠ '}{e.label}
        </Text>
      ))}
    </View>
  );
}

function Claim({ id, open, toggle, children, evidence }) {
  const isOpen = open.has(id);
  return (
    <Pressable onPress={() => toggle(id)} accessibilityRole="button"
      accessibilityLabel={isOpen ? 'Hide evidence' : 'Show evidence'} style={{ marginTop: 10 }}>
      {children}
      <Text style={[u.small, { color: C.accent }]}>{isOpen ? 'Hide evidence ▲' : `Show evidence (${evidence.length}) ▼`}</Text>
      {isOpen ? <Evidence items={evidence} /> : null}
    </Pressable>
  );
}

export default function DetectiveCard({ scan }) {
  const v = detectiveView(scan);
  const [open, setOpen] = useState(() => new Set());
  if (!v) return null;
  const toggle = (id) => setOpen((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  return (
    <Card title="Muse Detective" accent={v.clearedWarning ? C.red : C.accent}>
      {v.clearedWarning ? (
        <View style={{ backgroundColor: C.red + '1A', borderColor: C.red, borderWidth: 1, borderRadius: 8, padding: 10, marginBottom: 6 }}>
          <Text style={[u.h2, { color: C.red }]}>Red flag: codes were cleared recently</Text>
          <Claim id="cleared" open={open} toggle={toggle} evidence={v.clearedWarning.evidence}>
            <Text style={u.body}>{v.clearedWarning.text}</Text>
          </Claim>
        </View>
      ) : null}
      {v.explanation ? (
        <Claim id="explanation" open={open} toggle={toggle} evidence={v.explanation.evidence}>
          <Text style={u.body}>{v.explanation.text}</Text>
        </Claim>
      ) : null}
      {v.hypotheses.map((h) => (
        <Claim key={h.key} id={h.key} open={open} toggle={toggle} evidence={h.evidence}>
          <Text style={u.h2}>{h.rank}. {h.cause}</Text>
          <Text style={[u.small, { color: CONF_COLOR[h.confidence] || C.accent, fontWeight: '700' }]}>{h.confidenceLabel}</Text>
          {h.reasoning ? <Text style={u.body}>{h.reasoning}</Text> : null}
          {h.nextCheck ? <Text style={u.small}>Next check: {h.nextCheck}</Text> : null}
        </Claim>
      ))}
      {v.unverified.map((x) => (
        <View key={x.key} style={{ marginTop: 10 }}>
          <Text style={[u.small, { color: C.amber, fontWeight: '800' }]}>UNVERIFIED · {x.kind}</Text>
          <Text style={[u.small, { textDecorationLine: 'line-through' }]}>{x.text}</Text>
          <Text style={u.small}>{x.label}{x.missingIds.length ? `: ${x.missingIds.join(', ')}` : ''}</Text>
        </View>
      ))}
      {v.safetyNote ? <Text style={[u.small, { marginTop: 10, color: C.amber }]}>{v.safetyNote}</Text> : null}
      {v.receipt ? <Text style={[u.mono, { marginTop: 10, color: C.textDim }]}>{v.receipt}</Text> : null}
    </Card>
  );
}
