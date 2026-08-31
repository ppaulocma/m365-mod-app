// ============================================================================
// ble.js — conexão BLE com o Patinete ESP (NimBLE no firmware)
// ----------------------------------------------------------------------------
// Protocolo (espelho do ble_dashboard.h do firmware):
//   TELEMETRIA (notify, 151 B LE): ver decodeTelemetry() — decodificada em
//     camadas por tamanho, então firmware antigo continua abrindo.
//   CONTROLE  (write): [id u8][valor f32 LE] — ids em CMD abaixo
// ============================================================================
import { BleManager } from 'react-native-ble-plx';
import { PermissionsAndroid, Platform } from 'react-native';

export const UUID_SERVICE = '7a0b1000-c1e5-4c0d-9a9e-8f5d0e5c0001';
export const UUID_TELEM   = '7a0b1001-c1e5-4c0d-9a9e-8f5d0e5c0001';
export const UUID_CTRL    = '7a0b1002-c1e5-4c0d-9a9e-8f5d0e5c0001';
export const UUID_PARAMS  = '7a0b1003-c1e5-4c0d-9a9e-8f5d0e5c0001';
export const UUID_STREAM  = '7a0b1004-c1e5-4c0d-9a9e-8f5d0e5c0001';
export const UUID_CURVE   = '7a0b1005-c1e5-4c0d-9a9e-8f5d0e5c0001';
export const UUID_BULK    = '7a0b1006-c1e5-4c0d-9a9e-8f5d0e5c0001';
export const UUID_DEBUG   = '7a0b1007-c1e5-4c0d-9a9e-8f5d0e5c0001';

export const CMD = {
  TH: 1, BR: 2, ENABLE: 3, ESTOP: 4, CLEAR: 5,
  MODE: 6, I_LIMIT: 7, V_MAX: 8, V_LIMIT: 9, ZEA: 10, FAROL: 46,
  SAVE_PARAMS: 20, FACTORY: 21, CAL_ZEA: 22, CAL_KE: 23,
  // 24 (auto-calibração completa) e 25 (re-zerar INA240) foram removidos: a
  // primeira gravava o ângulo SEM medir a direção do sensor (a calibração de
  // ângulo dedicada faz as duas), e o zero agora é rastreado ao vivo a 8 kHz.
  IPH_CAL: 26,                        // CALIBRA a corrente de fase (roda suspensa)
  IPH_DIAG: 27,                       // 5 s de leitura CRUA no serial (motor off)
  I_STEP: 28,                         // degrau na malha de corrente (roda PRESA)
  ANG_SCAN: 29,                       // varredura do ângulo sob rotação (roda livre)
  STREAM_HZ: 30, STEP: 31, BULK_SRC: 32, CAP_FREE: 33, CURVE_SEL: 34,
  RIDE: 36, CRUISE: 37, WALK: 38, LOCK: 39, OTA: 40,
  CRASH_DUMP: 41,                     // despeja a caixa-preta da última falta
  TRIP_RESET: 44, FLOG_CLEAR: 45, DBG_HZ: 47,
};

// ids das curvas (espelho de curves.h)
export const CRV = {
  THROTTLE: 1, BRAKE: 2, REGEN_V: 3, TRAC_V: 4, THERMAL: 5, REGEN_S: 6,
};

// erros de validação do firmware (cmd_status). 4/5/6 são resultados de
// calibração (4 = OK), tratados pelas telas de calibração — não são erros de
// comando e por isso não aparecem como aviso no painel.
export const CMDERR = { 0: null, 1: 'valor fora do limite físico',
  2: 'exige o veículo parado', 3: 'não permitido agora',
  4: null, 5: null, 6: null,
  7: 'sensor de corrente de fase ausente ou fora de faixa' };

// Capacidade do pack [Wh] p/ o cálculo de autonomia (o valor real vem do
// parâmetro P_BATT_WH quando a tela de parâmetros carrega)
let BATT_WH = 275;
export const setBattWh = v => { if (v > 0) BATT_WH = v; };

// --- base64 <-> bytes (sem dependências) ------------------------------------
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export function b64encode(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = bytes[i + 1], c = bytes[i + 2];
    out += B64[a >> 2] + B64[((a & 3) << 4) | (b === undefined ? 0 : b >> 4)];
    out += b === undefined ? '=' : B64[((b & 15) << 2) | (c === undefined ? 0 : c >> 6)];
    out += c === undefined ? '=' : B64[c & 63];
  }
  return out;
}
export function b64decode(str) {
  const clean = str.replace(/=+$/, '');
  const out = [];
  let bits = 0, acc = 0;
  for (const ch of clean) {
    acc = (acc << 6) | B64.indexOf(ch);
    bits += 6;
    if (bits >= 8) { bits -= 8; out.push((acc >> bits) & 0xff); }
  }
  return Uint8Array.from(out);
}

