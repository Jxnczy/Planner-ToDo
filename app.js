const DAYS = [
  { key: 'MONDAY', label: 'Monday' },
  { key: 'TUESDAY', label: 'Tuesday' },
  { key: 'WEDNESDAY', label: 'Wednesday' },
  { key: 'THURSDAY', label: 'Thursday' },
  { key: 'FRIDAY', label: 'Friday' },
  { key: 'SATURDAY', label: 'Saturday' },
  { key: 'SUNDAY', label: 'Sunday' }
];

const CATEGORIES = [
  { key: 'goal', label: 'Goals' },
  { key: 'mustDo', label: 'Must Do' },
  { key: 'prioTask', label: 'Priority Tasks' },
  { key: 'chore', label: 'Chores & Errands' },
  { key: 'events', label: 'Events' },
  { key: 'habits', label: 'Habits & Notes' }
];

const QUADRANTS = [
  { id: 'must', label: 'Must Do', match: (t) => t.urgent && t.important },
  { id: 'have', label: 'Have To', match: (t) => !t.urgent && t.important },
  { id: 'should', label: 'Should Do', match: (t) => t.urgent && !t.important },
  { id: 'other', label: 'Other', match: (t) => !t.urgent && !t.important }
];

const STORAGE_KEY = 'planner-simple-state-v1';

const DEFAULT_TASKS = [
  { id: 101, text: 'Review quarterly report', duration: 120, urgent: true, important: true, completed: false },
  { id: 102, text: 'Schedule dentist appointment', duration: 15, urgent: true, important: false, completed: false },
  { id: 103, text: 'Brainstorm project ideas', duration: 90, urgent: false, important: true, completed: false },
  { id: 104, text: 'Organize old photos', duration: 180, urgent: false, important: false, completed: false }
];

const weekBoard = document.querySelector('#weekBoard');
const poolLists = {
  must: document.querySelector('#pool-must'),
  have: document.querySelector('#pool-have'),
  should: document.querySelector('#pool-should'),
  other: document.querySelector('#pool-other')
};
const statusToast = document.querySelector('#statusToast');
const weekRangeEl = document.querySelector('#weekRange');
const taskForm = document.querySelector('#taskForm');
const importInput = document.querySelector('#importFile');

let state = loadState();
const weekDates = buildWeekDates();
updateWeekRangeLabel();
buildWeekBoard();
renderAll();
attachEventHandlers();

function buildWeekDates() {
  const today = new Date();
  const start = getStartOfWeek(today);
  return DAYS.map((_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    const formatted = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    return { date, formatted };
  });
}

function updateWeekRangeLabel() {
  const first = weekDates[0].date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const last = weekDates[6].date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  weekRangeEl.textContent = `${first} – ${last}`;
}

function buildWeekBoard() {
  weekBoard.innerHTML = '';
  DAYS.forEach((day, index) => {
    const column = document.createElement('section');
    column.className = 'day-column';
    column.dataset.day = day.key;
    if (index === getTodayIndex()) {
      column.classList.add('is-today');
    }

    const header = document.createElement('div');
    header.className = 'day-header';
    const label = document.createElement('strong');
    label.textContent = day.label;
    const date = document.createElement('span');
    date.textContent = weekDates[index].formatted;
    header.append(label, date);
    column.appendChild(header);

    CATEGORIES.forEach((category) => {
      const wrapper = document.createElement('article');
      wrapper.className = 'category';
      wrapper.dataset.day = day.key;
      wrapper.dataset.category = category.key;

      const title = document.createElement('p');
      title.className = 'category-title';
      title.textContent = category.label;
      wrapper.appendChild(title);

      const list = document.createElement('div');
      list.className = 'task-list';
      list.dataset.day = day.key;
      list.dataset.category = category.key;
      list.dataset.dropTarget = 'board';
      addDropListeners(list);
      wrapper.appendChild(list);

      column.appendChild(wrapper);
    });

    weekBoard.appendChild(column);
  });
}

function renderAll() {
  renderPool();
  renderWeek();
  saveState();
}

function renderPool() {
  QUADRANTS.forEach((quadrant) => {
    const list = poolLists[quadrant.id];
    list.innerHTML = '';
    const todos = state.todoPool.filter(quadrant.match);
    if (!todos.length) {
      list.appendChild(emptyMessage('No tasks'));
      return;
    }
    todos.forEach((todo) => {
      const node = createTaskCard(todo, { location: 'pool' });
      list.appendChild(node);
    });
  });
}

function renderWeek() {
  document.querySelectorAll('[data-drop-target="board"]').forEach((list) => {
    const { day, category } = list.dataset;
    const tasks = state.week[day][category];
    list.innerHTML = '';
    if (!tasks.length) {
      list.appendChild(emptyMessage('Empty slot'));
      return;
    }
    tasks.forEach((todo) => {
      const node = createTaskCard(todo, { location: 'week', day, category });
      list.appendChild(node);
    });
  });
}

