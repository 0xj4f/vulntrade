import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'react-toastify';
import { ArrowDown, ArrowUp, Crown, RefreshCw, Search, Trophy } from 'lucide-react';
import api from '../services/apiService';
import { useDebug } from '../context/DebugContext';
import PageLayout from '../components/PageLayout';
import Card from '../components/Card';
import Modal from '../components/Modal';
import Button from '../components/Button';
import DataTable from '../components/DataTable';
import SparkLine from '../components/SparkLine';
import { Avatar, Chip, EmptyState } from '../components/ui';
import { colors, debugBanner, inputStyle, num, type } from '../styles/shared';
import { fmtPct, fmtPnL, fmtQty, fmtUSD, fmtPrice, pnlColor } from '../utils/format';

const RANK_COLORS = { 1: colors.gold, 2: colors.silver, 3: colors.bronze };

const displayName = (t) => (t.firstName && t.lastName ? `${t.firstName} ${t.lastName}` : t.username);

function RankChip({ rank, size = 28 }) {
  const c = RANK_COLORS[rank];
  return (
    <span aria-label={`Rank ${rank}`} style={{
      ...num, width: size, height: size, borderRadius: '50%', flexShrink: 0,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size > 30 ? '14px' : '12px', fontWeight: 700,
      background: c ? `color-mix(in srgb, ${c} 18%, transparent)` : colors.bgRaised,
      color: c || colors.textSecondary, border: `1px solid ${c ? `color-mix(in srgb, ${c} 45%, transparent)` : colors.borderDefault}`,
    }}>
      {rank === 1 ? <Crown size={size * 0.5} aria-hidden="true" /> : rank}
    </span>
  );
}

function WinRateBar({ value }) {
  const v = Math.max(0, Math.min(100, Number(value) || 0));
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', justifyContent: 'flex-end' }}>
      <span aria-hidden="true" style={{ width: '48px', height: '4px', borderRadius: '999px', background: colors.bgRaised, overflow: 'hidden' }}>
        <span style={{ display: 'block', width: `${v}%`, height: '100%', background: v >= 60 ? 'var(--vt-up)' : v >= 40 ? 'var(--vt-warn)' : 'var(--vt-down)' }} />
      </span>
      <span style={num}>{v.toFixed(1)}%</span>
    </span>
  );
}

/** Top-three podium card (clickable, opens the trader detail). */
function PodiumCard({ trader, onOpen, tall }) {
  const c = RANK_COLORS[trader.rank];
  return (
    <button type="button" onClick={() => onOpen(trader)} className="vt-btn vt-row"
      style={{
        textAlign: 'left', width: '100%', padding: tall ? '22px 18px' : '18px', borderRadius: 'var(--vt-radius-lg)',
        background: `linear-gradient(180deg, color-mix(in srgb, ${c} 10%, var(--vt-surface)), var(--vt-surface) 70%)`,
        border: `1px solid color-mix(in srgb, ${c} 35%, var(--vt-border))`, color: colors.textPrimary,
        boxShadow: trader.rank === 1 ? `0 10px 40px color-mix(in srgb, ${c} 18%, transparent)` : 'var(--vt-shadow-1)',
        alignSelf: 'end',
      }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
        <RankChip rank={trader.rank} size={tall ? 34 : 28} />
        <SparkLine data={trader.pnlSeries} width={96} height={28} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
        <Avatar name={trader.username} src={trader.profilePic} size={tall ? 44 : 38} ring={c} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: '14px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayName(trader)}</div>
          <div style={{ color: colors.textMuted, fontSize: '12px' }}>@{trader.username}</div>
        </div>
      </div>
      <div style={{ ...num, fontSize: tall ? '30px' : '24px', fontWeight: 700, letterSpacing: '-0.03em', color: pnlColor(trader.roi) }}>{fmtPct(trader.roi)}</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '6px', fontSize: '12px', color: colors.textMuted }}>
        <span>Equity <span style={{ ...num, color: colors.textSecondary }}>{fmtUSD(trader.portfolioValue)}</span></span>
        <span>{trader.tradeCount} trades</span>
      </div>
    </button>
  );
}

const SORTS = {
  rank: (a, b) => a.rank - b.rank,
  roi: (a, b) => b.roi - a.roi,
  pnl: (a, b) => Number(b.pnl || 0) - Number(a.pnl || 0),
  equity: (a, b) => Number(b.portfolioValue) - Number(a.portfolioValue),
  trades: (a, b) => b.tradeCount - a.tradeCount,
  win: (a, b) => b.winRate - a.winRate,
};

