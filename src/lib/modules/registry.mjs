// Module availability is independent of placement in the mobile navigation.
export const modules = Object.freeze([
  { id: 'tasks', title: '待办', paths: ['/tasks', '/task-detail', '/task-chat'], tools: ['createTask', 'listTasks', 'updateTask', 'getCurrentTask', 'updateCurrentTask'], defaultPinned: true },
  { id: 'slides', title: '知识幻灯片', paths: ['/slides', '/slides/view'], tools: ['createSlideDeck'], defaultPinned: false },
]);

export function normalizeModuleSettings(value) {
  return Object.fromEntries(modules.map(module => {
    const setting = value && typeof value === 'object' ? value[module.id] : null;
    return [module.id, { enabled: typeof setting?.enabled === 'boolean' ? setting.enabled : true,
      pinned: typeof setting?.pinned === 'boolean' ? setting.pinned : module.defaultPinned }];
  }));
}
export function moduleForPath(path) { return modules.find(module => module.paths.includes(path)); }
