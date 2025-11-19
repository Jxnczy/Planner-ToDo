import { Injectable, signal, computed, effect, inject } from '@angular/core';
import { Todo, Week, CategoryKey, DayTasks, DropTarget, DraggedTaskInfo } from '../models/todo.model';
import { StorageService } from './storage.service';
import { AudioService } from './audio.service';
import { GeminiService, SchedulingPlanItem } from './gemini.service';

@Injectable({
  providedIn: 'root',
})
export class TaskService {
  private storageService = inject(StorageService);
  private audioService = inject(AudioService);
  private geminiService = inject(GeminiService);

  // Core State Signals
  readonly daysOfWeek: string[] = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
  
  weekOffset = signal<number>(0);
  allWeeks = signal<{ [weekKey: string]: Week }>(this.storageService.get<{ [weekKey: string]: Week }>('planner-allWeeks') || {});
  todoPool = signal<Todo[]>(this.storageService.get<Todo[]>('planner-todoPool') || this.getInitialTodoPool());
  
  // UI & Interaction State Signals
  isDraggingTask = signal(false);
  draggedTaskInfo = signal<DraggedTaskInfo>(null);
  activeDropTarget = signal<DropTarget>(null);
  justCompletedTaskId = signal<number | null>(null);
  editingTaskId = signal<number | null>(null);
  editingTaskText = signal('');
  editingTaskDuration = signal<number | string>(30);
  isOrganizing = signal(false);

  // Date & Week Computations
  weekDateObjects = computed(() => this.calculateWeekDates(this.weekOffset()));
  weekDates = computed(() => this.weekDateObjects().map(day => `${(day.getMonth() + 1).toString().padStart(2, '0')}/${day.getDate().toString().padStart(2, '0')}`));
  
