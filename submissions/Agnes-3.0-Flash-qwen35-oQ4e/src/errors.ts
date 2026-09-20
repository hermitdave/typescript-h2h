/** Scheduler error hierarchy. All extend SchedulerError so callers can catch
 *  a single base type when they do not care about the specific failure. */

export class SchedulerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** An update would introduce a dependency cycle (or a self-dependency). */
export class CycleError extends SchedulerError {}

/** Referenced task id does not exist. */
export class NotFoundError extends SchedulerError {}

/** Operation is illegal in the task's current state (e.g. completing a PENDING task). */
export class InvalidStateError extends SchedulerError {}
