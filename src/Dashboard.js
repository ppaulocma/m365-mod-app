// ============================================================================
// Dashboard.js — MODO PILOTO (calmo, numerais gigantes e leves, pouco elemento)
// ----------------------------------------------------------------------------
// Tração em BRANCO de ponteiro, regen verde; laranja só em ação/interativo.
// Loading nos comandos que falam com o ESP (até o eco da telemetria voltar).
// ============================================================================
import React, { useEffect, useState, useRef } from 'react';
import { View, Text, StyleSheet, Pressable, PanResponder,
         ScrollView } from 'react-native';
import { T, FAULT_NAMES } from './theme';
import { CMD, CMDERR } from './ble';
import { Btn, Octagon, haptic } from './ui';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';

const POWER_MAX = 800, REGEN_MAX = 300;

// Loading até o eco: guarda o valor desejado e limpa quando a telemetria
// confirmar (ou após 2,5 s — comando perdido não trava a UI).
function usePendingEcho(current) {
  const [want, setWant] = useState(null);
  useEffect(() => { if (want !== null && current === want) setWant(null); },
            [current, want]);
  useEffect(() => {
    if (want === null) return;
    const tm = setTimeout(() => setWant(null), 2500);
    return () => clearTimeout(tm);
  }, [want]);
  return [want, setWant];
}

// --- barra de potência: regen ◂ verde | tração ▸ branca ----------------------
function PowerBar({ powerW }) {
  const p = powerW || 0;
  const right = Math.min(1, Math.max(0, p / POWER_MAX));
  const left  = Math.min(1, Math.max(0, -p / REGEN_MAX));
  return (
    <View style={st.pwrWrap}>
      <View style={st.pwrLabels}>
        <Text style={[st.pwrLbl, { color: T.color.regen }]}>◂ REGEN</Text>
        <Text style={[st.pwrVal, p < 0 && { color: T.color.regen }]}>
          {Math.abs(p)}<Text style={st.pwrUnit}> W</Text>
        </Text>
        <Text style={[st.pwrLbl, { color: T.color.textMut }]}>TRAÇÃO ▸</Text>
      </View>
      <View style={st.pwrBar}>
        <View style={st.pwrHalf}>
          <View style={[st.pwrFillL, { width: `${left * 100}%` }]} />
        </View>
        <View style={st.pwrCenter} />
        <View style={[st.pwrHalf, { flex: 1.6 }]}>
          <View style={[st.pwrFillR, { width: `${right * 100}%` }]} />
        </View>
      </View>
    </View>
  );
}

// --- medida (dado sem caixa: número leve + label CAPS, separado por fio) -----
function Meter({ label, value, unit, color }) {
  return (
    <View style={st.meter}>
      <Text style={st.meterLabel}>{label}</Text>
      <Text style={[st.meterValue, color && { color }]}>
        {value}<Text style={st.meterUnit}> {unit}</Text>
      </Text>
    </View>
  );
}