  weekDateRange = computed(() => {
    const dates = this.weekDateObjects();
    if (dates.length < 7) return '';
    const firstDay = dates[0];
    const lastDay = dates[6];
    const format = (d: Date) => `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
    return `${format(firstDay)} - ${format(lastDay)}`;
  });

  currentWeekKey = computed(() => {
    const monday = this.getMondayOfWeek(this.weekOffset());
    const year = monday.getFullYear();
    const firstDayOfYear = new Date(year, 0, 1);
    const pastDaysOfYear = (monday.getTime() - firstDayOfYear.getTime()) / 86400000;
    const weekNumber = Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7);
    return `${year}-W${String(weekNumber).padStart(2, '0')}`;
  });

  week = computed(() => {
    const key = this.currentWeekKey();
    const currentWeeks = this.allWeeks();
    return currentWeeks[key] || this.initializeWeek();
  });

  currentDayIndex = computed(() => {
    const today = new Date();
    const currentDay = today.getDay(); // Sunday - 0
    return currentDay === 0 ? 6 : currentDay - 1; // Monday - 0
  });

  // Task Pool Computations
  asapPool = computed(() => this.todoPool().filter(t => !t.habit && t.urgent && t.important));
  soonPool = computed(() => this.todoPool().filter(t => !t.habit && !t.urgent && t.important));
  pendingPool = computed(() => this.todoPool().filter(t => !t.habit && t.urgent && !t.important));
  offTimePool = computed(() => this.todoPool().filter(t => !t.habit && !t.urgent && !t.important));
  
  basicsPool = computed(() => {
    const allTasksInWeek = Object.values(this.week()).flatMap((day: DayTasks) => Object.values(day).flat());
    const scheduledChoreSourceIds = new Set(allTasksInWeek.filter(task => task.sourceId != null).map(task => task.sourceId));
    return this.todoPool().filter(t => t.habit && !scheduledChoreSourceIds.has(t.id));
  });

  // Daily Stats
  private readonly dailyCapacity = 480; // 8 hours in minutes
  dailyLoad = computed(() => {
    const weekData = this.week();
    const result: Record<string, { total: number; percentage: number; color: string }> = {};
    for (const day of this.daysOfWeek) {
        const dayTasks = weekData[day];
        // The total load is calculated based on ALL planned tasks for the day,
        // regardless of their completion status, to reflect the total commitment.
        // FIX: Type inference for `task` fails here, resulting in `unknown`. We cast it to `Todo`
        // to allow accessing its properties. The initial value of `0` ensures the accumulator `sum`
        // is correctly typed as a number.
        const totalMinutes = Object.values(dayTasks ?? {})
            .flat()
            .reduce((sum, task) => sum + ((task as Todo).duration || 0), 0);
        
        const percentage = this.dailyCapacity > 0 ? Math.min((totalMinutes / this.dailyCapacity) * 100, 100) : 0;
        result[day] = { total: totalMinutes, percentage, color: this.getLoadColor(percentage) };
    }
    return result;
  });

  constructor() {
    // Auto-create week if it doesn't exist on load
    if(!this.allWeeks()[this.currentWeekKey()]) {
      this.allWeeks.update(weeks => ({...weeks, [this.currentWeekKey()]: this.initializeWeek()}));
    }

    // Auto-save effects
    effect(() => {
      const timeoutId = setTimeout(() => this.storageService.set('planner-allWeeks', this.allWeeks()), 500);
      return () => clearTimeout(timeoutId);
    });
    effect(() => {
      const timeoutId = setTimeout(() => this.storageService.set('planner-todoPool', this.todoPool()), 500);
      return () => clearTimeout(timeoutId);
    });
  }

  // --- Public Methods for Components ---

  // Week Navigation
  navigateWeek(direction: number): void {
    this.weekOffset.update(val => val + direction);
    const newWeekKey = this.currentWeekKey();
    if (!this.allWeeks()[newWeekKey]) {
      this.allWeeks.update(weeks => ({ ...weeks, [newWeekKey]: this.initializeWeek() }));
    }
  }

  // Task Management
  addTodo(text: string, category: 'asap' | 'soon' | 'pending' | 'leisure' | 'basics', duration: number | string): void {
    const newTodo: Todo = {
      id: Date.now(),
      text: text.trim(),
      completed: false,
      urgent: category === 'asap' || category === 'pending',
      important: category === 'asap' || category === 'soon',
      duration: Number(duration) || 30,
      habit: category === 'basics',
    };
    this.todoPool.update(pool => [...pool, newTodo]);
  }

  toggleTodoCompletion(day: string, category: CategoryKey, todoId: number): void {
    const weekKey = this.currentWeekKey();
    let wasCompleted = false;

    this.allWeeks.update(currentWeeks => {
      const newWeeks = JSON.parse(JSON.stringify(currentWeeks));
      const task = newWeeks[weekKey][day][category].find((t: Todo) => t.id === todoId);
      if (task) {
        wasCompleted = !task.completed;
        task.completed = !task.completed;
      }
      return newWeeks;
    });
    
    if (wasCompleted) {
      this.audioService.playSuccessSound();
      this.justCompletedTaskId.set(todoId);
      setTimeout(() => this.justCompletedTaskId.set(null), 1000);
    }
  }

  // Editing
  startEdit(todo: Todo): void {
    this.editingTaskId.set(todo.id);
    this.editingTaskText.set(todo.text);
    this.editingTaskDuration.set(todo.duration);
  }

  cancelEdit(): void {
    this.editingTaskId.set(null);
  }

  saveEdit(): void {
    const id = this.editingTaskId();
    if (id === null) return;

    const newText = this.editingTaskText();
    const newDuration = Number(this.editingTaskDuration()) || 0;
    const weekKey = this.currentWeekKey();
    let foundInWeek = false;

    this.allWeeks.update(currentWeeks => {
      const newWeeks = JSON.parse(JSON.stringify(currentWeeks));
      for (const day of this.daysOfWeek) {
        for (const cat of Object.keys(newWeeks[weekKey][day])) {
          const category = cat as CategoryKey;
          const task = newWeeks[weekKey][day][category].find((t: Todo) => t.id === id);
          if (task) {
            task.text = newText;
            task.duration = newDuration;
            foundInWeek = true;
            return newWeeks;
          }
        }
      }
      return currentWeeks;
    });

    if (!foundInWeek) {
      this.todoPool.update(pool =>
        pool.map(t => (t.id === id ? { ...t, text: newText, duration: newDuration } : t))
      );
    }
    this.cancelEdit();
  }

  // Drag and Drop Handlers
  onDragStart(info: DraggedTaskInfo): void {
    this.draggedTaskInfo.set(info);
    this.isDraggingTask.set(true);
  }
  
  onDragEnter(target: DropTarget): void {
    this.activeDropTarget.set(target);
  }

  cleanupDragState(): void {
    this.isDraggingTask.set(false);
    this.draggedTaskInfo.set(null);
    this.activeDropTarget.set(null);
  }

  onDrop(day: string, category: CategoryKey): void {
    const data = this.draggedTaskInfo();
    if (!data) return;

    const todoToDrop = { ...data.todo, completed: false };
    const targetWeekKey = this.currentWeekKey();

    // Perform validation before any state updates
    if (category === 'goal') {
        const goalIsOccupied = this.week()[day].goal.length > 0;
        const isMovingFromSameGoalSlot = data.source === 'week' && data.day === day && data.category === 'goal';
        if (goalIsOccupied && !isMovingFromSameGoalSlot) {
            return; // Goal slot is occupied, abort.
        }
    }

    // Handle habit instantiation as a special case
    if (todoToDrop.habit && data.source === 'pool') {
      const newInstance = { ...todoToDrop, id: Date.now(), sourceId: todoToDrop.id };
      this.allWeeks.update(currentWeeks => {
        const newWeeks = JSON.parse(JSON.stringify(currentWeeks));
        newWeeks[targetWeekKey][day][category].push(newInstance);
        return newWeeks;
      });
      // Do not remove the original from the pool
      return;
    }

    // Perform the main atomic update on the week
    this.allWeeks.update(currentWeeks => {
        const newWeeks = JSON.parse(JSON.stringify(currentWeeks));
        
        // 1. Remove from source if it's within the week
        if (data.source === 'week') {
            newWeeks[data.weekKey][data.day][data.category] = newWeeks[data.weekKey][data.day][data.category].filter((t: Todo) => t.id !== todoToDrop.id);
        }

        // 2. Add to destination
        newWeeks[targetWeekKey][day][category].push(todoToDrop);
        
        return newWeeks;
    });

    // 3. Remove from pool if source was the pool
    if (data.source === 'pool') {
        this.todoPool.update(pool => pool.filter(t => t.id !== todoToDrop.id));
    }
  }

  onPoolDrop(): void {
    const data = this.draggedTaskInfo();
    if (!data || data.source !== 'week') return;
    
    const { todo, day, category, weekKey } = data;
    // Instantiated habits cannot be returned to the pool.
    if (todo.sourceId != null) return;

    // 1. Atomically remove from the week
    this.allWeeks.update(currentWeeks => {
        const newWeeks = JSON.parse(JSON.stringify(currentWeeks));
        newWeeks[weekKey][day][category] = newWeeks[weekKey][day][category].filter((t: Todo) => t.id !== todo.id);
        return newWeeks;
    });

    // 2. Add back to the pool
    this.todoPool.update(pool => [...pool, todo]);
  }

  // AI-powered Organization
  async organizeWeekWithAI(): Promise<void> {
    const tasksToOrganize = this.todoPool().filter(t => !t.habit);
    if (tasksToOrganize.length === 0) {
      alert("Backlog is empty. Nothing to organize!");
      return;
    }

    this.isOrganizing.set(true);
    try {
      const schedulingPlan = await this.geminiService.getSchedulingPlan(tasksToOrganize, this.week(), this.dailyLoad());
      if (schedulingPlan) {
        this.applySchedulingPlan(schedulingPlan);
      }
    } catch (error) {
      console.error("Failed to organize week with AI:", error);
    } finally {
      this.isOrganizing.set(false);
    }
  }

  private applySchedulingPlan(plan: SchedulingPlanItem[]): void {
    const weekKey = this.currentWeekKey();
    const tasksToScheduleMap = new Map(this.todoPool().map(t => [t.id, t]));
    const scheduledTaskIds = new Set<number>();

    this.allWeeks.update(currentWeeks => {
      // It's safer to create a deep copy to avoid mutation issues
      const weekToUpdate = JSON.parse(JSON.stringify(currentWeeks[weekKey]));
      
      for (const item of plan) {
        const task = tasksToScheduleMap.get(item.id);
        // Ensure day and category exist before pushing
        if (task && weekToUpdate[item.day] && weekToUpdate[item.day][item.category]) {
          weekToUpdate[item.day][item.category].push(task);
          scheduledTaskIds.add(item.id);
        }
      }
      return { ...currentWeeks, [weekKey]: weekToUpdate };
    });

    this.todoPool.update(pool => pool.filter(task => !scheduledTaskIds.has(task.id)));
  }


  // Data Management
  exportData(): void {
    const dataToExport = { allWeeks: this.allWeeks(), todoPool: this.todoPool() };
    const blob = new Blob([JSON.stringify(dataToExport, null, 2)], { type: 'application/json' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `planner-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    window.URL.revokeObjectURL(url);
    a.remove();
  }

  importData(file: File): void {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target?.result as string);
        if (data && data.allWeeks && data.todoPool) {
          this.allWeeks.set(data.allWeeks);
          this.todoPool.set(data.todoPool);
          this.weekOffset.set(0);
        } else {
          alert('Invalid import file format.');
        }
      } catch (err) {
        alert('Error importing data. Check console for details.');
        console.error('Error importing data:', err);
      }
    };
    reader.readAsText(file);
  }

  resetCurrentWeekTasks(): void {
    if (!confirm('Are you sure? This will move all tasks from the current week back to the backlog.')) return;
    
    const weekKey = this.currentWeekKey();
    const currentWeek = this.week();
    const tasksToMoveBack = Object.values(currentWeek)
      .flatMap((day: DayTasks) => Object.values(day).flat())
      .filter(task => !task.habit && task.sourceId == null);

    this.todoPool.update(pool => [...pool, ...tasksToMoveBack]);
    this.allWeeks.update(weeks => ({ ...weeks, [weekKey]: this.initializeWeek() }));
  }
  
  deleteAllData(): void {
    if (!confirm('Are you sure? This will delete all scheduled tasks and non-recurring backlog items.')) return;

    const persistentHabits = this.todoPool().filter(t => t.habit);
    this.todoPool.set(persistentHabits);
    this.allWeeks.set({ [this.currentWeekKey()]: this.initializeWeek() });
    this.weekOffset.set(0);
  }

  // --- Private Helper Methods ---

  private getMondayOfWeek(offsetWeeks: number): Date {
    const today = new Date();
    today.setDate(today.getDate() + offsetWeeks * 7);
    const dayOfWeek = today.getDay();
    const diff = today.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
    return new Date(today.setDate(diff));
  }

  private calculateWeekDates(offset: number): Date[] {
    const firstDayOfWeek = this.getMondayOfWeek(offset);
    return Array.from({ length: 7 }, (_, i) => {
      const day = new Date(firstDayOfWeek);
      day.setDate(firstDayOfWeek.getDate() + i);
      return day;
    });
  }

  private initializeWeek(): Week {
    const newWeek: Week = {};
    this.daysOfWeek.forEach(day => {
      newWeek[day] = { goal: [], focus: [], work: [], leisure: [], basics: [] };
    });
    return newWeek;
  }
  
  private getLoadColor(percentage: number): string {
    const p = percentage / 100;
    const h = 120 * (1 - p);
    const s = 90;
    const l = 55 - (20 * p);
    return this.hslToHex(h, s, l);
  }

  private hslToHex(h: number, s: number, l: number): string {
    l /= 100;
    const a = s * Math.min(l, 1 - l) / 100;
    const f = (n: number): string => {
      const k = (n + h / 30) % 12;
      const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
      return Math.round(255 * color).toString(16).padStart(2, '0');
    };
    return `#${f(0)}${f(8)}${f(4)}`;
  }
  
  private getInitialTodoPool(): Todo[] {
    return [
      { id: 101, text: 'Review Report', completed: false, urgent: true, important: true, duration: 120, habit: false },
      { id: 102, text: 'Fix critical bugs', completed: false, urgent: true, important: true, duration: 180, habit: false },
      { id: 103, text: 'Client presentation', completed: false, urgent: true, important: true, duration: 90, habit: false },
      { id: 104, text: 'Brainstorm ideas', completed: false, urgent: false, important: true, duration: 90, habit: false },
      { id: 105, text: 'Order calendar', completed: false, urgent: false, important: true, duration: 60, habit: false },
      { id: 106, text: 'Research eBay auto', completed: false, urgent: false, important: true, duration: 120, habit: false },
      { id: 108, text: 'Schedule dentist', completed: false, urgent: true, important: false, duration: 15, habit: false },
      { id: 109, text: 'Pay electricity', completed: false, urgent: true, important: false, duration: 10, habit: false },
      { id: 110, text: 'Check mails', completed: false, urgent: true, important: false, duration: 30, habit: false },
      { id: 111, text: 'Organize Photos', completed: false, urgent: false, important: false, duration: 180, habit: false },
      { id: 113, text: 'Read one chapter', completed: false, urgent: false, important: false, duration: 30, habit: false },
      { id: 201, text: 'Vacuum', completed: false, urgent: false, important: false, duration: 20, habit: true },
      { id: 202, text: 'Clean Up', completed: false, urgent: false, important: false, duration: 15, habit: true },
      { id: 203, text: 'Trash Out', completed: false, urgent: false, important: false, duration: 5, habit: true },
    ];
  }
}