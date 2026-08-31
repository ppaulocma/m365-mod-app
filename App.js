// ============================================================================
// App.js — casca do app: cabeçalho com régua + status BLE, abas PILOTO/OFICINA
// ----------------------------------------------------------------------------
// Conecta sozinho ao "PatineteESP" (filtro por UUID), reconecta se cair.
// A troca de aba é a transição entre as duas densidades do design system.
// ============================================================================
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, SafeAreaView,
         Platform } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { ScooterBle } from './src/ble';
import { T } from './src/theme';
import { ConnStatus, haptic } from './src/ui';
import { Ionicons } from '@expo/vector-icons';
import Dashboard from './src/Dashboard';
import Workshop from './src/Workshop';

export default function App() {
  const [tab, setTab] = useState('dash');
  const [status, setStatus] = useState('off');
  const [telem, setTelem] = useState({});
  const bleRef = useRef(null);
  const sessionRef = useRef([]);        // registro simples da viagem (gráfico/CSV)
  const debugRef = useRef([]);          // datalogger PESADO de debug (aba Debug)
  const lastRecRef = useRef(0);

  useEffect(() => {
    const ble = new ScooterBle((t) => {
      setTelem(t);
      // Registro SIMPLES da viagem (2 Hz, poucos campos) — só p/ o gráfico e
      // um CSV leve. O datalogger PESADO de debug é separado (aba Debug).
      const now = Date.now();
      if (now - lastRecRef.current >= 500) {
        lastRecRef.current = now;
        const arr = sessionRef.current;
        arr.push({ t: Math.round(now / 1000), kmh: t.kmh, ibat: t.ibat,
                   vbat: t.vbat, temp: t.tempC, faults: t.faults, duty: t.duty });
        if (arr.length > 14400) arr.shift();
      }
    }, setStatus);
    bleRef.current = ble;
    (async () => {
      const ok = await ble.requestPermissions();
      if (ok) ble.start();
    })();
    return () => ble.stop();
  }, []);

  const send = (id, v) => bleRef.current?.send(id, v);

  return (
    <View style={st.root}>
      <SafeAreaView style={{ flex: 1 }}>
      <StatusBar style="light" />

      {/* cabeçalho: identificação + conexão */}
      <View style={st.header}>
        <View style={st.headRow}>
          <Text style={st.title}>PATINETE</Text>
          <ConnStatus status={status} />
        </View>
      </View>

      <View style={{ flex: 1 }}>
        {tab === 'dash'
          ? <Dashboard t={telem} status={status} send={send}
                       ble={bleRef.current} />
          : <Workshop  t={telem} status={status} send={send}
                       ble={bleRef.current} session={sessionRef}
                       debug={debugRef} />}
      </View>

      </SafeAreaView>

      {/* abas fora do SafeArea: fundo vai até a borda física; o respiro do
          indicador de home fica DENTRO da barra (padding), sem vão */}
      <View style={st.tabs}>
        {[['dash', 'PILOTO', 'speedometer-outline'],
          ['cfg', 'OFICINA', 'construct-outline']].map(([id, name, icon]) => (
          <Pressable key={id} style={st.tab}
            accessibilityRole="tab" accessibilityLabel={`aba ${name}`}
            onPress={() => { haptic(20); setTab(id); }}>
            <Ionicons name={icon} size={20}
              color={tab === id ? T.color.accent : T.color.textDim} />
            <Text style={[st.tabTxt, tab === id && st.tabTxtOn]}>{name}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.color.bg },

  header: { paddingHorizontal: T.space.lg, paddingTop: T.space.md,
            paddingBottom: T.space.sm,
            borderBottomWidth: T.size.hairline,
            borderBottomColor: T.color.divider },
  headRow: { flexDirection: 'row', justifyContent: 'space-between',
             alignItems: 'center', marginTop: T.space.sm },
  title: { ...T.type.label, color: T.color.text, letterSpacing: 4,
           fontSize: 14 },

  tabs: { flexDirection: 'row', backgroundColor: T.color.bg,
          borderTopWidth: T.size.hairline, borderTopColor: T.color.border,
          paddingBottom: Platform.OS === 'ios' ? 22 : 8 },
  tab: { flex: 1, alignItems: 'center', paddingVertical: T.space.sm,
         minHeight: T.size.touch, gap: 2 },
  tabTxt: { ...T.type.micro, color: T.color.textDim, letterSpacing: 1.6 },
  tabTxtOn: { color: T.color.accent },
});