// --- limite rápido (− valor +) ----------------------------------------------
// Slider do limite de velocidade — ajuste de SESSÃO (RAM no ESP, zera no
// reset). O teto do slider é o PARÂMETRO gravado (fonte da verdade): daqui
// só dá para reduzir. Valor em laranja = aguardando eco da telemetria.
function SpeedLimitSlider({ value, max, onSet, conn }) {
  const MIN = 5;
  const [w, setW] = useState(0);
  const [drag, setDrag] = useState(null);
  const [sent, setSent] = useState(null);
  const wRef = useRef(0), maxRef = useRef(max), setRef = useRef(onSet);
  wRef.current = w; maxRef.current = max; setRef.current = onSet;

  const toVal = (x) => {
    const f = Math.min(1, Math.max(0, x / Math.max(1, wRef.current)));
    return Math.round(MIN + f * (maxRef.current - MIN));
  };
  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onStartShouldSetPanResponderCapture: () => true,   // ganha do ScrollView
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant:  (e) => setDrag(toVal(e.nativeEvent.locationX)),
    onPanResponderMove:   (e) => setDrag(toVal(e.nativeEvent.locationX)),
    onPanResponderRelease:(e) => {
      const v = toVal(e.nativeEvent.locationX);
      setDrag(null); setSent(v); setRef.current(v);
    },
  })).current;

  useEffect(() => {   // eco chegou: telemetria confirma o valor enviado
    if (sent !== null && Math.abs((value ?? 0) - sent) < 0.6) setSent(null);
  }, [value, sent]);

  const shown = drag ?? sent ?? value ?? max;
  const frac = Math.min(1, Math.max(0, (shown - MIN) / Math.max(1, max - MIN)));
  const pend = drag !== null || sent !== null;
  return (
    <View style={st.slWrap}>
      <View style={st.slHead}>
        <Text style={st.slLabel}>LIMITE DE VELOCIDADE</Text>
        <Text style={[st.slVal, pend && { color: T.color.accent }]}>
          {Math.round(shown)}<Text style={st.slUnit}> km/h</Text>
        </Text>
      </View>
      <View style={st.slTouch} accessibilityLabel="limite de velocidade"
            onLayout={(e) => setW(e.nativeEvent.layout.width)}
            {...(conn ? pan.panHandlers : {})}>
        {/* pointerEvents none: tocar no polegar dava locationX relativo a
            ELE (0-14px) => valor pulava p/ o mínimo por um frame (flicker) */}
        <View style={st.slTrack} pointerEvents="none">
          <View style={[st.slFill, { width: `${frac * 100}%` }]} />
        </View>
        <View style={[st.slThumb, { left: Math.max(0, frac * w - 7) }]}
              pointerEvents="none" />
      </View>
    </View>
  );
}