// --- decodificação da telemetria (26 bytes little-endian) --------------------
export function decodeTelemetry(base64) {
  const b = b64decode(base64);
  if (b.length < 26) return null;
  const dv = new DataView(b.buffer);
  const flags = b[10];
  return {
    kmh:    dv.getInt16(0, true) / 10,
    vbat:   dv.getUint16(2, true) / 10,
    ibat:   dv.getInt16(4, true) / 10,
    powerW: dv.getInt16(6, true),
    tempC:  dv.getInt8(8),
    soc:    b[9],
    enabled:   !!(flags & 0x01),
    modeVel:   !!(flags & 0x02),
    regen:     !!(flags & 0x04),
    panel:     !!(flags & 0x08),
    faults:    b[11],
    gapUs:     dv.getUint16(12, true),
    // Alvo aplicado: AMPÈRES no modo torque (malha de corrente), rad/s no modo
    // velocidade. O nome "targetV" ficou do tempo em que era tensão.
    targetV:   dv.getInt16(14, true) / 10,
    scalePct:  b[16],
    iLimit:    dv.getUint16(18, true) / 10,
    vMax:      dv.getUint16(20, true) / 10,
    vLimit:    dv.getUint16(22, true) / 10,
    zea:       dv.getUint16(24, true) / 1000,
    ...(b.length >= 44 ? (() => {
      const f2 = b[38];
      // Autonomia INTELIGENTE: o firmware aprende a capacidade real do pack
      // (Wh gastos ÷ queda de SoC medida em repouso) e manda: consumo recente
      // (EWMA de 200 m), capacidade aprendida e SoC por contagem de energia.
      // Aqui só a divisão final.
      const tripKm      = dv.getUint16(30, true) / 100;
      const tripWh      = dv.getUint16(40, true) / 10;
      const tripWhRegen = dv.getUint16(42, true) / 10;
      const whPerKm = dv.getUint16(32, true) / 10;      // consumo RECENTE
      const capWh   = dv.getUint16(34, true);           // capacidade aprendida
      const socPct  = b[9];
      const cap     = capWh > 0 ? capWh : BATT_WH;
      const rangeKm = (cap * (socPct / 100)) / Math.max(3, whPerKm || 18);
      return {
        odoKm:    dv.getUint32(26, true) / 1000,
        tripKm,
        whPerKm,
        capWh,
        rangeKm,
        duty:     b[36],
        headroom: b[37],
        cruise:   !!(f2 & 0x01),
        walk:     !!(f2 & 0x02),
        locked:   !!(f2 & 0x04),
        saturated:!!(f2 & 0x08),
        uvWarn:   !!(f2 & 0x10),
        ride:     (f2 >> 5) & 0x03,
        ecoAuto:  !!(f2 & 0x80),
        cmdStatus: b[39],
        // Field weakening: o firmware manda o id NEGATIVO em uso [A]×2. Era
        // avanço de ângulo em graus na era back-EMF — mudou junto com o
        // mecanismo (agora é injeção de id pela malha de d).
        fwA:       b[17] / 2,          // corrente de enfraquecimento [A]
        mtpaDeg:   b.length >= 45 ? dv.getInt8(44) / 10 : 0,   // trim MTPA [°]
        farol:      b.length >= 46 ? !!(b[45] & 0x01) : undefined,
        brakeLight: b.length >= 46 ? !!(b[45] & 0x02) : undefined,
        tripWh,
        tripWhRegen,
      };
    })() : {}),
    // ===== BLOCO PROFUNDO (46+): estado do CORE em tempo real =====
    ...(b.length >= 97 ? {
      velEst:    dv.getInt16(46, true) / 100,   // velocidade interna [rad/s]
      vq:        dv.getInt16(48, true) / 100,   // tensão eixo q [V]
      vd:        dv.getInt16(50, true) / 100,   // tensão eixo d [V]
      iRaw:      dv.getInt16(52, true) / 100,   // corrente CRUA (sem filtro) [A]
      effVLimit: dv.getUint16(54, true) / 100,  // teto de tensão efetivo [V]
      iphMag:    dv.getUint16(56, true) / 100,  // |I| de fase medida [A]
      tempScale: b[58],                          // derate térmico [%]
      tracvScale:b[59],                          // derate por tensão/SoC [%]
      elecSector:dv.getInt8(60),                 // setor elétrico do Hall (0..5)
      ovr:       b[61],                          // override (0-4)
      coastAct:  b[62],                          // costeira ativa
      hallBits:  b[63],                          // estado dos 3 halls (bitmask)
      hallSeen:  b[64],                          // estados válidos já vistos
      hallEps:   dv.getUint16(65, true),         // bordas cruas/s (ruído se parado)
      epsA:      dv.getUint16(67, true),         // bordas aceitas/s Hall A
      epsB:      dv.getUint16(69, true),         //   B
      epsC:      dv.getUint16(71, true),         //   C
      seqSkips:  dv.getUint16(73, true),         // SALTOS de setor = leitura errada
      seqRevs:   dv.getUint16(75, true),         // inversões da sequência
      seqInval:  dv.getUint16(77, true),         // estados impossíveis 000/111
      rejFiltA:  dv.getUint16(79, true),         // bordas descartadas (glitch) A
      rejFiltB:  dv.getUint16(81, true),
      rejFiltC:  dv.getUint16(83, true),
      rejConfA:  dv.getUint16(85, true),         // bordas lentas p/ assentar A
      rejConfB:  dv.getUint16(87, true),
      rejConfC:  dv.getUint16(89, true),
      hallBad:   dv.getUint16(91, true),         // ressincronizações
      linkDrops: dv.getUint16(93, true),         // ativações do dead-man
      loopGapUs: dv.getUint16(95, true),         // maior buraco do loop 1 kHz [µs]
    } : {}),
    // entradas do piloto + alvos/ângulo internos
    ...(b.length >= 113 ? {
      throttleIn:dv.getUint16(97, true) / 1000,  // acelerador CRU (entrada) 0..1
      brakeIn:   dv.getUint16(99, true) / 1000,  // freio CRU 0..1
      thrEff:    dv.getUint16(101, true) / 1000, // acelerador após a curva
      brkEff:    dv.getUint16(103, true) / 1000, // freio após curva+regen
      loopHz:    dv.getUint16(105, true),        // frequência real do loop FOC
      velTarget: dv.getInt16(107, true) / 100,   // alvo modo velocidade [rad/s]
      // 109-110 é slot RESERVADO (o firmware manda 0). Era a tensão do
      // regulador de costeira, removido — não decodifique nada aqui.
      elecAngle: dv.getUint16(111, true) / 1000, // ângulo elétrico [rad]
    } : {}),
    // ===== detalhe MÁXIMO (113+): timing, duties, mecânica, saúde =====
    ...(b.length >= 136 ? {
      espUs:     dv.getUint32(113, true),        // timestamp REAL do ESP [µs]
      dcA:       dv.getUint16(117, true) / 1000, // duty fase A (0..1)
      dcB:       dv.getUint16(119, true) / 1000, // duty fase B
      dcC:       dv.getUint16(121, true) / 1000, // duty fase C
      shaftAngle:dv.getUint16(123, true) / 1000, // ângulo mecânico [rad]
      shaftVel:  dv.getInt16(125, true) / 100,   // velocidade SimpleFOC [rad/s]
      pscaleFold:b[127],                          // foldback isolado [%]
      ecoV:      dv.getUint16(128, true) / 100,  // tensão do eco auto [V]
      regenILim: dv.getUint16(130, true) / 100,  // limite de regen [A]
      msSinceCmd:dv.getUint16(132, true),        // ms desde último comando
      freeHeapKb:dv.getUint16(134, true),        // RAM livre [KB]
    } : {}),
    ...(b.length >= 137 ? {
      motorTempC: dv.getInt8(136),               // temp interna do MOTOR [°C]
    } : {}),
    // ===== CORRENTE DE FASE (137+): 2x INA240A1 low-side =====
    // iphOk = false significa que a calibração de corrente de fase não passou
    // (ou nunca rodou). Nesse estado o firmware BLOQUEIA o motor de propósito:
    // sem saber o sinal do sensor, a malha de corrente pode virar
    // realimentação positiva e disparar.
    ...(b.length >= 151 ? {
      iphA:      dv.getInt16(137, true) / 100,   // [A] corrente da fase A
      iphB:      dv.getInt16(139, true) / 100,   // [A] fase B
      iphC:      dv.getInt16(141, true) / 100,   // [A] fase C (reconstruída)
      iphD:      dv.getInt16(143, true) / 100,   // [A] Id medido (fluxo)
      iphQ:      dv.getInt16(145, true) / 100,   // [A] Iq medido (torque)
      iqTarget:  dv.getInt16(147, true) / 100,   // [A] Iq PEDIDO pelo controle
      dutyMax:   b[149],       // [%] duty máximo em que a janela low-side ainda
                               //     comporta a conversão — define o teto de
                               //     modulação (e a velocidade máxima)
      iphOk:     !!(b[150] & 0x01),   // calibração de corrente de fase VÁLIDA
      // Como o módulo INA240 amarrou os pinos REF, deduzido do zero medido:
      // 0 = bidirecional (serve) | 1 = REF no GND | 2 = REF no V+ | 3 = sem sinal
      iphRef1:   (b[150] >> 1) & 0x03,
      iphRef2:   (b[150] >> 3) & 0x03,
    } : {}),
    ...(b.length >= 155 ? {
      iphZero1: dv.getUint16(151, true) / 1000,  // [V] zero medido do canal 1
      iphZero2: dv.getUint16(153, true) / 1000,  // [V] zero medido do canal 2
    } : {}),
    // ===== escala calibrada + saúde da janela (161+) =====
    // A escala [A/V] é o único número que diz qual shunt está REALMENTE
    // instalado: R = 1/(ganho x escala). Com INA240A1 (20 V/V), 50 A/V = 1 mΩ.
    // As rejeições são amostras de corrente descartadas por caírem fora da
    // janela low-side: zero é o normal, e subir significa que o duty encostou
    // no teto — é o indicador do topo de velocidade.
    ...(b.length >= 161 ? (() => {
      const s1 = dv.getUint16(155, true), s2 = dv.getUint16(157, true);
      const GAIN = 20;                               // INA240A1
      const mohm = (sc) => (sc > 0 ? 1000 / (GAIN * sc) : undefined);
      return {
        iphScale1: s1, iphScale2: s2,
        iphShunt1: mohm(s1), iphShunt2: mohm(s2),    // [mΩ] efetivo, deduzido
        iphRejects: dv.getUint16(159, true),
      };
    })() : {}),
  };
}

