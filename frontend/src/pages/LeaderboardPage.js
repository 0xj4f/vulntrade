import React, { useState, useEffect } from 'react';
import api from '../services/apiService';
import { toast } from 'react-toastify';

import PageLayout from '../components/PageLayout';
import Card from '../components/Card';
import StatCard from '../components/StatCard';
import Modal from '../components/Modal';
import SparkLine from '../components/SparkLine';
import { useDebug } from '../context/DebugContext';
import { colors, gridCols, debugBanner } from '../styles/shared';
import { fmtPct, fmtNum, fmtPrice, fmtPnL, pnlColor } from '../utils/format';

function LeaderboardPage() {
  const isDebug = useDebug();
  const [leaderboard, setLeaderboard] = useState([]);
  const [loading, setLoading] = useState(true);
  const [myRank, setMyRank] = useState(0);
  const [flag, setFlag] = useState(null);
  const [flagHint, setFlagHint] = useState(null);

  // Detail modal state
  const [selectedTrader, setSelectedTrader] = useState(null);
  const [traderDetail, setTraderDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    api.get('/api/leaderboard')
      .then(res => {
        const data = res.data;
        setLeaderboard(data.leaderboard || []);
        setMyRank(data.myRank || 0);
        setFlag(data.flag || null);
        setFlagHint(data.flagHint || null);
      })
      .catch(err => {
        toast.error('Failed to load leaderboard');
        console.error(err);
      })
      .finally(() => setLoading(false));
  }, []);

  const openDetail = (trader) => {
    setSelectedTrader(trader);
    setTraderDetail(null);
    setDetailLoading(true);
    api.get(`/api/leaderboard/${trader.userId}/detail`)
      .then(res => setTraderDetail(res.data))
      .catch(err => toast.error('Failed to load trader detail'))
      .finally(() => setDetailLoading(false));
  };

  const closeDetail = () => {
    setSelectedTrader(null);
    setTraderDetail(null);
  };

  // Summary stats
  const bestRoi = leaderboard.length > 0 ? leaderboard[0] : null;
  const mostTrades = leaderboard.length > 0
    ? leaderboard.reduce((a, b) => a.tradeCount > b.tradeCount ? a : b) : null;
  const bestWinRate = leaderboard.length > 0
    ? leaderboard.reduce((a, b) => a.winRate > b.winRate ? a : b) : null;

  const rankColor = (rank) => {
    if (rank === 1) return colors.amber;
    if (rank === 2) return '#A0AEC0';
    if (rank === 3) return '#CD7F32';
    return colors.textMuted;
  };

  const rankLabel = (rank) => {
    if (rank === 1) return '\u{1F947}';
    if (rank === 2) return '\u{1F948}';
    if (rank === 3) return '\u{1F949}';
    return `#${rank}`;
  };

  return (
    <PageLayout title="Leaderboard" titleColor={colors.amber} maxWidth="1000px">

      {/* #1 Flag Banner */}
      {flag && (
        <div style={{
          padding: '16px 24px', borderRadius: '12px', marginBottom: '20px',
          background: 'linear-gradient(135deg, rgba(255,170,0,0.15), rgba(255,215,0,0.08))',
          border: '1px solid rgba(255,170,0,0.3)',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: '28px', marginBottom: '8px' }}>{'\u{1F3C6}'}</div>
          <div style={{ color: colors.amber, fontSize: '16px', fontWeight: '700', marginBottom: '6px' }}>
            You're #1! Flag Unlocked
          </div>
          <code style={{
            color: colors.green, fontSize: '16px', fontWeight: '700',
            fontFamily: "'SF Mono', monospace",
            backgroundColor: 'rgba(0,214,143,0.1)', padding: '6px 16px',
            borderRadius: '8px', border: '1px solid rgba(0,214,143,0.2)',
          }}>
            {flag}
          </code>
        </div>
      )}

      {/* Your Rank indicator */}
      {myRank > 0 && !flag && (
        <div style={{
          padding: '10px 20px', borderRadius: '10px', marginBottom: '16px',
          backgroundColor: colors.bgCard, border: `1px solid ${colors.borderDefault}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span style={{ color: colors.textSecondary, fontSize: '14px' }}>
            Your Rank: <strong style={{ color: colors.textPrimary }}>#{myRank}</strong>
          </span>
          {isDebug && flagHint && (
            <span style={{ color: colors.amber, fontSize: '12px' }}>{flagHint}</span>
          )}
        </div>
      )}

      {/* Summary Stats */}
      {!loading && leaderboard.length > 0 && (
        <div style={gridCols('1fr 1fr 1fr')}>
          <StatCard label="Best ROI" value={bestRoi ? fmtPct(bestRoi.roi) : '--'}
            valueColor={bestRoi ? pnlColor(bestRoi.roi) : colors.textMuted} valueSize="22px">
            {bestRoi && <div style={{ color: colors.textMuted, fontSize: '11px', marginTop: '4px' }}>@{bestRoi.username}</div>}
          </StatCard>
          <StatCard label="Most Active" value={mostTrades ? `${fmtNum(mostTrades.tradeCount)} trades` : '--'}
            valueColor={colors.blue} valueSize="22px">
            {mostTrades && <div style={{ color: colors.textMuted, fontSize: '11px', marginTop: '4px' }}>@{mostTrades.username}</div>}
          </StatCard>
          <StatCard label="Best Win Rate" value={bestWinRate ? `${bestWinRate.winRate}%` : '--'}
            valueColor={colors.purple} valueSize="22px">
            {bestWinRate && <div style={{ color: colors.textMuted, fontSize: '11px', marginTop: '4px' }}>@{bestWinRate.username}</div>}
          </StatCard>
        </div>
      )}

      {/* Leaderboard Table */}
      <Card title={<span>Top Traders <span style={{ color: colors.textMuted, fontWeight: '400', fontSize: '14px' }}>({leaderboard.length})</span></span>}>
        {/* Column headers */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: '16px',
          padding: '8px 20px', marginBottom: '4px',
        }}>
          <div style={colHeader('44px', 'center')}>Rank</div>
          <div style={{ ...colHeader('0', 'left'), flex: 1 }}>Trader</div>
          <div style={colHeader('110px', 'right')}>ROI</div>
          <div style={colHeader('80px', 'right')}>Trades</div>
          <div style={colHeader('80px', 'right')}>Win Rate</div>
          <div style={colHeader('90px', 'center')}>Top Symbol</div>
        </div>

        {loading && <div style={{ textAlign: 'center', padding: '40px', color: colors.textMuted }}>Loading leaderboard...</div>}
        {!loading && leaderboard.length === 0 && <div style={{ textAlign: 'center', padding: '40px', color: colors.textMuted }}>No traders found</div>}

        {leaderboard.map(trader => (
          <TraderRow key={trader.userId} trader={trader} rankColor={rankColor} rankLabel={rankLabel}
            isDebug={isDebug} onClick={() => openDetail(trader)} />
        ))}
      </Card>

      {/* Debug vuln hint */}
      {isDebug && (
        <Card variant="danger" title="Leaderboard Vulnerabilities" titleColor={colors.red}>
          <div style={{ color: colors.textMuted, fontSize: '13px', lineHeight: '1.6' }}>
            <div>VULN: <code style={{ color: colors.amber }}>/api/leaderboard</code> response includes <code style={{ color: colors.amber }}>notes</code> field — check DevTools Network tab for leaked FLAGs.</div>
            <div style={{ marginTop: '4px' }}>VULN: IDOR via <code style={{ color: colors.amber }}>/api/leaderboard?userId=1</code> — look up any user's stats.</div>
            <div style={{ marginTop: '4px' }}>VULN: Reach #1 to unlock flag. Hint: <code style={{ color: colors.amber }}>/app/admin.setPrice</code> WebSocket is unprotected — manipulate VULN price.</div>
          </div>
        </Card>
      )}

      {/* Trader Detail Modal */}
      <Modal open={!!selectedTrader} onClose={closeDetail} width="680px">
        {selectedTrader && (
          <div>
            {/* Modal Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '24px' }}>
              <div style={{
                width: '48px', height: '48px', borderRadius: '50%',
                background: selectedTrader.rank <= 3
                  ? `linear-gradient(135deg, ${rankColor(selectedTrader.rank)}, ${rankColor(selectedTrader.rank)}88)`
                  : 'linear-gradient(135deg, #4F8BFF, #8B5CF6)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '18px', fontWeight: '700', color: '#fff',
                border: `2px solid ${rankColor(selectedTrader.rank)}`,
              }}>
                {selectedTrader.username?.charAt(0)?.toUpperCase() || '?'}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ color: colors.textPrimary, fontSize: '18px', fontWeight: '700' }}>
                  {selectedTrader.firstName && selectedTrader.lastName
                    ? `${selectedTrader.firstName} ${selectedTrader.lastName}`
                    : selectedTrader.username}
                </div>
                <div style={{ color: colors.textMuted, fontSize: '13px' }}>
                  @{selectedTrader.username} &middot; Rank #{selectedTrader.rank}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ color: pnlColor(selectedTrader.roi), fontSize: '22px', fontWeight: '700' }}>
                  {fmtPct(selectedTrader.roi)}
                </div>
                <div style={{ color: colors.textMuted, fontSize: '11px' }}>ROI</div>
              </div>
            </div>

            {/* Stats row */}
            <div style={{ display: 'flex', gap: '12px', marginBottom: '20px' }}>
              {[
                { label: 'Trades', value: selectedTrader.tradeCount, color: colors.blue },
                { label: 'Win Rate', value: `${selectedTrader.winRate}%`, color: selectedTrader.winRate >= 50 ? colors.green : colors.red },
                { label: 'Top Symbol', value: selectedTrader.topSymbol, color: colors.amber },
              ].map(s => (
                <div key={s.label} style={{
                  flex: 1, padding: '10px 14px', borderRadius: '8px',
                  backgroundColor: colors.bgStat, border: `1px solid ${colors.borderDefault}`,
                }}>
                  <div style={{ fontSize: '10px', color: colors.textMuted, textTransform: 'uppercase', fontWeight: '600', letterSpacing: '0.06em', marginBottom: '4px' }}>{s.label}</div>
                  <div style={{ color: s.color, fontWeight: '700', fontSize: '15px' }}>{s.value}</div>
                </div>
              ))}
            </div>

            {/* Per-symbol breakdown */}
            <div style={{ fontSize: '12px', color: colors.textMuted, fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '10px' }}>
              Performance by Symbol
            </div>

            {detailLoading && <div style={{ textAlign: 'center', padding: '20px', color: colors.textMuted }}>Loading...</div>}

            {traderDetail && traderDetail.symbols && traderDetail.symbols.map(sym => (
              <div key={sym.symbol} style={{
                display: 'flex', alignItems: 'center', gap: '14px',
                padding: '12px 14px', borderRadius: '8px',
                backgroundColor: colors.bgCard, border: `1px solid ${colors.borderDefault}`,
                marginBottom: '6px',
              }}>
                {/* Symbol name */}
                <div style={{ width: '80px' }}>
                  <span style={{
                    display: 'inline-block', padding: '3px 10px', borderRadius: '6px',
                    fontSize: '12px', fontWeight: '700',
                    backgroundColor: colors.bgInput, border: `1px solid ${colors.borderDefault}`,
                    color: colors.textPrimary,
                  }}>{sym.symbol}</span>
                </div>

                {/* Trades */}
                <div style={{ width: '50px', textAlign: 'center' }}>
                  <div style={{ fontSize: '10px', color: colors.textMuted }}>Trades</div>
                  <div style={{ fontSize: '13px', fontWeight: '600', color: colors.textSecondary }}>{sym.tradeCount}</div>
                </div>

                {/* Net Position */}
                <div style={{ width: '70px', textAlign: 'right' }}>
                  <div style={{ fontSize: '10px', color: colors.textMuted }}>Net Qty</div>
                  <div style={{ fontSize: '13px', fontWeight: '600', color: colors.textSecondary }}>{fmtNum(sym.netPosition)}</div>
                </div>

                {/* Realized P&L */}
                <div style={{ width: '90px', textAlign: 'right' }}>
                  <div style={{ fontSize: '10px', color: colors.textMuted }}>Realized</div>
                  <div style={{ fontSize: '13px', fontWeight: '600', color: pnlColor(sym.realizedPnl) }}>
                    {fmtPnL(sym.realizedPnl)}
                  </div>
                </div>

                {/* Unrealized P&L */}
                <div style={{ width: '90px', textAlign: 'right' }}>
                  <div style={{ fontSize: '10px', color: colors.textMuted }}>Unrealized</div>
                  <div style={{ fontSize: '13px', fontWeight: '600', color: pnlColor(sym.unrealizedPnl || 0) }}>
                    {sym.unrealizedPnl != null ? fmtPnL(sym.unrealizedPnl) : '--'}
                  </div>
                </div>

                {/* Sparkline */}
                <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-end' }}>
                  {sym.pnlProgression && sym.pnlProgression.length >= 2 ? (
                    <SparkLine data={sym.pnlProgression} width={100} height={28} />
                  ) : (
                    <div style={{ width: '100px', height: '28px' }} />
                  )}
                </div>
              </div>
            ))}

            {/* Debug: notes */}
            {isDebug && traderDetail?.notes && (
              <div style={{ ...debugBanner, marginTop: '16px' }}>
                {traderDetail.notes}
              </div>
            )}
          </div>
        )}
      </Modal>
    </PageLayout>
  );
}

/* ── Column header helper ─── */
const colHeader = (width, align) => ({
  width,
  textAlign: align,
  fontSize: '10px',
  color: colors.textMuted,
  fontWeight: '600',
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
});

/* ── Individual trader row ─────────────────────────── */
function TraderRow({ trader, rankColor, rankLabel, isDebug, onClick }) {
  const [hovered, setHovered] = useState(false);
  const rank = trader.rank;

  return (
    <div>
      <div
        onClick={onClick}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: 'flex', alignItems: 'center', gap: '16px',
          padding: '14px 20px',
          borderRadius: '10px',
          backgroundColor: hovered ? colors.bgCardHover : 'transparent',
          border: `1px solid ${hovered ? colors.borderMedium : 'transparent'}`,
          borderLeft: rank <= 3 ? `3px solid ${rankColor(rank)}` : '3px solid transparent',
          marginBottom: '4px',
          transition: 'all 0.15s ease',
          cursor: 'pointer',
        }}
      >
        {/* Rank */}
        <div style={{
          width: '44px', textAlign: 'center',
          fontSize: rank <= 3 ? '20px' : '14px',
          fontWeight: '700', color: rankColor(rank),
        }}>
          {rankLabel(rank)}
        </div>

        {/* Avatar + Name */}
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <div style={{
              width: '36px', height: '36px', borderRadius: '50%',
              background: rank === 1 ? 'linear-gradient(135deg, #FFD700, #FFA500)'
                : rank === 2 ? 'linear-gradient(135deg, #A0AEC0, #718096)'
                : rank === 3 ? 'linear-gradient(135deg, #CD7F32, #A0522D)'
                : 'linear-gradient(135deg, #4F8BFF, #8B5CF6)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '14px', fontWeight: '700', color: '#fff',
              border: `2px solid ${rank <= 3 ? rankColor(rank) : 'transparent'}`,
              boxShadow: rank === 1 ? '0 0 12px rgba(255,215,0,0.3)' : 'none',
            }}>
              {trader.username?.charAt(0)?.toUpperCase() || '?'}
            </div>
            {trader.profilePic && (
              <img src={trader.profilePic} alt=""
                onError={(e) => { e.target.style.display = 'none'; }}
                style={{
                  position: 'absolute', inset: 0,
                  width: '36px', height: '36px', borderRadius: '50%',
                  objectFit: 'cover', display: 'block',
                  border: `2px solid ${rank <= 3 ? rankColor(rank) : 'transparent'}`,
                }}
              />
            )}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{
              color: colors.textPrimary, fontSize: '14px', fontWeight: '600',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {trader.firstName && trader.lastName
                ? `${trader.firstName} ${trader.lastName}`
                : trader.username}
            </div>
            <div style={{ color: colors.textMuted, fontSize: '12px' }}>@{trader.username}</div>
          </div>
        </div>

        {/* ROI % */}
        <div style={{
          width: '110px', textAlign: 'right',
          fontSize: '18px', fontWeight: '700',
          color: pnlColor(trader.roi), letterSpacing: '-0.02em',
        }}>
          {fmtPct(trader.roi)}
        </div>

        {/* Trade Count */}
        <div style={{ width: '80px', textAlign: 'right', fontSize: '14px', fontWeight: '500', color: colors.textSecondary }}>
          {fmtNum(trader.tradeCount)}
        </div>

        {/* Win Rate */}
        <div style={{
          width: '80px', textAlign: 'right', fontSize: '14px', fontWeight: '500',
          color: trader.winRate >= 60 ? colors.green : trader.winRate >= 40 ? colors.textSecondary : colors.red,
        }}>
          {trader.winRate}%
        </div>

        {/* Top Symbol */}
        <div style={{ width: '90px', textAlign: 'center' }}>
          <span style={{
            display: 'inline-block', padding: '3px 10px', borderRadius: '20px',
            fontSize: '11px', fontWeight: '600',
            backgroundColor: colors.bgInput, border: `1px solid ${colors.borderDefault}`,
            color: colors.textSecondary,
          }}>
            {trader.topSymbol}
          </span>
        </div>
      </div>

      {isDebug && trader.notes && (
        <div style={{ ...debugBanner, marginLeft: '64px', marginBottom: '8px', marginTop: '-2px' }}>
          {trader.notes}
        </div>
      )}
    </div>
  );
}

export default LeaderboardPage;
