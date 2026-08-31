// ============================================================================
// Config.js — MODO OFICINA (tabela de especificação, densa e técnica)
// ----------------------------------------------------------------------------
// Grupos por assunto. Cada FEATURE tem um botão liga/desliga; ao desligar, as
// configs que dependem dela ficam OPACAS e BLOQUEADAS (não somem). Desligar uma
// feature "de valor" (ex.: field weakening) guarda o valor atual e zera o real —
// religar devolve o valor de antes. Nada é enviado até APLICAR (confirmado).
// ============================================================================
import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, Alert,
  KeyboardAvoidingView, Platform, Pressable,
} from 'react-native';
import { T } from './theme';
import { CMD, setBattWh } from './ble';
import { Btn, SectionLabel, haptic } from './ui';

// --- catálogo (espelho EXATO do enum de params.h do firmware) ----------------
// A ordem do enum define os ids; mexer aqui sem mexer lá quebra tudo em
// silêncio (o app escreve por id). Confira contra params.h ao atualizar.
export const P = {
  KE: 1, IQ_MAX: 2, MODCEIL: 3, SLEW_UP: 4, SLEW_REL: 5, ACCEL: 6,
  DECEL: 7, BRAKE_DEC: 8, SPD_BAND: 9, PID_P: 10, PID_I: 11, LPF_TF: 12,
  OC_TRIP: 13, REGEN_I: 14, UV_CUT: 15, /* 16 vago */ T_CUT: 17,
  WHEEL_MM: 18, FW_START: 19, FW_MAX_A: 20, SHUNT_MOHM: 21, ZEA: 22,
  BATT_WH: 23, DIR_INVERT: 24, MTPA: 25, ECO_AUTO: 26,
  PWM_FREQ: 27, MAX_KMH: 28, ILIM_A: 29, VLIM: 30,
  UV_WARN: 31, UV_RECOVER: 32,
  ECO_VMAX: 33, ECO_ILIM: 34, NOR_VMAX: 35, NOR_ILIM: 36, BATT_VMAX: 37,
  IPH_TRIP: 38, COAST: 39, BATT_LEARN: 40,
  TRAC_DERATE: 41, THERM_DERATE: 42, MT_DERATE: 43, MT_CUT: 44,
  // --- malha de corrente de fase (INA240) ---
  CUR_P: 45, CUR_I: 46, CUR_TF: 47, PH_SHUNT: 48, PH_GAIN: 49,
  // --- medidos pela calibração / timing de comutação ---
  SENS_DIR: 50, COMM_LEAD: 51, UD_MAX: 52, CUR_DB: 53,
};

// Estado LIGADO de uma feature, considerando a edição ao vivo (>= 0.5 = ligada;
// vale p/ toggle 0/1 e p/ feature de valor como FW, cujo "desligado" é 0).
const featOnLive = (id, params, edits) => {
  const eff = edits?.[id] !== undefined ? parseFloat(edits[id]) : params?.[id]?.val;
  return eff !== undefined && !isNaN(eff) && eff >= 0.5;
};
// Exports usados pela Oficina/telemetria (feature ligada a partir do param cru)
export const featOn = (params, id) => !params?.[id] || params[id].val >= 0.5;
export const fwOn = (params) => Math.abs(params?.[P.FW_MAX_A]?.val || 0) >= 0.05;