// ============================================================================
// DATA-LOG da viagem — esquema ÚNICO (gravador + CSV nunca divergem).
// Captura TODA a telemetria de valor, inclusive baixo nível (duty, headroom,
// scale/foldback, gap do loop, fw, mtpa, ângulo zero, flags de estado).
// ============================================================================
export const LOG_COLS = [
  { h: 't_ms',          k: 't'   },   // tempo absoluto [ms]
  { h: 'kmh',           k: 'kmh' },
  { h: 'ibat_A',        k: 'ibat' },  // corrente de bateria (+tração −regen)
  { h: 'vbat_V',        k: 'vbat' },
  { h: 'power_W',       k: 'powerW' },
  { h: 'temp_C',        k: 'temp' },
  { h: 'motor_temp_C',  k: 'motorTemp' },
  { h: 'target',        k: 'targetV' },   // alvo aplicado (A no torque, rad/s no vel)
  { h: 'duty_pct',      k: 'duty' },
  { h: 'headroom_pct',  k: 'headroom' },  // derate térmico
  { h: 'scale_pct',     k: 'scale' },     // foldback (100 = sem corte)
  { h: 'loop_gap_us',   k: 'gapUs' },     // saúde do loop de 1 kHz
  { h: 'fw_id_A',       k: 'fwA' },       // corrente de field weakening
  { h: 'mtpa_deg',      k: 'mtpaDeg' },
  { h: 'zea_rad',       k: 'zea' },
  { h: 'soc_pct',       k: 'soc' },
  { h: 'cap_Wh',        k: 'capWh' },
  { h: 'whkm',          k: 'whPerKm' },
  { h: 'range_km',      k: 'range' },
  { h: 'odo_km',        k: 'odoKm' },
  { h: 'trip_km',       k: 'tripKm' },
  { h: 'trip_Wh',       k: 'tripWh' },
  { h: 'trip_Wh_regen', k: 'tripWhRegen' },
  { h: 'ilimit_A',      k: 'iLimit' },    // limite de corrente EFETIVO
  { h: 'vmax_kmh',      k: 'vMax' },
  { h: 'vlimit_V',      k: 'vLimit' },
  { h: 'ride',          k: 'ride' },      // 0 eco 1 normal 2 turbo
  { h: 'faults',        k: 'faults' },    // bitmask (0 = ok)
  { h: 'cmd_status',    k: 'cmdStatus' },
  { h: 'enabled',       k: 'en' },
  { h: 'mode_vel',      k: 'modeVel' },
  { h: 'regen',         k: 'regen' },
  { h: 'cruise',        k: 'cruise' },
  { h: 'walk',          k: 'walk' },
  { h: 'locked',        k: 'locked' },
  { h: 'saturated',     k: 'sat' },
  { h: 'uv_warn',       k: 'uv' },
  { h: 'eco_auto',      k: 'eco' },
  { h: 'panel',         k: 'panel' },
  { h: 'farol',         k: 'farol' },
  // ---- CORE em tempo real (debug profundo) ----
  { h: 'vel_est_rads',  k: 'velEst' },     // velocidade interna
  { h: 'vq_V',          k: 'vq' },         // tensão eixo q (torque)
  { h: 'vd_V',          k: 'vd' },         // tensão eixo d
  { h: 'iraw_A',        k: 'iRaw' },       // corrente CRUA (sem filtro)
  { h: 'effvlim_V',     k: 'effVLimit' },  // teto de tensão efetivo
  // ---- corrente de FASE medida (o que substituiu a back-EMF estimada) ----
  { h: 'iph_mag_A',     k: 'iphMag' },     // |I| — grandeza de proteção
  { h: 'iq_meas_A',     k: 'iphQ' },       // Iq medido (torque)
  { h: 'iq_target_A',   k: 'iqTarget' },   // Iq pedido — o erro é a malha
  { h: 'id_meas_A',     k: 'iphD' },       // Id medido (fluxo; ~0 fora de FW)
  { h: 'iph_a_A',       k: 'iphA' },
  { h: 'iph_b_A',       k: 'iphB' },
  { h: 'iph_c_A',       k: 'iphC' },
  { h: 'duty_max_pct',  k: 'dutyMax' },    // teto de duty imposto pela janela
  { h: 'iph_zero1_V',   k: 'iphZero1' },   // zero medido do INA240 canal 1
  { h: 'iph_escala1',   k: 'iphScale1' },  // [A/V] escala calibrada canal 1
  { h: 'iph_escala2',   k: 'iphScale2' },
  { h: 'iph_rejeicoes', k: 'iphRejects' }, // amostras fora da janela low-side
  { h: 'iph_zero2_V',   k: 'iphZero2' },
  { h: 'tempscale_pct', k: 'tempScale' },  // derate térmico isolado
  { h: 'tracvscale_pct',k: 'tracvScale' }, // derate tensão/SoC isolado
  { h: 'elec_sector',   k: 'elecSector' }, // setor elétrico do Hall
  { h: 'ovr',           k: 'ovr' },        // override ativo
  { h: 'coast_active',  k: 'coastAct' },
  { h: 'hall_bits',     k: 'hallBits' },
  { h: 'hall_seen',     k: 'hallSeen' },
  { h: 'hall_eps',      k: 'hallEps' },    // bordas cruas/s
  { h: 'eps_a',         k: 'epsA' },
  { h: 'eps_b',         k: 'epsB' },
  { h: 'eps_c',         k: 'epsC' },
  { h: 'seq_skips',     k: 'seqSkips' },   // saltos de setor = comutação errada
  { h: 'seq_revs',      k: 'seqRevs' },
  { h: 'seq_inval',     k: 'seqInval' },
  { h: 'rej_filt_a',    k: 'rejFiltA' },
  { h: 'rej_filt_b',    k: 'rejFiltB' },
  { h: 'rej_filt_c',    k: 'rejFiltC' },
  { h: 'rej_conf_a',    k: 'rejConfA' },
  { h: 'rej_conf_b',    k: 'rejConfB' },
  { h: 'rej_conf_c',    k: 'rejConfC' },
  { h: 'hall_bad',      k: 'hallBad' },
  { h: 'link_drops',    k: 'linkDrops' },
  { h: 'loop_gap_us',   k: 'loopGapUs' },
  // ---- entrada do piloto + alvos internos ----
  { h: 'throttle_in',   k: 'throttleIn' },   // acelerador CRU (0..1)
  { h: 'brake_in',      k: 'brakeIn' },      // freio CRU (0..1)
  { h: 'thr_eff',       k: 'thrEff' },       // acelerador após a curva
  { h: 'brk_eff',       k: 'brkEff' },       // freio após curva+regen
  { h: 'loop_hz',       k: 'loopHz' },       // frequência real do loop FOC
  { h: 'vel_target_rads', k: 'velTarget' },  // alvo modo velocidade
  { h: 'elec_angle_rad',k: 'elecAngle' },    // ângulo elétrico da comutação
  // ---- detalhe máximo ----
  { h: 'esp_us',        k: 'espUs' },        // timestamp REAL do ESP (jitter/drops)
  { h: 'dc_a',          k: 'dcA' },          // duty por fase (vetor aplicado)
  { h: 'dc_b',          k: 'dcB' },
  { h: 'dc_c',          k: 'dcC' },
  { h: 'shaft_angle_rad', k: 'shaftAngle' }, // ângulo mecânico
  { h: 'shaft_vel_rads', k: 'shaftVel' },    // velocidade SimpleFOC
  { h: 'pscale_fold_pct', k: 'pscaleFold' }, // foldback isolado
  { h: 'eco_v',         k: 'ecoV' },         // tensão do eco auto
  { h: 'regen_ilim_A',  k: 'regenILim' },    // limite de regen efetivo
  { h: 'ms_since_cmd',  k: 'msSinceCmd' },   // dead-man do link
  { h: 'free_heap_kb',  k: 'freeHeapKb' },   // RAM livre
];

