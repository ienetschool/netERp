import { z } from 'zod';
import { dateOnlySchema, uuidSchema } from './common.js';

export const employeeCreateSchema = z.object({
  employeeNo: z.string().min(1).max(30),
  firstName: z.string().min(1).max(80),
  middleName: z.string().max(80).optional(),
  lastName: z.string().min(1).max(80),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER']).optional(),
  dateOfBirth: dateOnlySchema.optional(),
  nationality: z.string().max(60).optional(),
  nationalId: z.string().max(60).optional(),
  email: z.string().email().optional(),
  phone: z.string().max(30).optional(),
  address: z.string().max(400).optional(),
  hireDate: dateOnlySchema,
  employmentType: z.enum(['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN']).optional(),
  jobTitle: z.string().max(100).optional(),
  managerEmployeeId: uuidSchema.optional(),
  departmentId: uuidSchema.optional(),
  branchId: uuidSchema.optional(),
  companyId: uuidSchema,
});

export const employeeUpdateSchema = employeeCreateSchema.partial().omit({ companyId: true });

export const attendanceUpsertSchema = z.object({
  employeeId: uuidSchema,
  attendanceDate: dateOnlySchema,
  status: z.enum(['PRESENT', 'ABSENT', 'LATE', 'HALF_DAY', 'LEAVE', 'HOLIDAY', 'OFF_DAY']),
  clockIn: z.string().datetime({ offset: true }).optional(),
  clockOut: z.string().datetime({ offset: true }).optional(),
  workedMinutes: z.number().int().min(0).max(1440).optional(),
  overtimeMinutes: z.number().int().min(0).max(1440).optional(),
  notes: z.string().max(500).optional(),
  companyId: uuidSchema,
  branchId: uuidSchema.optional(),
});

export const leaveRequestCreateSchema = z.object({
  employeeId: uuidSchema,
  leaveTypeId: uuidSchema,
  companyId: uuidSchema,
  branchId: uuidSchema.optional(),
  startDate: dateOnlySchema,
  endDate: dateOnlySchema,
  requestedDays: z.number().min(0.5).max(366),
  reason: z.string().max(500).optional(),
});

export const holidayCreateSchema = z.object({
  name: z.string().min(1).max(120),
  holidayDate: dateOnlySchema,
  isRecurring: z.boolean().default(false),
  companyId: uuidSchema,
  branchId: uuidSchema.nullish(),
});

export type EmployeeCreateInput = z.infer<typeof employeeCreateSchema>;
export type EmployeeUpdateInput = z.infer<typeof employeeUpdateSchema>;
export type AttendanceUpsertInput = z.infer<typeof attendanceUpsertSchema>;
export type LeaveRequestCreateInput = z.infer<typeof leaveRequestCreateSchema>;
export type HolidayCreateInput = z.infer<typeof holidayCreateSchema>;
