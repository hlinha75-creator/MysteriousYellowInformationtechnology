function runTask(task, logger = console) {
  return Promise.resolve()
    .then(task.run)
    .catch((error) => logger.error(task.errorMessage, error));
}

function runTasks(tasks, logger = console) {
  return Promise.all(tasks.map((task) => runTask(task, logger)));
}

function scheduleTaskGroups(groups, options = {}) {
  const setIntervalFn = options.setIntervalFn || setInterval;
  const logger = options.logger || console;

  return groups.map((group) => setIntervalFn(() => {
    void runTasks(group.tasks, logger);
  }, group.intervalMs));
}

module.exports = {
  runTask,
  runTasks,
  scheduleTaskGroups
};
