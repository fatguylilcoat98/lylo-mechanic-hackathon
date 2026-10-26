/*
 * LYLO Mechanic — debug log (for test feedback).
 */
import React, { useState } from 'react';
import { Text, ScrollView, Share } from 'react-native';
import * as BT from '../services/BluetoothService';
import { Button, Card, u } from '../components/ui';

export default function LogScreen() {
  const [lines, setLines] = useState(BT.getLog());
  return (
    <ScrollView style={u.screen} contentContainerStyle={u.scroll}>
      <Button title="Share log" onPress={() => Share.share({ message: 'LYLO Mechanic debug log\n' + lines.join('\n') })} />
      <Button title="Refresh" kind="secondary" onPress={() => setLines(BT.getLog())} />
      <Card title={lines.length + ' lines'} style={{ marginTop: 12 }}>
        {lines.length ? lines.map((l, i) => <Text key={i} style={u.mono}>{l}</Text>) : <Text style={u.small}>Nothing logged yet. Connect to an adapter first.</Text>}
      </Card>
    </ScrollView>
  );
}
