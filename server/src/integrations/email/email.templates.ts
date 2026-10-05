/**
 * EmailTemplateEngine — lightweight variable-substitution templates for
 * common outbound emails (welcome, password reset, notification, etc.).
 *
 * Templates are plain functions so they stay type-safe and testable without
 * a template-loader dependency.  Placeholders use `{{key}}` syntax and are
 * replaced from a context record; missing keys become empty strings.
 */

export interface TemplateContext {
  [key: string]: string | number | boolean | null | undefined;
}

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

const PLACEHOLDER = /\{\{\s*([^}]+?)\s*\}\}/g;

function substitute(template: string, context: TemplateContext): string {
  return template.replace(PLACEHOLDER, (_, key) => {
    const value = context[key.trim()];
    return value == null ? '' : String(value);
  });
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Render a plain-text template into both text and HTML.  The HTML variant
 * escapes the raw text and wraps each line in `<p>` so the result is safe
 * to send without further sanitization.
 */
export function renderTextTemplate(subjectTemplate: string, bodyTemplate: string, context: TemplateContext): RenderedEmail {
  const subject = substitute(subjectTemplate, context);
  const text = substitute(bodyTemplate, context);
  const html = text
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join('\n');
  return { subject, text, html };
}

/**
 * Render an HTML template (already contains markup) plus a plain-text
 * fallback.  The subject is still substituted.
 */
export function renderHtmlTemplate(
  subjectTemplate: string,
  htmlTemplate: string,
  textFallback: string,
  context: TemplateContext,
): RenderedEmail {
  const subject = substitute(subjectTemplate, context);
  const html = substitute(htmlTemplate, context);
  const text = substitute(textFallback, context);
  return { subject, text, html };
}

/** Built-in templates. */
export const EmailTemplates = {
  welcome: {
    subject: 'Welcome to {{companyName}}, {{firstName}}!',
    text: `Hi {{firstName}},\n\nWelcome to {{companyName}}! We're excited to have you on board.\n\nIf you have any questions, just reply to this email.\n\nBest,\nThe {{companyName}} Team`,
    html: `<p>Hi {{firstName}},</p><p>Welcome to <strong>{{companyName}}</strong>! We're excited to have you on board.</p><p>If you have any questions, just reply to this email.</p><p>Best,<br>The {{companyName}} Team</p>`,
  },
  passwordReset: {
    subject: 'Reset your {{companyName}} password',
    text: `Hi {{firstName}},\n\nClick the link below to reset your password:\n{{resetLink}}\n\nThis link expires in {{expiryMinutes}} minutes.\n\nIf you didn't request this, please ignore this email.\n\nBest,\nThe {{companyName}} Team`,
    html: `<p>Hi {{firstName}},</p><p>Click the link below to reset your password:</p><p><a href="{{resetLink}}">Reset Password</a></p><p>This link expires in {{expiryMinutes}} minutes.</p><p>If you didn't request this, please ignore this email.</p><p>Best,<br>The {{companyName}} Team</p>`,
  },
  ticketConfirmation: {
    subject: 'Ticket #{{ticketId}} received',
    text: `Hi {{firstName}},\n\nWe've received your request (Ticket #{{ticketId}}). Our team will get back to you within {{responseTime}}.\n\nBest,\nThe {{companyName}} Team`,
    html: `<p>Hi {{firstName}},</p><p>We've received your request (Ticket #<strong>{{ticketId}}</strong>). Our team will get back to you within {{responseTime}}.</p><p>Best,<br>The {{companyName}} Team</p>`,
  },
} as const;

export type TemplateName = keyof typeof EmailTemplates;

export function renderTemplate(name: TemplateName, context: TemplateContext): RenderedEmail {
  const tpl = EmailTemplates[name];
  if (!tpl) {
    throw new Error(`Unknown email template: ${name}`);
  }
  return renderHtmlTemplate(tpl.subject, tpl.html, tpl.text, context);
}