// Constrói uma linha do log a partir da telemetria decodificada + timestamp.
export function logRow(t, tMs) {
  return {
    t: tMs,
    kmh: t.kmh, ibat: t.ibat, vbat: t.vbat, powerW: t.powerW, temp: t.tempC,
    motorTemp: t.motorTempC,
    targetV: t.targetV, duty: t.duty, headroom: t.headroom, scale: t.scalePct,
    gapUs: t.gapUs, fwA: t.fwA, mtpaDeg: t.mtpaDeg, zea: t.zea,
    soc: t.soc, capWh: t.capWh, whPerKm: t.whPerKm, range: t.rangeKm,
    odoKm: t.odoKm, tripKm: t.tripKm, tripWh: t.tripWh, tripWhRegen: t.tripWhRegen,
    iLimit: t.iLimit, vMax: t.vMax, vLimit: t.vLimit, ride: t.ride,
    faults: t.faults, cmdStatus: t.cmdStatus,
    en: t.enabled ? 1 : 0, modeVel: t.modeVel ? 1 : 0, regen: t.regen ? 1 : 0,
    cruise: t.cruise ? 1 : 0, walk: t.walk ? 1 : 0, locked: t.locked ? 1 : 0,
    sat: t.saturated ? 1 : 0, uv: t.uvWarn ? 1 : 0, eco: t.ecoAuto ? 1 : 0,
    panel: t.panel ? 1 : 0, farol: t.farol ? 1 : 0,
    // core profundo (já decodificado em t)
    velEst: t.velEst, vq: t.vq, vd: t.vd, iRaw: t.iRaw,
    effVLimit: t.effVLimit,
    iphMag: t.iphMag, iphQ: t.iphQ, iqTarget: t.iqTarget, iphD: t.iphD,
    iphA: t.iphA, iphB: t.iphB, iphC: t.iphC, dutyMax: t.dutyMax,
    iphZero1: t.iphZero1, iphZero2: t.iphZero2,
    iphScale1: t.iphScale1, iphScale2: t.iphScale2, iphRejects: t.iphRejects,
    tempScale: t.tempScale, tracvScale: t.tracvScale,
    elecSector: t.elecSector, ovr: t.ovr, coastAct: t.coastAct,
    hallBits: t.hallBits, hallSeen: t.hallSeen, hallEps: t.hallEps,
    epsA: t.epsA, epsB: t.epsB, epsC: t.epsC,
    seqSkips: t.seqSkips, seqRevs: t.seqRevs, seqInval: t.seqInval,
    rejFiltA: t.rejFiltA, rejFiltB: t.rejFiltB, rejFiltC: t.rejFiltC,
    rejConfA: t.rejConfA, rejConfB: t.rejConfB, rejConfC: t.rejConfC,
    hallBad: t.hallBad, linkDrops: t.linkDrops, loopGapUs: t.loopGapUs,
    throttleIn: t.throttleIn, brakeIn: t.brakeIn, thrEff: t.thrEff,
    brkEff: t.brkEff, loopHz: t.loopHz, velTarget: t.velTarget,
    elecAngle: t.elecAngle,
    espUs: t.espUs, dcA: t.dcA, dcB: t.dcB, dcC: t.dcC,
    shaftAngle: t.shaftAngle, shaftVel: t.shaftVel, pscaleFold: t.pscaleFold,
    ecoV: t.ecoV, regenILim: t.regenILim, msSinceCmd: t.msSinceCmd,
    freeHeapKb: t.freeHeapKb,
  };
}

