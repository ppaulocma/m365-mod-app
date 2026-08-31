// ============================================================================
// Workshop.js — MODO OFICINA completo, atrás de PIN
// ----------------------------------------------------------------------------
// Abas: PARÂMETROS (Config.js) · CURVAS (editores arrastáveis) ·
//       TUNING (stream 50 Hz + step response com métricas) ·
//       REGISTROS (log de faltas, viagem/CSV, OTA)
// ============================================================================
import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, Pressable, ScrollView, TextInput, Alert,
  Modal,
  useWindowDimensions,
} from 'react-native';
import { T } from './theme';
import { CMD, CRV, logToCsv, logRow, LOG_COLS } from './ble';
import { Btn, SectionLabel, haptic } from './ui';
import { LineChart, CurveEditor, Gauge } from './charts';
import Config, { P, featOn, fwOn } from './Config';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';

// Desbloqueio por Face ID / senha do CELULAR (expo-local-authentication).
// Se o dev client ainda não tiver o módulo nativo, cai num confirmar simples.
let LocalAuth = null;
try { LocalAuth = require('expo-local-authentication'); } catch (e) {}

// --- especificações dos editores (espelham os limites FÍSICOS do firmware) ---
const CURVE_META = {
  [CRV.THROTTLE]: { name: 'Acelerador', xUnit: '%', yUnit: '%',
    spec: { xMin: 0, xMax: 100, yMin: 0, yMax: 100, xUnit: '%', yUnit: '%',
            xLabel: 'manete', yLabel: 'alvo de pot\u00eancia (%)' },
    hint: 'Tradução do manete em potência: quanto cada posição do acelerador pede do motor.',
    presets: [
      { name: 'linear',      pts: [{x:0,y:0},{x:100,y:100}] },
      { name: 'progressiva', pts: [{x:0,y:0},{x:40,y:18},{x:75,y:55},{x:100,y:100}] },
      { name: 'agressiva',   pts: [{x:0,y:0},{x:25,y:45},{x:60,y:85},{x:100,y:100}] },
      { name: 'suave',       pts: [{x:0,y:0},{x:50,y:30},{x:100,y:70}] },
    ] },
  [CRV.BRAKE]: { name: 'Freio regenerativo', xUnit: '%', yUnit: '%',
    spec: { xMin: 0, xMax: 100, yMin: 0, yMax: 100, xUnit: '%', yUnit: '%',
            xLabel: 'manete de freio', yLabel: 'for\u00e7a de regen (%)' },
    hint: 'Força da frenagem regenerativa para cada posição do manete de freio.',
    presets: [
      { name: 'linear', pts: [{x:0,y:0},{x:100,y:100}] },
      { name: 'suave',  pts: [{x:0,y:0},{x:60,y:35},{x:100,y:85}] },
    ] },
  [CRV.REGEN_S]: { name: 'Regen × velocidade', xUnit: 'km/h', yUnit: '%',
    spec: { xMin: 0, xMax: 45, yMin: 0, yMax: 100, xUnit: ' km/h', yUnit: '%',
            xLabel: 'velocidade', yLabel: 'regen permitida (%)' },
    hint: 'Enfraquece a regen em baixa velocidade — a roda nunca trava ao frear.',
    presets: [
      { name: 'padrão', pts: [{x:0,y:15},{x:5,y:55},{x:12,y:100},{x:45,y:100}] },
    ] },
  [CRV.REGEN_V]: { name: 'Regen × tensão (SOBRETENSÃO)', xUnit: 'V', yUnit: '%',
    spec: { xMin: 250, xMax: 440, yMin: 0, yMax: 100, xScale: 0.1,
            xUnit: ' V', yUnit: '%',
            xLabel: 'tens\u00e3o do pack', yLabel: 'regen permitida (%)' },
    hint: 'PROTEÇÃO: bateria cheia não aceita carga. A regen tem que ' +
          'cair a ZERO perto de 42 V, senão a frenagem sobrecarrega o pack.',
    danger: true,
    presets: [
      { name: 'padrão 10s', pts: [{x:250,y:100},{x:405,y:100},{x:418,y:25},{x:425,y:0}] },
    ] },
  [CRV.TRAC_V]: { name: 'Tração × tensão', xUnit: 'V', yUnit: '%',
    spec: { xMin: 250, xMax: 440, yMin: 0, yMax: 100, xScale: 0.1,
            xUnit: ' V', yUnit: '%',
            xLabel: 'tens\u00e3o do pack', yLabel: 'pot\u00eancia permitida (%)' },
    hint: 'Reduz a potência conforme a tensão cai — impede a bateria fraca de afundar sob carga.',
    danger: true,
    presets: [
      { name: 'padrão 10s', pts: [{x:310,y:20},{x:320,y:45},{x:335,y:100},{x:440,y:100}] },
    ] },
  [CRV.THERMAL]: { name: 'Throttling térmico', xUnit: '°C', yUnit: '%',
    spec: { xMin: 0, xMax: 120, yMin: 0, yMax: 100, xUnit: '\u00b0C', yUnit: '%',
            xLabel: 'temperatura', yLabel: 'pot\u00eancia permitida (%)' },
    hint: 'Corte gradual de potência com a temperatura dos MOSFETs — o headroom térmico nasce desta curva.',
    danger: true,
    presets: [
      { name: 'padrão', pts: [{x:70,y:100},{x:90,y:0},{x:120,y:0}] },
    ] },
};

// Como o módulo INA240 amarrou os pinos REF, lido do zero medido com corrente
// comprovadamente nula. Só o primeiro caso permite medir corrente alternada.
const REF_TXT = ['bidirecional', 'REF no GND', 'REF no V+', 'ainda não medido'];
// Módulo REPROVADO = zero medido num extremo. O código 3 significa "ainda não
// medido", que não é reprovação — é só falta de calibração.
const refBad = (t) => t.iphRef1 === 1 || t.iphRef1 === 2
                   || t.iphRef2 === 1 || t.iphRef2 === 2;

