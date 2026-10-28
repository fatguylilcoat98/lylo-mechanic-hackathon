/*
 * LYLO Mechanic — The Good Neighbor Guard
 * Christopher Hughes · Sacramento, CA
 *
 * Offline test build: no server, no login. All diagnosis runs on the phone.
 */

import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import HomeScreen from './screens/HomeScreen';
import ConnectScreen from './screens/ConnectScreen';
import ScanScreen from './screens/ScanScreen';
import UsedCarScreen from './screens/UsedCarScreen';
import CodesScreen from './screens/CodesScreen';
import CodeDetailScreen from './screens/CodeDetailScreen';
import LookupScreen from './screens/LookupScreen';
import LogScreen from './screens/LogScreen';
import PhotoHelperScreen from '../../../hackathon/mobile-bridge/src/PhotoHelperScreen'; // hackathon v0.4.2
import VinScreen from '../../../hackathon/mobile-bridge/src/VinScreen'; // hackathon v0.4.3
import NoAdapterScreen from '../../../hackathon/mobile-bridge/src/NoAdapterScreen'; // hackathon v0.4.5
import { C } from './constants/colors';

const Stack = createNativeStackNavigator();

const THEME = {
  dark: true,
  colors: { primary: C.accent, background: C.bg, card: C.card, text: C.textBright, border: C.border, notification: C.accent },
};

export default function App() {
  return (
    <>
      <StatusBar style="light" />
      <NavigationContainer theme={THEME}>
        <Stack.Navigator
          initialRouteName="Home"
          screenOptions={{
            headerStyle: { backgroundColor: C.card },
            headerTintColor: C.accent,
            headerTitleStyle: { fontWeight: '700' },
            contentStyle: { backgroundColor: C.bg },
            headerShadowVisible: false,
          }}>
          <Stack.Screen name="Home" component={HomeScreen} options={{ headerShown: false }} />
          <Stack.Screen name="Connect" component={ConnectScreen} options={{ title: 'Connect adapter' }} />
          <Stack.Screen name="Scan" component={ScanScreen} options={{ title: 'Scanning', headerBackVisible: false, gestureEnabled: false }} />
          <Stack.Screen name="UsedCar" component={UsedCarScreen} options={{ title: 'Used-Car Check' }} />
          <Stack.Screen name="Codes" component={CodesScreen} options={{ title: 'Trouble codes' }} />
          <Stack.Screen name="CodeDetail" component={CodeDetailScreen} options={({ route }) => ({ title: route.params?.code || 'Code' })} />
          <Stack.Screen name="Lookup" component={LookupScreen} options={{ title: 'Look up a code' }} />
          <Stack.Screen name="Log" component={LogScreen} options={{ title: 'Debug log' }} />
          <Stack.Screen name="PhotoHelper" component={PhotoHelperScreen} options={{ title: 'Photo Helper' }} />
          <Stack.Screen name="Vin" component={VinScreen} options={{ title: 'Your car' }} />
          <Stack.Screen name="NoAdapter" component={NoAdapterScreen} options={{ title: 'No adapter' }} />
        </Stack.Navigator>
      </NavigationContainer>
    </>
  );
}
