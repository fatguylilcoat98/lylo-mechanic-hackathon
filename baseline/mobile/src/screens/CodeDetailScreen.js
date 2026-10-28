/*
 * LYLO Mechanic — one code, fully explained.
 */
import React, { useMemo } from 'react';
import { View, Text, ScrollView, Share } from 'react-native';
import { buildCodeResult } from '../engine/diagnose';
import { Button, Card, Badge, Bullet, LEVEL_COLORS, u } from '../components/ui';
import { C } from '../constants/colors';
import RepairLinks from '../../../../hackathon/mobile-bridge/src/RepairLinks'; // hackathon v0.4.6: Watch how + nearest store

export default function CodeDetailScreen({ route }) {
  const r = useMemo(() => route.params?.result || buildCodeResult(route.params?.code), [route.params]);
  return (
    <ScrollView style={u.screen} contentContainerStyle={u.scroll}>
      <Card accent={LEVEL_COLORS[r.urgency.color]}>
        <Text style={[u.h1, { color: C.accent }]}>{r.code}</Text>
        <Text style={[u.h2, { marginTop: 4 }]}>{r.title}</Text>
        <View style={u.row}>
          <Badge text={r.urgency.level} color={LEVEL_COLORS[r.urgency.color]} />
          <Badge text={'Difficulty: ' + r.difficulty.level} color={C.accent} />
        </View>
        <Text style={[u.small, { marginTop: 8 }]}>{r.urgency.message}</Text>
      </Card>

      <Card title="What it means">
        <Text style={u.body}>{r.plain}</Text>
      </Card>

      {r.causes.length ? (
        <Card title="Most likely causes (most common first)">
          {r.causes.map((c, i) => <Bullet key={i}>{c}</Bullet>)}
        </Card>
      ) : null}

      <Card title="Check these first (cheap / free)">
        {r.check.map((c, i) => <Bullet key={i} color={C.green}>{c}</Bullet>)}
      </Card>

      <Card title="How to fix it">
        <Text style={u.body}>{r.fix}</Text>
        <Text style={[u.small, { marginTop: 6 }]}>Difficulty: {r.difficulty.level} — {r.difficulty.label}</Text>
        {r.laborHours ? <Text style={u.small}>Typical shop labor: {r.laborHours[0]}–{r.laborHours[1]} hours</Text> : null}
      </Card>

      <RepairLinks result={r} />

      <Card title="Fair price range (estimate)">
        <Row label="Do it yourself (parts)" value={r.priceText.diy} />
        <Row label="Independent shop" value={r.priceText.shop} strong />
        {r.priceText.dealer ? <Row label="Dealer" value={r.priceText.dealer} /> : null}
        <Text style={[u.small, { marginTop: 8 }]}>{r.estimateNote}</Text>
      </Card>

      <Card title="What to say at the shop">
        <Text style={[u.body, { fontStyle: 'italic' }]}>{r.shopScript}</Text>
        <Button title="Share / copy this" kind="secondary" onPress={() => Share.share({ message: r.shopScript })} />
      </Card>

      <Card title="Red flags at the shop" accent={C.amber}>
        {r.redFlags.map((f, i) => <Bullet key={i} color={C.amber}>{f}</Bullet>)}
      </Card>
    </ScrollView>
  );
}

function Row({ label, value, strong }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 }}>
      <Text style={u.body}>{label}</Text>
      <Text style={[u.body, { fontWeight: strong ? '800' : '600', color: strong ? C.textBright : C.text }]}>{value}</Text>
    </View>
  );
}
