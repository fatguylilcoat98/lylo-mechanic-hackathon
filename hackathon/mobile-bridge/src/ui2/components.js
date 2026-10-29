/*
 * LYLO Mechanic UI v2 shared components. Presentation only.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { color, space, radius, type, touch, EVIDENCE, TONE } from './theme';

export function EvidenceBadge({ kind, compact }) {
  const e = EVIDENCE[kind] || EVIDENCE.unknown;
  return (
    <View testID={e.testID} accessibilityLabel={'Evidence: ' + e.label} style={[s.badge, { borderColor: e.fg }]}>
      <Text style={[s.badgeText, { color: e.fg }]}>{e.icon}{compact ? '' : '  ' + e.label.toUpperCase()}</Text>
    </View>
  );
}

export function ReplayBadge({ label }) {
  if (!label) return null;
  return (
    <View testID="replay-badge" accessibilityLabel={'Replay: ' + label} style={s.replay}>
      <Text style={s.replayText}>{'\u25B6  REPLAY \u00B7 '}{label}</Text>
    </View>
  );
}

export function BigActionButton({ title, subtitle, onPress, kind = 'primary', testID }) {
  const primary = kind === 'primary';
  return (
    <Pressable testID={testID} onPress={onPress} accessibilityRole="button" accessibilityLabel={subtitle ? `${title}. ${subtitle}` : title}
      style={({ pressed }) => [s.big, primary ? s.bigPrimary : s.bigSecondary, pressed && { opacity: 0.85 }]}>
      <Text style={[s.bigTitle, { color: primary ? color.onAccent : color.text }]}>{title}</Text>
      {subtitle ? <Text style={[s.bigSub, { color: primary ? color.onAccent : color.textDim }]}>{subtitle}</Text> : null}
    </Pressable>
  );
}

/** Verdict / safety hero. Red levels get the full override story. */
export function SafetyBanner({ tone, title, why, safety }) {
  const t = TONE[tone] || TONE.yellow;
  return (
    <View testID={'safety-' + tone} accessibilityRole="alert" style={[s.safety, { backgroundColor: t.bg }]}>
      {safety ? <Text style={[s.kicker, { color: t.fg }]}>SAFETY RULES {safety.overruled ? '\u00B7 OVERRULED THE AI' : ''}</Text> : null}
      <Text style={[s.safetyTitle, { color: t.fg }]}>{safety ? safety.title : title}</Text>
      {why ? <Text style={[s.safetyWhy, { color: t.fg }]}>{why}</Text> : null}
      {safety ? <Text style={[s.safetyNote, { color: t.fg }]}>{safety.note}</Text> : null}
      {safety ? safety.triggers.map((x) => <Text key={x} style={[s.safetyNote, { color: t.fg }]}>{'\u2022 '}{x}</Text>) : null}
    </View>
  );
}

const PRED = {
  pending: { word: 'PREDICTION LOCKED', fg: color.accent, title: 'Waiting for the car to answer' },
  held: { word: 'PREDICTION HELD', fg: color.green, title: 'The car proved it right' },
  failed: { word: 'PREDICTION FAILED', fg: color.red, title: 'The car proved it wrong. Revising.' },
  // v0.5.1: the server's hash-chained record did not verify (chain_ok false or no head hash). No verdict is shown.
  unverified: { word: 'RESULT NOT VERIFIED', fg: color.accent, title: 'The server sent a result without a verified record. Not shown as proof.' },
  integrity: { word: 'RECORD INTEGRITY CHECK FAILED', fg: color.red, title: "Record integrity check failed: this result can't be trusted as proof" },
};

export function PredictionBanner({ prediction }) {
  if (!prediction) return null;
  const p = PRED[prediction.status] || PRED.pending;
  return (
    <View testID={'prediction-' + prediction.status} style={[s.pred, { borderColor: p.fg }]}>
      <Text style={[s.kicker, { color: p.fg }]}>{p.word}</Text>
      <Text style={s.predTitle}>{p.title}</Text>
      <Text style={s.small}>{'\u201C'}{prediction.text}{'\u201D'}</Text>
      {prediction.measured ? <Text style={[s.small, { color: color.text, marginTop: space.xs }]}>Measured: {prediction.measured}</Text> : null}
    </View>
  );
}

