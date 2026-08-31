// ============================================================================
// theme.js — DESIGN SYSTEM do app (tokens centralizados)
// ----------------------------------------------------------------------------
// Contexto que dita as decisões: uso ao ar livre (sol/noite), leitura de
// relance em movimento, operação com uma mão/luva. Tema ESCURO é o principal.
//
// REGRAS DE USO (valem para todas as telas):
//  - Nenhum valor visual hard-coded em componente: tudo vem destes tokens.
//  - UMA cor de acento (ação primária + dado ativo). Semânticas fixas em todo
//    o app, inclusive gráficos: mesma grandeza = mesma cor em todo lugar.
//  - Cor nunca é o único portador de informação (ícone/label/forma junto).
//  - Números de telemetria SEMPRE com fontVariant tabular (não "dançam").
//  - Ações principais na metade inferior da tela (alcance de polegar).
// ============================================================================

// --- COR --------------------------------------------------------------------
// Neutros: cinza-azulado profundo (não preto puro). 4 níveis de superfície
// criam profundidade sem sombra pesada.
const palette = {
  bg:        '#0B0F10',  // grafite-petróleo profundo (frio, não navy)
  surface1:  '#12181A',  // painel
  surface2:  '#1A2224',  // controle
  surface3:  '#242E31',  // overlay / pressed
  border:    '#2C383B',  // borda de elemento interativo
  divider:   '#1B2325',  // fio horizontal de seção (hairline)

  text:      '#F2F5F4',  // primário (15:1 sobre bg)
  textMut:   '#9AA8A6',  // secundário (AA)
  textDim:   '#5A6866',  // desabilitado / decorativo

  accent:        '#FF7A1A',  // laranja-sinal (instrumento de medição).
  accentPressed: '#E06210',  // SÓ ação primária e elemento interativo ativo.
  onAccent:      '#1A0E02',

  // Semânticas (fixas no app inteiro, inclusive gráficos):
  traction:  '#EAF2F4',  // tração / energia saindo — BRANCO de ponteiro
  regen:     '#46D07C',  // regeneração — verde, oposta à tração
  warn:      '#FFC53D',  // atenção / perto do limite — amarelo
  danger:    '#FF4D42',  // perigo / falta — vermelho + marca octogonal
  neutral:   '#9AA8A6',  // informação secundária

  // Fundos semânticos (faixas/banners — ~10% sobre o fundo)
  dangerBg:  '#301412',
  warnBg:    '#2E2408',
  regenBg:   '#0E2A1A',

  estop:     '#C93B3B',  // EXCLUSIVO do botão de emergência (nunca reutilizar)
  estopPressed: '#A82F2F',
  onEstop:   '#FFFFFF',
};

// --- TIPOGRAFIA -------------------------------------------------------------
// Uma família (a do sistema). Identidade: NUMERAIS GRANDES E LEVES (peso
// 300-400, como cluster automotivo/instrumento de bancada) + labels pequenos
// em CAPS com tracking largo. Peso alto não é usado para dado — só o E-STOP
// e avisos gritam. Números TABULARES sempre.
const type = {
  display: { fontSize: 96, fontWeight: '300', lineHeight: 100,
             letterSpacing: -2 },                                // velocidade
  big:     { fontSize: 34, fontWeight: '400', lineHeight: 38 },  // valor grande
  title:   { fontSize: 20, fontWeight: '600', lineHeight: 26 },  // título
  body:    { fontSize: 15, fontWeight: '400', lineHeight: 20 },  // texto padrão
  label:   { fontSize: 11, fontWeight: '600', lineHeight: 15,
             letterSpacing: 2, textTransform: 'uppercase' },     // rótulos CAPS
  micro:   { fontSize: 10, fontWeight: '500', lineHeight: 13,
             letterSpacing: 0.4 },                               // unidades
  tabular: ['tabular-nums'],   // TODO número de telemetria
};

// --- ESPAÇO / FORMA ---------------------------------------------------------
// Espaçamento em múltiplos de 4. Cantos MODERADOS (8-12px): técnico sem ser
// duro. Separação por ESPAÇO e FIO (divider); superfície em interativos.
const space  = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
const radius = { card: 12, control: 8, chip: 6 };   // nem cápsula, nem vivo
const size   = {
  touch: 48,       // altura mínima de QUALQUER alvo de toque
  estop: 64,       // botão de emergência: maior que tudo
  hairline: 1,
};

// --- MOVIMENTO --------------------------------------------------------------
// Curto e funcional. Telemetria NUNCA anima — número que muda, muda.
const motion = { fast: 150, base: 200, slow: 250 };

// --- DENSIDADES (as duas camadas do app) ------------------------------------
// PILOTO: respirado, números gigantes, pouco elemento.
// OFICINA: denso, técnico, controles compactos.
const density = {
  pilot:    { pad: space.lg, gap: space.md, rowPad: space.lg },
  workshop: { pad: space.md, gap: space.sm, rowPad: space.md },
};

// --- VARIANTES DE BOTÃO (as únicas 5 do app) --------------------------------
// Cada uma com os 4 estados: normal / pressed / disabled / loading.
// loading é OBRIGATÓRIO em ação que fala com o ESP32.
const button = {
  primary:   { bg: palette.accent,   bgPressed: palette.accentPressed,
               fg: palette.onAccent, border: 'transparent' },
  secondary: { bg: palette.surface2, bgPressed: palette.surface3,
               fg: palette.text,     border: palette.border },
  tertiary:  { bg: 'transparent',    bgPressed: palette.surface2,
               fg: palette.textMut,  border: 'transparent' },
  danger:    { bg: 'transparent',    bgPressed: palette.dangerBg,
               fg: palette.danger,   border: palette.danger },
  estop:     { bg: palette.estop,    bgPressed: palette.estopPressed,
               fg: palette.onEstop,  border: '#7A2020' },  // tratamento exclusivo
  disabledOpacity: 0.38,
};

export const T = { color: palette, type, space, radius, size, motion,
                   density, button };

// Faltas: sempre ícone + texto (cor nunca sozinha)
export const FAULT_NAMES = [
  [1,  'SOBRECORRENTE'],
  [2,  'SUBTENSÃO'],
  [4,  'SOBRETEMPERATURA'],
  [8,  'SENSOR/FOC (reiniciar)'],
  [16, 'E-STOP acionado'],
  [32, 'sem comando (dead-man)'],
  [128,'STALL (fase protegida)'],
];
