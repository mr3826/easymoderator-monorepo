'use strict';

const META_PAGE_TASKS_REQUIRED = 'META_PAGE_TASKS_REQUIRED';
const REQUIRED_PAGE_TASKS = Object.freeze(['CREATE_CONTENT', 'MANAGE', 'MODERATE']);
const TASK_NAME_PATTERN = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/;

function normalizePageTask(task) {
    if (typeof task !== 'string') return null;

    const normalized = task.trim().replace(/\s+/g, '_').toUpperCase();
    return normalized && TASK_NAME_PATTERN.test(normalized) ? normalized : null;
}

function normalizePageTasks(tasks) {
    if (!Array.isArray(tasks)) return null;

    const normalized = [];
    const seen = new Set();
    for (const task of tasks) {
        const normalizedTask = normalizePageTask(task);
        if (!normalizedTask) return null;
        if (!seen.has(normalizedTask)) {
            seen.add(normalizedTask);
            normalized.push(normalizedTask);
        }
    }
    return normalized;
}

function evaluatePageEligibility(tasks) {
    const normalizedTasks = normalizePageTasks(tasks);
    if (!normalizedTasks) {
        return {
            tasks: [],
            connectable: false,
            reason: META_PAGE_TASKS_REQUIRED,
        };
    }

    const taskSet = new Set(normalizedTasks);
    const connectable = taskSet.has('MESSAGING')
        && REQUIRED_PAGE_TASKS.some((task) => taskSet.has(task));

    return {
        tasks: normalizedTasks,
        connectable,
        reason: connectable ? null : META_PAGE_TASKS_REQUIRED,
    };
}

module.exports = {
    META_PAGE_TASKS_REQUIRED,
    REQUIRED_PAGE_TASKS,
    normalizePageTasks,
    evaluatePageEligibility,
};
