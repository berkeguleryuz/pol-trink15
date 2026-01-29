/**
 * TELEGRAM NOTIFIER
 * 
 * Telegram Bot API entegrasyonu
 * 7 bildirim tipi + onay sistemi
 */

import TelegramBot from 'node-telegram-bot-api';
import { MessageFormatter } from './message-formatter';
import {
  NotificationType,
  TelegramNotification,
  MatchStartingData,
  GoalScoredData,
  TradeExecutedData,
  PositionClosedData,
  FavoriteDetectedData,
  StopLossData,
  DailyReportData,
  ApprovalRequest
} from './types';

export class TelegramNotifier {
  private bot: TelegramBot;
  private chatId: string;
  private formatter: MessageFormatter;
  private approvalRequests: Map<string, ApprovalRequest> = new Map();
  private approvalCallbacks: Map<string, (approved: boolean) => void> = new Map();

  constructor(botToken: string, chatId: string) {
    this.bot = new TelegramBot(botToken, { polling: true });
    this.chatId = chatId;
    this.formatter = new MessageFormatter();

    this.setupCommands();
    this.setupCallbackHandlers();
  }

  /**
   * Komutları setup et
   */
  private setupCommands(): void {
    // /start
    this.bot.onText(/\/start/, (msg) => {
      this.bot.sendMessage(msg.chat.id, `
🤖 *Polymarket Football Trading Bot*

Hoş geldin! Bot aktif ve maçları takip ediyor.

*Komutlar:*
/stats - Bot istatistikleri
/positions - Açık pozisyonlar
/pnl - Günlük/haftalık kar
/next - En yakın maç

Bildirimler otomatik gelecek! ⚽
`, { parse_mode: 'Markdown' });
    });

    // /stats
    this.bot.onText(/\/stats/, async (msg) => {
      // Bot'tan stats çek (event emit edilecek)
      this.emit('stats-requested', msg.chat.id);
    });

    // /positions
    this.bot.onText(/\/positions/, async (msg) => {
      this.emit('positions-requested', msg.chat.id);
    });

    // /pnl
    this.bot.onText(/\/pnl/, async (msg) => {
      this.emit('pnl-requested', msg.chat.id);
    });

    // /next
    this.bot.onText(/\/next/, async (msg) => {
      this.emit('next-match-requested', msg.chat.id);
    });
  }

  /**
   * Callback button handlers
   */
  private setupCallbackHandlers(): void {
    this.bot.on('callback_query', async (query) => {
      const data = query.data;
      if (!data) return;

      const [action, requestId] = data.split(':');
      const request = this.approvalRequests.get(requestId);

      if (!request) {
        await this.bot.answerCallbackQuery(query.id, {
          text: '⚠️ İstek süresi doldu veya bulunamadı',
          show_alert: true
        });
        return;
      }

      if (action === 'approve') {
        request.status = 'approved';
        await this.bot.answerCallbackQuery(query.id, {
          text: '✅ Onaylandı! Trade açılıyor...'
        });
        
        // Edit message
        await this.bot.editMessageText(
          query.message!.text + '\n\n✅ *ONAYLANDI* - Trade açılıyor...',
          {
            chat_id: query.message!.chat.id,
            message_id: query.message!.message_id,
            parse_mode: 'Markdown'
          }
        );

        // Callback'i çağır
        const callback = this.approvalCallbacks.get(requestId);
        if (callback) {
          callback(true);
          this.approvalCallbacks.delete(requestId);
        }
      } else if (action === 'reject') {
        request.status = 'rejected';
        await this.bot.answerCallbackQuery(query.id, {
          text: '❌ Reddedildi'
        });

        await this.bot.editMessageText(
          query.message!.text + '\n\n❌ *REDDEDİLDİ*',
          {
            chat_id: query.message!.chat.id,
            message_id: query.message!.message_id,
            parse_mode: 'Markdown'
          }
        );

        const callback = this.approvalCallbacks.get(requestId);
        if (callback) {
          callback(false);
          this.approvalCallbacks.delete(requestId);
        }
      }

      this.approvalRequests.delete(requestId);
    });
  }

