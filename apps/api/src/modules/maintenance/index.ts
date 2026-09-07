/**
 * maintenance (L3) - 30-day cycle engine, jobs, assignment. STEP 2.
 * Planned public interface (ARCHITECTURE section 1.2): generateJobs, assignJob, reschedule, closeJob;
 * dueBoard, myJobs. Consumes ElevatorRegistered/StatusChanged, ContractTerminated, VisitRecorded.
 */
export const moduleInfo = { name: 'maintenance', layer: 3, status: 'skeleton' } as const
