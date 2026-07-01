/** 运行状态枚举 */
export var WorkflowStatus;
(function (WorkflowStatus) {
    WorkflowStatus["RUNNING"] = "running";
    WorkflowStatus["COMPLETED"] = "completed";
    WorkflowStatus["FAILED"] = "failed";
})(WorkflowStatus || (WorkflowStatus = {}));