// --- aba MONITOR (padrão): instrumentação completa ao vivo -------------------
function MonitorTab({ t, feat = {} }) {
  const pw = (t.vbat ?? 0) * (t.ibat ?? 0);
  const rpm = (t.kmh ?? 0) / 3.6 / 0.108 * 60 / (2 * Math.PI);
  // Os gauges tinham LARGURA FIXA (110 px x 4 = 440 px) dentro de uma linha sem
  // flexWrap: em qualquer telefone com menos de 440 px úteis eles saíam da tela.
  // Agora o tamanho vem da largura real, então cabe em qualquer aparelho.
  const { width } = useWindowDimensions();
  const avail = width - 2 * T.space.md;          // padding do ScrollView
  const g4 = Math.max(78, Math.min(120, Math.floor(avail / 4) - 6));
  const g2 = Math.max(120, Math.min(180, Math.floor(avail / 2) - 10));
  return (
    <View>
      <View style={st.gaugeRow}>
        <Gauge label="VELOCIDADE" value={Math.abs(t.kmh ?? 0)} unit="km/h"
          min={0} max={35} decimals={1} size={g2} />
        <Gauge label="POTÊNCIA" value={Math.abs(pw)} unit={pw < 0 ? 'W regen' : 'W'}
          min={0} max={900} size={g2}
          color={pw < 0 ? T.color.regen : T.color.accent} />
      </View>
      <View style={st.gaugeRow}>
        <Gauge label="CORRENTE" value={t.ibat ?? 0} unit="A"
          min={-15} max={35} decimals={1} size={g4}
          color={(t.ibat ?? 0) < -0.3 ? T.color.regen : T.color.accent}
          warnFrom={t.iLimit ?? 25} dangerFrom={(t.iLimit ?? 25) * 1.3} />
        <Gauge label="TENSÃO" value={t.vbat ?? 0} unit="V"
          min={30} max={43} decimals={1} size={g4}
          warnFrom={42} dangerFrom={42.5} />
        <Gauge label="TEMP FET" value={t.tempC ?? 0} unit="°C"
          min={0} max={110} size={g4} warnFrom={70} dangerFrom={90} />
        <Gauge label="TEMP MOTOR" value={t.motorTempC ?? 0} unit="°C"
          min={0} max={140} size={g4} warnFrom={100} dangerFrom={120} />
      </View>

      {/* CORRENTE DE FASE (INA240) — é o que a malha realimenta.
          |I| é a grandeza de proteção (não depende do ângulo do Hall);
          Iq medido x pedido mostra se a malha está seguindo. */}
      <View style={st.gaugeRow}>
        <Gauge label="|I| FASE" value={t.iphMag ?? 0} unit="A"
          min={0} max={50} decimals={1} size={g4}
          warnFrom={30} dangerFrom={45} />
        <Gauge label="Iq MEDIDO" value={t.iphQ ?? 0} unit="A"
          min={-25} max={45} decimals={1} size={g4}
          color={(t.iphQ ?? 0) < -0.3 ? T.color.regen : T.color.accent} />
        <Gauge label="Iq PEDIDO" value={t.iqTarget ?? 0} unit="A"
          min={-25} max={45} decimals={1} size={g4}
          color={T.color.textDim} />
        <Gauge label="Id MEDIDO" value={t.iphD ?? 0} unit="A"
          min={-25} max={25} decimals={1} size={g4}
          color={T.color.textDim} />
      </View>
      <View style={st.grid}>
        {[
          ['RPM',        rpm.toFixed(0), ''],
          ['ALVO',       t.targetV?.toFixed(1) ?? '--', t.modeVel ? 'rad/s' : 'A'],
          ['DUTY',       t.duty ?? '--', '%'],
          ['HEADROOM',   t.headroom ?? '--', '%'],
          ['POT. DISP.', t.scalePct ?? '--', '%'],
          ['LOOP GAP',   t.gapUs ?? '--', 'µs'],
          ['TRIP',       t.tripKm?.toFixed(2) ?? '--', 'km'],
          ['ODÔMETRO',   t.odoKm?.toFixed(1) ?? '--', 'km'],
          ['CONSUMO',    t.whPerKm?.toFixed(0) ?? '--', 'Wh/km'],
          ['AUTONOMIA',  t.rangeKm?.toFixed(0) ?? '--', 'km'],
          ['GASTO',      t.tripWh?.toFixed(0) ?? '--', 'Wh'],
          ['REGEN',      t.tripWhRegen?.toFixed(1) ?? '--', 'Wh'],
          ['CAP. PACK',  t.capWh || '--', 'Wh'],
          ['SOC',        t.soc ?? '--', '%'],
          // FW/MTPA só aparecem se a feature estiver ligada
          ...(feat.fw   !== false ? [['FW ATIVO',  t.fwA?.toFixed(1) ?? '--', 'A']] : []),
          ...(feat.mtpa !== false ? [['MTPA TRIM', t.mtpaDeg?.toFixed(1) ?? '--', '° el.']] : []),
          ['Vq',         t.vq?.toFixed(1) ?? '--', 'V'],
          ['I CRUA',     t.iRaw?.toFixed(1) ?? '--', 'A'],
          ['ERRO Iq',    ((t.iqTarget ?? 0) - (t.iphQ ?? 0)).toFixed(1), 'A'],
          ['FASE A',     t.iphA?.toFixed(1) ?? '--', 'A'],
          ['FASE B',     t.iphB?.toFixed(1) ?? '--', 'A'],
          ['FASE C',     t.iphC?.toFixed(1) ?? '--', 'A'],
          ['DUTY MÁX',   t.dutyMax ?? '--', '%'],
          // Rejeições: amostras de corrente que caíram FORA da janela
          // low-side. Zero é o normal. Subir = o duty encostou no teto e a
          // janela fechou — é o indicador de saúde do topo de velocidade.
          ['FORA DA JANELA', t.iphRejects ?? '--', ''],
          ['ZERO CH1',   t.iphZero1?.toFixed(2) ?? '--', 'V'],
          ['ZERO CH2',   t.iphZero2?.toFixed(2) ?? '--', 'V'],
          // Escala calibrada e o shunt que ela implica. É como se confere um
          // shunt trocado sem tirar a placa: R = 1/(ganho x escala).
          ['ESCALA CH1', t.iphScale1 ?? '--', 'A/V'],
          ['ESCALA CH2', t.iphScale2 ?? '--', 'A/V'],
          ['SHUNT CH1',  t.iphShunt1?.toFixed(2) ?? '--', 'mΩ'],
          ['SHUNT CH2',  t.iphShunt2?.toFixed(2) ?? '--', 'mΩ'],
          ['SEQ SKIP',   t.seqSkips ?? '--', ''],
          ['HALL RUÍDO', t.hallEps ?? '--', 'b/s'],
        ].map(([l, v, u]) => (
          <View key={l} style={st.cell}>
            <Text style={st.cellL}>{l}</Text>
            <Text style={st.cellV}>{v}<Text style={st.cellU}> {u}</Text></Text>
          </View>
        ))}
      </View>
      {/* Diagnóstico do módulo INA240: o zero medido revela como a placa
          amarrou os pinos REF, e isso decide se o hardware serve. */}
      {/* "Não serve" SÓ quando o zero foi medido e caiu num extremo (REF no GND
          ou no V+). Antes bastava não ser bidirecional, e o estado "ainda não
          medido" acusava um módulo bom como ruim. */}
      {refBad(t) && (
        <Text style={[st.hint, { color: T.color.danger }]}>
          ▲ MÓDULO INA240 NÃO SERVE PARA CORRENTE DE FASE.
          {'\n'}Zeros medidos: canal 1 = {t.iphZero1?.toFixed(2) ?? '--'} V (
          {REF_TXT[t.iphRef1]}), canal 2 = {t.iphZero2?.toFixed(2) ?? '--'} V (
          {REF_TXT[t.iphRef2]}).
          {'\n'}O zero precisa ficar perto da METADE da alimentação (~1,65 V em
          3,3 V) para medir os dois sentidos. Ler 1,4–1,6 V é normal: o ADC do
          ESP32 em 11 dB puxa para baixo no meio da escala, e a escala real é
          medida contra o INA226 na calibração. O problema é o zero encostado
          em 0 V ou em 3,3 V — aí metade da onda some, e isso não se corrige
          em software porque a corrente de fase é alternada.
          {'\n'}Conserto: no INA240, REF1 no 3,3 V e REF2 no GND (o divisor
          interno de 100k+100k põe o zero no meio). Se o módulo tem os dois no
          GND, levante o REF1 e leve ao 3,3 V.
        </Text>
      )}
      {t.iphOk === false && !refBad(t) && (
        <Text style={[st.hint, { color: T.color.danger }]}>
          ▲ MOTOR BLOQUEADO: a corrente de fase não está calibrada. Sem saber o
          sinal do sensor a malha vira realimentação positiva e o motor dispara,
          então o firmware não deixa ligar. Rode "Calibrar corrente de fase" na
          aba Parâmetros, com a RODA SUSPENSA.
        </Text>
      )}
      {(t.saturated || t.cruise || t.walk || t.locked || t.uvWarn || t.ecoAuto) && (
        <Text style={st.hint}>
          {t.saturated ? '▲ saturado  ' : ''}{t.cruise ? '· cruise  ' : ''}
          {t.walk ? '· walk  ' : ''}{t.locked ? '· travado  ' : ''}
          {t.uvWarn ? '· ▲ bateria fraca  ' : ''}{t.ecoAuto ? '· eco auto' : ''}
        </Text>
      )}
    </View>
  );
}