// Serializa o log inteiro em CSV (cabeçalho + linhas, na ordem de LOG_COLS).
export function logToCsv(rows) {
  const head = LOG_COLS.map(c => c.h).join(',');
  const lines = new Array(rows.length);
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    lines[i] = LOG_COLS.map(c => {
      const v = r[c.k];
      return v === undefined || v === null ? '' : v;
    }).join(',');
  }
  return head + '\n' + lines.join('\n') + '\n';
}

// frame do STREAM de alta taxa (12 B)
export function decodeStream(base64) {
  const b = b64decode(base64);
  if (b.length < 12) return null;
  const dv = new DataView(b.buffer);
  return {
    t:    dv.getUint16(0, true),
    kmh:  dv.getInt16(2, true) / 10,
    ibat: dv.getInt16(4, true) / 10,
    vbat: dv.getUint16(6, true) / 10,
    target: dv.getInt16(8, true) / 10,
    duty: b[10],
    temp: dv.getInt8(11),
    // frame 16 B (firmware novo): performance; 12 B antigo => undefined
    fwA:     b.length >= 16 ? b[12] / 2 : undefined,   // id de FW [A]
    scale:   b.length >= 16 ? b[13] : undefined,
    mtpaDeg: b.length >= 16 ? dv.getInt8(14) / 10 : undefined,
    headPct: b.length >= 16 ? b[15] : undefined,
    // frame 20 B: corrente de fase medida x pedida (tuning do PI de corrente)
    iq:      b.length >= 20 ? dv.getInt16(16, true) / 10 : undefined,
    iqt:     b.length >= 20 ? dv.getInt16(18, true) / 10 : undefined,
  };
}

