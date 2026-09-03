/**
 * LeaveService — leave request lifecycle (create / list / approve / reject).
 *
 * Approved leave overrides normal attendance: the calendar and dashboard read
 * approved leave directly, and clock-in is blocked for those dates.
 */
import type { LeaveRequestRepository } from '../repositories/leaveRequestRepository';
import type { UserRepository } from '../repositories/userRepository';
import { badRequest } from '../utils/errors.utils';
import type {
  CreateLeaveRequestData,
  LeaveRequestRow,
  RequestStatus,
} from '../types';

const LEAVE_TYPES = ['annual', 'sick', 'personal', 'unpaid'];

export class LeaveService {
  constructor(
    private leaveRequestRepository: LeaveRequestRepository,
    private userRepository: UserRepository,
  ) {}

  async create(data: CreateLeaveRequestData): Promise<LeaveRequestRow> {
    const user = await this.userRepository.findById(data.employee_id);
    if (!user)    throw badRequest('Employee not found');

    if (!LEAVE_TYPES.includes(data.leave_type)) {
      throw badRequest('Invalid leave type — use annual, sick, personal or unpaid');
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data.start_date) || !/^\d{4}-\d{2}-\d{2}$/.test(data.end_date)) {
      throw badRequest('Dates must use YYYY-MM-DD format');
    }
    if (data.start_date > data.end_date) {
      throw badRequest('start_date must be on or before end_date');
    }

    // Reject overlapping pending/approved requests to keep the calendar sane.
    const overlap = await this.leaveRequestRepository.findOverlap(
      data.employee_id,
      data.start_date,
      data.end_date,
    );
    if (overlap.length > 0) {
      throw badRequest('You already have a leave request overlapping these dates');
    }

    const id = await this.leaveRequestRepository.create(data);
    const created = await this.leaveRequestRepository.findById(id);
    if (!created)    throw badRequest('Could not create leave request');
    return created;
  }

  async listForEmployee(employeeId: number): Promise<LeaveRequestRow[]> {
    return this.leaveRequestRepository.findByEmployee(employeeId);
  }

  async listAll(
    companyId: number,
    status?: RequestStatus | '',
  ): Promise<LeaveRequestRow[]> {
    return this.leaveRequestRepository.findByCompany(companyId, status || '');
  }

  async setStatus(
    id: number,
    status: 'approved' | 'rejected',
    approverId: number,
  ): Promise<LeaveRequestRow> {
    const request = await this.leaveRequestRepository.findById(id);
    if (!request)    throw badRequest('Leave request not found');
    if (request.status !== 'pending') {
      throw badRequest('Only pending requests can be approved or rejected');
    }

    await this.leaveRequestRepository.setStatus(id, status, approverId);
    const updated = await this.leaveRequestRepository.findById(id);
    if (!updated)    throw badRequest('Could not update leave request');
    return updated;
  }
}