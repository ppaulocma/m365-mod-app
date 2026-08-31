#!/usr/bin/env python3
# ============================================================================
# analyze_log.py — analisador do CSV do log de DEBUG do PatineteApp (50 Hz).
# ----------------------------------------------------------------------------
# Lê o CSV em STREAMING (não carrega tudo na RAM) e imprime um RELATÓRIO
# compacto: estatísticas por coluna + eventos/anomalias que explicam socos,
# falta de potência e problemas de comutação. Feito p/ arquivos grandes.
#
#   python3 analyze_log.py caminho/do/log.csv
#   python3 analyze_log.py log.csv --around 12345   # janela ao redor de t_ms
#   python3 analyze_log.py log.csv --downsample 10 > pequeno.csv  # 1 a cada 10
#
# Robusto à ORDEM das colunas (casa pelo cabeçalho). Contadores cumulativos
# (seq_skips, rej_*, link_drops) viram DELTAS por segundo automaticamente.
# ============================================================================
import sys, csv, statistics, argparse

# colunas cumulativas (só crescem) -> analisar como incrementos, não valor
CUMULATIVE = {'seq_skips','seq_revs','seq_inval','rej_filt_a','rej_filt_b',
              'rej_filt_c','rej_conf_a','rej_conf_b','rej_conf_c','hall_bad',
              'link_drops'}
# limiares de anomalia
GAP_WARN_US   = 2000      # buraco no loop de 1 kHz que vira soco
DERATE_COLS   = ['scale_pct','tempscale_pct','tracvscale_pct','pscale_fold_pct',
                 'headroom_pct']
DERATE_WARN   = 99        # abaixo disso está cortando potência