function createTaskCard(todo, context) {
  const card = document.createElement('div');
  card.className = 'task-card';
  card.draggable = true;
  card.dataset.taskId = String(todo.id);
  card.dataset.location = context.location;
  if (context.location === 'week') {
    card.dataset.day = context.day;
    card.dataset.category = context.category;
  }
  if (todo.completed) {
    card.classList.add('is-complete');
  }

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = todo.completed;
  checkbox.addEventListener('change', () => toggleCompletion(todo.id, context, checkbox.checked));

  const content = document.createElement('div');
  content.className = 'task-main';
  const title = document.createElement('span');
  title.textContent = todo.text;
  const meta = document.createElement('span');
  meta.className = 'task-meta';
  meta.textContent = `${todo.duration} min`;
  content.append(title, meta);

  const actions = document.createElement('div');
  actions.className = 'task-actions';
  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'icon-button';
  editBtn.title = 'Edit task';
  editBtn.textContent = '✎';
  editBtn.addEventListener('click', () => editTask(todo.id));

  const duplicateBtn = document.createElement('button');
  duplicateBtn.type = 'button';
  duplicateBtn.className = 'icon-button';
  duplicateBtn.title = 'Duplicate';
  duplicateBtn.textContent = '+';
  duplicateBtn.addEventListener('click', () => duplicateTask(todo.id));

  actions.append(editBtn, duplicateBtn);

  card.append(checkbox, content, actions);
  card.addEventListener('dragstart', (event) => handleDragStart(event, context, todo.id));
  card.addEventListener('dragend', () => handleDragEnd());

  return card;
}

function emptyMessage(text) {
  const p = document.createElement('p');
  p.className = 'muted';
  p.textContent = text;
  return p;
}

function handleDragStart(event, context, taskId) {
  const payload = { taskId, ...context };
  event.dataTransfer.setData('text/plain', JSON.stringify(payload));
  event.dataTransfer.effectAllowed = 'move';
  document.body.dataset.dragging = 'true';
  const card = event.currentTarget;
  card.dataset.dragging = 'true';
}

function handleDragEnd() {
  delete document.body.dataset.dragging;
  document
    .querySelectorAll('[data-highlight]')
    .forEach((node) => node.removeAttribute('data-highlight'));
  document
    .querySelectorAll('[data-dragging]')
    .forEach((node) => node.removeAttribute('data-dragging'));
}

function addDropListeners(node) {
  node.addEventListener('dragover', (event) => {
    event.preventDefault();
    node.dataset.highlight = 'true';
  });
  node.addEventListener('dragleave', () => node.removeAttribute('data-highlight'));
  node.addEventListener('drop', (event) => {
    event.preventDefault();
    node.removeAttribute('data-highlight');
    const payload = getPayload(event);
    if (!payload) return;
    const targetDay = node.dataset.day;
    const targetCategory = node.dataset.category;
    moveTask(payload, { day: targetDay, category: targetCategory });
  });
}

function attachEventHandlers() {
  taskForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = document.querySelector('#taskText').value.trim();
    const duration = Number(document.querySelector('#taskDuration').value);
    const urgent = document.querySelector('#taskUrgent').checked;
    const important = document.querySelector('#taskImportant').checked;
    if (!text || duration <= 0) {
      return;
    }
    const newTask = {
      id: Date.now(),
      text,
      duration,
      urgent,
      important,
      completed: false
    };
    state.todoPool.push(newTask);
    taskForm.reset();
    document.querySelector('#taskDuration').value = '30';
    renderAll();
    showToast('Task added to pool');
  });

  document.querySelectorAll('[data-pool-drop]').forEach((area) => {
    area.addEventListener('dragover', (event) => {
      event.preventDefault();
      area.dataset.highlight = 'true';
    });
    area.addEventListener('dragleave', () => area.removeAttribute('data-highlight'));
    area.addEventListener('drop', (event) => {
      event.preventDefault();
      area.removeAttribute('data-highlight');
      const payload = getPayload(event);
      if (!payload) return;
      moveTask(payload, { toPool: true });
    });
  });

  document.querySelector('[data-drop-target="trash"]').addEventListener('dragover', (event) => {
    event.preventDefault();
    const target = event.currentTarget;
    target.dataset.highlight = 'true';
  });
  document.querySelector('[data-drop-target="trash"]').addEventListener('dragleave', (event) => {
    event.currentTarget.removeAttribute('data-highlight');
  });
  document.querySelector('[data-drop-target="trash"]').addEventListener('drop', (event) => {
    event.preventDefault();
    const payload = getPayload(event);
    event.currentTarget.removeAttribute('data-highlight');
    if (!payload) return;
    deleteTask(payload);
  });

  document.querySelector('#exportButton').addEventListener('click', exportState);
  document.querySelector('#importButton').addEventListener('click', () => importInput.click());
  document.querySelector('#resetButton').addEventListener('click', resetState);
  importInput.addEventListener('change', handleImport);
}

function moveTask(payload, target) {
  const task = takeTaskFromSource(payload);
  if (!task) return;
  if (target.toPool) {
    state.todoPool.push(task);
    showToast('Sent back to pool');
  } else {
    state.week[target.day][target.category].push(task);
    showToast(`Moved to ${getDayLabel(target.day)}`);
  }
  renderAll();
}