// Tipos de linha: numérica | toggle booleano (feat) | toggle de valor (vfeat).
// dep = id da feature-mãe: a linha fica OPACA+BLOQUEADA quando ela está off.
// ro  = MEDIDO pela calibração: mostra, não deixa digitar. Campo editável para
//       um valor que só a calibração sabe é convite para estragá-lo à mão.
const GROUPS = [
  { title: 'Limites', items: [
    { id: P.MAX_KMH, l: 'Velocidade máxima',  u: 'km/h', d: 0,
      h: 'Teto geral. O modo de pilotagem e o slider do painel reduzem por cima — se a velocidade parar antes disto, o culpado é um dos dois.' },
    { id: P.ILIM_A,  l: 'Corrente da bateria', u: 'A',    d: 0, h: 'Limite no barramento (INA226).' },
    { id: P.IQ_MAX,  l: 'Corrente de fase',    u: 'A',    d: 0, h: 'O que o punho cheio pede. É o torque máximo.' },
    { id: P.VLIM,    l: 'Tensão máxima',       u: 'V',    d: 1,
      h: 'DEIXE NO MÁXIMO (42). O firmware já corta sozinho no teto de amostragem — baixar aqui só rouba velocidade de topo, em silêncio.' },
  ]},
  { title: 'Modos de pilotagem', items: [
    { id: P.ECO_VMAX, l: 'ECO · velocidade',    u: 'km/h', d: 0 },
    { id: P.ECO_ILIM, l: 'ECO · corrente',      u: 'A',    d: 0 },
    { id: P.NOR_VMAX, l: 'NORMAL · velocidade', u: 'km/h', d: 0 },
    { id: P.NOR_ILIM, l: 'NORMAL · corrente',   u: 'A',    d: 0, h: 'TURBO usa os Limites direto.' },
  ]},
  { title: 'Motor (medido pela calibração)', items: [
    { id: P.ZEA,        l: 'Ângulo zero FOC',  u: 'rad',     d: 4, ro: true,
      h: 'MEDIDO. "Calibrar ângulo" acha o setor, "Afinar ângulo" acha o resto dentro dele.' },
    { id: P.SENS_DIR,   l: 'Direção do sensor', u: '±1',     d: 0, ro: true,
      h: 'MEDIDO junto com o ângulo — é um fato da fiação dos Halls. Para trocar o sentido de giro use "Inverter sentido".' },
    { id: P.KE,         l: 'Ke do motor',      u: 'V/rad/s', d: 3, ro: true,
      h: 'MEDIDO. Não gera torque; a proteção de realimentação o usa para saber quando a tensão acabou.' },
    { id: P.WHEEL_MM,   l: 'Diâmetro da roda', u: 'mm',      d: 0 },
    { id: P.PWM_FREQ,   l: 'Frequência do PWM', u: 'Hz',     d: 0,
      h: 'Aplica no próximo boot. Mudar exige recalibrar a corrente de fase (a janela de amostragem muda).' },
    { id: P.DIR_INVERT, l: 'Inverter sentido', b: true,      h: 'Aplica no boot; recalibre o ângulo depois.' },
  ]},
  { title: 'Malha de corrente (INA240)', items: [
    { id: P.CUR_P,    l: 'Ganho P',            u: '',   d: 3, h: 'Sobe até oscilar, depois recua 30%.' },
    { id: P.CUR_I,    l: 'Ganho I',            u: '',   d: 0, h: 'Elimina o erro em regime.' },
    { id: P.CUR_TF,   l: 'Filtro de Iq/Id',    u: 's',  d: 4,
      h: 'Só o filtro do referencial dq. Alto demais atrasa a malha; baixo demais deixa ruído entrar. 0.002–0.005.' },
    { id: P.CUR_DB,   l: 'Zona morta do integrador', u: 'A', d: 2,
      h: 'Tem de COBRIR o ruído de Id/Iq medidos (o diagnóstico imprime o veredito e a sugestão). Pequena demais, o integrador persegue ruído e vira corrente real — no eixo d isso aparece como Id subindo sozinho com picos.' },
    { id: P.UD_MAX,   l: 'Autoridade do eixo d', u: '× teto', d: 2,
      h: 'Quanto da tensão a malha de d pode usar para zerar o Id. 0 DESLIGA o eixo d — é o teste que separa "o d está bombeando corrente" de "a comutação está errada": se em 0 a velocidade voltar e a corrente cair, o problema é a malha de d.' },
  ]},
  { title: 'Modulação e velocidade', items: [
    { id: P.MODCEIL,  l: 'Teto de modulação',    u: '',     d: 3,
      h: 'Limite do bootstrap do driver (máx. 0.56). HOJE ele NÃO manda: o teto da janela de amostragem de corrente é menor (~0.45) e é ele que corta. Mexer aqui só tem efeito abaixo desse valor — ver DUTY MÁX no Monitor.' },
    { id: P.SPD_BAND, l: 'Faixa da vel. máx.',   u: 'km/h', d: 1, h: 'Em quantos km/h a corrente afunila até o teto.' },
  ]},
  { title: 'Rampas e freio', items: [
    { id: P.SLEW_UP,   l: 'Acelerador (subida)', u: 'A/s',    d: 0 },
    { id: P.SLEW_REL,  l: 'Acelerador (soltar)', u: 'A/s',    d: 0 },
    { id: P.ACCEL,     l: 'Aceleração',          u: 'rad/s²', d: 0 },
    { id: P.DECEL,     l: 'Freio-motor ao soltar', u: 'rad/s²', d: 0 },
    { id: P.BRAKE_DEC, l: 'Freio a 100%',        u: 'rad/s²', d: 0 },
  ]},
  { title: 'PID de velocidade', items: [
    { id: P.PID_P,  l: 'Ganho P',            u: '',  d: 2 },
    { id: P.PID_I,  l: 'Ganho I',            u: '',  d: 2 },
    { id: P.LPF_TF, l: 'Filtro de velocidade', u: 's', d: 2 },
  ]},
  { title: 'Bateria', items: [
    { id: P.BATT_WH,    l: 'Capacidade do pack',   u: 'Wh', d: 0 },
    { id: P.BATT_VMAX,  l: 'Tensão máxima (cheia)', u: 'V', d: 1 },
    { id: P.UV_WARN,    l: 'Aviso de bateria fraca', u: 'V', d: 1 },
    { id: P.UV_CUT,     l: 'Tensão mínima (corte)', u: 'V', d: 1 },
    { id: P.UV_RECOVER, l: 'Rearme da subtensão',  u: 'V', d: 1 },
    { id: P.REGEN_I,    l: 'Corrente máx. de carga', u: 'A', d: 0,
      h: 'Regen. Agora também é o teto de corrente de FASE do freio — se o freio ficar fraco, suba aqui.' },
    { id: P.SHUNT_MOHM, l: 'Shunt do INA226',  u: 'mΩ', d: 3,
      h: 'Calibra a corrente de BATERIA — e ela é a referência que a calibração de fase usa. Se estiver errada, TODA a escala de corrente sai errada. Afira contra um amperímetro: novo = atual × (lido ÷ real).' },
  ]},
  { title: 'Proteções', items: [
    { id: P.OC_TRIP, l: 'Trip de bateria',          u: 'A',  d: 0, h: 'Sobrecorrente no barramento (INA226).' },
    { id: P.IPH_TRIP, l: 'Trip de fase |I|',        u: 'A',  d: 0,
      h: 'Corte por magnitude de corrente de FASE medida — não depende do ângulo, vale parado e girando.' },
    { id: P.T_CUT,   l: 'Corte térmico (MOSFETs)',  u: '°C', d: 0 },
    { id: P.MT_CUT,  l: 'Corte térmico (motor)',    u: '°C', d: 0 },
  ]},
  { title: 'Features', items: [
    { id: P.BATT_LEARN,  l: 'Bateria inteligente', b: true, h: 'Aprende a capacidade real do pack.' },
    { id: P.COAST,       l: 'Roda-solta ao soltar', b: true, h: 'Iq alvo = 0 ao soltar o acelerador.' },
    { id: P.ECO_AUTO,    l: 'Eco automático', b: true, h: 'Cruzeiro econômico no modo ECO.' },
    { id: P.TRAC_DERATE, l: 'Derate por tensão', b: true, h: 'Reduz a tração com a bateria fraca.' },
    { id: P.THERM_DERATE, l: 'Derate térmico', b: true,
      h: 'Reduz potência ao esquentar. MOSFETs seguem a CURVA térmica (aba Curvas); o motor usa a rampa abaixo.' },
    { id: P.MT_DERATE, l: 'Início do derate (motor)',   u: '°C', d: 0, dep: P.THERM_DERATE },
  ]},
  { title: 'Field weakening', items: [
    { id: P.FW_MAX_A, l: 'Field weakening', vfeat: true, onDef: 8,
      h: 'Compra rotação acima do teto de tensão TROCANDO torque por velocidade: o Id divide o mesmo orçamento de corrente de fase com o Iq. Só no TURBO, nunca em frenagem, colapsa ao soltar o punho.' },
    { id: P.FW_MAX_A, l: 'Corrente máxima de FW', u: 'A', d: 1, dep: P.FW_MAX_A, key: 'fwamps',
      h: 'Id negativo injetado na malha de d. No topo o FW SEMPRE chega neste valor — trate-o como o que vai ser usado, não como um limite raro. Cada ampère vale ~0,2–0,3 km/h e sai do teto de torque: com 25 A de fase e 8 A de FW sobram 23,7 A para o Iq.' },
    { id: P.FW_START,   l: 'Joelho de saturação', u: '% do teto', d: 0, dep: P.FW_MAX_A,
      h: 'Utilização de tensão em que o FW entra. Decide QUANDO, não QUANTO: acima do joelho a injeção sobe até o máximo e fica lá, porque a utilização nunca passa de 100%. Baixar o joelho só faz o FW começar mais cedo, em velocidade menor.' },
  ]},
];