def f(x):
    try: return float(x)
    except (ValueError, TypeError): return None

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('csv')
    ap.add_argument('--around', type=float, help='imprime janela ±1s ao redor deste t_ms')
    ap.add_argument('--downsample', type=int, help='emite CSV com 1 linha a cada N')
    a = ap.parse_args()

    with open(a.csv, newline='') as fh:
        rd = csv.reader(fh)
        head = next(rd)
        idx = {h: i for i, h in enumerate(head)}

        # modo downsample: só reemite o CSV reduzido e sai
        if a.downsample:
            w = csv.writer(sys.stdout); w.writerow(head)
            for n, row in enumerate(rd):
                if n % a.downsample == 0: w.writerow(row)
            return

        def col(row, name):
            i = idx.get(name); return row[i] if i is not None and i < len(row) else None

        # acumuladores
        stats = {h: [] for h in head}          # amostras numéricas (p/ min/max/mean)
        n = 0; t0 = t1 = None
        prev_cum = {c: None for c in CUMULATIVE}
        cum_events = {c: [] for c in CUMULATIVE}   # (t_ms, delta)
        gap_events = []                             # (t_ms, gap_us)
        derate_time = {c: 0 for c in DERATE_COLS}   # nº de linhas com corte
        derate_max  = {c: None for c in DERATE_COLS} # maior valor visto (prova 0-100 vivo)
        fault_rows = []                             # (t_ms, faults)
        window = [] if a.around is not None else None

        for row in rd:
            n += 1
            t = f(col(row, 't_ms'))
            if t is not None:
                if t0 is None: t0 = t
                t1 = t

            # janela ao redor de um instante
            if window is not None and t is not None and abs(t - a.around) <= 1000:
                window.append(row)

            # estatísticas numéricas (amostra 1 a cada 5 p/ economizar RAM em arquivos enormes)
            if n % 5 == 0:
                for h in head:
                    v = f(col(row, h))
                    if v is not None: stats[h].append(v)

            # gap do loop
            g = f(col(row, 'loop_gap_us'))
            if g is not None and g >= GAP_WARN_US:
                gap_events.append((t, g))

            # contadores cumulativos -> incrementos
            for c in CUMULATIVE:
                v = f(col(row, c))
                if v is None: continue
                if prev_cum[c] is not None and v > prev_cum[c]:
                    cum_events[c].append((t, v - prev_cum[c]))
                prev_cum[c] = v

            # derate/foldback ativo
            for c in DERATE_COLS:
                v = f(col(row, c))
                if v is None: continue
                if derate_max[c] is None or v > derate_max[c]: derate_max[c] = v
                if v < DERATE_WARN: derate_time[c] += 1

            # faltas
            fv = f(col(row, 'faults'))
            if fv is not None and fv != 0: fault_rows.append((t, int(fv)))

        dur = (t1 - t0) / 1000.0 if (t0 is not None and t1 is not None) else 0
        P = print
        P('='*70)
        P(f'ARQUIVO : {a.csv}')
        P(f'LINHAS  : {n}   DURACAO : {dur:.1f} s   ({n/dur:.0f} Hz)' if dur else f'LINHAS: {n}')
        P('='*70)

        # ---- janela ao redor de um instante (se pedida) --------------------
        if window is not None:
            P(f'\n--- JANELA ±1s ao redor de t_ms={a.around:.0f} ({len(window)} linhas) ---')
            cols = ['t_ms','kmh','ibat_A','vbat_V','duty_pct','target','vq_V',
                    'scale_pct','tracvscale_pct','tempscale_pct','loop_gap_us',
                    'seq_skips','hall_eps','faults','throttle_in','effvlim_V',
                    'iph_mag_A','iq_meas_A','iq_target_A','iph_valid_pct']
            cols = [c for c in cols if c in idx]
            P(','.join(cols))
            for row in window:
                P(','.join(str(col(row,c)) for c in cols))
            return

        # ---- estatísticas das colunas-chave --------------------------------
        key = ['kmh','ibat_A','iraw_A','vbat_V','power_W','temp_C','duty_pct',
                'target','vq_V','vd_V','effvlim_V','iph_mag_A','iq_meas_A',
                'iq_target_A','id_meas_A','iph_valid_pct','velest_rads',
                'scale_pct','tracvscale_pct','tempscale_pct','pscale_fold_pct',
                'loop_gap_us','loop_hz','hall_eps','throttle_in','thr_eff','zea_rad']
        P('\n--- ESTATISTICAS (colunas-chave) ---')
        P(f'{"coluna":<16}{"min":>10}{"media":>10}{"max":>10}{"desvio":>10}')
        for h in key:
            s = stats.get(h) or []
            if not s: continue
            sd = statistics.pstdev(s) if len(s) > 1 else 0
            P(f'{h:<16}{min(s):>10.2f}{statistics.mean(s):>10.2f}{max(s):>10.2f}{sd:>10.2f}')

        # ---- veredito de anomalias -----------------------------------------
        P('\n--- EVENTOS / ANOMALIAS ---')
        # gaps
        if gap_events:
            worst = sorted(gap_events, key=lambda x: -x[1])[:8]
            P(f'[GAP loop>{GAP_WARN_US}us] {len(gap_events)} ocorrencias — piores:')
            for t,g in worst: P(f'    t={t:.0f}ms  gap={g:.0f}us')
        else:
            P(f'[GAP loop] nenhum acima de {GAP_WARN_US}us — loop saudavel.')
        # comutacao
        for c in ['seq_skips','seq_revs','seq_inval']:
            ev = cum_events.get(c) or []
            tot = sum(d for _,d in ev)
            if tot:
                P(f'[{c}] +{tot} no total, em {len(ev)} momentos — piores:')
                for t,d in sorted(ev,key=lambda x:-x[1])[:5]: P(f'    t={t:.0f}ms  +{d:.0f}')
        skips = sum(d for _,d in (cum_events.get('seq_skips') or []))
        if not skips: P('[comutacao] seq_skips=0 — Halls/comutacao limpos no periodo.')
        # derate/foldback
        any_derate = False
        for c in DERATE_COLS:
            frac = derate_time[c] / n * 100 if n else 0
            # só reporta se a coluna é um % vivo (chegou perto de 100 alguma hora)
            if frac > 1 and (derate_max[c] or 0) >= DERATE_WARN:
                P(f'[{c}] cortando potencia em {frac:.0f}% do tempo (<{DERATE_WARN}%)')
                any_derate = True
        if not any_derate: P('[derate/foldback] potencia cheia — nada estrangulando.')
        # faltas
        if fault_rows:
            P(f'[FALTAS] {len(fault_rows)} linhas com falta ativa — 1a: t={fault_rows[0][0]:.0f} bits=0x{fault_rows[0][1]:02X}')
        else:
            P('[faltas] nenhuma no periodo.')
        # dica
        P('\nDica: rode com --around <t_ms> num instante suspeito p/ ver a janela crua.')

if __name__ == '__main__':
    main()