  /**
   * Bildirim gönder
   */
  async sendNotification(notification: TelegramNotification): Promise<void> {
    let message = '';

    switch (notification.type) {
      case NotificationType.MATCH_STARTING:
        message = this.formatter.formatMatchStarting(notification.data);
        break;

      case NotificationType.GOAL_SCORED:
        message = this.formatter.formatGoalScored(notification.data);
        break;

      case NotificationType.TRADE_EXECUTED:
        message = this.formatter.formatTradeExecuted(notification.data);
        break;

      case NotificationType.POSITION_CLOSED:
        message = this.formatter.formatPositionClosed(notification.data);
        break;

      case NotificationType.FAVORITE_DETECTED:
        if (notification.requiresApproval) {
          // Approval requests are handled separately via sendApprovalRequest
          return;
        }
        message = this.formatter.formatFavoriteDetected(notification.data);
        break;

      case NotificationType.STOP_LOSS:
        message = this.formatter.formatStopLoss(notification.data);
        break;

      case NotificationType.DAILY_REPORT:
        message = this.formatter.formatDailyReport(notification.data);
        break;

      case NotificationType.ERROR:
        message = this.formatter.formatError(notification.data.error, notification.data.context);
        break;

      default:
        console.warn(`⚠️ Bilinmeyen bildirim tipi: ${notification.type}`);
        return;
    }

    try {
      await this.bot.sendMessage(this.chatId, message, {
        parse_mode: 'Markdown',
        disable_web_page_preview: false
      });
    } catch (error) {
      console.error('❌ Telegram gönderim hatası:', error);
    }
  }

  /**
   * Onay istegi gönder (inline keyboard)
   */
  async sendApprovalRequest(
    data: FavoriteDetectedData,
    callback: (approved: boolean) => void
  ): Promise<string> {
    const requestId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 dakika

    const request: ApprovalRequest = {
      id: requestId,
      type: NotificationType.FAVORITE_DETECTED,
      data,
      createdAt: new Date(),
      expiresAt,
      status: 'pending'
    };

    this.approvalRequests.set(requestId, request);
    this.approvalCallbacks.set(requestId, callback);

    const message = this.formatter.formatApprovalRequest(data);

    try {
      await this.bot.sendMessage(this.chatId, message, {
        parse_mode: 'Markdown',
        disable_web_page_preview: false,
        reply_markup: {
          inline_keyboard: [
            [
              { text: '👍 EVET', callback_data: `approve:${requestId}` },
              { text: '👎 HAYIR', callback_data: `reject:${requestId}` }
            ]
          ]
        }
      });

      // Timeout - 5 dakika sonra otomatik reddet
      setTimeout(() => {
        const req = this.approvalRequests.get(requestId);
        if (req && req.status === 'pending') {
          req.status = 'expired';
          const cb = this.approvalCallbacks.get(requestId);
          if (cb) {
            cb(false);
            this.approvalCallbacks.delete(requestId);
          }
          this.approvalRequests.delete(requestId);
        }
      }, 5 * 60 * 1000);

      return requestId;
    } catch (error) {
      console.error('❌ Approval request gönderimi hatası:', error);
      throw error;
    }
  }

  /**
   * Stats gönder
   */
  async sendStats(stats: any): Promise<void> {
    const message = this.formatter.formatStats(stats);
    await this.bot.sendMessage(this.chatId, message, {
      parse_mode: 'Markdown'
    });
  }

  /**
   * Event emitter (bot'a bağlanmak için)
   */
  private emit(event: string, ...args: any[]): void {
    // Bu production-bot'a bağlanacak
    console.log(`📡 Telegram event: ${event}`, args);
  }

  /**
   * Bot'u durdur
   */
  stop(): void {
    this.bot.stopPolling();
    console.log('✅ Telegram bot durduruldu');
  }
}
