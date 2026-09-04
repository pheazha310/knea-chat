/**
 * SubscriptionController — MVC controller layer.
 *
 * Super Admin subscription / plan management: list every workspace with its
 * plan + seat usage, and change a workspace's plan. Access is Super Admin
 * only (enforced on the routes).
 */
import type { NextFunction, Request, Response } from 'express';
import type { AuditLogService } from '../services/AuditLog.service';
import type { SubscriptionService } from '../services/Subscription.service';

export class SubscriptionController {
  constructor(
    private subscriptionService: SubscriptionService,
    private auditLogService?: AuditLogService | null,
  ) {}

  private async record(
    req: Request,
    action: string,
    companyId: number,
    details?: Record<string, unknown>,
  ): Promise<void> {
    if (!this.auditLogService) return;
    await this.auditLogService.log({
      company_id: null, // platform-scope action
      actor_user_id: req.user!.id,
      actor_role: req.user!.role,
      action,
      entity_type: 'company',
      entity_id: companyId,
      details,
      ip_address: req.ip,
    });
  }

  /** GET /api/subscriptions — every workspace's plan + seat usage. */
  list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { search = '' } = req.query;
      const companies = await this.subscriptionService.listSubscriptions({
        search: String(search),
      });
      const plans = this.subscriptionService.getPlans();
      res.status(200).json({
        success: true,
        message: 'Subscriptions retrieved successfully',
        data: { subscriptions: companies, plans },
      });
    } catch (error) {
      next(error);
    }
  };

  /** PATCH /api/subscriptions/:id — change a workspace's plan. */
  update = async (req: Request, res: Response): Promise<void> => {
    try {
      const companyId = Number(req.params.id);
      const { plan_key, plan_status, plan_expires_at, billing_email } = req.body || {};

      const subscription = await this.subscriptionService.setCompanyPlan(companyId, {
        plan_key,
        plan_status,
        plan_expires_at,
        billing_email,
      });

      await this.record(
        req,
        'subscription.updated',
        companyId,
        {
          plan_key: subscription.plan_key,
          plan_status: subscription.plan_status,
          billing_email: subscription.billing_email ?? undefined,
        },
      );

      res.status(200).json({
        success: true,
        message: 'Subscription updated successfully',
        data: { subscription },
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: (error as Error).message,
        errors: {},
      });
    }
  };
}
