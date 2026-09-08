/**
 * TelegramService — Telegram Bot API client.
 *
 * Responsibilities are strictly limited to Bot API communication:
 *   getMe / sendMessage / setWebhook / deleteWebhook / getWebhookInfo.
 *
 * It contains NO database logic and NO Express request/response logic — the
 * application layer (TelegramInboxService) orchestrates contacts, conversations
 * and messages on top of this client.
 *
 * Security notes:
 *   - The bot token is read from TELEGRAM_BOT_TOKEN only (never hard-coded).
 *   - The token is never logged; error messages carry Telegram's own
 *     `description`/`error_code` (which never echo the token).
 *   - Missing configuration is reported lazily at call time so the server can
 *     still boot without Telegram configured.
 */
import axios from 'axios';
import type {
  TelegramApiResponse,
  TelegramBot,
  TelegramFile,
  TelegramMessage,
  TelegramWebhookInfo,
} from './telegram.types';

/** Normalized Telegram API failure — safe to surface to callers/logs. */
export class TelegramApiError extends Error {
  errorCode?: number;

  constructor(message: string, errorCode?: number) {
    super(message);
    this.name = 'TelegramApiError';
    this.errorCode = errorCode;
  }
}

/** Minimal HTTP client shape so tests can inject a stub. */
export interface HttpLike {
  get<T>(url: string): Promise<{ data: T }>;
  post<T>(url: string, body?: unknown): Promise<{ data: T }>;
  /** Fetch raw binary content (used to download Telegram media). */
  getBuffer(url: string): Promise<Buffer>;
}

const DEFAULT_API_URL = 'https://api.telegram.org/bot';

/** Adapt the axios default into the injectable HttpLike (binary downloads). */
const createDefaultHttp = (client: typeof axios): HttpLike => ({
  get: async <T>(url: string) => client.get<T>(url),
  post: async <T>(url: string, body?: unknown) => client.post<T>(url, body),
  getBuffer: async (url: string) => {
    const response = await client.get<ArrayBuffer>(url, { responseType: 'arraybuffer' });
    return Buffer.from(response.data);
  },
});

export class TelegramService {
  private readonly botToken: string;
  private readonly apiUrl: string;
  private readonly http: HttpLike;

  constructor(
    botToken: string = process.env.TELEGRAM_BOT_TOKEN || '',
    apiUrl: string = process.env.TELEGRAM_API_URL || DEFAULT_API_URL,
    http: HttpLike = createDefaultHttp(axios),
  ) {
    this.botToken = botToken;
    this.apiUrl = apiUrl.replace(/\/+$/, '');
    this.http = http;
  }

  /** True when a bot token has been configured. */
  isConfigured(): boolean {
    return this.botToken.length > 0;
  }

  /** Throw a safe, token-free error when the bot is not configured. */
  private requireToken(): void {
    if (!this.botToken) {
      throw new TelegramApiError(
        'Telegram bot is not configured (TELEGRAM_BOT_TOKEN is missing)',
      );
    }
  }

  /**
   * Build /bot<token>/<method> without ever logging the URL. The configured
   * base is expected to end in '/bot' (TELEGRAM_API_URL default); a base
   * without it gets '/bot' appended so both forms produce the documented URL.
   */
  private getApiUrl(method: string): string {
    const base = this.apiUrl.endsWith('/bot') ? this.apiUrl : `${this.apiUrl}/bot`;
    return `${base}${this.botToken}/${method}`;
  }

  /**
   * Normalize an API failure into a TelegramApiError. The token never appears
   * here: Telegram's `description` is used verbatim and network errors are
   * reported generically (the underlying message is only logged by callers).
   */
  private normalizeError(error: unknown): TelegramApiError {
    if (error instanceof TelegramApiError) return error;

    const axiosError = error as {
      response?: { data?: { ok?: boolean; description?: string; error_code?: number } };
      message?: string;
    };
    const telegramBody = axiosError.response?.data;
    if (telegramBody && telegramBody.description) {
      return new TelegramApiError(
        `Telegram API error: ${telegramBody.description}`,
        telegramBody.error_code,
      );
    }
    return new TelegramApiError('Telegram API is unreachable. Please try again later.');
  }

