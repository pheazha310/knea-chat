import { Router } from 'express';
import type { AttendanceController } from '../controllers/attendance.controller';
import type { AuthMiddleware } from '../middleware/auth.middleware';

export const createOvertimeRouter = (
  attendanceController: AttendanceController,
  auth: AuthMiddleware,
): Router => {
  const router = Router();

  // Employees submit + view their own requests; managers see the company's
  // and approve / reject pending ones.
  router.post('/', auth.authenticate, attendanceController.overtimeRequest);
  router.get('/', auth.authenticate, attendanceController.overtimeList);
  router.put('/:id/approve', auth.authenticate, auth.authorizeAtLeast('manager'), attendanceController.overtimeApprove);
  router.put('/:id/reject', auth.authenticate, auth.authorizeAtLeast('manager'), attendanceController.overtimeReject);

  return router;
};