/**
 * Leaderboard — traders ranked by return on what they put in (deposits − withdrawals ±
 * adjustments).
 *
 * VULN (kept, DATA-08): the response includes each trader's `notes` (flags) — visible in
 * DevTools; shown in debug mode.
 * VULN (kept, AUTHZ-05): /api/leaderboard/{id}/detail is an IDOR.
 * VULN (kept, FLAG 11): rank #1 returns a flag.
 */
function LeaderboardPage() {
  const isDebug = useDebug();
  const [data, setData] = useState({ leaderboard: [], myRank: 0 });
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState({ key: 'rank', desc: false });
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = () => {
    setLoading(true);
    api.get('/api/leaderboard')
      .then(res => setData(res.data || { leaderboard: [] }))
      .catch(err => { toast.error('Failed to load leaderboard'); console.error(err); })
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const openDetail = (trader) => {
    setSelected(trader);
    setDetail(null);
    setDetailLoading(true);
    api.get(`/api/leaderboard/${trader.userId}/detail`)
      .then(res => setDetail(res.data))
      .catch(() => toast.error('Failed to load trader detail'))
      .finally(() => setDetailLoading(false));
  };

  const board = data.leaderboard || [];
  const me = data.me;
  const leader = board[0];
  const podium = board.slice(0, 3);
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q ? board.filter(t => `${t.username} ${t.firstName || ''} ${t.lastName || ''}`.toLowerCase().includes(q)) : board;
    const sorted = filtered.slice().sort(SORTS[sort.key] || SORTS.rank);
    return sort.desc ? sorted.reverse() : sorted;
  }, [board, query, sort]);

  const sortHeader = (key, label) => {
    const active = sort.key === key;
    const Icon = active && sort.desc ? ArrowUp : ArrowDown;
    return (
      <button type="button" onClick={() => setSort(s => ({ key, desc: s.key === key ? !s.desc : false }))}
        aria-label={`Sort by ${label}`} style={{ all: 'unset', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '4px', color: active ? colors.textPrimary : 'inherit' }}>
        {label}{active && <Icon size={11} aria-hidden="true" />}
      </button>
    );
  };

  const gapToLeader = me && leader && me.rank > 1 ? Number(leader.roi) - Number(me.roi) : null;

  return (
    <PageLayout
      title="Leaderboard"
      subtitle="Traders ranked by return on net deposits · live prices"
      maxWidth="1160px"
      actions={<Button variant="gray" icon={<RefreshCw size={14} aria-hidden="true" />} onClick={load}>Refresh</Button>}
    >
      {/* #1 flag banner */}
      {data.flag && (
        <section className="vt-pop" style={{
          padding: '18px 20px', borderRadius: 'var(--vt-radius-lg)', marginBottom: '16px', textAlign: 'center',
          background: `linear-gradient(135deg, color-mix(in srgb, ${colors.gold} 16%, var(--vt-surface)), var(--vt-surface))`,
          border: `1px solid color-mix(in srgb, ${colors.gold} 40%, var(--vt-border))`,
        }}>
          <Trophy size={26} aria-hidden="true" style={{ color: colors.gold, marginBottom: '6px' }} />
          <div style={{ ...type.section, color: colors.gold, marginBottom: '8px' }}>You're #1 — flag unlocked</div>
          <code style={{ ...num, color: colors.green, fontSize: '15px', fontWeight: 700, background: colors.greenDark, padding: '6px 14px', borderRadius: '8px' }}>{data.flag}</code>
        </section>
      )}

      {/* Your standing */}
      {me && (
        <section style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '16px 32px', padding: '16px 20px', marginBottom: '16px', borderRadius: 'var(--vt-radius-lg)', background: colors.bgCard, border: `1px solid ${colors.borderAccent}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <RankChip rank={me.rank} size={40} />
            <div>
              <div style={{ ...type.caps }}>Your rank</div>
              <div style={{ ...num, fontSize: '22px', fontWeight: 700 }}>#{me.rank} <span style={{ fontSize: '13px', color: colors.textMuted, fontWeight: 500 }}>of {data.totalTraders}</span></div>
            </div>
          </div>
          {[
            ['Return', fmtPct(me.roi), pnlColor(me.roi)],
            ['P&L', fmtPnL(me.pnl), pnlColor(me.pnl)],
            ['Equity', fmtUSD(me.portfolioValue)],
            ['Win rate', `${Number(me.winRate).toFixed(1)}%`],
          ].map(([k, v, c]) => (
            <div key={k}>
              <div style={{ ...type.caps, fontSize: '10px' }}>{k}</div>
              <div style={{ ...num, fontSize: '16px', fontWeight: 600, color: c || colors.textPrimary }}>{v}</div>
            </div>
          ))}
          {gapToLeader != null && (
            <div style={{ marginLeft: 'auto', minWidth: '200px', flex: '0 1 260px' }}>
              <div style={{ fontSize: '12px', color: colors.textMuted, marginBottom: '6px' }}>
                <span style={num}>{gapToLeader.toFixed(2)} pts</span> behind #1
              </div>
              <div aria-hidden="true" style={{ height: '6px', borderRadius: '999px', background: colors.bgRaised, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${Math.max(4, Math.min(100, (Number(me.roi) / Math.max(Number(leader.roi), 0.01)) * 100))}%`, background: 'linear-gradient(90deg, var(--vt-accent), var(--vt-up))' }} />
              </div>
              {isDebug && data.flagHint && <div style={{ color: colors.amber, fontSize: '12px', marginTop: '6px' }}>{data.flagHint}</div>}
            </div>
          )}
        </section>
      )}

      {/* Podium */}
      {loading ? (
        <div className="vt-cols-3" style={{ marginBottom: '16px' }}>{[0, 1, 2].map(i => <div key={i} className="skeleton" style={{ height: '200px' }} />)}</div>
      ) : podium.length > 0 && (
        <section aria-label="Top three" className="vt-cols-3" style={{ marginBottom: '16px', alignItems: 'end' }}>
          {[podium[1], podium[0], podium[2]].filter(Boolean).map(t => (
            <PodiumCard key={t.userId} trader={t} onOpen={openDetail} tall={t.rank === 1} />
          ))}
        </section>
      )}

      {/* Rankings */}
      <Card title="Rankings" flush subtitle={data.totalTraders > board.length ? `Top ${board.length} of ${data.totalTraders} traders` : `${board.length} traders`}
        headerRight={
          <label style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: '9px', top: '50%', transform: 'translateY(-50%)', color: colors.textMuted, display: 'inline-flex' }}><Search size={13} aria-hidden="true" /></span>
            <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Find a trader" aria-label="Find a trader"
              style={{ ...inputStyle, height: '30px', width: '180px', paddingLeft: '28px' }} />
          </label>
        }>
        <DataTable
          rowKey={t => t.userId}
          data={rows}
          onRowClick={openDetail}
          empty={loading ? 'Loading…' : <EmptyState title="No traders found">Try another name.</EmptyState>}
          rowStyle={t => (me && t.userId === me.userId ? { background: 'var(--vt-accent-soft)' } : undefined)}
          columns={[
            { key: 'rank', label: sortHeader('rank', 'Rank'), width: '64px', render: t => <RankChip rank={t.rank} /> },
            { key: 'trader', label: 'Trader', render: t => (
              <span style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                <Avatar name={t.username} src={t.profilePic} size={30} ring={RANK_COLORS[t.rank]} />
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', fontWeight: 600, whiteSpace: 'nowrap' }}>{displayName(t)}</span>
                  <span style={{ display: 'block', color: colors.textMuted, fontSize: '12px' }}>@{t.username}</span>
                </span>
              </span>
            ) },
            { key: 'roi', label: sortHeader('roi', 'Return'), align: 'right', render: t => <span style={{ fontSize: '14px', fontWeight: 700, color: pnlColor(t.roi) }}>{fmtPct(t.roi)}</span> },
            { key: 'pnl', label: sortHeader('pnl', 'P&L'), align: 'right', render: t => <span style={{ color: pnlColor(t.pnl) }}>{fmtPnL(t.pnl)}</span> },
            { key: 'equity', label: sortHeader('equity', 'Equity'), align: 'right', render: t => fmtUSD(t.portfolioValue) },
            { key: 'trades', label: sortHeader('trades', 'Trades'), align: 'right', render: t => t.tradeCount },
            { key: 'win', label: sortHeader('win', 'Win rate'), align: 'right', render: t => <WinRateBar value={t.winRate} /> },
            { key: 'top', label: 'Top', align: 'center', render: t => <Chip>{t.topSymbol}</Chip> },
            { key: 'trend', label: 'Realized', align: 'right', render: t => <span style={{ display: 'inline-flex', justifyContent: 'flex-end' }}><SparkLine data={t.pnlSeries} width={80} height={22} /></span> },
          ]}
        />
        {isDebug && rows.some(t => t.notes) && (
          <div style={{ padding: '12px 16px', borderTop: `1px solid ${colors.borderDefault}` }}>
            {rows.filter(t => t.notes).map(t => (
              <div key={t.userId} style={{ ...debugBanner, marginBottom: '8px' }}>#{t.rank} {t.username}: {t.notes}</div>
            ))}
          </div>
        )}
      </Card>

      {isDebug && (
        <Card variant="danger" title="Leaderboard vulnerabilities" titleColor={colors.red}>
          <div style={{ color: colors.textMuted, fontSize: '13px', lineHeight: 1.7 }}>
            <div>VULN: <code style={{ color: colors.amber }}>/api/leaderboard</code> response includes <code style={{ color: colors.amber }}>notes</code> — check DevTools for leaked FLAGs.</div>
            <div>VULN: IDOR via <code style={{ color: colors.amber }}>/api/leaderboard?userId=1</code> — look up any user's stats.</div>
            <div>VULN: Reach #1 to unlock a flag. Hint: <code style={{ color: colors.amber }}>/app/admin.setPrice</code> is unprotected — ROI is measured against net deposits, so size the position accordingly.</div>
          </div>
        </Card>
      )}

      {/* Trader detail */}
      <Modal open={!!selected} onClose={() => { setSelected(null); setDetail(null); }} width="760px">
        {selected && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '18px', paddingRight: '32px' }}>
              <Avatar name={selected.username} src={selected.profilePic} size={52} ring={RANK_COLORS[selected.rank]} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ ...type.title, fontSize: '18px' }}>{displayName(selected)}</div>
                <div style={{ color: colors.textMuted, fontSize: '13px' }}>@{selected.username} · rank #{selected.rank}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ ...num, fontSize: '24px', fontWeight: 700, color: pnlColor(selected.roi) }}>{fmtPct(selected.roi)}</div>
                <div style={{ ...type.caps, fontSize: '10px' }}>Return</div>
              </div>
            </div>
            <div className="vt-stats" style={{ marginBottom: '18px' }}>
              {[
                ['Equity', fmtUSD(selected.portfolioValue)],
                ['Capital in', fmtUSD(selected.capital)],
                ['Realized', fmtPnL(selected.realizedPnl), pnlColor(selected.realizedPnl)],
                ['Trades', selected.tradeCount],
                ['Win rate', `${Number(selected.winRate).toFixed(1)}%`],
              ].map(([k, v, c]) => (
                <div key={k} style={{ padding: '10px 12px', borderRadius: '8px', background: colors.bgStat, border: `1px solid ${colors.borderDefault}` }}>
                  <div style={{ ...type.caps, fontSize: '10px', marginBottom: '4px' }}>{k}</div>
                  <div style={{ ...num, fontWeight: 600, color: c || colors.textPrimary }}>{v}</div>
                </div>
              ))}
            </div>

            <div style={{ ...type.caps, marginBottom: '8px' }}>Performance by symbol</div>
            {detailLoading && <div className="skeleton" style={{ height: '120px' }} />}
            {detail && (
              <DataTable small rowKey={s => s.symbol} data={detail.symbols || []} emptyText="No trades yet"
                columns={[
                  { key: 'symbol', label: 'Symbol', render: s => <span style={{ fontWeight: 600 }}>{s.symbol}</span> },
                  { key: 'trades', label: 'Trades', align: 'right', render: s => s.tradeCount },
                  { key: 'net', label: 'Holding', align: 'right', render: s => fmtQty(s.netPosition) },
                  { key: 'avg', label: 'Avg cost', align: 'right', render: s => (Number(s.netPosition) > 0 ? fmtPrice(s.avgCost) : '—') },
                  { key: 'realized', label: 'Realized', align: 'right', render: s => <span style={{ color: pnlColor(s.realizedPnl) }}>{fmtPnL(s.realizedPnl)}</span> },
                  { key: 'unrealized', label: 'Unrealized', align: 'right', render: s => (s.unrealizedPnl != null ? <span style={{ color: pnlColor(s.unrealizedPnl) }}>{fmtPnL(s.unrealizedPnl)}</span> : '—') },
                  { key: 'wins', label: 'Wins', align: 'right', render: s => (s.sells ? `${s.wins}/${s.sells}` : '—') },
                  { key: 'spark', label: 'Realized trend', align: 'right', render: s => <span style={{ display: 'inline-flex' }}><SparkLine data={s.pnlProgression} width={90} height={22} /></span> },
                ]} />
            )}
            {/* Debug: notes */}
            {isDebug && detail?.notes && <div style={{ ...debugBanner, marginTop: '16px', marginBottom: 0 }}>{detail.notes}</div>}
          </div>
        )}
      </Modal>
    </PageLayout>
  );
}

export default LeaderboardPage;
