/**
 * Email channel startup diagnostics.
 *
 * The inbound email pipeline has three config links that live OUTSIDE the
 * code — DNS (MX records), the Resend webhook, and a reachable webhook host —
 * and each fails silently: mail bounces at the sender's server, the webhook
 * fires but the body fetch returns no content, or deliveries time out. This
 * module surfaces all three as loud startup warnings (never fatal, never
 * blocking) so a misconfigured channel is caught at boot instead of
 * discovered as "the user emailed admin@kneachat.com and nothing appeared".
 *
 * Runs only when the email channel looks configured — EMAIL_WEBHOOK_SECRET
 * is set (the inbound webhook secret) and an inbound domain is declared via
 * EMAIL_INBOUND_DOMAIN.
 *
 * Skipped entirely when EMAIL_STARTUP_CHECKS=false.
 */

const CHECK_TIMEOUT_MS = 10_000;

/** A single diagnostic finding, rendered as a warning block at startup. */
export interface StartupCheckFinding {
  /** Short machine-readable check id ('mx', 'webhook-url', 'webhook-host'). */
  check: string;
  /** True when the check found a problem worth warning about. */
  problem: boolean;
  /** One-line human description of the problem (empty when all good). */
  detail: string;
  /** Concrete remediation step shown under the warning. */
  hint: string;
}

/** Resolve the inbound mail domain (defaults to the one KneaChat ships with). */
export function getInboundDomain(): string {
  return (process.env.EMAIL_INBOUND_DOMAIN || 'kneachat.com').trim().toLowerCase();
}

/** True when the email inbound pipeline is configured enough to check. */
export function isEmailInboundConfigured(): boolean {
  return !!(process.env.EMAIL_WEBHOOK_SECRET || '').trim() && !!getInboundDomain();
}

/** True when the webhook URL is a quick-tunnel host whose hostname changes on every restart. */
export function isQuickTunnelUrl(webhookUrl: string): boolean {
  return /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i.test(webhookUrl);
}

/** Look up MX records for the domain; ENOTFOUND/NODATA → no MX. */
export async function resolveMxRecords(
  domain: string,
): Promise<Array<{ exchange: string; priority: number }> | null> {
  const dns = await import('dns');
  try {
    const records = await dns.promises.resolveMx(domain);
    return records.length > 0 ? records : null;
  } catch {
    // NXDOMAIN / SERVFAIL / no resolver — treat every failure as "no MX".
    return null;
  }
}

/** Fetch with a hard timeout that never throws. */
async function fetchWithTimeout(url: string): Promise<{ ok: boolean; status: number } | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(CHECK_TIMEOUT_MS) });
    return { ok: res.ok, status: res.status };
  } catch {
    return null;
  }
}

/**
 * Run all email inbound diagnostics. Resolves (never rejects) with findings
 * for: MX records, webhook URL presence/plausibility, and webhook host
 * reachability.
 */
export async function runEmailStartupChecks(): Promise<StartupCheckFinding[]> {
  const findings: StartupCheckFinding[] = [];

  // --- 1. MX records: the domain must route inbound mail somewhere. --------
  const domain = getInboundDomain();
  const mx = await resolveMxRecords(domain);
  if (!mx) {
    findings.push({
      check: 'mx',
      problem: true,
      detail: `no MX records — the internet cannot deliver mail to @${domain} (senders get a bounce; the webhook never fires)`,
      hint: `Add the domain in the Resend dashboard → Domains and create the MX record it shows at your registrar, then re-check with: dig MX ${domain}`,
    });
  } else {
    findings.push({
      check: 'mx',
      problem: false,
      detail: `MX → ${mx.map((r) => `${r.exchange} (${r.priority})`).join(', ')}`,
      hint: '',
    });
  }

  // --- 2. Webhook URL configured? ------------------------------------------
  const webhookUrl = (process.env.EMAIL_WEBHOOK_URL || '').trim();
  if (!webhookUrl) {
    findings.push({
      check: 'webhook-url',
      problem: true,
      detail: 'EMAIL_WEBHOOK_URL is not set — Resend has nothing to deliver email.received events to',
      hint: 'Run: npm run resend:setup -- <management-key> https://<public-host>/api/email/webhook',
    });
    return findings; // nothing further to probe
  }

  // Quick-tunnel hint (hostname changes on every restart).
  if (isQuickTunnelUrl(webhookUrl)) {
    findings.push({
      check: 'webhook-url',
      problem: true,
      detail: 'EMAIL_WEBHOOK_URL points at a trycloudflare.com quick tunnel — its hostname changes on every tunnel restart',
      hint: 'Re-run npm run resend:setup with the new URL after each tunnel restart, or use a stable hostname (named tunnel / deployed server).',
    });
  } else {
    findings.push({ check: 'webhook-url', problem: false, detail: '', hint: '' });
  }

  // --- 3. Webhook host reachable? ------------------------------------------
  const base = webhookUrl.replace(/\/api\/email\/webhook\/?$/i, '');
  const health = await fetchWithTimeout(`${base}/api/health`);
  if (!health) {
    findings.push({
      check: 'webhook-host',
      problem: true,
      detail: `webhook host unreachable — ${base}/api/health did not answer within ${CHECK_TIMEOUT_MS / 1000}s`,
      hint: 'Is the server running and the tunnel up? Resend retries with backoff and eventually stops delivering.',
    });
  } else if (!health.ok) {
    findings.push({
      check: 'webhook-host',
      problem: true,
      detail: `webhook host answered HTTP ${health.status} — check the server/tunnel before trusting deliveries`,
      hint: 'Fix the endpoint, then re-run npm run resend:setup.',
    });
  } else {
    findings.push({ check: 'webhost-ok', problem: false, detail: `${base}/api/health → 200`, hint: '' });
  }

  return findings;
}

/**
 * Fire-and-forget startup probe: logs a formatted report (⚠️ per problem,
 * ✅ per pass) when the email inbound pipeline is configured. Never throws,
 * never blocks startup, and is skipped when EMAIL_STARTUP_CHECKS=false.
 */
export function scheduleEmailStartupChecks(): void {
  if ((process.env.EMAIL_STARTUP_CHECKS || '').trim().toLowerCase() === 'false') {
    return;
  }
  if (!isEmailInboundConfigured()) {
    return;
  }

  // Deferred so server startup logging stays first and a hung DNS probe
  // cannot delay the listen callback.
  setTimeout(() => {
    void runEmailStartupChecks()
      .then((findings) => {
        const problems = findings.filter((f) => f.problem);
        const passes = findings.filter((f) => !f.problem);

        if (problems.length === 0) {
          for (const pass of passes) {
            if (pass.detail) console.log(`✅ [email] Inbound check ok: ${pass.detail}`);
          }
          return;
        }

        console.warn('⚠️  [email] Email omni-channel inbound routing problems detected:');
        for (const problem of problems) {
          console.warn(`   • ${problem.detail}`);
          if (problem.hint) console.warn(`     → ${problem.hint}`);
        }
        console.warn('   Inbound email will NOT reach the Omni Inbox until these are fixed.');
      })
      .catch(() => {
        // Diagnostics must never crash the server.
      });
  }, 1_500).unref();
}
