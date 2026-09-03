import { Router } from 'express';
import type { AttendanceController } from '../controllers/attendance.controller';
import type { AuthMiddleware } from '../middleware/auth.middleware';
import { rateLimit } from '../middleware/rateLimit.middleware';

/** Tight per-user rate limit for the abuse-prone clock endpoints. */
const clockRateLimit = rateLimit({ windowMs: 60_000, max: 10 });

export const createAttendanceRouter = (
  attendanceController: AttendanceController,
  auth: AuthMiddleware,
): Router => {
  const router = Router();

  // Self-service (any authenticated employee)
  router.post('/clock-in', auth.authenticate, clockRateLimit, attendanceController.clockIn);
  router.post('/clock-out', auth.authenticate, clockRateLimit, attendanceController.clockOut);
  router.post('/break/start', auth.authenticate, clockRateLimit, attendanceController.breakStart);
  router.post('/break/end', auth.authenticate, clockRateLimit, attendanceController.breakEnd);
  router.get('/me/today', auth.authenticate, attendanceController.meToday);
  router.get('/me/month', auth.authenticate, attendanceController.meMonth);

  // Manager / admin / super admin reads
  router.get('/employees', auth.authenticate, auth.authorizeAtLeast('manager'), attendanceController.employees);
  router.get('/employee/:id', auth.authenticate, auth.authorizeAtLeast('manager'), attendanceController.employeeDetail);
  router.get('/report', auth.authenticate, auth.authorizeAtLeast('manager'), attendanceController.report);
  router.get('/dashboard', auth.authenticate, auth.authorizeAtLeast('manager'), attendanceController.dashboard);

  return router;
}