// --- gerenciador de conexão --------------------------------------------------
export class ScooterBle {
  constructor(onTelemetry, onStatus) {
    this.manager = new BleManager();
    this.device = null;
    this.onTelemetry = onTelemetry;
    this.onStatus = onStatus;   // 'off' | 'scanning' | 'connecting' | 'connected'
    this.stopped = false;
  }

  async requestPermissions() {
    if (Platform.OS !== 'android') return true;
    const perms = [
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    ].filter(Boolean);
    const res = await PermissionsAndroid.requestMultiple(perms);
    return Object.values(res).every(v => v === 'granted' || v === 'never_ask_again');
  }

  start() {
    this.stopped = false;
    const sub = this.manager.onStateChange(state => {
      if (state === 'PoweredOn') { sub.remove(); this.scan(); }
      else this.onStatus('off');
    }, true);
  }

  scan() {
    if (this.stopped) return;
    this.onStatus('scanning');
    this.manager.startDeviceScan([UUID_SERVICE], null, (err, dev) => {
      if (err) { this.onStatus('off'); return; }
      if (dev) { this.manager.stopDeviceScan(); this.connect(dev); }
    });
  }

  async connect(dev) {
    try {
      this.onStatus('connecting');
      const d = await dev.connect({ requestMTU: 247 });
      await d.discoverAllServicesAndCharacteristics();
      this.device = d;
      d.onDisconnected(() => {
        this.device = null;
        if (!this.stopped) { this.onStatus('scanning'); this.scan(); }
      });
      d.monitorCharacteristicForService(UUID_SERVICE, UUID_TELEM, (err, ch) => {
        if (!err && ch?.value) {
          const t = decodeTelemetry(ch.value);
          if (t) this.onTelemetry(t);
        }
      });
      this.onStatus('connected');
    } catch (e) {
      this.onStatus('scanning');
      setTimeout(() => this.scan(), 1500);
    }
  }

