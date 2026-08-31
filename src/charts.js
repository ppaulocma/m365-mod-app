// ============================================================================
// charts.js — data viz do design system (react-native-svg)
// ----------------------------------------------------------------------------
// LineChart: multi-série estilo osciloscópio (grid discreto, zonas de limite
//            como faixa sutil, linhas grossas p/ leitura em movimento).
// CurveEditor: pontos ARRASTÁVEIS com clamp físico, fantasma da curva
//              anterior, presets, undo e reset — nada de slider cego.
// ============================================================================
import React, { useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, PanResponder, Pressable } from 'react-native';
import Svg, { Polyline, Line, Rect, Circle, Path, Text as SvgText } from 'react-native-svg';
import { T } from './theme';
import { Ionicons } from '@expo/vector-icons';
import { haptic } from './ui';

// O react-native-svg tem código NATIVO: se o dev client foi compilado antes
// dele entrar, o render explode com "RNSVG... not found". Este boundary
// transforma o crash numa instrução clara de recompilar.
class ChartBoundary extends React.Component {
  constructor(p) { super(p); this.state = { err: false }; }
  static getDerivedStateFromError() { return { err: true }; }
  render() {
    if (this.state.err) {
      return (
        <View style={{ padding: 16, borderWidth: 1, borderColor: T.color.warn,
                       borderRadius: 3 }}>
          <Text style={{ color: T.color.warn, fontSize: 12, lineHeight: 17 }}>
            Os gráficos precisam do módulo nativo do SVG.{'\n'}
            Recompile o app uma vez:{'\n'}
            npx expo run:ios   (ou run:android)
          </Text>
        </View>
      );
    }
    return this.props.children;
  }
}

// --- Gauge (arco 270°) -------------------------------------------------------
// value/min/max + zonas coloridas; número central grande, unidade leve.
export function Gauge(props) {
  return <ChartBoundary><GaugeInner {...props} /></ChartBoundary>;
}
function GaugeInner({ label, value, unit, min = 0, max = 100, size = 150,
                      color = T.color.traction, warnFrom, dangerFrom, decimals = 0 }) {
  const R = size / 2 - 10, cx = size / 2, cy = size / 2;
  const a0 = 135, sweep = 270;
  const frac = Math.max(0, Math.min(1, ((value ?? min) - min) / (max - min)));
  const arc = (from, to, stroke, wdt, op = 1) => {
    const A0 = ((a0 + from * sweep) * Math.PI) / 180;
    const A1 = ((a0 + to * sweep) * Math.PI) / 180;
    const large = (to - from) * sweep > 180 ? 1 : 0;
    const d = `M ${cx + R * Math.cos(A0)} ${cy + R * Math.sin(A0)} ` +
              `A ${R} ${R} 0 ${large} 1 ${cx + R * Math.cos(A1)} ${cy + R * Math.sin(A1)}`;
    return <Path d={d} stroke={stroke} strokeWidth={wdt} fill="none"
                 strokeLinecap="round" opacity={op} />;
  };
  let liveColor = color;
  if (dangerFrom !== undefined && value >= dangerFrom) liveColor = T.color.danger;
  else if (warnFrom !== undefined && value >= warnFrom) liveColor = T.color.warn;
  return (
    <View style={{ width: size, alignItems: 'center' }}>
      <Svg width={size} height={size * 0.86}>
        {arc(0, 1, T.color.surface2, 8)}
        {warnFrom !== undefined && arc((warnFrom - min) / (max - min),
          dangerFrom !== undefined ? (dangerFrom - min) / (max - min) : 1,
          T.color.warn, 8, 0.25)}
        {dangerFrom !== undefined && arc((dangerFrom - min) / (max - min), 1,
          T.color.danger, 8, 0.3)}
        {frac > 0.005 && arc(0, frac, liveColor, 8)}
      </Svg>
      {/* valor centrado no arco; a cor acompanha a zona (branco/âmbar/verm.) */}
      <View style={{ position: 'absolute', top: size * 0.27, left: 0, right: 0,
                     alignItems: 'center' }}>
        <Text numberOfLines={1} style={{ fontSize: size * 0.185, fontWeight: '400',
                       color: liveColor, fontVariant: ['tabular-nums'] }}>
          {value !== undefined && value !== null ? Number(value).toFixed(decimals) : '--'}
        </Text>
        <Text style={{ ...T.type.micro, color: T.color.textMut }}>{unit}</Text>
      </View>
      {/* rótulo abaixo do arco: largura toda, fonte encolhe até caber */}
      <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}
            style={{ ...T.type.micro, color: T.color.textDim,
                     letterSpacing: 1.6, width: size, textAlign: 'center',
                     marginTop: -2 }}>{label}</Text>
    </View>
  );
}