function deleteTask(payload) {
  const task = takeTaskFromSource(payload);
  if (task) {
    renderAll();
    showToast('Task removed');
  }
}

function takeTaskFromSource(payload) {
  if (payload.location === 'pool') {
    const index = state.todoPool.findIndex((t) => t.id === payload.taskId);
    if (index === -1) return null;
    return state.todoPool.splice(index, 1)[0];
  }
  if (payload.location === 'week') {
    const list = state.week[payload.day][payload.category];
    const index = list.findIndex((t) => t.id === payload.taskId);
    if (index === -1) return null;
    return list.splice(index, 1)[0];
  }
  return null;
}

function toggleCompletion(taskId, context, completed) {
  const target = context.location === 'pool'
    ? state.todoPool.find((t) => t.id === taskId)
    : state.week[context.day][context.category].find((t) => t.id === taskId);
  if (!target) return;
  target.completed = completed;
  renderAll();
}

function editTask(taskId) {
  const { task } = locateTask(taskId);
  if (!task) return;
  const newText = prompt('Update task description', task.text);
  if (newText === null) return;
  const trimmed = newText.trim();
  if (!trimmed) return;
  const newDuration = prompt('Duration in minutes', String(task.duration));
  if (newDuration === null) return;
  const durationNum = Number(newDuration);
  if (!Number.isFinite(durationNum) || durationNum <= 0) return;
  task.text = trimmed;
  task.duration = durationNum;
  renderAll();
  showToast('Task updated');
}

function duplicateTask(taskId) {
  const { task } = locateTask(taskId);
  if (!task) return;
  const copy = { ...task, id: Date.now() + Math.floor(Math.random() * 1000) };
  state.todoPool.push(copy);
  renderAll();
  showToast('Task duplicated to pool');
}

function locateTask(taskId) {
  const fromPool = state.todoPool.find((t) => t.id === taskId);
  if (fromPool) {
    return { task: fromPool, location: 'pool' };
  }
  for (const day of DAYS) {
    for (const category of CATEGORIES) {
      const list = state.week[day.key][category.key];
      const match = list.find((t) => t.id === taskId);
      if (match) {
        return { task: match, location: 'week', day: day.key, category: category.key };
      }
    }
  }
  return { task: null };
}

function exportState() {
  const blob = new Blob([JSON.stringify(state)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  const timestamp = new Date().toISOString().split('T')[0];
  link.download = `planner-week-${timestamp}.json`;
  link.click();
  URL.revokeObjectURL(url);
  showToast('Exported current data');
}

function handleImport(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!validateState(data)) {
        throw new Error('Invalid file format');
      }
      state = data;
      renderAll();
      showToast('Import successful');
    } catch (error) {
      console.error(error);
      showToast('Import failed');
    } finally {
      importInput.value = '';
    }
  };
  reader.readAsText(file);
}

function resetState() {
  if (!confirm('This will remove all tasks. Continue?')) return;
  state = createDefaultState();
  renderAll();
  showToast('Planner reset');
}

function loadState() {
  if (typeof localStorage === 'undefined') {
    return createDefaultState();
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return createDefaultState();
    }
    const parsed = JSON.parse(raw);
    if (!validateState(parsed)) {
      return createDefaultState();
    }
    return parsed;
  } catch (error) {
    console.error('Failed to parse saved state', error);
    return createDefaultState();
  }
}

function createDefaultState() {
  const week = {};
  DAYS.forEach((day) => {
    week[day.key] = {};
    CATEGORIES.forEach((category) => {
      week[day.key][category.key] = [];
    });
  });
  return { todoPool: [...DEFAULT_TASKS], week };
}

function validateState(data) {
  if (!data || typeof data !== 'object') return false;
  if (!Array.isArray(data.todoPool) || typeof data.week !== 'object') return false;
  for (const day of DAYS) {
    if (!data.week[day.key]) return false;
    for (const category of CATEGORIES) {
      if (!Array.isArray(data.week[day.key][category.key])) return false;
    }
  }
  return true;
}

function saveState() {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function showToast(message) {
  statusToast.textContent = message;
  statusToast.dataset.visible = 'true';
  clearTimeout(showToast.timeout);
  showToast.timeout = setTimeout(() => {
    statusToast.removeAttribute('data-visible');
  }, 2200);
}

function getPayload(event) {
  try {
    const payload = JSON.parse(event.dataTransfer.getData('text/plain'));
    if (typeof payload.taskId === 'number' || typeof payload.taskId === 'string') {
      payload.taskId = Number(payload.taskId);
    }
    return payload;
  } catch (error) {
    return null;
  }
}

function getStartOfWeek(date) {
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  result.setDate(date.getDate() + diff);
  return result;
}

function getTodayIndex() {
  const day = new Date().getDay();
  return day === 0 ? 6 : day - 1;
}

function getDayLabel(dayKey) {
  const entry = DAYS.find((d) => d.key === dayKey);
  return entry ? entry.label : dayKey;
}
