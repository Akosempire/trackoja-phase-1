// Tailoring jobs. House conventions: static methods that THROW, snake_case rows
// mapped by a private mapper, supabase.rpc('name', { p_arg }) with p_-prefixed args.

import { supabase } from '../config/supabase';

export type JobStatus =
  | 'received'
  | 'in_progress'
  | 'ready_for_fitting'
  | 'alterations'
  | 'ready_for_pickup'
  | 'delivered'
  | 'cancelled';

/** Normal forward order, used to offer the next step. The database holds the rules. */
export const JOB_STATUS_FLOW: JobStatus[] = [
  'received',
  'in_progress',
  'ready_for_fitting',
  'alterations',
  'ready_for_pickup',
  'delivered',
];

export const JOB_STATUS_LABEL: Record<JobStatus, string> = {
  received: 'Received',
  in_progress: 'In progress',
  ready_for_fitting: 'Ready for fitting',
  alterations: 'Alterations',
  ready_for_pickup: 'Ready for pickup',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

export interface TailoringJob {
  id: string;
  jobNumber: number;
  garmentType: string;
  quantity: number;
  customerId: string | null;
  customerName: string | null;
  status: JobStatus;
  price: number;
  paid: number;
  balance: number;
  dueDate: string | null;
  daysUntilDue: number | null;
  assignedEmail: string | null;
  nextFittingAt: string | null;
  createdAt: string;
}

export interface JobSummary {
  jobsDueSoon: number;
  jobsOverdue: number;
  upcomingFittings: number;
  awaitingPickup: number;
  outstandingBalances: number;
  openJobs: number;
}

export interface CreateJobInput {
  storeId: string;
  garmentType: string;
  customerName?: string | null;
  customerPhone?: string | null;
  quantity?: number;
  price?: number;
  deposit?: number;
  dueDate?: string | null;
  fabricSuppliedBy?: 'business' | 'client';
  designNotes?: string | null;
  materialsNotes?: string | null;
  measurements?: Record<string, string> | null;
  measurementNotes?: string | null;
}

export class JobService {
  static async list(
    storeId: string,
    filters: { status?: JobStatus; dueWithinDays?: number; openOnly?: boolean; limit?: number } = {}
  ): Promise<TailoringJob[]> {
    try {
      const { data, error } = await supabase.rpc('list_tailoring_jobs', {
        p_store_id: storeId,
        p_status: filters.status ?? null,
        p_due_within_days: filters.dueWithinDays ?? null,
        p_open_only: filters.openOnly ?? true,
        p_limit: filters.limit ?? 100,
      });
      if (error) throw error;

      return (data ?? []).map((row: any) => ({
        id: row.id,
        jobNumber: Number(row.job_number ?? 0),
        garmentType: row.garment_type,
        quantity: Number(row.quantity ?? 1),
        customerId: row.customer_id,
        customerName: row.customer_name,
        status: row.status,
        price: Number(row.price ?? 0),
        paid: Number(row.paid ?? 0),
        balance: Number(row.balance ?? 0),
        dueDate: row.due_date,
        daysUntilDue: row.days_until_due === null ? null : Number(row.days_until_due),
        assignedEmail: row.assigned_email,
        nextFittingAt: row.next_fitting_at,
        createdAt: row.created_at,
      }));
    } catch (error) {
      console.error('List tailoring jobs error:', error);
      throw error;
    }
  }

  static async summary(storeId: string): Promise<JobSummary> {
    try {
      const { data, error } = await supabase.rpc('tailoring_job_summary', {
        p_store_id: storeId,
      });
      if (error) throw error;
      const row: any = Array.isArray(data) ? data[0] : data;
      return {
        jobsDueSoon: Number(row?.jobs_due_soon ?? 0),
        jobsOverdue: Number(row?.jobs_overdue ?? 0),
        upcomingFittings: Number(row?.upcoming_fittings ?? 0),
        awaitingPickup: Number(row?.awaiting_pickup ?? 0),
        outstandingBalances: Number(row?.outstanding_balances ?? 0),
        openJobs: Number(row?.open_jobs ?? 0),
      };
    } catch (error) {
      console.error('Tailoring job summary error:', error);
      throw error;
    }
  }

  /** The database validates the deposit, the garment, and the transition rules. */
  static async create(input: CreateJobInput): Promise<void> {
    try {
      const { error } = await supabase.rpc('create_tailoring_job', {
        p_store_id: input.storeId,
        p_garment_type: input.garmentType,
        p_customer_id: null,
        p_customer_name: input.customerName ?? null,
        p_customer_phone: input.customerPhone ?? null,
        p_quantity: input.quantity ?? 1,
        p_price: input.price ?? 0,
        p_deposit: input.deposit ?? 0,
        p_due_date: input.dueDate ?? null,
        p_fabric_supplied_by: input.fabricSuppliedBy ?? 'business',
        p_design_notes: input.designNotes ?? null,
        p_materials_notes: input.materialsNotes ?? null,
        p_assigned_to: null,
        p_measurements: input.measurements ?? null,
        p_measurement_notes: input.measurementNotes ?? null,
      });
      if (error) throw error;
    } catch (error) {
      console.error('Create tailoring job error:', error);
      throw error;
    }
  }

  /**
   * Move a job on. A move the database does not permit is refused, and a backward
   * move requires a reason - both enforced server-side, not here.
   */
  static async setStatus(jobId: string, status: JobStatus, reason?: string): Promise<void> {
    try {
      const { error } = await supabase.rpc('update_job_status', {
        p_job_id: jobId,
        p_new_status: status,
        p_reason: reason ?? null,
      });
      if (error) throw error;
    } catch (error) {
      console.error('Update job status error:', error);
      throw error;
    }
  }

  static async recordPayment(
    jobId: string,
    amount: number,
    method = 'cash',
    reference?: string
  ): Promise<void> {
    try {
      const { error } = await supabase.rpc('record_job_payment', {
        p_job_id: jobId,
        p_amount: amount,
        p_method: method,
        p_reference: reference ?? null,
      });
      if (error) throw error;
    } catch (error) {
      console.error('Record job payment error:', error);
      throw error;
    }
  }

  static async scheduleFitting(jobId: string, scheduledAt: string, notes?: string): Promise<void> {
    try {
      const { error } = await supabase.rpc('schedule_fitting', {
        p_job_id: jobId,
        p_scheduled_at: scheduledAt,
        p_notes: notes ?? null,
      });
      if (error) throw error;
    } catch (error) {
      console.error('Schedule fitting error:', error);
      throw error;
    }
  }
}
