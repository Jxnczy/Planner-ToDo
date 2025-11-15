import { ChangeDetectionStrategy, Component, computed, signal, effect, ElementRef, ViewChild, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Todo, Week, CategoryKey, DayTasks, PlannerState } from './todo.model';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [CommonModule, FormsModule]
})
export class AppComponent implements OnDestroy {
  
  daysOfWeek: string[] = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
  weekDates = signal<string[]>([]);
  week = signal<Week>(this.loadFromLocalStorage<Week>('planner-week') || this.initializeWeek());
  currentDayIndex = signal<number>(this.determineCurrentDayIndex());
  isSidebarCollapsed = signal(false);

  @ViewChild('fileInput') fileInput?: ElementRef<HTMLInputElement>;

  // Task Pool State
  newTodoText = signal('');
  isUrgent = signal(false);
  isImportant = signal(false);
  taskDuration = signal(30);
  todoPool = signal<Todo[]>(this.loadFromLocalStorage<Todo[]>('planner-todoPool') || [
    { id: 101, text: 'Review quarterly report', completed: false, urgent: true, important: true, duration: 120 },
    { id: 102, text: 'Schedule dentist appointment', completed: false, urgent: true, important: false, duration: 15 },
    { id: 103, text: 'Brainstorm project ideas', completed: false, urgent: false, important: true, duration: 90 },
    { id: 104, text: 'Organize old photos', completed: false, urgent: false, important: false, duration: 180 },
  ]);

  mustDoPool = computed(() => this.todoPool().filter(t => t.urgent && t.important));
  prioTaskPool = computed(() => this.todoPool().filter(t => !t.urgent && t.important));
  chorePool = computed(() => this.todoPool().filter(t => t.urgent && !t.important));
  backlogPool = computed(() => this.todoPool().filter(t => !t.urgent && !t.important));

  activeDropTarget = signal<{ day: string; category: CategoryKey } | 'pool' | 'trash' | null>(null);
  draggedTaskInfo = signal<{ day: string; category: CategoryKey; todo: Todo } | null>(null);
  isDraggingTask = signal(false);

  // Editing State
  editingTaskId = signal<number | null>(null);
  editingTaskText = signal('');
  editingTaskDuration = signal(30);

  importStatus = signal<{ type: 'success' | 'error'; message: string } | null>(null);
  private importStatusTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.calculateWeekDates();