// --- LineChart ---------------------------------------------------------------
// series: [{ data:[y...], color, label }] · zones: [{from,to,color}] (em y)
export function LineChart(props) {
  return <ChartBoundary><LineChartInner {...props} /></ChartBoundary>;
}
function LineChartInner({ series, height = 160, yMin, yMax, zones = [],
                            xLabel, testID, showLegend = true }) {
  const [w, setW] = useState(0);
  const H = height, PADL = 12, PADR = 14, PADT = 10, PADB = 10;
  let lo = yMin, hi = yMax;
  if (lo === undefined || hi === undefined) {
    lo = Infinity; hi = -Infinity;
    for (const s of series) for (const v of s.data) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    if (!isFinite(lo)) { lo = 0; hi = 1; }
    if (hi - lo < 1e-6) hi = lo + 1;
    const m = (hi - lo) * 0.1; lo -= m; hi += m;
  }
  const sy = v => H - PADB - ((v - lo) / (hi - lo)) * (H - PADT - PADB);
  const n = Math.max(...series.map(s => s.data.length), 2);
  const sx = i => PADL + (i / (n - 1)) * (w - PADL - PADR);

  return (
    <View onLayout={e => setW(e.nativeEvent.layout.width)} testID={testID}>
      {w > 0 && (
        <Svg width={w} height={H}>
          {zones.map((z, i) => (
            <Rect key={i} x={PADL} width={w - PADL - PADR}
              y={sy(z.to)} height={Math.max(0, sy(z.from) - sy(z.to))}
              fill={z.color} opacity={0.09} />
          ))}
          {[0, 0.25, 0.5, 0.75, 1].map(f => (
            <Line key={f} x1={PADL} x2={w - PADR}
              y1={PADT + f * (H - PADT - PADB)} y2={PADT + f * (H - PADT - PADB)}
              stroke={T.color.divider} strokeWidth={1} />
          ))}
          {series.map((s, i) => s.data.length > 1 && (
            <Polyline key={i}
              points={s.data.map((v, j) => `${sx(j)},${sy(v)}`).join(' ')}
              fill="none" stroke={s.color}
              strokeWidth={s.thin ? 1.5 : 2.5} opacity={s.ghost ? 0.35 : 1} />
          ))}
          <SvgText x={PADL + 4} y={PADT + 10} fill={T.color.textMut}
            fontSize={10} textAnchor="start">
            {hi.toFixed(Math.abs(hi) < 10 ? 1 : 0)}</SvgText>
          <SvgText x={PADL + 4} y={(H + PADT - PADB) / 2 + 4} fill={T.color.textDim}
            fontSize={10} textAnchor="start">
            {((hi + lo) / 2).toFixed(Math.abs(hi) < 10 ? 1 : 0)}</SvgText>
          <SvgText x={PADL + 4} y={H - PADB - 4} fill={T.color.textMut}
            fontSize={10} textAnchor="start">
            {lo.toFixed(Math.abs(lo) < 10 ? 1 : 0)}</SvgText>
        </Svg>
      )}
      {showLegend && (
        <View style={cs.legend}>
          {series.map((s, i) => (
            <View key={i} style={cs.legItem}>
              <View style={[cs.legSw, { backgroundColor: s.color }]} />
              <Text style={cs.legTxt}>{s.label}</Text>
            </View>
          ))}
          {xLabel ? <Text style={[cs.legTxt, { marginLeft: 'auto' }]}>{xLabel}</Text> : null}
        </View>
      )}
    </View>
  );
}

