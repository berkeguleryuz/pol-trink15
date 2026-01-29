/**
 * MESSAGE FORMATTER
 * 
 * Telegram mesajlarını formatla (Markdown/HTML)
 */

import {
  NotificationType,
  MatchStartingData,
  GoalScoredData,
  TradeExecutedData,
  PositionClosedData,
  FavoriteDetectedData,
  StopLossData,
  DailyReportData
} from './types';

export class MessageFormatter {
  /**
   * Escape Markdown special characters
   * Handles undefined/null values gracefully
   */
  private escapeMarkdown(text: string | undefined | null): string {
    if (!text) return '';
    // Escape: _ * [ ] ( ) ~ ` > # + - = | { } . !
    return text.replace(/([_*\[\]()~`>#+=|{}.!-])/g, '\\$1');
  }

  /**
   * Maç başlıyor bildirimi
   */
  formatMatchStarting(data: MatchStartingData): string {
    return `
🏁 *MAÇ BAŞLIYOR!*

⚽ *${this.escapeMarkdown(data.homeTeam)}* vs *${this.escapeMarkdown(data.awayTeam)}*
🕐 ${data.kickoffTime}
⏰ ${data.minutesUntilKickoff} dakika sonra

🔗 [Polymarket'te Görüntüle](${data.marketLink})

_Canlı takip başlıyor... Gol fırsatları izlenecek._
`;
  }

  /**
   * Gol oldu bildirimi
   */
  formatGoalScored(data: GoalScoredData): string {
    const teamName = data.team === 'home' 
      ? data.title.split(' vs ')[0] 
      : data.title.split(' vs ')[1];
    
    // Handle missing scorer gracefully
    const scorerInfo = data.scorer && data.scorer !== 'Unknown' 
      ? ` - ${this.escapeMarkdown(data.scorer)}`
      : '';
    
    return `
⚽⚽⚽ *GOL!*

*${this.escapeMarkdown(teamName)}*${scorerInfo}
⏱ ${data.minute}. dakika

📊 *Skor:* ${data.previousScore.home}-${data.previousScore.away} → *${data.newScore.home}-${data.newScore.away}*

🔗 [Market Linki](${data.marketLink})

_Pozisyonlar açılıyor..._
`;
  }

  /**
   * Trade executed
   */
  formatTradeExecuted(data: TradeExecutedData): string {
    const positionList = data.positions
      .map((p, i) => {
        // Escape Markdown characters in position type
        const escapedType = p.type.replace(/_/g, '\\_');
        return `${i + 1}. ${escapedType}: $${p.amount.toFixed(2)} @ ${(p.price * 100).toFixed(1)}%`;
      })
      .join('\n');

    return `
💰 *TRADE AÇILDI!*

⚽ ${this.escapeMarkdown(data.title)}

*Pozisyonlar:*
${positionList}

💵 *Toplam Yatırım:* $${data.totalInvestment.toFixed(2)}

🔗 [Polymarket](${data.marketLink})

_Kademeli satış hedefleri aktif (50%, 100%, 200%)_
`;
  }

  /**
   * Pozisyon kapatıldı
   */
  formatPositionClosed(data: PositionClosedData): string {
    const emoji = data.pnl >= 0 ? '📈' : '📉';
    const pnlText = data.pnl >= 0 ? `+$${data.pnl.toFixed(2)}` : `-$${Math.abs(data.pnl).toFixed(2)}`;
    const pnlPercent = data.pnlPercent >= 0 ? `+${data.pnlPercent.toFixed(1)}%` : `${data.pnlPercent.toFixed(1)}%`;

    return `
${emoji} *POZİSYON KAPANDI*

*${data.positionType}*
💵 Tutar: $${data.amount.toFixed(2)}

📊 Entry: ${(data.entryPrice * 100).toFixed(1)}%
📊 Exit: ${(data.exitPrice * 100).toFixed(1)}%

${emoji} *PnL:* ${pnlText} (${pnlPercent})

📝 ${data.reason}

🔗 [Market](${data.marketLink})
`;
  }

  /**
   * Favori tespit edildi (pre-match)
   */
  formatFavoriteDetected(data: FavoriteDetectedData): string {
    const favoriteTeam = data.favorite === 'home' ? data.homeTeam : data.awayTeam;

    return `
⭐ *FAVORİ TESPİT EDİLDİ!*

⚽ *${this.escapeMarkdown(data.homeTeam)}* vs *${this.escapeMarkdown(data.awayTeam)}*
🕐 ${data.kickoffTime}

🎯 *Favori:* ${this.escapeMarkdown(favoriteTeam)}
📊 *Kazanma İhtimali:* ${data.winProbability.toFixed(1)}%
💰 *Mevcut Fiyat:* ${(data.currentPrice * 100).toFixed(1)}%

💡 *Öneri:* ${data.recommendedAction}

🔗 [Polymarket](${data.marketLink})

_Bu fırsatı değerlendirmek ister misin?_
`;
  }

  /**
   * Stop-loss tetiklendi
   */
  formatStopLoss(data: StopLossData): string {
    return `
🛑 *STOP-LOSS!*

⚽ ${data.slug}

💔 *${data.positionsCount} pozisyon kapatıldı*
📉 *Toplam Zarar:* -$${Math.abs(data.totalLoss).toFixed(2)}

📝 ${data.reason}

🔗 [Market](${data.marketLink})

_Zarar kesme işlemi tamamlandı. Yeni fırsatlar bekleniyor..._
`;
  }

  /**
   * Günlük rapor
   */
  formatDailyReport(data: DailyReportData): string {
    const pnlEmoji = data.totalPnL >= 0 ? '📈' : '📉';
    const pnlText = data.totalPnL >= 0 ? `+$${data.totalPnL.toFixed(2)}` : `-$${Math.abs(data.totalPnL).toFixed(2)}`;

    let report = `
📊 *GÜNLÜK RAPOR* - ${data.date}

━━━━━━━━━━━━━━━━━━━━━━━━

📈 *İSTATİSTİKLER*
• Toplam Trade: ${data.totalTrades}
• Açık Pozisyon: ${data.openPositions}
• Kapalı Pozisyon: ${data.closedPositions}
• Kazanma Oranı: ${(data.winRate * 100).toFixed(1)}%

${pnlEmoji} *TOPLAM PnL:* ${pnlText}

━━━━━━━━━━━━━━━━━━━━━━━━
`;

    if (data.bestTrade) {
      report += `
🏆 *EN İYİ TRADE*
${data.bestTrade.match}
💰 +$${data.bestTrade.pnl.toFixed(2)}
`;
    }

    if (data.worstTrade) {
      report += `
💔 *EN KÖTÜ TRADE*
${data.worstTrade.match}
📉 -$${Math.abs(data.worstTrade.pnl).toFixed(2)}
`;
    }

    report += `
━━━━━━━━━━━━━━━━━━━━━━━━

_Yarın yeni fırsatlar için hazır olun! 🚀_
`;

    return report;
  }

  /**
   * Hata mesajı
   */
  formatError(error: string, context?: string): string {
    return `
❌ *HATA*

${context ? `📍 ${context}\n` : ''}
⚠️ ${error}

_Bot çalışmaya devam ediyor..._
`;
  }

  /**
   * Stats komutu
   */
  formatStats(stats: {
    totalMatches: number;
    todayMatches: number;
    liveMatches: number;
    trackedMatches: number;
    openPositions: number;
    dailyPnL: number;
    totalPnL: number;
  }): string {
    const dailyPnLEmoji = stats.dailyPnL >= 0 ? '📈' : '📉';
    const dailyPnLText = stats.dailyPnL >= 0 
      ? `+$${stats.dailyPnL.toFixed(2)}` 
      : `-$${Math.abs(stats.dailyPnL).toFixed(2)}`;

    return `
📊 *BOT İSTATİSTİKLERİ*

━━━━━━━━━━━━━━━━━━━━━━━━

📋 *MAÇLAR*
• Toplam: ${stats.totalMatches}
• Bugün: ${stats.todayMatches}
• 🔴 Canlı: ${stats.liveMatches}
• 👁️ Takip Edilen: ${stats.trackedMatches}

💰 *POZİSYONLAR*
• Açık: ${stats.openPositions}
• ${dailyPnLEmoji} Günlük PnL: ${dailyPnLText}
• 💎 Toplam PnL: $${stats.totalPnL.toFixed(2)}

━━━━━━━━━━━━━━━━━━━━━━━━

_Bot aktif ve maçları takip ediyor! ⚽_
`;
  }

  /**
   * Approval request (inline keyboard için)
   */
  formatApprovalRequest(data: FavoriteDetectedData): string {
    return `
⭐ *ONAY GEREKİYOR*

${this.formatFavoriteDetected(data)}

_5 dakika içinde yanıt bekleniyor..._
`;
  }
}