const fmt = (v, dec) => (v === undefined || v === null || isNaN(v))
  ? '—' : Number(v).toFixed(dec);

// Toggle SIM/NÃO reutilizável (feature booleana e feature de valor)
function BoolToggle({ label, def, hint, on, changed, locked, onToggle }) {
  return (
    <View style={[st.row, locked && st.rowLocked]}>
      <View style={{ flex: 1, paddingRight: T.space.md }}>
        <Text style={st.rowLabel}>{label}</Text>
        <Text style={st.rowDef}>padrão {def ? 'sim' : 'não'}</Text>
        {hint ? <Text style={st.rowHint}>{hint}</Text> : null}
      </View>
      <View style={[st.boolWrap, changed && st.inputChanged]}>
        {[['não', 0], ['sim', 1]].map(([lbl, v]) => {
          const sel = (on ? 1 : 0) === v;
          return (
            <Pressable key={lbl} disabled={locked}
              accessibilityLabel={`${label}: ${lbl}`}
              onPress={() => { haptic(20); onToggle(); }}
              style={[st.boolBtn, sel && st.boolBtnOn]}>
              <Text style={[st.boolTxt, sel && st.boolTxtOn]}>{lbl}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

// Linha numérica (bloqueia + opaca quando `locked`)
function NumRow({ meta, param, edit, locked, onEdit }) {
  const cur = param ? fmt(param.val, meta.d ?? 0) : '—';
  const changed = !locked && edit !== undefined && edit !== '' &&
    parseFloat(edit) !== (param ? +param.val.toFixed(meta.d ?? 0) : NaN);
  return (
    <View style={[st.row, locked && st.rowLocked]}>
      <View style={{ flex: 1, paddingRight: T.space.md }}>
        <Text style={st.rowLabel}>{meta.l}</Text>
        <Text style={st.rowDef}>
          padrão {param ? fmt(param.def, meta.d) : '—'}{meta.u ? ` ${meta.u}` : ''}
        </Text>
        {meta.h ? <Text style={st.rowHint}>{meta.h}</Text> : null}
      </View>
      <View style={[st.inputWrap, changed && st.inputChanged]}>
        <TextInput
          style={st.input}
          editable={!locked}
          value={locked ? cur : (edit !== undefined ? edit : cur)}
          onChangeText={txt => onEdit(meta.id, txt.replace(',', '.'))}
          keyboardType="numbers-and-punctuation"
          selectTextOnFocus
          accessibilityLabel={meta.l}
        />
        {meta.u ? <Text style={st.inputUnit}>{meta.u}</Text> : null}
      </View>
    </View>
  );
}

export default function Config({ t, status, send, ble }) {
  const conn = status === 'connected';
  const [params, setParams] = useState(null);
  const [edits, setEdits]   = useState({});
  const [busy, setBusy]     = useState(null);   // 'apply'|'factory'|'calz'|'calk'|'auto'|'reload'
  const loadedFor = useRef(false);
  const stash = useRef({});   // valor guardado ao desligar uma feature de valor
  const cmdStatusRef = useRef(0);
  useEffect(() => { if (t?.cmdStatus) cmdStatusRef.current = t.cmdStatus; }, [t?.cmdStatus]);

  const reload = useCallback(async () => {
    const p = await ble?.readParams();
    if (p) {
      setParams(p); setEdits({});
      if (p[23]) setBattWh(p[23].val);
    }
  }, [ble]);

  useEffect(() => {
    if (conn && !loadedFor.current) { loadedFor.current = true; reload(); }
    if (!conn) loadedFor.current = false;
  }, [conn, reload]);

  const onEdit = (id, txt) => setEdits(e => ({ ...e, [id]: txt }));

  // Liga/desliga feature. Booleana: 0/1. De valor: desligar guarda o valor e
  // zera; religar devolve o valor guardado (ou o default).
  const toggleFeat = (meta) => {
    const on = featOnLive(meta.id, params, edits);
    if (meta.vfeat) {
      if (on) {
        const eff = edits[meta.id] !== undefined ? parseFloat(edits[meta.id]) : params?.[meta.id]?.val;
        if (eff && eff >= 0.5) stash.current[meta.id] = eff;
        onEdit(meta.id, '0');
      } else {
        const v = stash.current[meta.id] ?? (params?.[meta.id]?.def || meta.onDef || 1);
        onEdit(meta.id, String(v));
      }
    } else {
      onEdit(meta.id, on ? '0' : '1');
    }
  };

  const changes = Object.entries(edits)
    .map(([id, txt]) => ({ id: +id, val: parseFloat(txt) }))
    .filter(c => !isNaN(c.val) && params?.[c.id] &&
                 c.val !== +params[c.id].val.toFixed(6));

  const run = (key, waitMs, fn) => {
    setBusy(key);
    fn();
    setTimeout(async () => { await reload(); setBusy(null); }, waitMs);
  };

  const apply = () => {
    haptic(30);
    Alert.alert('Aplicar parâmetros',
      `${changes.length} parâmetro(s) serão aplicados AO VIVO e gravados na ` +
      'memória da controladora.\n\nConfirma?',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Aplicar e gravar', style: 'destructive',
          onPress: () => run('apply', 700, async () => {
            await ble.writeParams(changes);
            send(CMD.SAVE_PARAMS, 1);
          }) },
      ]);
  };

  const factory = () => {
    haptic(60);
    Alert.alert('Restaurar padrões de fábrica',
      'TODOS os parâmetros voltam aos valores do firmware. Confirma?',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Restaurar', style: 'destructive',
          onPress: () => run('factory', 900, () => send(CMD.FACTORY, 1)) },
      ]);
  };

  // A linha de segurança é POR ROTINA: umas giram o motor, outras exigem ele
  // desligado. Um aviso genérico ("vai girar sozinho") no diagnóstico, que
  // roda parado, ensina o usuário a ignorar o aviso — que é o pior resultado.
  const SAFE_SPIN = '⚠️ RODA SUSPENSA E LIVRE — o motor vai girar sozinho.';
  const SAFE_OFF  = '⚠️ Motor DESLIGADO e roda parada — a rotina recusa se não estiver.';
  const calibrate = (key, name, cmd, warn, waitMs, safety = SAFE_SPIN) => {
    haptic(60);
    Alert.alert(name, `${warn}\n\n${safety}`,
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Iniciar', style: 'destructive',
          onPress: () => run(key, waitMs, () => send(cmd, 1)) },
      ]);
  };

  // Degrau da malha de corrente: exige roda PRESA (o oposto do aviso de
  // calibrate()) e manda o valor da corrente, não o "1" fixo.
  const iStep = (amps) => {
    haptic(60);
    Alert.alert('Degrau da malha de corrente',
      `Aplica ${amps} A de degrau e captura a corrente MEDIDA a 1 kHz, ` +
      'desenhando no serial. É o que separa malha oscilando de malha lenta ' +
      'de comutação errada — os três dão a mesma sensação no guidão.\n\n' +
      '⚠️ RODA PRESA (não apenas suspensa): aplica corrente de verdade e o ' +
      'motor vai dar um tranco.',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Aplicar degrau', style: 'destructive',
          onPress: () => run('istep', 3000, () => send(CMD.I_STEP, amps)) },
      ]);
  };

  // CALIBRAÇÃO DA CORRENTE DE FASE — é ela que libera a malha de corrente.
  // Enquanto não passar, o firmware bloqueia o motor de propósito.
  const iphCal = () => {
    haptic(60);
    Alert.alert('Calibrar corrente de fase',
      'Descobre por MEDIÇÃO o que não pode ser chutado: em que instante do PWM ' +
      'os MOSFETs de baixo conduzem, qual fase está em cada INA240 e o sinal de ' +
      'cada canal.\n\n' +
      'Aplica um vetor DC em cada fase por vez, com a roda parada, subindo a ' +
      'tensão só até ter resolução suficiente (respeitando o limite de ' +
      'corrente). O motor dá pequenos trancos de alinhamento — é normal.\n\n' +
      '⚠️ RODA SUSPENSA + fonte LIMITADA em corrente.\n\n' +
      'Sem esta calibração o motor NÃO LIGA: com o sinal do sensor errado a ' +
      'malha de corrente vira realimentação positiva e o motor dispara.',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Calibrar', style: 'destructive', onPress: async () => {
          haptic(30); setBusy('iph'); cmdStatusRef.current = 0;
          send(CMD.IPH_CAL, 1);
          const t0 = Date.now(); let res = 0;
          while (Date.now() - t0 < 25000) {
            await new Promise(r => setTimeout(r, 400));
            const st = cmdStatusRef.current;
            if (st === 4 || st === 7 || st === 2) { res = st; break; }
          }
          await reload(); setBusy(null);
          Alert.alert('Corrente de fase',
            res === 4 ? 'Calibrada. A malha de corrente está liberada — '
                      + 'confira no Monitor que |I| fica ~0 A com a roda parada.'
          : res === 2 ? 'Recusada: exige o motor desligado e a roda parada.'
          : res === 7 ? 'FALHOU. O serial diz qual etapa recusou:\n\n'
                      + '· zero fora de faixa → alimentação ou REF do INA240\n'
                      + '· nenhuma resposta em nenhum evento → shunt sem contato '
                      + 'ou estágio de potência sem alimentação\n'
                      + '· razão fora de 1,3–3,5 → a leitura não tem a assinatura '
                      + 'de estrela trifásica (fiação dos shunts)\n'
                      + '· dois canais na mesma fase → confira em qual fase cada '
                      + 'shunt está'
                      : 'Sem resposta a tempo — confira o serial.');
        } },
      ]);
  };

  // AFINAR O ÂNGULO GIRANDO: a calibração estática acha o setor, mas não vê
  // onde o rotor parou DENTRO dele. Esta varredura gira em velocidade fixa,
  // testa offsets de ±36° e fica com o de MENOR corrente de bateria — foi ela
  // que achou os +30° que derrubaram o consumo a vazio em 7x.
  const angScan = () => {
    haptic(60);
    Alert.alert('Afinar ângulo girando',
      'Gira em velocidade fixa e varre o ângulo de comutação em ±36°, medindo ' +
      'a corrente de bateria em cada ponto. Fica com o ângulo de MENOR ' +
      'consumo e grava.\n\n' +
      'É o passo que a calibração parada não consegue fazer: ela acha o setor ' +
      'certo, mas não sabe onde o rotor parou dentro dele.\n\n' +
      '⚠️ RODA SUSPENSA E LIVRE — gira sozinho por ~15 s. O progresso sai no serial.',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Afinar', style: 'destructive',
          onPress: () => run('ang', 20000, () => send(CMD.ANG_SCAN, 6)) },
      ]);
  };

  // greying ao vivo: uma linha com `dep` fica bloqueada quando a mãe está off
  const isLocked = (meta) => meta.ro === true ||
    (meta.dep !== undefined && !featOnLive(meta.dep, params, edits));

  return (
    <KeyboardAvoidingView style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={st.root} contentContainerStyle={{ paddingBottom: 120 }}
        keyboardShouldPersistTaps="handled">

        {!conn && (
          <Text style={st.offline}>SEM CONEXÃO — parâmetros indisponíveis</Text>
        )}

        {GROUPS.map(g => (
          <View key={g.title}>
            <SectionLabel>{g.title}</SectionLabel>
            <View style={st.table}>
              {g.items.map(meta => {
                const param = params?.[meta.id];
                const locked = isLocked(meta);
                if (meta.b || meta.vfeat) {
                  const on = featOnLive(meta.id, params, edits);
                  const savedOn = param ? param.val >= 0.5 : false;
                  return (
                    <BoolToggle key={meta.key || `feat-${meta.id}`}
                      label={meta.l} hint={meta.h}
                      def={param ? param.def >= 0.5 : false}
                      on={on} changed={edits[meta.id] !== undefined && on !== savedOn}
                      locked={locked} onToggle={() => toggleFeat(meta)} />
                  );
                }
                return (
                  <NumRow key={meta.key || meta.id} meta={meta} param={param}
                    edit={edits[meta.id]} locked={locked} onEdit={onEdit} />
                );
              })}
            </View>
          </View>
        ))}

        {/* A ORDEM IMPORTA e não é óbvia: a escala de corrente ancora tudo, o
            ângulo depende dela, e o afinamento depende do ângulo. Fora de
            ordem, cada passo mede em cima do erro do anterior. */}
        <SectionLabel right="roda suspensa!">Calibração · nesta ordem</SectionLabel>
        <Text style={st.note}>
          Faça 1 e 2 sempre que trocar fiação, shunts ou a frequência do PWM.
          O 3 vale a cada troca de motor — é ele que derruba o consumo a vazio.
        </Text>
        <Btn variant="primary" label="1 · Corrente de fase (obrigatória)"
          disabled={!conn} loading={busy === 'iph'}
          onPress={iphCal} style={st.mb} />
        <Btn label="2 · Ângulo de comutação (obrigatória)"
          disabled={!conn} loading={busy === 'calz'}
          onPress={() => calibrate('calz', 'Calibrar ângulo de comutação', CMD.CAL_ZEA,
            'Mede DUAS coisas de uma vez: o ângulo zero elétrico e a direção '
            + 'real do sensor Hall (fato da fiação — nunca chutado).\n\n'
            + 'Refaça sempre depois da calibração de corrente.', 12000)}
          style={st.mb} />
        <Btn label="3 · Afinar ângulo girando (recomendada)"
          disabled={!conn} loading={busy === 'ang'}
          onPress={angScan} style={st.mb} />
        <Btn label="4 · Medir Ke (opcional)"
          disabled={!conn} loading={busy === 'calk'}
          onPress={() => calibrate('calk', 'Medir Ke do motor', CMD.CAL_KE,
            'Aplica 6 V por 4 s e calcula o Ke pela velocidade final.\n\n'
            + 'Não gera torque, mas a proteção de realimentação usa o Ke para '
            + 'saber quando a tensão simplesmente acabou (topo de velocidade) '
            + 'em vez de acusar sensor quebrado.', 6500)}
          style={st.mb} />

        <SectionLabel right="serial">Diagnóstico</SectionLabel>
        <Btn label="Leitura crua da corrente de fase (5 s)"
          disabled={!conn} loading={busy === 'idiag'}
          onPress={() => calibrate('idiag', 'Diagnóstico da corrente de fase',
            CMD.IPH_DIAG,
            'Despeja no serial: contagens do ADC, zeros, ruído por etapa com e '
            + 'sem rádio, correntes por fase, |I|, Iq/Id e o balanço de '
            + 'rejeições da janela de amostragem.\n\n'
            + 'É o exame completo do sensor.', 8000, SAFE_OFF)}
          style={st.mb} />
        <Btn label="Caixa-preta da última falta"
          disabled={!conn} loading={busy === 'crash'}
          onPress={() => { haptic(30); send(CMD.CRASH_DUMP, 1); Alert.alert(
            'Caixa-preta',
            'Despejando no serial os 512 ms que antecederam a última falta que '
            + 'travou o motor: alvo e corrente medida, |I|, velocidade, tensão, '
            + 'setor, e as contagens CRUAS do ADC por canal.\n\n'
            + 'Se nada travou desde o último despejo, ela avisa.'); }}
          style={st.mb} />
        <Btn label="Degrau da malha de corrente (roda PRESA)"
          disabled={!conn} loading={busy === 'istep'}
          onPress={() => iStep(3)} style={st.mb} />

        <SectionLabel>Manutenção</SectionLabel>
        <Btn label="Reler parâmetros da controladora"
          disabled={!conn} loading={busy === 'reload'}
          onPress={() => run('reload', 500, () => {})}
          style={st.mb} />
        <Btn variant="danger" label="Restaurar padrões de fábrica"
          disabled={!conn} loading={busy === 'factory'}
          onPress={factory} style={st.mb} />
      </ScrollView>

      {changes.length > 0 && (
        <View style={st.applyBar}>
          <Btn variant="tertiary" label="Descartar"
            onPress={() => setEdits({})} />
          <Btn variant="primary"
            label={`Aplicar e gravar (${changes.length})`}
            loading={busy === 'apply'}
            onPress={apply} style={{ flex: 1 }} />
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: T.density.workshop.pad },
  offline: { ...T.type.micro, color: T.color.warn, letterSpacing: 1.6,
             textAlign: 'center', marginTop: T.space.md },
  mb: { marginBottom: T.space.sm },
  note: { ...T.type.micro, color: T.color.textDim, lineHeight: 15,
          marginBottom: T.space.sm },

  table: { borderTopWidth: T.size.hairline, borderTopColor: T.color.divider },
  row: { flexDirection: 'row', alignItems: 'center',
         paddingVertical: T.density.workshop.rowPad,
         borderBottomWidth: T.size.hairline, borderBottomColor: T.color.divider },
  rowLocked: { opacity: 0.38 },
  rowLabel: { ...T.type.body, color: T.color.text },
  rowDef: { ...T.type.micro, color: T.color.textDim, marginTop: 2,
            fontVariant: T.type.tabular },
  rowHint: { ...T.type.micro, color: T.color.textDim, marginTop: 3,
             lineHeight: 14, fontStyle: 'italic' },

  inputWrap: { flexDirection: 'row', alignItems: 'center',
               backgroundColor: T.color.surface2,
               borderRadius: T.radius.control, paddingHorizontal: T.space.sm,
               borderWidth: 1, borderColor: 'transparent', minHeight: 40 },
  inputChanged: { borderColor: T.color.accent },
  input: { color: T.color.text, minWidth: 58, textAlign: 'right',
           fontSize: 15, fontWeight: '500', paddingVertical: 6,
           fontVariant: T.type.tabular },
  inputUnit: { fontSize: 10, color: T.color.textDim, marginLeft: 4 },

  boolWrap: { flexDirection: 'row', backgroundColor: T.color.surface2,
              borderRadius: T.radius.control, padding: 3,
              borderWidth: 1, borderColor: 'transparent' },
  boolBtn: { paddingVertical: 8, paddingHorizontal: 16,
             borderRadius: T.radius.control - 2 },
  boolBtnOn: { backgroundColor: T.color.surface3 },
  boolTxt: { fontSize: 13, fontWeight: '500', color: T.color.textDim },
  boolTxtOn: { color: T.color.accent, fontWeight: '700' },

  applyBar: { position: 'absolute', left: 0, right: 0, bottom: 0,
              flexDirection: 'row', gap: T.space.sm, padding: T.space.md,
              backgroundColor: T.color.bg,
              borderTopWidth: T.size.hairline, borderTopColor: T.color.border },
});
