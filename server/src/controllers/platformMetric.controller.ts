/**
 * PlatformMetricController — MVC controller layer.
 *
 * GET /api/admin/metrics — live platform statistics for the Super Admin
 * monitoring dashboard (Super Admin only, enforced on the routes).
 */
import type { NextFunction, Request, Response } from 'express';
import type { PlatformMetricService } from '../services/PlatformMetric.service';

export class PlatformMetricController {
  constructor(private platformMetricService: PlatformMetricService) {}

  metrics = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const metrics = await this.platformMetricService.getMetrics();
      res.status(200).json({
        success: true,
        message: 'Platform metrics retrieved successfully',
        data: { metrics },
      });
    } catch (error) {
      next(error);
    }
  };
}
