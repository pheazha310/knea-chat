/**
 * IntegrationConfigController — HTTP handlers for per-company integration management.
 *
 *   GET    /api/integrations              — list integrations for the user's company
 *   GET    /api/integrations/available   — list all available channels
 *   POST   /api/integrations/:channel    — enable a channel (admin+)
 *   PATCH  /api/integrations/:channel    — update channel config (admin+)
 *   DELETE /api/integrations/:channel    — disable/delete a channel (admin+)
 *   GET    /api/integrations/:channel/health — health check (admin+)
 */
import type { Request, Response } from 'express';
import type { IntegrationConfigService } from '../services/IntegrationConfig.service';
import { toClientError } from '../utils/errors.utils';

export class IntegrationConfigController {
  constructor(private integrationConfigService: IntegrationConfigService) {}

  list = async (req: Request, res: Response): Promise<void> => {
    try {
      const companyId = req.user!.companyId;
      const integrations = await this.integrationConfigService.listForCompany(companyId);
      res.status(200).json({ success: true, data: integrations });
    } catch (error) {
      const { statusCode, message } = toClientError(error, 'integrations');
      res.status(statusCode).json({ success: false, message, errors: {} });
    }
  };

  listAvailable = async (req: Request, res: Response): Promise<void> => {
    try {
      const channels = await this.integrationConfigService.listAvailable(req.user!.companyId);
      res.status(200).json({ success: true, data: channels });
    } catch (error) {
      const { statusCode, message } = toClientError(error, 'integrations');
      res.status(statusCode).json({ success: false, message, errors: {} });
    }
  };

  get = async (req: Request, res: Response): Promise<void> => {
    try {
      const companyId = req.user!.companyId;
      const channel = String(req.params.channel || '').toLowerCase();
      const integration = await this.integrationConfigService.getForCompany(companyId, channel);
      if (!integration) {
        res.status(404).json({ success: false, message: 'Integration not found', errors: {} });
        return;
      }
      res.status(200).json({ success: true, data: integration });
    } catch (error) {
      const { statusCode, message } = toClientError(error, 'integrations');
      res.status(statusCode).json({ success: false, message, errors: {} });
    }
  };

  enable = async (req: Request, res: Response): Promise<void> => {
    try {
      const companyId = req.user!.companyId;
      const channel = String(req.params.channel || '').toLowerCase();
      const integration = await this.integrationConfigService.enable(companyId, channel);
      res.status(201).json({ success: true, message: 'Integration enabled', data: integration });
    } catch (error) {
      const { statusCode, message } = toClientError(error, 'integrations');
      res.status(statusCode).json({ success: false, message, errors: {} });
    }
  };

  updateConfig = async (req: Request, res: Response): Promise<void> => {
    try {
      const companyId = req.user!.companyId;
      const channel = String(req.params.channel || '').toLowerCase();
      const config = typeof req.body?.config === 'object' && req.body.config !== null ? req.body.config : {};
      const integration = await this.integrationConfigService.updateConfig(companyId, channel, config);
      res.status(200).json({ success: true, message: 'Integration updated', data: integration });
    } catch (error) {
      const { statusCode, message } = toClientError(error, 'integrations');
      res.status(statusCode).json({ success: false, message, errors: {} });
    }
  };

  disable = async (req: Request, res: Response): Promise<void> => {
    try {
      const companyId = req.user!.companyId;
      const channel = String(req.params.channel || '').toLowerCase();
      await this.integrationConfigService.disable(companyId, channel);
      res.status(200).json({ success: true, message: 'Integration disabled' });
    } catch (error) {
      const { statusCode, message } = toClientError(error, 'integrations');
      res.status(statusCode).json({ success: false, message, errors: {} });
    }
  };

  delete_ = async (req: Request, res: Response): Promise<void> => {
    try {
      const companyId = req.user!.companyId;
      const channel = String(req.params.channel || '').toLowerCase();
      await this.integrationConfigService.delete(companyId, channel);
      res.status(200).json({ success: true, message: 'Integration deleted' });
    } catch (error) {
      const { statusCode, message } = toClientError(error, 'integrations');
      res.status(statusCode).json({ success: false, message, errors: {} });
    }
  };

  health = async (req: Request, res: Response): Promise<void> => {
    try {
      const companyId = req.user!.companyId;
      const channel = String(req.params.channel || '').toLowerCase();
      const health = await this.integrationConfigService.checkHealth(companyId, channel);
      res.status(200).json({
        success: health?.connected ?? false,
        channel,
        connected: health?.connected ?? false,
        ...(health?.info ? { info: health.info } : {}),
      });
    } catch (error) {
      const { statusCode, message } = toClientError(error, 'integrations');
      res.status(statusCode).json({ success: false, message, errors: {} });
    }
  };
}

export default IntegrationConfigController;
