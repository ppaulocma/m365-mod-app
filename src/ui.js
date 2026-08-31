// ============================================================================
// ui.js — primitivos do design system (v3 · instrumento de medição)
// ----------------------------------------------------------------------------
// Tudo consome tokens de theme.js — nenhum valor visual solto.
// ============================================================================
import React from 'react';
import {
  View, Text, Pressable, ActivityIndicator, Vibration, StyleSheet,
  Platform,
} from 'react-native';
import { T } from './theme';

// Haptics SUAVES via expo-haptics (taptic engine): seleção sutil para toques
// leves, impacto leve para ações, aviso só no perigoso. A API Vibration crua
// ficou de fallback — no iOS ela é tudo-ou-nada (zumbido de ~400 ms em
// QUALQUER duração), então sem o módulo nativo preferimos silêncio lá.
let Haptics = null;
try { Haptics = require('expo-haptics'); } catch (e) {}

export const haptic = (ms = 20) => {
  if (Haptics) {
    if (ms <= 25)      Haptics.selectionAsync().catch(() => {});
    else if (ms <= 40) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
                              .catch(() => {});
    else               Haptics.notificationAsync(
                         Haptics.NotificationFeedbackType.Warning)
                              .catch(() => {});
  } else if (Platform.OS === 'android') {
    Vibration.vibrate(Math.min(ms, 15));
  }
};

// --- Régua de graduação (motivo estrutural da marca) -------------------------
export function TickRuler({ count = 36 }) {
  return (
    <View style={su.ticks} accessible={false}>
      {Array.from({ length: count }).map((_, i) => (
        <View key={i}
          style={[su.tick, i % 5 === 0 && su.tickMajor]} />
      ))}
    </View>
  );
}

// --- Octógono (marca de perigo / E-STOP) -------------------------------------
// Quadrado com os 4 cantos cortados por losangos da cor do fundo.
export function Octagon({ size = 22, color = T.color.onEstop, bg = T.color.estop }) {
  const c = size * 0.45;
  const corner = (pos) => ({
    position: 'absolute', width: c, height: c, backgroundColor: bg,
    transform: [{ rotate: '45deg' }], ...pos,
  });
  const o = -c / 2;
  return (
    <View style={{ width: size, height: size, backgroundColor: color,
                   overflow: 'hidden' }} accessible={false}>
      <View style={corner({ left: o, top: o })} />
      <View style={corner({ right: o, top: o })} />
      <View style={corner({ left: o, bottom: o })} />
      <View style={corner({ right: o, bottom: o })} />
    </View>
  );
}

// --- Rótulo de seção (eyebrow CAPS) ------------------------------------------
export function SectionLabel({ children, right }) {
  return (
    <View style={su.secRow}>
      <Text style={su.secTxt}>{children}</Text>
      {right ? <Text style={su.secRight}>{right}</Text> : null}
    </View>
  );
}

// --- Status da conexão BLE (cor + marca + texto, sempre visível) -------------
const CONN = {
  connected:  { c: T.color.regen,  txt: 'CONECTADO' },
  connecting: { c: T.color.warn,   txt: 'CONECTANDO…' },
  scanning:   { c: T.color.warn,   txt: 'PROCURANDO…' },
  off:        { c: T.color.danger, txt: 'SEM BLUETOOTH' },
};
export function ConnStatus({ status }) {
  const s = CONN[status] || CONN.off;
  return (
    <View style={[su.conn, { borderLeftColor: s.c }]}
      accessibilityLabel={`conexão: ${s.txt}`}>
      <View style={[su.connDot, { backgroundColor: s.c }]} />
      <Text style={[su.connTxt, { color: s.c }]}>{s.txt}</Text>
    </View>
  );
}

// --- Botão (as únicas 5 variantes do app) ------------------------------------
// props: variant primary|secondary|tertiary|danger|estop · loading · disabled
export function Btn({ variant = 'secondary', label, onPress, disabled,
                      loading, style, textStyle, accessibilityLabel }) {
  const v = T.button[variant];
  const isEstop = variant === 'estop';
  const off = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || label}
      disabled={off}
      onPress={() => { if (isEstop || variant === 'danger') haptic(60); onPress?.(); }}
      hitSlop={6}
      style={({ pressed }) => [
        su.btn,
        {
          backgroundColor: pressed ? v.bgPressed : v.bg,
          borderColor: v.border,
          minHeight: isEstop ? T.size.estop : T.size.touch,
        },
        isEstop && su.estopExtra,
        disabled && { opacity: T.button.disabledOpacity },
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color={v.fg} />
      ) : (
        <View style={su.btnInner}>
          {isEstop && <Octagon />}
          <Text style={[
            su.btnTxt, { color: v.fg },
            variant === 'tertiary' && su.btnTxtTer,
            isEstop && su.btnTxtEstop,
            textStyle,
          ]}>{label}</Text>
        </View>
      )}
    </Pressable>
  );
}

const su = StyleSheet.create({
  ticks: { flexDirection: 'row', gap: 5, alignItems: 'flex-end',
           height: 10, overflow: 'hidden' },
  tick: { width: T.size.hairline, height: 5, backgroundColor: T.color.textDim },
  tickMajor: { height: 10, backgroundColor: T.color.textMut },

  secRow: { flexDirection: 'row', justifyContent: 'space-between',
            alignItems: 'baseline', marginTop: T.space.xl,
            marginBottom: T.space.md },
  secTxt: { ...T.type.label, color: T.color.textMut },
  secRight: { ...T.type.micro, color: T.color.textDim },

  conn: { flexDirection: 'row', alignItems: 'center', gap: T.space.sm,
          backgroundColor: T.color.surface1, borderLeftWidth: 2,
          paddingVertical: T.space.sm, paddingHorizontal: T.space.md },
  connDot: { width: 8, height: 8 },
  connTxt: { ...T.type.micro, letterSpacing: 1.6, fontWeight: '600' },

  btn: { borderRadius: T.radius.control, borderWidth: T.size.hairline,
         alignItems: 'center', justifyContent: 'center',
         paddingHorizontal: T.space.md },
  btnInner: { flexDirection: 'row', alignItems: 'center', gap: T.space.md },
  btnTxt: { fontSize: 12, fontWeight: '600', letterSpacing: 1.2,
            textTransform: 'uppercase' },
  btnTxtTer: { textTransform: 'none', letterSpacing: 0, fontSize: 13,
               fontWeight: '400' },
  estopExtra: { borderWidth: 3, borderColor: T.button.estop.border,
                borderRadius: T.radius.card },
  btnTxtEstop: { fontSize: 17, fontWeight: '800', letterSpacing: 3 },
});