export function CauseCard({ cause, open, onToggle }) {
  const n = cause.evidence.length;
  return (
    <Pressable onPress={onToggle} accessibilityRole="button" accessibilityState={{ expanded: !!open }}
      accessibilityLabel={`${cause.title}. ${cause.likely}. ${open ? 'Hide' : 'Show'} proof`} style={s.cause}>
      <View style={s.causeHead}>
        <Text style={s.causeRank}>{cause.rank}</Text>
        <View style={{ flex: 1 }}>
          <Text style={s.causeTitle}>{cause.title}</Text>
          <View style={s.row}><EvidenceBadge kind="guess" /><Text style={s.small}>{'  '}{cause.likely}</Text></View>
        </View>
      </View>
      <Text style={s.link}>{open ? 'Hide proof \u25B2' : `Show proof (${n}) \u25BC`}</Text>
      {open ? (
        <View style={s.proof}>
          {n === 0 ? <View style={s.proofRow}><EvidenceBadge kind="unknown" compact /><Text style={s.proofText}>No reading cited.</Text></View> : null}
          {cause.evidence.map((e) => (
            <View key={e.id} style={s.proofRow}><EvidenceBadge kind={e.kind} compact /><Text style={s.proofText}>{e.label}</Text></View>
          ))}
          {cause.nextCheck ? <Text style={[s.small, { marginTop: space.sm }]}>Next check: {cause.nextCheck}</Text> : null}
        </View>
      ) : null}
    </Pressable>
  );
}

export function Section({ title, children }) {
  return <View style={{ marginTop: space.xl }}>{title ? <Text style={s.section}>{title}</Text> : null}{children}</View>;
}

export const s = StyleSheet.create({
  badge: { borderWidth: 1.5, borderRadius: radius.pill, paddingHorizontal: space.sm, paddingVertical: 2, alignSelf: 'flex-start', minWidth: 28, alignItems: 'center' },
  badgeText: { ...type.label, fontSize: 12 },
  replay: { backgroundColor: color.surface, borderColor: color.replay, borderWidth: 1.5, borderRadius: radius.md, padding: space.md, marginBottom: space.lg },
  replayText: { color: color.replay, ...type.label },
  big: { minHeight: touch.min + 16, borderRadius: radius.lg, paddingVertical: space.lg, paddingHorizontal: space.xl, justifyContent: 'center', marginTop: space.md },
  bigPrimary: { backgroundColor: color.accent },
  bigSecondary: { backgroundColor: color.surface, borderWidth: 1.5, borderColor: color.line },
  bigTitle: { ...type.h, fontSize: 22 },
  bigSub: { ...type.small, marginTop: 2 },
  safety: { borderRadius: radius.lg, padding: space.xl },
  kicker: { ...type.label, marginBottom: space.sm },
  safetyTitle: { ...type.hero },
  safetyWhy: { ...type.body, marginTop: space.md },
  safetyNote: { ...type.small, marginTop: space.sm, fontWeight: '700' },
  pred: { backgroundColor: color.surface, borderWidth: 2, borderRadius: radius.lg, padding: space.lg, marginTop: space.lg },
  predTitle: { color: color.text, ...type.h, marginBottom: space.xs },
  cause: { backgroundColor: color.surface, borderRadius: radius.md, padding: space.lg, marginTop: space.md, minHeight: touch.min },
  causeHead: { flexDirection: 'row' },
  causeRank: { color: color.accent, ...type.title, width: 34 },
  causeTitle: { color: color.text, ...type.h, marginBottom: space.sm },
  link: { color: color.accent, ...type.small, fontWeight: '800', marginTop: space.md },
  proof: { marginTop: space.sm, borderLeftWidth: 2, borderLeftColor: color.line, paddingLeft: space.md },
  proofRow: { flexDirection: 'row', alignItems: 'center', marginTop: space.sm },
  proofText: { color: color.text, ...type.small, flex: 1, marginLeft: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  small: { color: color.textDim, ...type.small },
  section: { color: color.textDim, ...type.label, marginBottom: space.xs },
});
