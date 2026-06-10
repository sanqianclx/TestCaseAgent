export class TaskCancelledError extends Error {
  constructor(message: string = '任务已取消') {
    super(message);
    this.name = 'TaskCancelledError';
  }
}

type TaskRunState = {
  sessionId?: number;
  workspaceId?: number;
  outputDir?: string;
  cancelled: boolean;
};

const taskRuns = new Map<string, TaskRunState>();

export function registerTaskRun(taskId: string, state: Omit<TaskRunState, 'cancelled'> = {}): void {
  taskRuns.set(taskId, {
    ...state,
    cancelled: false,
  });
}

export function updateTaskRun(taskId: string, state: Partial<Omit<TaskRunState, 'cancelled'>>): void {
  const existing = taskRuns.get(taskId);
  if (!existing) return;
  taskRuns.set(taskId, { ...existing, ...state });
}

export function cancelTaskRun(taskId: string): boolean {
  const existing = taskRuns.get(taskId);
  if (!existing) {
    taskRuns.set(taskId, { cancelled: true });
    return false;
  }
  existing.cancelled = true;
  taskRuns.set(taskId, existing);
  return true;
}

export function cancelSessionTaskRuns(sessionId: number): string[] {
  const cancelledTaskIds: string[] = [];
  for (const [taskId, state] of taskRuns.entries()) {
    if (state.sessionId === sessionId) {
      state.cancelled = true;
      taskRuns.set(taskId, state);
      cancelledTaskIds.push(taskId);
    }
  }
  return cancelledTaskIds;
}

export function isTaskRunCancelled(taskId?: string): boolean {
  if (!taskId) return false;
  return taskRuns.get(taskId)?.cancelled === true;
}

export function throwIfTaskRunCancelled(taskId?: string): void {
  if (isTaskRunCancelled(taskId)) {
    throw new TaskCancelledError();
  }
}

export function unregisterTaskRun(taskId: string): void {
  taskRuns.delete(taskId);
}