  // envia um comando [id][f32] — fire-and-forget
  async send(id, value) {
    if (!this.device) return;
    const b = new Uint8Array(5);
    b[0] = id;
    new DataView(b.buffer).setFloat32(1, value, true);
    try {
      await this.device.writeCharacteristicWithoutResponseForService(
        UUID_SERVICE, UUID_CTRL, b64encode(b));
    } catch (e) { /* desconexão em curso — o reconnect cuida */ }
  }

  // Lê o pacote de parâmetros: [n][id u8, valor f32, default f32] * n
  // Devolve { id: { val, def } }
  async readParams() {
    if (!this.device) return null;
    try {
      const ch = await this.device.readCharacteristicForService(UUID_SERVICE, UUID_PARAMS);
      const b = b64decode(ch.value);
      if (b.length < 1) return null;
      const dv = new DataView(b.buffer);
      const n = b[0];
      const out = {};
      for (let i = 0; i < n; i++) {
        const off = 1 + i * 9;
        if (off + 9 > b.length) break;
        out[b[off]] = {
          val: dv.getFloat32(off + 1, true),
          def: dv.getFloat32(off + 5, true),
        };
      }
      return out;
    } catch (e) { return null; }
  }

  // Escreve uma lista de { id, val } (com resposta — confiável p/ aplicar)
  async writeParams(entries) {
    if (!this.device || !entries.length) return false;
    const b = new Uint8Array(entries.length * 5);
    const dv = new DataView(b.buffer);
    entries.forEach((e, i) => { b[i * 5] = e.id; dv.setFloat32(i * 5 + 1, e.val, true); });
    try {
      await this.device.writeCharacteristicWithResponseForService(
        UUID_SERVICE, UUID_PARAMS, b64encode(b));
      return true;
    } catch (e) { return false; }
  }