  /** GET /bot<TOKEN>/getMe — verifies the bot token. */
  async getMe(): Promise<TelegramApiResponse<TelegramBot>> {
    this.requireToken();
    try {
      const response = await this.http.get<TelegramApiResponse<TelegramBot>>(
        this.getApiUrl('getMe'),
      );
      return response.data;
    } catch (error) {
      throw this.normalizeError(error);
    }
  }

  /**
   * POST /bot<TOKEN>/sendMessage — send a text message to a chat.
   * @param chatId Telegram chat id (never trusted from the client; resolved
   *               server-side from the stored external contact).
   * @param text Message text.
   * @param options Optional sendMessage parameters (reply_to_message_id …).
   */
  async sendMessage(
    chatId: number,
    text: string,
    options: { reply_to_message_id?: number } = {},
  ): Promise<TelegramApiResponse<TelegramMessage>> {
    this.requireToken();
    if (!text) {
      throw new TelegramApiError('Message text is required');
    }
    try {
      const response = await this.http.post<TelegramApiResponse<TelegramMessage>>(
        this.getApiUrl('sendMessage'),
        {
          chat_id: chatId,
          text,
          ...(options.reply_to_message_id
            ? { reply_to_message_id: options.reply_to_message_id }
            : {}),
        },
      );
      return response.data;
    } catch (error) {
      throw this.normalizeError(error);
    }
  }

  /** POST /bot<TOKEN>/setWebhook — register the webhook URL + secret token. */
  async setWebhook(
    webhookUrl: string,
    secretToken: string = process.env.TELEGRAM_WEBHOOK_SECRET || '',
  ): Promise<TelegramApiResponse<boolean>> {
    this.requireToken();
    if (!webhookUrl) {
      throw new TelegramApiError('A webhook URL is required');
    }
    try {
      const response = await this.http.post<TelegramApiResponse<boolean>>(
        this.getApiUrl('setWebhook'),
        {
          url: webhookUrl,
          allowed_updates: ['message'],
          ...(secretToken ? { secret_token: secretToken } : {}),
        },
      );
      return response.data;
    } catch (error) {
      throw this.normalizeError(error);
    }
  }

  /** POST /bot<TOKEN>/deleteWebhook — remove the registered webhook. */
  async deleteWebhook(): Promise<TelegramApiResponse<boolean>> {
    this.requireToken();
    try {
      const response = await this.http.post<TelegramApiResponse<boolean>>(
        this.getApiUrl('deleteWebhook'),
      );
      return response.data;
    } catch (error) {
      throw this.normalizeError(error);
    }
  }

  /** GET /bot<TOKEN>/getWebhookInfo — current webhook configuration. */
  async getWebhookInfo(): Promise<TelegramApiResponse<TelegramWebhookInfo>> {
    this.requireToken();
    try {
      const response = await this.http.get<TelegramApiResponse<TelegramWebhookInfo>>(
        this.getApiUrl('getWebhookInfo'),
      );
      return response.data;
    } catch (error) {
      throw this.normalizeError(error);
    }
  }

  /** GET /bot<TOKEN>/getFile — resolve a file_id to a downloadable file_path. */
  async getFile(fileId: string): Promise<TelegramApiResponse<TelegramFile>> {
    this.requireToken();
    if (!fileId) {
      throw new TelegramApiError('A Telegram file_id is required');
    }
    try {
      const response = await this.http.get<TelegramApiResponse<TelegramFile>>(
        `${this.getApiUrl('getFile')}?file_id=${encodeURIComponent(fileId)}`,
      );
      return response.data;
    } catch (error) {
      throw this.normalizeError(error);
    }
  }

  /**
   * Download a media file from Telegram's file server (raw bytes).
   * @param filePath The `file_path` returned by getFile.
   */
  async downloadFile(filePath: string): Promise<Buffer> {
    this.requireToken();
    if (!filePath) {
      throw new TelegramApiError('A Telegram file_path is required');
    }
    try {
      // https://api.telegram.org/file/bot<TOKEN>/<file_path>
      const fileBase = this.apiUrl.replace(/\/bot$/, '/file');
      return await this.http.getBuffer(`${fileBase}/bot${this.botToken}/${filePath}`);
    } catch (error) {
      throw this.normalizeError(error);
    }
  }
}

export default new TelegramService();