export default function Dashboard({ t, status, send, ble }) {
  const conn = status === 'connected';
  // teto do slider = vmax do MODO atual (ECO 33 / NORMAL 35 / TURBO 28);
  // o valor escolhido sobrepõe o vmax do modo SÓ EM RAM (volta no reset)
  const [pv, setPv] = useState(null);
  useEffect(() => {
    if (conn && ble) ble.readParams()
      .then(ps => ps && setPv({ eco: ps[33]?.val, nor: ps[35]?.val,
                                top: ps[28]?.val }))
      .catch(() => {});
  }, [conn, ble]);
  const modeVmax = pv
    ? ((t.ride ?? 1) === 0 ? pv.eco : (t.ride ?? 1) === 1 ? pv.nor : pv.top)
    : null;
  const faults = FAULT_NAMES.filter(([bit]) => t.faults & bit).map(([, n]) => n);
  const speedFrac = Math.min(1, Math.abs(t.kmh ?? 0) / Math.max(1, t.vMax ?? 25));
  const [wantEn, setWantEn] = usePendingEcho(t.enabled);
  const [wantMode, setWantMode] = usePendingEcho(t.modeVel);

  const toggleEnable = () => {
    haptic(35);
    const target = !t.enabled;
    setWantEn(target);
    send(CMD.ENABLE, target ? 1 : 0);
  };
  const setMode = (v) => {
    if ((t.modeVel ? 1 : 0) === v) return;
    haptic(25);
    setWantMode(!!v);
    send(CMD.MODE, v);
  };

  return (
    <ScrollView style={st.root} contentContainerStyle={st.content}
                showsVerticalScrollIndicator={false}>
      {/* faltas: octógono + texto + ação */}
      {faults.length > 0 && (
        <View style={st.faults}>
          <Octagon size={16} color={T.color.danger} bg={T.color.dangerBg} />
          <View style={{ flex: 1 }}>
            {faults.map(f => <Text key={f} style={st.faultTxt}>{f}</Text>)}
          </View>
          <Btn variant="tertiary" label="Limpar" style={st.faultBtn}
               onPress={() => send(CMD.CLEAR, 1)} />
        </View>
      )}

      {/* bateria */}
      <View style={st.batWrap}>
        <View style={st.batBar}>
          <View style={[st.batFill, {
            width: `${t.soc ?? 0}%`,
            backgroundColor: t.soc > 40 ? T.color.regen
                           : t.soc > 15 ? T.color.warn : T.color.danger,
          }]} />
        </View>
        <View style={st.batRow}>
          <Text style={st.batTxt}>BAT {t.soc ?? '--'}% · {t.vbat?.toFixed(1) ?? '--'} V
            {t.uvWarn ? '  ▲FRACA' : ''}{t.panel ? ' · PAINEL' : ''}</Text>
          <Text style={st.batTxt}>
            {t.rangeKm !== undefined ? `${t.rangeKm.toFixed(0)} km rest` : ''}
            {t.whPerKm ? ` · ${t.whPerKm.toFixed(0)} Wh/km` : ''}</Text>
        </View>
      </View>

      {/* velocímetro — numeral gigante e leve */}
      <View style={st.speedWrap}>
        <Text style={st.speed} accessibilityLabel="velocidade">
          {Math.abs(t.kmh ?? 0).toFixed(1)}
        </Text>
        <Text style={st.speedUnit}>km/h</Text>
      </View>
      <View style={st.speedTrack}>
        <View style={[st.speedFill, { width: `${speedFrac * 100}%` }]} />
      </View>
      <Text style={st.subInfo}>
        TRIP {t.tripKm?.toFixed(2) ?? '--'} km · ODO {t.odoKm?.toFixed(0) ?? '--'} km
        {t.ecoAuto ? ' · ECO AUTO' : ''}
        {t.fwA > 0.3 ? ` · FW ${t.fwA.toFixed(1)} A` : ''}
        {t.saturated ? ' · ▲ SATURADO' : ''}
        {t.scalePct < 100 ? ` · ▲ LIMITADO ${t.scalePct}%` : ''}
      </Text>
      {t.headroom !== undefined && t.headroom < 100 && (
        <View style={st.headWrap}>
          <Text style={st.headLbl}>HEADROOM TÉRMICO</Text>
          <View style={st.headTrack}>
            <View style={[st.headFill, {
              width: `${t.headroom}%`,
              backgroundColor: t.headroom > 50 ? T.color.regen
                             : t.headroom > 20 ? T.color.warn : T.color.danger,
            }]} />
          </View>
        </View>
      )}
      {t.cmdStatus > 0 && (
        <Text style={st.cmdErr}>▲ {CMDERR[t.cmdStatus] || 'comando recusado'}</Text>
      )}

      <PowerBar powerW={t.powerW} />

      <SpeedLimitSlider value={t.vMax} max={modeVmax ?? 35} conn={conn}
        onSet={(v) => { haptic(20); send(CMD.V_MAX, v); }} />

      {/* medidas — sem caixas, fio entre elas */}
      <View style={st.meters}>
        <Meter label="CORRENTE" value={t.ibat?.toFixed(1) ?? '--'} unit="A"
               color={t.regen ? T.color.regen : undefined} />
        <View style={st.meterDiv} />
        <Meter label="TEMP MOSFET" value={t.tempC ?? '--'} unit="°C"
               color={t.tempC > 70 ? T.color.warn : undefined} />
        <View style={st.meterDiv} />
        <Meter label="TEMP MOTOR" value={t.motorTempC ?? '--'} unit="°C"
               color={t.motorTempC > 100 ? T.color.warn : undefined} />
      </View>

      {/* modo de pilotagem */}
      <View style={st.modeRow}>
        {[['ECO', 0, 'leaf-outline'], ['NORMAL', 1, 'speedometer-outline'],
          ['TURBO', 2, 'flash-outline']].map(([name, v, icon]) => {
          const on = (t.ride ?? 1) === v;
          const c = on ? (v === 2 ? T.color.warn : T.color.accent) : T.color.textDim;
          return (
            <Pressable key={name} disabled={!conn}
              accessibilityLabel={`modo de pilotagem ${name}`}
              onPress={() => { haptic(25); send(CMD.RIDE, v); }}
              style={({ pressed }) => [st.modeBtn, on && st.modeBtnOn,
                v === 2 && on && { borderColor: T.color.warn },
                pressed && { backgroundColor: T.color.surface3 }]}>
              <Ionicons name={icon} size={16} color={c} />
              <Text style={[st.modeTxt, { color: c }]}>{name}</Text>
            </Pressable>
          );
        })}
      </View>

      {/* funções rápidas: cruise / walk / trava */}
      <View style={st.modeRow}>
        {[
          ['FAROL', t.farol ? 'car-light-high' : 'car-light-dimmed', t.farol,
            () => send(CMD.FAROL, t.farol ? 0 : 1)],
          ['CRUISE', 'car-cruise-control', t.cruise,
            () => send(CMD.CRUISE, t.cruise ? 0 : 1)],
          ['WALK', 'walk', t.walk, () => send(CMD.WALK, t.walk ? 0 : 1)],
          ['TRAVA', t.locked ? 'lock' : 'lock-open-variant-outline', t.locked, () => {
            if (!t.locked && Math.abs(t.kmh ?? 0) > 1) return;   // só parado
            send(CMD.LOCK, t.locked ? 0 : 1);
          }],
        ].map(([name, icon, on, fn]) => {
          const c = on ? (name === 'TRAVA' ? T.color.danger : T.color.accent)
                       : T.color.textDim;
          return (
            <Pressable key={name} disabled={!conn}
              accessibilityLabel={name}
              onPress={() => { haptic(30); fn(); }}
              style={({ pressed }) => [st.modeBtn, on && st.modeBtnOn,
                name === 'TRAVA' && on && { borderColor: T.color.danger },
                pressed && { backgroundColor: T.color.surface3 }]}>
              <MaterialCommunityIcons name={icon} size={17} color={c} />
              <Text style={[st.modeTxt, { color: c }]}>{name}</Text>
            </Pressable>
          );
        })}
      </View>

      {/* modo — segmentado plano */}
      <View style={st.modeRow}>
        {[['TORQUE', 0], ['VELOCIDADE', 1]].map(([name, v]) => {
          const on = (t.modeVel ? 1 : 0) === v;
          const pending = wantMode !== null && (wantMode ? 1 : 0) === v;
          return (
            <Pressable key={name} disabled={!conn}
              accessibilityLabel={`modo ${name}`}
              onPress={() => setMode(v)}
              style={({ pressed }) => [st.modeBtn,
                on && st.modeBtnOn,
                pressed && { backgroundColor: T.color.surface3 }]}>
              <Text style={[st.modeTxt, on && st.modeTxtOn]}>
                {pending ? '…' : name}
              </Text>
            </Pressable>
          );
        })}
      </View>



      {/* ação principal no fim da rolagem (alcance do polegar) */}
      <Btn variant="primary"
        label={t.enabled ? 'Desligar motor' : 'Ligar motor'}
        disabled={!conn}
        loading={wantEn !== null}
        onPress={toggleEnable}
        style={{ marginTop: T.space.lg }} />
    </ScrollView>
  );
}