  // Liga/desliga o stream de alta taxa e assina os frames
  async streamStart(hz, onFrame) {
    if (!this.device) return;
    this.onStream = onFrame;
    if (!this.streamSub) {
      this.streamSub = this.device.monitorCharacteristicForService(
        UUID_SERVICE, UUID_STREAM, (err, ch) => {
          if (!err && ch?.value && this.onStream) {
            const f = decodeStream(ch.value);
            if (f) this.onStream(f);
          }
        });
    }
    await this.send(CMD.STREAM_HZ, hz);
  }
  async streamStop() {
    await this.send(CMD.STREAM_HZ, 0);
    this.onStream = null;
  }

  // DATALOGGER DE DEBUG: pacote RICO completo (=telemetria) a 50 Hz numa
  // característica dedicada. onSample recebe cada amostra já decodificada.
  async debugStart(hz, onSample) {
    if (!this.device) return false;
    this.onDebug = onSample;
    if (!this.debugSub) {
      this.debugSub = this.device.monitorCharacteristicForService(
        UUID_SERVICE, UUID_DEBUG, (err, ch) => {
          if (!err && ch?.value && this.onDebug) {
            const t = decodeTelemetry(ch.value);
            if (t) this.onDebug(t);
          }
        });
    }
    await this.send(CMD.DBG_HZ, hz || 50);
    this.debugActive = true;
    return true;
  }
  async debugStop() {
    await this.send(CMD.DBG_HZ, 0);
    this.onDebug = null;
    this.debugActive = false;
  }

  // Curvas: [id][n][x i16, y i16]*n (o firmware valida e pode REJEITAR)
  async readCurve(id) {
    if (!this.device) return null;
    try {
      await this.send(CMD.CURVE_SEL, id);
      await new Promise(r => setTimeout(r, 120));
      const ch = await this.device.readCharacteristicForService(UUID_SERVICE, UUID_CURVE);
      const b = b64decode(ch.value);
      if (b.length < 2 || b[0] !== id) return null;
      const dv = new DataView(b.buffer);
      const n = b[1], pts = [];
      for (let i = 0; i < n; i++)
        pts.push({ x: dv.getInt16(2 + i * 4, true), y: dv.getInt16(4 + i * 4, true) });
      return pts;
    } catch (e) { return null; }
  }
  async writeCurve(id, pts) {
    if (!this.device) return false;
    const b = new Uint8Array(2 + pts.length * 4);
    const dv = new DataView(b.buffer);
    b[0] = id; b[1] = pts.length;
    pts.forEach((p, i) => {
      dv.setInt16(2 + i * 4, Math.round(p.x), true);
      dv.setInt16(4 + i * 4, Math.round(p.y), true);
    });
    try {
      await this.device.writeCharacteristicWithResponseForService(
        UUID_SERVICE, UUID_CURVE, b64encode(b));
      return true;
    } catch (e) { return false; }
  }

  // BULK: baixa tudo de uma fonte (1 = captura de step, 2 = log de faltas)
  async bulkDownload(src) {
    if (!this.device) return null;
    try {
      await this.send(CMD.BULK_SRC, src);
      await new Promise(r => setTimeout(r, 120));
      const out = [];
      for (let guard = 0; guard < 100; guard++) {
        const ch = await this.device.readCharacteristicForService(UUID_SERVICE, UUID_BULK);
        const b = b64decode(ch.value || '');
        if (!b.length) break;
        out.push(b);
      }
      const total = out.reduce((a, c) => a + c.length, 0);
      const buf = new Uint8Array(total);
      let off = 0;
      for (const c of out) { buf.set(c, off); off += c.length; }
      return buf;
    } catch (e) { return null; }
  }

  stop() {
    this.stopped = true;
    this.manager.stopDeviceScan();
    if (this.device) this.device.cancelConnection().catch(() => {});
  }
}