// --- aba CURVAS --------------------------------------------------------------
function CurvesTab({ ble, conn, onDragging }) {
  const [sel, setSel] = useState(CRV.THROTTLE);
  const [pts, setPts] = useState(null);
  const [ghost, setGhost] = useState(null);
  const [busy, setBusy] = useState(false);
  const meta = CURVE_META[sel];

  const load = useCallback(async (id) => {
    setPts(null);
    const p = await ble?.readCurve(id);
    if (p) { setPts(p); setGhost(p.map(q => ({ ...q }))); }
  }, [ble]);

  useEffect(() => { if (conn) load(sel); }, [conn, sel, load]);

  const apply = () => {
    const doIt = async () => {
      setBusy(true);
      const ok = await ble.writeCurve(sel, pts);
      if (!ok) Alert.alert('Falhou', 'A curva foi rejeitada ou a conexão caiu.');
      else { await load(sel); }
      setBusy(false);
    };
    if (meta.danger) {
      haptic(60);
      Alert.alert('Curva de PROTEÇÃO',
        `"${meta.name}" protege o hardware. Valores errados podem QUEIMAR ` +
        'o estágio de potência ou a bateria.\n\nAplicar mesmo assim?',
        [{ text: 'Cancelar', style: 'cancel' },
         { text: 'Sei o que estou fazendo', style: 'destructive', onPress: doIt }]);
    } else doIt();
  };

  const [selOpen, setSelOpen] = useState(false);
  return (
    <View>
      {/* seletor de curva: nome atual + lista completa em folha modal */}
      <Pressable style={st.selRow}
        onPress={() => { haptic(20); setSelOpen(true); }}
        accessibilityLabel="escolher curva">
        <View style={{ flex: 1 }}>
          <Text style={st.selName}>{meta.name}</Text>
          <Text style={st.selSub} numberOfLines={1}>{meta.hint}</Text>
        </View>
        {meta.danger && <Text style={st.selBadge}>PROTEÇÃO</Text>}
        <Ionicons name="chevron-expand-outline" size={18}
          color={T.color.textDim} />
      </Pressable>
      <Modal transparent visible={selOpen} animationType="fade"
        onRequestClose={() => setSelOpen(false)}>
        <Pressable style={st.selBack} onPress={() => setSelOpen(false)}>
          <View style={st.selSheet}>
            <Text style={st.selTitle}>CURVAS</Text>
            {Object.entries(CURVE_META).map(([id, m]) => (
              <Pressable key={id} style={st.selItem}
                onPress={() => { haptic(20); setSel(+id); setSelOpen(false); }}>
                <View style={{ flex: 1 }}>
                  <Text style={[st.selItemName,
                    +id === sel && { color: T.color.accent }]}>{m.name}</Text>
                  <Text style={st.selSub} numberOfLines={1}>{m.hint}</Text>
                </View>
                {m.danger && <Text style={st.selBadge}>PROTEÇÃO</Text>}
                {+id === sel && <Ionicons name="checkmark" size={16}
                  color={T.color.accent} />}
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
      <Text style={st.hint}>{meta.hint} Linha fantasma = curva gravada no
        firmware · zona vermelha = proibida (limite físico).</Text>
      {pts ? (
        <>
          <CurveEditor pts={pts} ghost={ghost} spec={meta.spec}
            presets={meta.presets} onChange={setPts} onDragging={onDragging} />
          <View style={{ flexDirection: 'row', gap: T.space.sm, marginTop: T.space.sm }}>
            <Btn variant="tertiary" label="Reverter"
              onPress={() => ghost && setPts(ghost.map(q => ({ ...q })))} />
            <Btn variant={meta.danger ? 'danger' : 'primary'}
              label="Aplicar curva" loading={busy} disabled={!conn}
              onPress={apply} style={{ flex: 1 }} />
          </View>
        </>
      ) : <Text style={st.hint}>{conn ? 'carregando…' : 'sem conexão'}</Text>}
    </View>
  );
}

// --- aba TUNING (stream + step response) -------------------------------------
// grandezas do frame de stream: chave no buffer, rótulo, cor e unidade
const TUN_SERIES = [
  { k: 'tgt',   label: 'alvo',    color: T.color.textDim,  u: 'km/h', d: 1 },
  { k: 'vel',   label: 'veloc',   color: T.color.traction, u: 'km/h', d: 1 },
  { k: 'i',     label: 'corr bat',color: T.color.accent,   u: 'A',    d: 1 },
  { k: 'iq',    label: 'Iq med',  color: '#F0A030',        u: 'A',    d: 1 },
  { k: 'iqt',   label: 'Iq alvo', color: '#F0A03060',      u: 'A',    d: 1 },
  { k: 'pw',    label: 'potência',color: '#4FA3E3',        u: 'W',    d: 0 },
  { k: 'duty',  label: 'duty',    color: T.color.warn,     u: '%',    d: 0 },
  { k: 'fw',    label: 'fw',      color: '#A78BFA',        u: 'A',    d: 1 },
  { k: 'scale', label: 'limite',  color: '#FF7A9E',        u: '%',    d: 0 },
  { k: 'vbat',  label: 'tensão',  color: T.color.regen,    u: 'V',    d: 1 },
  { k: 'temp',  label: 'temp',    color: T.color.danger,   u: '°C',   d: 0 },
];

function TuningTab({ ble, conn, t, feat = {} }) {
  // série 'fw' some da legenda/gráfico quando o field weakening está desligado
  const SERIES = TUN_SERIES.filter(m => m.k !== 'fw' || feat.fw !== false);
  const [live, setLive] = useState(false);
  const [vis, setVis] = useState(
    { tgt: true, vel: true, i: false, iq: true, iqt: true, pw: false,
      duty: false, fw: false, scale: false, vbat: false, temp: false });
  const [frozen, setFrozen] = useState(false);
  const frozenRef = useRef(false);
  const [amp, setAmp] = useState('3');
  const [stepData, setStepData] = useState(null);
  const [metrics, setMetrics] = useState(null);
  const [busy, setBusy] = useState(false);
  const bufRef = useRef({ tgt: [], vel: [], i: [], iq: [], iqt: [], pw: [],
                          duty: [], fw: [], scale: [], vbat: [], temp: [] });
  const [, force] = useState(0);

  useEffect(() => () => { ble?.streamStop(); }, [ble]);

  const toggleLive = async () => {
    if (live) { await ble.streamStop(); setLive(false); return; }
    bufRef.current = { tgt: [], vel: [], i: [], iq: [], iqt: [], pw: [],
                       duty: [], fw: [], scale: [], vbat: [], temp: [] };
    await ble.streamStart(50, f => {
      if (frozenRef.current) return;             // congelado: descarta
      const b = bufRef.current;
      b.tgt.push(f.target); b.vel.push(f.kmh); b.i.push(f.ibat);
      b.iq.push(f.iq ?? 0); b.iqt.push(f.iqt ?? 0);   // malha de corrente
      b.pw.push(f.vbat * f.ibat);                // potência = V x I (de graça)
      b.duty.push(f.duty); b.vbat.push(f.vbat); b.temp.push(f.temp);
      b.fw.push(f.fwA ?? 0); b.scale.push(f.scale ?? 100);
      if (b.tgt.length > 300)
        for (const k of Object.keys(b)) b[k].shift();
    });
    setLive(true);
    const iv = setInterval(() => force(x => x + 1), 100);
    setTimeout(() => clearInterval(iv), 3600 * 1000);
  };

  const runStep = () => {
    haptic(60);
    Alert.alert('Step response',
      'Aplica um DEGRAU de velocidade e captura 1,5 s a 1 kHz.\n\n' +
      'RODA SUSPENSA E LIVRE — o motor acelera sozinho!',
      [{ text: 'Cancelar', style: 'cancel' },
       { text: 'Aplicar degrau', style: 'destructive', onPress: async () => {
          setBusy(true); setStepData(null); setMetrics(null);
          ble.send(CMD.STEP, parseFloat(amp) || 3);
          await new Promise(r => setTimeout(r, 2500));
          const raw = await ble.bulkDownload(1);
          ble.send(CMD.CAP_FREE, 1);
          if (raw && raw.length >= 6) {
            const dv = new DataView(raw.buffer);
            const n = Math.floor(raw.length / 6);
            const tgt = [], vel = [];
            for (let i = 0; i < n; i++) {
              tgt.push(dv.getInt16(i * 6, true) / 100);
              vel.push(dv.getInt16(i * 6 + 2, true) / 100);
            }
            setStepData({ tgt, vel });
            // métricas: degrau começa na amostra 250
            const base = tgt[0], fin = tgt[n - 1];
            const stepMag = fin - base;
            if (Math.abs(stepMag) > 0.1) {
              let peak = -Infinity;
              for (let i = 250; i < n; i++) peak = Math.max(peak, vel[i]);
              const overshoot = Math.max(0, (peak - fin) / stepMag * 100);
              const v10 = base + 0.1 * stepMag, v90 = base + 0.9 * stepMag;
              let t10 = -1, t90 = -1;
              for (let i = 250; i < n; i++) {
                if (t10 < 0 && vel[i] >= v10) t10 = i - 250;
                if (t90 < 0 && vel[i] >= v90) t90 = i - 250;
              }
              const tail = vel.slice(n - 200);
              const ssErr = fin - tail.reduce((a, c) => a + c, 0) / tail.length;
              setMetrics({
                overshoot: overshoot.toFixed(1),
                rise: t10 >= 0 && t90 >= 0 ? (t90 - t10) : null,
                sse: ssErr.toFixed(2),
              });
            }
          } else {
            Alert.alert('Sem captura', 'O firmware não liberou a captura — ' +
              'o motor está habilitado?');
          }
          setBusy(false);
       } }]);
  };

  const b = bufRef.current;
  const stat = (arr) => {
    if (!arr.length) return null;
    let mn = Infinity, mx = -Infinity, sum = 0;
    for (const v of arr) { if (v < mn) mn = v; if (v > mx) mx = v; sum += v; }
    return { cur: arr[arr.length - 1], mn, mx, avg: sum / arr.length };
  };
  let errAvg = null;
  if (b.tgt.length > 10) {
    let sum = 0;
    for (let i = 0; i < b.tgt.length; i++) sum += Math.abs(b.tgt[i] - b.vel[i]);
    errAvg = sum / b.tgt.length;
  }
  return (
    <View>
      <SectionLabel right="alvo × resposta ao vivo">Stream 50 Hz</SectionLabel>
      <LineChart height={150} showLegend={false}
        series={SERIES.filter(m => vis[m.k])
          .map(m => ({ data: b[m.k], color: m.color, label: m.label,
                       thin: m.k === 'tgt' }))} />
      {/* legenda INTERATIVA: toque esconde/mostra a linha */}
      <View style={st.tunLegRow}>
        {SERIES.map(m => (
          <Pressable key={m.k} style={st.tunLegChip}
            accessibilityLabel={`${vis[m.k] ? 'esconder' : 'mostrar'} ${m.label}`}
            onPress={() => setVis(v => ({ ...v, [m.k]: !v[m.k] }))}>
            <View style={[st.tunLegSw, { backgroundColor: m.color },
              !vis[m.k] && { opacity: 0.25 }]} />
            <Text style={[st.tunLegTxt, !vis[m.k] && { opacity: 0.35 }]}>
              {m.label}</Text>
          </Pressable>
        ))}
        <Pressable style={[st.tunLegChip, { marginLeft: 'auto' }]}
          accessibilityLabel={frozen ? 'retomar gráfico' : 'congelar gráfico'}
          onPress={() => { frozenRef.current = !frozen; setFrozen(!frozen); }}>
          <Ionicons name={frozen ? 'play-outline' : 'pause-outline'} size={14}
            color={frozen ? T.color.accent : T.color.textDim} />
          <Text style={[st.tunLegTxt, frozen && { color: T.color.accent }]}>
            {frozen ? 'retomar' : 'congelar'}</Text>
        </Pressable>
      </View>
      {/* estatísticas da janela (6 s): atual · mín · máx por série visível */}
      {b.tgt.length > 10 && (
        <View style={st.tunStats}>
          <View style={st.tunStatRow}>
            <Text style={[st.tunStatCell, st.tunStatHead]}>série</Text>
            <Text style={[st.tunStatCell, st.tunStatHead]}>atual</Text>
            <Text style={[st.tunStatCell, st.tunStatHead]}>mín</Text>
            <Text style={[st.tunStatCell, st.tunStatHead]}>máx</Text>
          </View>
          {SERIES.filter(m => vis[m.k]).map(m => {
            const sti = stat(b[m.k]);
            return sti && (
              <View key={m.k} style={st.tunStatRow}>
                <Text style={[st.tunStatCell, { color: m.color }]}>{m.label}</Text>
                <Text style={st.tunStatCell}>{sti.cur.toFixed(m.d)}{m.u}</Text>
                <Text style={st.tunStatCell}>{sti.mn.toFixed(m.d)}</Text>
                <Text style={st.tunStatCell}>{sti.mx.toFixed(m.d)}</Text>
              </View>
            );
          })}
          {errAvg !== null && vis.tgt && vis.vel && (
            <Text style={st.tunErr}>erro médio alvo × veloc:
              {' '}{errAvg.toFixed(2)} km/h</Text>
          )}
        </View>
      )}
      <Btn label={live ? 'Parar stream' : 'Iniciar stream'} disabled={!conn}
        onPress={toggleLive} style={{ marginTop: T.space.sm }} />

      <SectionLabel right="roda suspensa!">Step response (PID)</SectionLabel>
      <View style={{ flexDirection: 'row', gap: T.space.sm, alignItems: 'center' }}>
        <Text style={st.hint}>degrau de</Text>
        <TextInput style={st.ampIn} value={amp} onChangeText={setAmp}
          keyboardType="numeric" />
        <Text style={st.hint}>km/h</Text>
        <Btn variant="danger" label="Aplicar degrau" loading={busy}
          disabled={!conn || !t.enabled} onPress={runStep} style={{ flex: 1 }} />
      </View>
      {!t.enabled && <Text style={st.hint}>ligue o motor no Piloto primeiro</Text>}
      {stepData && (
        <>
          <LineChart height={170}
            series={[
              { data: stepData.tgt, color: T.color.accent, label: 'comando', thin: true },
              { data: stepData.vel, color: T.color.traction, label: 'resposta' },
            ]} xLabel="1,5 s @ 1 kHz" />
          {metrics && (
            <View style={st.metRow}>
              <Text style={st.metTxt}>overshoot {metrics.overshoot}%</Text>
              <Text style={st.metTxt}>
                subida {metrics.rise !== null ? `${metrics.rise} ms` : '—'}</Text>
              <Text style={st.metTxt}>erro regime {metrics.sse} km/h</Text>
            </View>
          )}
          <Text style={st.hint}>Ajuste os ganhos P/I na aba Parâmetros e repita.
            Overshoot alto → desça P ou I; resposta lenta → suba P.</Text>
        </>
      )}
    </View>
  );
}

// --- aba REGISTROS -----------------------------------------------------------
const FAULT_BITS = [[1,'sobrecorrente'],[2,'subtensão'],[4,'sobretemp'],
  [8,'sensor'],[16,'e-stop'],[32,'dead-man'],[64,'aviso bateria'],
  [128,'stall (fase protegida)']];

function LogsTab({ ble, conn, session, send }) {
  const [faults, setFaults] = useState(null);
  const [busy, setBusy] = useState('');

  const loadFaults = async () => {
    setBusy('faltas');
    const raw = await ble.bulkDownload(2);
    const out = [];
    if (raw) {
      const dv = new DataView(raw.buffer);
      for (let off = 0; off + 16 <= raw.length; off += 16) {
        out.push({                                     // FaultEntry packed 16 B
          odoKm:  dv.getUint32(off, true) / 1000,
          upt:    dv.getUint32(off + 4, true),
          bits:   dv.getUint8(off + 8),
          ibat:   dv.getInt16(off + 9, true) / 10,
          vbat:   dv.getUint16(off + 11, true) / 10,
          temp:   dv.getInt8(off + 13),
          kmh:    dv.getInt16(off + 14, true) / 10,
        });
      }
    }
    setFaults(out);
    setBusy('');
  };

  // CSV SIMPLES da viagem (o datalog pesado é a aba Debug).
  const exportCsv = async () => {
    const s = session.current;
    if (!s.length) { Alert.alert('Sem dados', 'Nada registrado ainda.'); return; }
    let csv = 't_s,kmh,ibat_A,vbat_V,temp_C,duty_pct,faults\n';
    for (const r of s)
      csv += `${r.t},${r.kmh},${r.ibat},${r.vbat},${r.temp},${r.duty},${r.faults}\n`;
    try {
      const uri = FileSystem.cacheDirectory + 'viagem.csv';
      await FileSystem.writeAsStringAsync(uri, csv);
      if (await Sharing.isAvailableAsync())
        await Sharing.shareAsync(uri, { mimeType: 'text/csv' });
    } catch (e) { Alert.alert('Falhou', e.message); }
  };

  const ota = () => {
    haptic(60);
    Alert.alert('Atualização de firmware (OTA)',
      'O motor será TRAVADO e o patinete sai do ar. Ele sobe a rede WiFi ' +
      '"Patinete-OTA" (senha patinete123) — conecte e abra http://192.168.4.1 ' +
      'para enviar o firmware.bin.\n\nSem upload em 5 min, volta ao normal.',
      [{ text: 'Cancelar', style: 'cancel' },
       { text: 'Entrar em modo OTA', style: 'destructive',
         onPress: () => send(CMD.OTA, 1) }]);
  };

  const s = session.current;
  const mins = s.length ? Math.round((s[s.length - 1].t - s[0].t) / 60000) : 0;
  // downsample SÓ para o gráfico (~300 pts): o CSV exporta o log INTEGRAL.
  const g = [];
  const step = Math.max(1, Math.floor(s.length / 300));
  for (let i = 0; i < s.length; i += step) g.push(s[i]);
  return (
    <View>
      <SectionLabel right={`${s.length} amostras · ${mins} min`}>
        Data-log da viagem</SectionLabel>
      {s.length > 10 ? (
        <LineChart height={150}
          series={[
            { data: g.map(r => r.kmh),  color: T.color.traction, label: 'km/h' },
            { data: g.map(r => r.ibat), color: T.color.accent,   label: 'A' },
            { data: g.map(r => r.temp), color: T.color.warn,     label: '°C', thin: true },
            { data: g.map(r => r.duty ?? 0), color: T.color.regen, label: 'duty%', thin: true },
          ]} />
      ) : <Text style={st.hint}>registrando… ande um pouco para ver o gráfico</Text>}
      <Text style={st.hint}>Resumo leve da viagem (2 Hz). Para debug de baixo
        nível, use a aba Debug (50 Hz, todos os campos do core).</Text>
      <Btn label="Exportar viagem (CSV)" onPress={exportCsv}
        disabled={!s.length} style={{ marginTop: T.space.sm }} />

      <SectionLabel>Log de faltas (persistente)</SectionLabel>
      <Btn label="Baixar log de faltas" loading={busy === 'faltas'}
        disabled={!conn} onPress={loadFaults} />
      {faults && faults.length === 0 && (
        <Text style={st.hint}>nenhuma falta registrada</Text>)}
      {faults && faults.map((f, i) => (
        <View key={i} style={st.faultRow}>
          <Text style={st.faultRowTitle}>
            {FAULT_BITS.filter(([b]) => f.bits & b).map(([, n]) => n).join(' + ') || `0x${f.bits.toString(16)}`}
          </Text>
          <Text style={st.faultRowSub}>
            {f.odoKm.toFixed(1)} km · {f.ibat.toFixed(1)} A · {f.vbat.toFixed(1)} V ·
            {' '}{f.temp} °C · {f.kmh.toFixed(0)} km/h
          </Text>
        </View>
      ))}
      {faults && faults.length > 0 && (
        <Btn variant="danger" label="Apagar log de faltas" disabled={!conn}
          onPress={() => send(CMD.FLOG_CLEAR, 1)} style={{ marginTop: T.space.sm }} />)}

      <SectionLabel>Firmware</SectionLabel>
      <Btn variant="danger" label="Atualizar firmware (modo OTA)"
        disabled={!conn} onPress={ota} />
    </View>
  );
}

// --- aba DEBUG: datalogger de baixo nível (50 Hz, todos os campos) -----------
function DebugTab({ ble, conn, debug }) {
  // estado vem do ble => a gravação SEGUE mesmo trocando de aba (dá p/ ver o
  // Monitor enquanto grava); só para no botão Parar.
  const [rec, setRec] = useState(!!ble?.debugActive);
  const [busy, setBusy] = useState(false);
  const [, force] = useState(0);

  useEffect(() => {                 // tick do contador enquanto grava
    if (!rec) return;
    const iv = setInterval(() => force(x => x + 1), 300);
    return () => clearInterval(iv);
  }, [rec]);

  const start = async () => {
    debug.current = [];
    const ok = await ble.debugStart(50, (t) => {
      const arr = debug.current;
      arr.push(logRow(t, Date.now()));
      if (arr.length > 216000) arr.splice(0, 21600);   // ~72 min: anel (poda 10%)
    });
    if (ok) { haptic(40); setRec(true); }
    else Alert.alert('Sem conexão', 'Conecte ao patinete primeiro.');
  };
  const stop = async () => { await ble.debugStop(); setRec(false); haptic(40); };
  const clear = () => { debug.current = []; force(x => x + 1); haptic(20); };

  const exportCsv = async () => {
    const s = debug.current;
    if (!s.length) { Alert.alert('Sem dados', 'Grave algo antes de exportar.'); return; }
    setBusy(true);
    try {
      const csv = logToCsv(s);
      const d = new Date();
      const p = n => String(n).padStart(2, '0');
      const name = `debug_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
                   `_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.csv`;
      const uri = FileSystem.cacheDirectory + name;
      await FileSystem.writeAsStringAsync(uri, csv);
      if (await Sharing.isAvailableAsync())
        await Sharing.shareAsync(uri, { mimeType: 'text/csv',
          dialogTitle: 'Datalog de debug (CSV)' });
      else Alert.alert('Salvo', uri);
    } catch (e) { Alert.alert('Falhou', e.message); }
    setBusy(false);
  };

  const n = debug.current.length;
  const secs = n ? (debug.current[n - 1].t - debug.current[0].t) / 1000 : 0;
  const hz = secs > 1 ? Math.round(n / secs) : 0;
  const kb = Math.round(n * LOG_COLS.length * 6.5 / 1024);

  return (
    <View>
      <SectionLabel right={`${LOG_COLS.length} campos · 50 Hz`}>
        Datalogger de debug</SectionLabel>

      {/* cartão de status: indicador GRAVANDO + contadores ao vivo */}
      <View style={[st.dbgCard, rec && st.dbgCardRec]}>
        <View style={st.dbgRow}>
          <View style={[st.dbgDot, { backgroundColor: rec ? T.color.danger
                                                            : T.color.textDim }]} />
          <Text style={st.dbgState}>{rec ? 'GRAVANDO' : (n ? 'PARADO' : 'PRONTO')}</Text>
        </View>
        <View style={st.dbgStats}>
          <View style={st.dbgStat}>
            <Text style={st.dbgNum}>{n}</Text><Text style={st.dbgLbl}>amostras</Text></View>
          <View style={st.dbgStat}>
            <Text style={st.dbgNum}>{secs.toFixed(0)}</Text><Text style={st.dbgLbl}>seg</Text></View>
          <View style={st.dbgStat}>
            <Text style={st.dbgNum}>{hz || '—'}</Text><Text style={st.dbgLbl}>Hz real</Text></View>
          <View style={st.dbgStat}>
            <Text style={st.dbgNum}>{kb}</Text><Text style={st.dbgLbl}>KB</Text></View>
        </View>
      </View>

      <Btn variant={rec ? 'danger' : 'primary'}
        label={rec ? 'Parar gravação' : 'Iniciar gravação'}
        disabled={!conn} onPress={rec ? stop : start}
        style={{ marginTop: T.space.md }} />
      <View style={{ flexDirection: 'row', gap: T.space.sm, marginTop: T.space.sm }}>
        <Btn variant="tertiary" label="Limpar" onPress={clear}
          disabled={rec || !n} />
        <Btn label="Exportar CSV" onPress={exportCsv} loading={busy}
          disabled={rec || !n} style={{ flex: 1 }} />
      </View>

      <Text style={st.hint}>Grava TODO o estado do core a 50 Hz (5× a
        telemetria) — entrada do piloto, tensões d/q, corrente crua, ângulo
        elétrico, saúde dos halls (skips/eps por pino), foldback, derates,
        gap do loop… {LOG_COLS.length} colunas. Não exibe nada (só grava);
        exporte o CSV e analise no PC. Ideal para caçar problema escondido:
        deixe gravando, reproduza o sintoma, pare e exporte.</Text>
    </View>
  );
}

// --- Oficina (com PIN) -------------------------------------------------------
export default function Workshop(props) {
  const [unlocked, setUnlocked] = useState(false);
  const [tab, setTab] = useState('mon');
  const [scrollLock, setScrollLock] = useState(false);
  const conn = props.status === 'connected';

  // Flags de feature (lidas dos parâmetros): células/séries de uma feature
  // desligada SOMEM do monitor e dos registros.
  const [feat, setFeat] = useState({ mtpa: true, fw: true });
  useEffect(() => {
    let alive = true;
    if (conn && unlocked && props.ble?.readParams) {
      props.ble.readParams().then(p => {
        if (alive && p) setFeat({
          mtpa: featOn(p, P.MTPA), fw: fwOn(p),
          coast: featOn(p, P.COAST),
          battLearn: featOn(p, P.BATT_LEARN),
        });
      }).catch(() => {});
    }
    return () => { alive = false; };
  }, [conn, unlocked, props.ble, tab]);

  const unlock = async () => {
    if (LocalAuth) {
      try {
        const has = await LocalAuth.hasHardwareAsync();
        if (has) {
          const r = await LocalAuth.authenticateAsync({
            promptMessage: 'Desbloquear a Oficina',
            cancelLabel: 'Cancelar',
          });
          if (r.success) { haptic(25); setUnlocked(true); }
          return;
        }
      } catch (e) {}
    }
    // sem módulo nativo (dev client antigo): confirmação simples
    Alert.alert('Oficina', 'Biometria indisponível neste build. Entrar assim mesmo?',
      [{ text: 'Cancelar', style: 'cancel' },
       { text: 'Entrar', onPress: () => setUnlocked(true) }]);
  };

  if (!unlocked) {
    return (
      <View style={st.pinWrap}>
        <Ionicons name="construct-outline" size={40} color={T.color.textDim} />
        <Text style={st.pinTitle}>OFICINA</Text>
        <Text style={[st.hint, { textAlign: 'center' }]}>Área técnica — parâmetros
          que podem danificar o hardware.</Text>
        <Btn variant="primary" label="Desbloquear" onPress={unlock}
          style={{ alignSelf: 'stretch', marginTop: T.space.lg }} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <View style={st.wtabs}>
        {[['mon', 'Monitor', 'pulse-outline'],
          ['par', 'Parâmetros', 'options-outline'],
          ['crv', 'Curvas', 'analytics-outline'],
          ['tun', 'Tuning', 'flash-outline'],
          ['log', 'Registros', 'document-text-outline'],
          ['dbg', 'Debug', 'bug-outline']].map(([id, name, icon]) => (
          <Pressable key={id} style={st.wtab} onPress={() => { haptic(20); setTab(id); }}>
            <Ionicons name={icon} size={18}
              color={tab === id ? T.color.accent : T.color.textDim} />
            <Text style={[st.wtabTxt, tab === id && { color: T.color.accent }]}>
              {name}</Text>
          </Pressable>
        ))}
      </View>
      {tab === 'par' ? <Config {...props} /> : (
        <ScrollView style={{ flex: 1, paddingHorizontal: T.space.md }}
          contentContainerStyle={{ paddingBottom: 60 }}
          keyboardShouldPersistTaps="handled"
          scrollEnabled={!scrollLock}>
          {tab === 'mon' && <MonitorTab t={props.t} feat={feat} />}
          {tab === 'crv' && <CurvesTab ble={props.ble} conn={conn}
                              onDragging={setScrollLock} />}
          {tab === 'tun' && <TuningTab ble={props.ble} conn={conn} t={props.t} feat={feat} />}
          {tab === 'log' && <LogsTab ble={props.ble} conn={conn}
                              session={props.session} send={props.send} />}
          {tab === 'dbg' && <DebugTab ble={props.ble} conn={conn}
                              debug={props.debug} />}
        </ScrollView>
      )}
    </View>
  );
}

const st = StyleSheet.create({
  dbgCard: { backgroundColor: T.color.surface1, borderRadius: T.radius.card,
             padding: T.space.md, marginTop: T.space.sm,
             borderWidth: 1, borderColor: 'transparent' },
  dbgCardRec: { borderColor: T.color.danger },
  dbgRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dbgDot: { width: 12, height: 12, borderRadius: 6 },
  dbgState: { ...T.type.label, color: T.color.text, letterSpacing: 2 },
  dbgStats: { flexDirection: 'row', justifyContent: 'space-between',
              marginTop: T.space.md },
  dbgStat: { alignItems: 'center', flex: 1 },
  dbgNum: { fontSize: 22, fontWeight: '300', color: T.color.text,
            fontVariant: ['tabular-nums'] },
  dbgLbl: { ...T.type.micro, color: T.color.textDim, marginTop: 2 },
  // abas da oficina: fixas, com ícone, sem quebra de linha
  wtabs: { flexDirection: 'row', paddingHorizontal: T.space.xs,
           borderBottomWidth: T.size.hairline, borderBottomColor: T.color.divider },
  wtab: { flex: 1, alignItems: 'center', paddingVertical: T.space.sm, gap: 2,
          minHeight: T.size.touch },
  wtabTxt: { fontSize: 9, fontWeight: '600', letterSpacing: 0.4,
             color: T.color.textDim },

  // seleção de curva: linha-resumo + folha modal com a lista completa
  selRow: { flexDirection: 'row', alignItems: 'center', gap: T.space.md,
            backgroundColor: T.color.surface1, borderRadius: T.radius.card,
            padding: T.space.md, marginTop: T.space.sm },
  selName: { ...T.type.body, color: T.color.text, fontWeight: '600' },
  selSub: { ...T.type.micro, color: T.color.textMut, marginTop: 2 },
  selBadge: { ...T.type.micro, color: T.color.danger, fontWeight: '700',
              letterSpacing: 1.2, borderWidth: 1, borderColor: T.color.danger,
              borderRadius: T.radius.chip, paddingHorizontal: 6,
              paddingVertical: 2, overflow: 'hidden' },
  selBack: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)',
             justifyContent: 'center', padding: T.space.lg },
  selSheet: { backgroundColor: T.color.surface1, borderRadius: T.radius.card,
              padding: T.space.md },
  selTitle: { ...T.type.micro, color: T.color.textDim, letterSpacing: 2,
              marginBottom: T.space.sm, marginLeft: T.space.sm },
  selItem: { flexDirection: 'row', alignItems: 'center', gap: T.space.md,
             paddingVertical: T.space.md, paddingHorizontal: T.space.sm,
             borderTopWidth: T.size.hairline, borderTopColor: T.color.divider },
  selItemName: { ...T.type.body, color: T.color.text },

  // tuning: legenda interativa + tabela de estatisticas
  tunLegRow: { flexDirection: 'row', flexWrap: 'wrap', gap: T.space.sm,
               marginTop: T.space.sm, alignItems: 'center' },
  tunLegChip: { flexDirection: 'row', alignItems: 'center', gap: 5,
                paddingVertical: 4, paddingHorizontal: 8,
                borderWidth: 1, borderColor: T.color.border,
                borderRadius: T.radius.chip },
  tunLegSw: { width: 12, height: 3, borderRadius: 2 },
  tunLegTxt: { fontSize: 11, color: T.color.textMut, letterSpacing: 0.4 },
  tunStats: { marginTop: T.space.sm, borderTopWidth: T.size.hairline,
              borderTopColor: T.color.divider },
  tunStatRow: { flexDirection: 'row', paddingVertical: 3 },
  tunStatCell: { flex: 1, fontSize: 11, color: T.color.text,
                 fontVariant: ['tabular-nums'] },
  tunStatHead: { color: T.color.textDim, letterSpacing: 1 },
  tunErr: { fontSize: 11, color: T.color.textMut, marginTop: 4,
            fontVariant: ['tabular-nums'] },

  // monitor
  gaugeRow: { flexDirection: 'row', flexWrap: 'wrap',
              justifyContent: 'space-evenly',
              alignItems: 'flex-end', marginTop: T.space.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: T.space.md,
          borderTopWidth: T.size.hairline, borderTopColor: T.color.divider },
  cell: { width: '33.33%', paddingVertical: T.space.sm, alignItems: 'center',
          borderBottomWidth: T.size.hairline, borderBottomColor: T.color.divider },
  cellL: { fontSize: 9, fontWeight: '600', letterSpacing: 1.2,
           color: T.color.textDim },
  cellV: { fontSize: 17, fontWeight: '400', color: T.color.text,
           fontVariant: ['tabular-nums'], marginTop: 2 },
  cellU: { fontSize: 10, color: T.color.textMut },
  hint: { ...T.type.micro, color: T.color.textMut, marginVertical: T.space.sm,
          lineHeight: 15 },

  ampIn: { backgroundColor: T.color.surface2, borderRadius: T.radius.control,
           color: T.color.text, minWidth: 54, minHeight: 44, textAlign: 'center',
           fontSize: 16, fontWeight: '500',
           borderWidth: 1, borderColor: T.color.border },
  metRow: { flexDirection: 'row', justifyContent: 'space-between',
            borderTopWidth: 1, borderTopColor: T.color.divider,
            borderBottomWidth: 1, borderBottomColor: T.color.divider,
            paddingVertical: T.space.sm, marginTop: T.space.sm },
  metTxt: { ...T.type.micro, color: T.color.text, letterSpacing: 0.5,
            fontVariant: T.type.tabular },

  faultRow: { borderBottomWidth: 1, borderBottomColor: T.color.divider,
              paddingVertical: T.space.sm },
  faultRowTitle: { ...T.type.body, color: T.color.danger },
  faultRowSub: { ...T.type.micro, color: T.color.textMut, marginTop: 2,
                 fontVariant: T.type.tabular },

  pinWrap: { flex: 1, alignItems: 'center', justifyContent: 'center',
             padding: T.space.xxl, gap: T.space.sm },
  pinTitle: { ...T.type.label, color: T.color.text, fontSize: 15,
              letterSpacing: 6 },
});