const st = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: T.density.pilot.pad, paddingTop: T.space.sm,
             paddingBottom: T.space.lg },

  faults: { flexDirection: 'row', alignItems: 'center', gap: T.space.md,
            backgroundColor: T.color.dangerBg, borderLeftWidth: 2,
            borderLeftColor: T.color.danger, padding: T.space.md,
            marginBottom: T.space.md, borderRadius: T.radius.card },
  faultTxt: { ...T.type.micro, color: T.color.danger, letterSpacing: 1.2,
              fontWeight: '600' },
  faultBtn: { minHeight: 36 },

  batWrap: { marginBottom: T.space.xs },
  batBar: { height: 8, backgroundColor: T.color.surface2 },
  batFill: { height: '100%' },
  batRow: { flexDirection: 'row', justifyContent: 'space-between',
            marginTop: T.space.xs },
  batTxt: { ...T.type.micro, color: T.color.textMut, letterSpacing: 1.2,
            fontVariant: T.type.tabular },

  speedWrap: { flexDirection: 'row', justifyContent: 'center',
               alignItems: 'flex-end', marginTop: T.space.md },
  speed: { ...T.type.display, color: T.color.text,
           fontVariant: T.type.tabular },
  speedUnit: { ...T.type.body, color: T.color.textMut,
               marginBottom: T.space.lg, marginLeft: T.space.sm },
  speedTrack: { height: 3, backgroundColor: T.color.surface2 },
  speedFill: { height: '100%', backgroundColor: T.color.traction },
  subInfo: { ...T.type.micro, color: T.color.textMut, textAlign: 'center',
             letterSpacing: 1.2, marginVertical: T.space.sm,
             fontVariant: T.type.tabular },

  pwrWrap: { marginBottom: T.space.md },
  pwrLabels: { flexDirection: 'row', justifyContent: 'space-between',
               alignItems: 'baseline', marginBottom: T.space.xs },
  pwrLbl: { ...T.type.micro, letterSpacing: 2, fontWeight: '600' },
  pwrVal: { fontSize: 16, fontWeight: '400', color: T.color.text,
            fontVariant: T.type.tabular },
  pwrUnit: { ...T.type.micro, color: T.color.textMut },
  pwrBar: { flexDirection: 'row', height: 16,
            backgroundColor: T.color.surface1,
            borderBottomWidth: T.size.hairline, borderBottomColor: T.color.border },
  pwrHalf: { flex: 1, flexDirection: 'row' },
  pwrCenter: { width: 2, backgroundColor: T.color.textDim },
  pwrFillL: { backgroundColor: T.color.regen, marginLeft: 'auto', height: '100%' },
  pwrFillR: { backgroundColor: T.color.traction, height: '100%' },

  meters: { flexDirection: 'row', alignItems: 'stretch',
            borderTopWidth: T.size.hairline, borderTopColor: T.color.divider,
            borderBottomWidth: T.size.hairline, borderBottomColor: T.color.divider,
            paddingVertical: T.space.md, marginBottom: T.space.md },
  meter: { flex: 1, alignItems: 'center' },
  meterDiv: { width: T.size.hairline, backgroundColor: T.color.divider },
  meterLabel: { ...T.type.micro, color: T.color.textDim, letterSpacing: 2,
                marginBottom: T.space.xs },
  meterValue: { ...T.type.big, color: T.color.text,
                fontVariant: T.type.tabular },
  meterUnit: { ...T.type.micro, color: T.color.textMut },

  modeRow: { flexDirection: 'row', gap: T.space.sm, marginBottom: T.space.md },
  modeBtn: { flex: 1, backgroundColor: T.color.surface1,
             borderRadius: T.radius.control, minHeight: T.size.touch,
             alignItems: 'center', justifyContent: 'center',
             flexDirection: 'row', gap: 6,
             borderWidth: T.size.hairline, borderColor: T.color.border },
  modeBtnOn: { borderColor: T.color.accent },
  modeTxt: { ...T.type.label, color: T.color.textDim },
  modeTxtOn: { color: T.color.accent },

  slWrap: { marginTop: T.space.md },
  slHead: { flexDirection: 'row', justifyContent: 'space-between',
            alignItems: 'baseline', marginBottom: 6 },
  slLabel: { ...T.type.micro, color: T.color.textDim, letterSpacing: 1.6 },
  slVal: { fontSize: 15, fontWeight: '500', color: T.color.text,
           fontVariant: ['tabular-nums'] },
  slUnit: { ...T.type.micro, color: T.color.textMut },
  slTouch: { height: T.size.touch, justifyContent: 'center' },
  slTrack: { height: 4, borderRadius: 2, backgroundColor: T.color.surface3,
             overflow: 'hidden' },
  slFill: { height: 4, backgroundColor: T.color.accent },
  slThumb: { position: 'absolute', width: 14, height: 14, borderRadius: 7,
             backgroundColor: T.color.bg, borderWidth: 2,
             borderColor: T.color.accent },

  limits: { flexDirection: 'row', gap: T.space.sm },
  lim: { flex: 1 },
  limLabel: { ...T.type.micro, color: T.color.textDim, letterSpacing: 1.6,
              textAlign: 'center', marginBottom: T.space.xs },
  limRow: { flexDirection: 'row', alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: T.color.surface1,
            borderRadius: T.radius.control },
  limBtn: { width: 34, height: T.size.touch, alignItems: 'center',
            justifyContent: 'center', backgroundColor: T.color.surface2,
            borderRadius: T.radius.control },
  limBtnTxt: { fontSize: 18, fontWeight: '400', color: T.color.text },
  limVal: { fontSize: 15, fontWeight: '500', color: T.color.text,
            fontVariant: T.type.tabular },
  limUnit: { ...T.type.micro, color: T.color.textMut },

  headWrap: { marginBottom: T.space.sm },
  headLbl: { ...T.type.micro, color: T.color.textDim, letterSpacing: 2,
             marginBottom: 3 },
  headTrack: { height: 5, backgroundColor: T.color.surface2 },
  headFill: { height: '100%' },
  cmdErr: { ...T.type.micro, color: T.color.warn, textAlign: 'center',
            letterSpacing: 1, marginBottom: T.space.xs },
});