// --- CurveEditor -------------------------------------------------------------
// pts: [{x,y}] · spec: {xMin,xMax,yMin,yMax,xUnit,yUnit,safeY?} · onChange(pts)
// ghost: curva anterior (fantasma) · presets: [{name,pts}]
export function CurveEditor(props) {
  return <ChartBoundary><CurveEditorInner {...props} /></ChartBoundary>;
}
function CurveEditorInner({ pts, ghost, spec, onChange, presets = [],
                            height = 210, onDragging }) {
  const [w, setW] = useState(0);
  const [dragLbl, setDragLbl] = useState(null);
  const H = height, PADX = 20, PADR = 20, PADY = 22;
  const undoRef = useRef(null);
  const xs = spec.xScale ?? 1;                    // exibição (ex.: V*10 -> V)
  const fmtX = v => String(+(v * xs).toFixed(1));
  const maxPts = spec.maxPts ?? 8;

  const addPointAt = (lx, ly) => {                // toque no vazio: ponto ALI
    if (pts.length >= maxPts) return;
    let nx = Math.round(Math.max(spec.xMin, Math.min(spec.xMax, ux(lx))));
    let ny = Math.round(Math.max(spec.yMin, Math.min(spec.yMax, uy(ly))));
    if (spec.safeY !== undefined) ny = Math.min(ny, spec.safeY);
    let ins = pts.length;
    for (let i = 0; i < pts.length; i++) if (pts[i].x > nx) { ins = i; break; }
    const loX = ins > 0 ? pts[ins - 1].x : spec.xMin - 2;
    const hiX = ins < pts.length ? pts[ins].x : spec.xMax + 2;
    if (nx - loX < 2 || hiX - nx < 2) return;     // colado num vizinho: ignora
    undoRef.current = pts.map(q => ({ ...q }));
    const p = pts.map(q => ({ ...q }));
    p.splice(ins, 0, { x: nx, y: ny });
    onChange(p);
  };
  const rmPointAt = (i) => {                      // segurar um ponto: remove
    if (i <= 0 || i >= pts.length - 1 || pts.length <= 2) return;
    undoRef.current = pts.map(q => ({ ...q }));
    onChange(pts.filter((_, k) => k !== i));
  };

  const px = x => PADX + ((x - spec.xMin) / (spec.xMax - spec.xMin)) * (w - PADX - PADR);
  const py = y => H - PADY - ((y - spec.yMin) / (spec.yMax - spec.yMin)) * (H - 2 * PADY);
  const ux = pxv => spec.xMin + ((pxv - PADX) / (w - PADX - PADR)) * (spec.xMax - spec.xMin);
  const uy = pyv => spec.yMin + ((H - PADY - pyv) / (H - 2 * PADY)) * (spec.yMax - spec.yMin);

  const dragIdx = useRef(-1);
  const gest = useRef({ t0: 0, x0: 0, y0: 0, moved: false });
  const pan = useMemo(() => PanResponder.create({
    // O editor é DONO do gesto: captura o toque e NUNCA cede para o
    // ScrollView pai (senão a tela rola junto e o arrasto buga).
    onStartShouldSetPanResponder: () => true,
    onStartShouldSetPanResponderCapture: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (e) => {
      const { locationX, locationY } = e.nativeEvent;
      gest.current = { t0: Date.now(), x0: locationX, y0: locationY,
                       moved: false };
      let best = -1, bd = 1e9;
      pts.forEach((p, i) => {
        const d = Math.hypot(px(p.x) - locationX, py(p.y) - locationY);
        if (d < bd) { bd = d; best = i; }
      });
      dragIdx.current = (bd < 44) ? best : -1;   // alvo de toque generoso
      if (dragIdx.current >= 0) undoRef.current = pts.map(p => ({ ...p }));
      onDragging?.(true);                        // trava o scroll da tela
    },
    onPanResponderMove: (e) => {
      const { locationX, locationY } = e.nativeEvent;
      const g = gest.current;
      if (Math.hypot(locationX - g.x0, locationY - g.y0) > 8) g.moved = true;
      const i = dragIdx.current;
      if (i < 0 || !g.moved) return;
      const p = [...pts.map(q => ({ ...q }))];
      // CLAMP FÍSICO: nunca além dos limites do firmware; x mantém a ordem
      let nx = Math.max(spec.xMin, Math.min(spec.xMax, ux(locationX)));
      const loX = i > 0 ? p[i - 1].x + 1 : spec.xMin;
      const hiX = i < p.length - 1 ? p[i + 1].x - 1 : spec.xMax;
      nx = Math.max(loX, Math.min(hiX, nx));
      let ny = Math.max(spec.yMin, Math.min(spec.yMax, uy(locationY)));
      if (spec.safeY !== undefined) ny = Math.min(ny, spec.safeY);
      p[i] = { x: Math.round(nx), y: Math.round(ny) };
      setDragLbl(fmtX(p[i].x) + (spec.xUnit ?? '') + '  \u2192  '
                 + p[i].y + (spec.yUnit ?? ''));
      onChange(p);
    },
    onPanResponderRelease:   () => {
      const g = gest.current, held = Date.now() - g.t0;
      if (!g.moved) {
        if (dragIdx.current >= 0 && held > 450) rmPointAt(dragIdx.current);
        else if (dragIdx.current < 0 && held < 300) addPointAt(g.x0, g.y0);
      }
      dragIdx.current = -1; setDragLbl(null); onDragging?.(false);
    },
    onPanResponderTerminate: () => { dragIdx.current = -1; setDragLbl(null);
                                     onDragging?.(false); },
  }), [pts, w]);

  return (
    <View>
      {/* cabeçalho dos eixos: o que é o Y + leitura viva do ponto arrastado */}
      <View style={cs.axisHead}>
        <Text style={cs.axisLbl}>{'\u2191 '}{spec.yLabel ?? ''}</Text>
        <View style={cs.headRight}>
          <Text style={[cs.dragVal, !dragLbl && { color: T.color.textMut }]}>
            {dragLbl ?? `${pts.length}/${maxPts} pontos`}
          </Text>
          <Pressable hitSlop={10} accessibilityLabel="desfazer última edição"
            onPress={() => { haptic(20);
                             if (undoRef.current) onChange(undoRef.current); }}>
            <Ionicons name="arrow-undo-outline" size={16}
              color={T.color.textDim} />
          </Pressable>
        </View>
      </View>
      <View onLayout={e => setW(e.nativeEvent.layout.width)} {...pan.panHandlers}>
        {w > 0 && (
          <Svg width={w} height={H}>
            {/* zona proibida acima do limite seguro */}
            {spec.safeY !== undefined && (
              <Rect x={PADX} width={w - PADX - PADR} y={py(spec.yMax)}
                height={Math.max(0, py(spec.safeY) - py(spec.yMax))}
                fill={T.color.danger} opacity={0.10} />
            )}
            {[0.25, 0.5, 0.75].map(f => (
              <Line key={f} x1={PADX} x2={w - PADR} y1={H * f} y2={H * f}
                stroke={T.color.divider} strokeWidth={1} />
            ))}
            {ghost && ghost.length > 1 && (
              <Polyline points={ghost.map(p => `${px(p.x)},${py(p.y)}`).join(' ')}
                fill="none" stroke={T.color.textMut} strokeWidth={2} opacity={0.3} />
            )}
            <Polyline points={pts.map(p => `${px(p.x)},${py(p.y)}`).join(' ')}
              fill="none" stroke={T.color.accent} strokeWidth={2.5} />
            {pts.map((p, i) => (
              <React.Fragment key={i}>
                <Circle cx={px(p.x)} cy={py(p.y)} r={16}
                  fill={T.color.accent} opacity={0.15} />
                <Circle cx={px(p.x)} cy={py(p.y)} r={6} fill={T.color.accent} />
              </React.Fragment>
            ))}
            {/* números do eixo Y por DENTRO do plot (canto sup./inf. esq.):
                gutter externo vira ~zero e o gráfico usa a largura toda */}
            <SvgText x={PADX + 4} y={py(spec.yMax) + 12} fill={T.color.textMut}
              fontSize={10}>{spec.yMax}{spec.yUnit}</SvgText>
            <SvgText x={PADX + 4} y={py(spec.yMin) - 6} fill={T.color.textMut}
              fontSize={10}>{spec.yMin}</SvgText>
            <SvgText x={PADX} y={H - 4} fill={T.color.textDim} fontSize={10}>
              {fmtX(spec.xMin)}{spec.xUnit}</SvgText>
            <SvgText x={(PADX + w - PADR) / 2} y={H - 4} fill={T.color.textDim}
              fontSize={10} textAnchor="middle">
              {spec.xLabel ?? ''}{' \u2192'}</SvgText>
            <SvgText x={w - PADR} y={H - 4} fill={T.color.textDim} fontSize={10}
              textAnchor="end">{fmtX(spec.xMax)}{spec.xUnit}</SvgText>
          </Svg>
        )}
      </View>
      <Text style={cs.gestHint}>
        {'toque no vazio = novo ponto \u00b7 segurar um ponto = remover \u00b7 '}
        {'arrastar = ajustar'}
      </Text>
      {presets.length > 0 && (
        <View style={cs.presetRow}>
          <Text style={cs.presetLbl}>MODELOS</Text>
          {presets.map(pr => (
            <Pressable key={pr.name} style={cs.preset}
              accessibilityLabel={`modelo ${pr.name}`}
              onPress={() => { haptic(25);
                               undoRef.current = pts.map(p => ({ ...p }));
                               onChange(pr.pts.map(p => ({ ...p }))); }}>
              <Text style={cs.presetTxt}>{pr.name}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const cs = StyleSheet.create({
  axisHead: { flexDirection: 'row', justifyContent: 'space-between',
              alignItems: 'baseline', marginBottom: 4 },
  axisLbl: { ...T.type.micro, color: T.color.textDim, letterSpacing: 1.2 },
  dragVal: { ...T.type.micro, color: T.color.accent, letterSpacing: 1.2,
             fontVariant: ['tabular-nums'] },
  legend: { flexDirection: 'row', gap: T.space.lg, marginTop: T.space.sm,
            alignItems: 'center', flexWrap: 'wrap', paddingLeft: 12 },
  legItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legSw: { width: 14, height: 4, borderRadius: 2 },
  legTxt: { fontSize: 11, fontWeight: '600', color: T.color.textMut,
            letterSpacing: 0.3 },
  headRight: { flexDirection: 'row', alignItems: 'center', gap: T.space.md },
  gestHint: { fontSize: 10, color: T.color.textMut, letterSpacing: 0.4,
              marginTop: 4, textAlign: 'center' },
  presetRow: { flexDirection: 'row', gap: T.space.sm, marginTop: T.space.md,
               flexWrap: 'wrap', alignItems: 'center' },
  presetLbl: { ...T.type.micro, color: T.color.textDim, letterSpacing: 2,
               marginRight: T.space.xs },
  preset: { borderWidth: 1, borderColor: T.color.border,
            borderRadius: T.radius.control,
            paddingVertical: 6, paddingHorizontal: 12 },
  presetTxt: { ...T.type.micro, color: T.color.textMut },
});
