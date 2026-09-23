"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TaskStatus = exports.TaskPriority = void 0;
/**
 * Task priority levels
 */
var TaskPriority;
(function (TaskPriority) {
    TaskPriority[TaskPriority["CRITICAL"] = 100] = "CRITICAL";
    TaskPriority[TaskPriority["HIGH"] = 75] = "HIGH";
    TaskPriority[TaskPriority["MEDIUM"] = 50] = "MEDIUM";
    TaskPriority[TaskPriority["LOW"] = 25] = "LOW";
    TaskPriority[TaskPriority["BACKGROUND"] = 0] = "BACKGROUND";
})(TaskPriority || (exports.TaskPriority = TaskPriority = {}));
/**
 * Task status
 */
var TaskStatus;
(function (TaskStatus) {
    TaskStatus["PENDING"] = "pending";
    TaskStatus["READY"] = "ready";
    TaskStatus["RUNNING"] = "running";
    TaskStatus["COMPLETED"] = "completed";
    TaskStatus["FAILED"] = "failed";
    TaskStatus["CANCELLED"] = "cancelled";
})(TaskStatus || (exports.TaskStatus = TaskStatus = {}));