    effect(() => {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('planner-week', JSON.stringify(this.week()));
        localStorage.setItem('planner-todoPool', JSON.stringify(this.todoPool()));
      }
    });
  }

  ngOnDestroy(): void {
    if (this.importStatusTimeout) {
      clearTimeout(this.importStatusTimeout);
    }
  }

  private loadFromLocalStorage<T>(key: string): T | null {
    if (typeof localStorage === 'undefined') {
      return null;
    }
    const data = localStorage.getItem(key);
    if (!data) {
      return null;
    }
    try {
      return JSON.parse(data) as T;
    } catch (e) {
      console.error(`Error parsing localStorage item "${key}":`, e);
      return null;
    }
  }

  private calculateWeekDates(): void {
    const dates: string[] = [];
    const startOfWeek = this.getStartOfWeek(new Date());
    for (let i = 0; i < 7; i++) {
      const currentDate = new Date(startOfWeek);
      currentDate.setDate(startOfWeek.getDate() + i);
      dates.push(this.formatDate(currentDate));
    }
    this.weekDates.set(dates);
  }

  private getStartOfWeek(date: Date): Date {
    const day = date.getDay();
    const diff = day === 0 ? -6 : 1 - day; // adjust so week starts on Monday
    const monday = new Date(date);
    monday.setHours(0, 0, 0, 0);
    monday.setDate(date.getDate() + diff);
    return monday;
  }

  private formatDate(date: Date): string {
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  private determineCurrentDayIndex(): number {
    const today = new Date().getDay();
    return today === 0 ? 6 : today - 1; // convert Sunday (0) to index 6
  }

  private initializeWeek(): Week {
    const week: Week = {};
    for (const day of this.daysOfWeek) {
        week[day] = {
            goal: [],
            mustDo: [],
            prioTask: [],
            chore: [],
            events: [],
            habits: [],
        };
    }
    return week;
  }

  addTodo(): void {
    const text = this.newTodoText().trim();
    if (!text) return;

    const newTodo: Todo = {
      id: Date.now(),
      text,
      completed: false,
      urgent: this.isUrgent(),
      important: this.isImportant(),
      duration: this.taskDuration(),
    };

    this.todoPool.update(pool => [...pool, newTodo]);
    this.newTodoText.set('');
    this.isUrgent.set(false);
    this.isImportant.set(false);
    this.taskDuration.set(30);
  }

  toggleTodoCompletion(day: string, category: CategoryKey, todoId: number): void {
    this.week.update(currentWeek => {
      const newWeek = JSON.parse(JSON.stringify(currentWeek));
      const todo = newWeek[day][category].find((t: Todo) => t.id === todoId);
      if (todo) {
        todo.completed = !todo.completed;
      }
      return newWeek;
    });
  }
  
  toggleSidebar(): void {
    this.isSidebarCollapsed.update(v => !v);
  }

  // Edit Handlers
  startEdit(task: Todo): void {
    this.editingTaskId.set(task.id);
    this.editingTaskText.set(task.text);
    this.editingTaskDuration.set(task.duration);
  }

  cancelEdit(): void {
    this.editingTaskId.set(null);
  }

  saveEdit(): void {
    const id = this.editingTaskId();
    if (id === null) return;

    const newText = this.editingTaskText().trim();
    const newDuration = this.editingTaskDuration();
    if (!newText || newDuration <= 0) return;

    // Try updating in the week signal
    const weekVal = this.week();
    let taskFound = false;
    for (const day of this.daysOfWeek) {
      for (const category of Object.keys(weekVal[day]) as CategoryKey[]) {
        const taskIndex = weekVal[day][category].findIndex(t => t.id === id);
        if (taskIndex > -1) {
          this.week.update(currentWeek => {
            const newWeek = JSON.parse(JSON.stringify(currentWeek));
            const taskToUpdate = newWeek[day][category][taskIndex];
            taskToUpdate.text = newText;
            taskToUpdate.duration = newDuration;
            return newWeek;
          });
          taskFound = true;
          break;
        }
      }
      if (taskFound) break;
    }

    // If not found, try updating in the pool
    if (!taskFound) {
      this.todoPool.update(pool => pool.map(task =>
        task.id === id ? { ...task, text: newText, duration: newDuration } : task
      ));
    }

    this.cancelEdit();
  }

  exportPlannerState(): void {
    if (typeof document === 'undefined') {
      return;
    }

    const plannerState: PlannerState = {
      week: this.week(),
      todoPool: this.todoPool(),
    };

    const blob = new Blob([JSON.stringify(plannerState, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `planner-state-${new Date().toISOString().split('T')[0]}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    this.setImportStatus('Planner data exported.', 'success');
  }

  triggerImportDialog(): void {
    this.fileInput?.nativeElement.click();
  }

  handleFileImport(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result as string);
        if (this.isValidPlannerState(parsed)) {
          this.week.set(parsed.week);
          this.todoPool.set(parsed.todoPool);
          this.setImportStatus('Planner data imported successfully.', 'success');
        } else {
          this.setImportStatus('Selected file is not a valid planner export.', 'error');
        }
      } catch (e) {
        console.error('Error importing planner data', e);
        this.setImportStatus('Unable to read the selected file.', 'error');
      } finally {
        input.value = '';
      }
    };
    reader.readAsText(file);
  }

  resetPlanner(): void {
    this.week.set(this.initializeWeek());
    this.todoPool.set([]);
    this.setImportStatus('Planner reset to a clean slate.', 'success');
  }

  private isValidPlannerState(data: unknown): data is PlannerState {
    if (!data || typeof data !== 'object') {
      return false;
    }
    const candidate = data as PlannerState;
    if (!candidate.week || typeof candidate.week !== 'object' || !Array.isArray(candidate.todoPool)) {
      return false;
    }

    const categories: CategoryKey[] = ['goal', 'mustDo', 'prioTask', 'chore', 'events', 'habits'];
    for (const day of this.daysOfWeek) {
      const dayTasks = (candidate.week as Week)[day];
      if (!dayTasks) {
        return false;
      }
      for (const category of categories) {
        if (!Array.isArray(dayTasks[category])) {
          return false;
        }
        if (!dayTasks[category].every(task => this.isValidTodo(task))) {
          return false;
        }
      }
    }

    return candidate.todoPool.every(task => this.isValidTodo(task));
  }

  private isValidTodo(task: unknown): task is Todo {
    if (!task || typeof task !== 'object') {
      return false;
    }
    const todo = task as Todo;
    return typeof todo.id === 'number'
      && typeof todo.text === 'string'
      && typeof todo.completed === 'boolean'
      && typeof todo.urgent === 'boolean'
      && typeof todo.important === 'boolean'
      && typeof todo.duration === 'number';
  }

  private setImportStatus(message: string, type: 'success' | 'error'): void {
    this.importStatus.set({ message, type });
    if (this.importStatusTimeout) {
      clearTimeout(this.importStatusTimeout);
    }
    this.importStatusTimeout = setTimeout(() => this.importStatus.set(null), 4000);
  }


  // Drag and Drop Handlers
  onPoolDragStart(event: DragEvent, todo: Todo): void {
    const dragData = { id: todo.id, source: 'pool' };
    event.dataTransfer?.setData('text/plain', JSON.stringify(dragData));
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
    }
    this.isDraggingTask.set(true);
  }

  onWeekDragStart(event: DragEvent, todo: Todo, day: string, category: CategoryKey): void {
    const dragData = { id: todo.id, source: 'week', sourceDay: day, sourceCategory: category };
    event.dataTransfer?.setData('text/plain', JSON.stringify(dragData));
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
    }
    this.draggedTaskInfo.set({ day, category, todo });
    this.isDraggingTask.set(true);
  }

  onDragEnd(): void {
    this.draggedTaskInfo.set(null);
    this.activeDropTarget.set(null);
    this.isDraggingTask.set(false);
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
  }
  
  onDragEnter(day: string, category: CategoryKey): void {
    this.activeDropTarget.set({ day, category });
  }
  
  onDragEnterTarget(target: 'pool' | 'trash'): void {
    this.activeDropTarget.set(target);
  }

  onDragLeave(): void {
    this.activeDropTarget.set(null);
  }

  onDrop(event: DragEvent, day: string, category: CategoryKey): void {
    event.preventDefault();
    const dataStr = event.dataTransfer?.getData('text/plain');
    if (!dataStr) {
      this.activeDropTarget.set(null);
      return;
    }

    try {
      const data = JSON.parse(dataStr);
      
      if (category === 'goal' && this.week()[day].goal.length > 0 && !(data.sourceDay === day && data.sourceCategory === 'goal')) {
          console.warn("Goal slot is already occupied.");
          this.activeDropTarget.set(null);
          this.draggedTaskInfo.set(null);
          return;
      }
      
      this.activeDropTarget.set(null);
      this.draggedTaskInfo.set(null);
      const todoId = data.id;

      if (data.source === 'pool') {
        const todoToMove = this.todoPool().find(t => t.id === todoId);
        if (todoToMove) {
          this.week.update(currentWeek => {
            const newWeek = { ...currentWeek };
            newWeek[day][category] = [...newWeek[day][category], todoToMove];
            return newWeek;
          });
          this.todoPool.update(pool => pool.filter(t => t.id !== todoId));
        }
      } else if (data.source === 'week' && data.sourceDay && data.sourceCategory) {
        const { sourceDay, sourceCategory } = data;
        this.week.update(currentWeek => {
          const newWeek = JSON.parse(JSON.stringify(currentWeek));
          const sourceList: Todo[] = newWeek[sourceDay][sourceCategory];
          const todoIndex = sourceList.findIndex((t: Todo) => t.id === todoId);

          if (todoIndex > -1) {
            const [todoToMove] = sourceList.splice(todoIndex, 1);
            newWeek[day][category].push(todoToMove);
          }
          return newWeek;
        });
      }
    } catch (e) {
      console.error("Error parsing drag data", e);
    }
  }

  onPoolDrop(event: DragEvent): void {
    event.preventDefault();
    this.activeDropTarget.set(null);
    const dataStr = event.dataTransfer?.getData('text/plain');
    if (!dataStr) return;

    try {
      const data = JSON.parse(dataStr);
      if (data.source === 'week' && data.sourceDay && data.sourceCategory) {
        const { sourceDay, sourceCategory, id: todoId } = data;
        let taskToMove: Todo | undefined;

        this.week.update(currentWeek => {
          const newWeek = JSON.parse(JSON.stringify(currentWeek));
          const sourceList: Todo[] = newWeek[sourceDay][sourceCategory];
          const todoIndex = sourceList.findIndex((t: Todo) => t.id === todoId);

          if (todoIndex > -1) {
            [taskToMove] = sourceList.splice(todoIndex, 1);
          }
          return newWeek;
        });

        if (taskToMove) {
          this.todoPool.update(pool => [...pool, taskToMove!]);
        }
      }
    } catch (e) {
      console.error("Error parsing drag data on pool drop", e);
    }
  }

  onTrashDrop(event: DragEvent): void {
    event.preventDefault();
    this.activeDropTarget.set(null);
    const dataStr = event.dataTransfer?.getData('text/plain');
    if (!dataStr) return;

    try {
      const data = JSON.parse(dataStr);
      const { id: todoId, source } = data;

      if (source === 'week') {
        const { sourceDay, sourceCategory } = data;
        this.week.update(currentWeek => {
          const newWeek = JSON.parse(JSON.stringify(currentWeek));
          const sourceList: Todo[] = newWeek[sourceDay][sourceCategory];
          const todoIndex = sourceList.findIndex((t: Todo) => t.id === todoId);
          if (todoIndex > -1) {
            sourceList.splice(todoIndex, 1);
          }
          return newWeek;
        });
      } else if (source === 'pool') {
        this.todoPool.update(pool => pool.filter(t => t.id !== todoId));
      }
    } catch (e) {
      console.error("Error parsing drag data on trash drop", e);
    }
  }
  
  isDropTarget(dayOrTarget: string, category?: CategoryKey): boolean {
    const target = this.activeDropTarget();
    if (typeof target === 'string') {
      return target === dayOrTarget;
    }
    if (target && typeof target === 'object' && category) {
        return target.day === dayOrTarget && target.category === category;
    }
    return false;
  }

  isTaskBeingDragged(todo: Todo, day: string, category: CategoryKey): boolean {
    const dragged = this.draggedTaskInfo();
    if (!dragged) return false;
    return dragged.todo.id === todo.id && dragged.day === day && dragged.category === category;
  }

  // UI Helper Methods
  isPastDay(dayIndex: number): boolean {
    return dayIndex < this.currentDayIndex();
  }

  getEmptyPlaceholders(taskCount: number, capacity: number): unknown[] {
    const emptyCount = Math.max(0, capacity - taskCount);
    return Array(emptyCount).fill(0);
  }

  calculateDayStats(day: string): string {
    const dayTasks = this.week()[day];
    if (!dayTasks) return '00:00 (0%)';
    
    const totalMinutes = [...dayTasks.goal, ...dayTasks.mustDo, ...dayTasks.prioTask, ...dayTasks.chore, ...dayTasks.events, ...dayTasks.habits]
      .reduce((sum, task) => sum + task.duration, 0);

    const goalMinutes = 300; // 5 hours
    const percentage = goalMinutes > 0 ? Math.round((totalMinutes / goalMinutes) * 100) : 0;
    
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')} (${percentage}%)`;
  }
}