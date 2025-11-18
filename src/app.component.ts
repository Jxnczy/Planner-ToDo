import { ChangeDetectionStrategy, Component, computed, signal, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Todo, Week, CategoryKey, DayTasks, DropTarget } from './todo.model';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [CommonModule, FormsModule]
})
export class AppComponent {
  
  daysOfWeek: string[] = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
  weekDateObjects = signal<Date[]>([]);
  weekOffset = signal<number>(0);
  allWeeks = signal<{ [weekKey: string]: Week }>(this.loadFromLocalStorage<{ [weekKey: string]: Week }>('planner-allWeeks') || {});
  
  weekDates = computed(() => this.weekDateObjects().map(day => `${(day.getMonth() + 1).toString().padStart(2, '0')}/${day.getDate().toString().padStart(2, '0')}`));
  
  weekDateRange = computed(() => {
    const dates = this.weekDateObjects();
    if (dates.length < 7) return '';
    const firstDay = dates[0];
    const lastDay = dates[6];
    const format = (d: Date) => {
        const dd = String(d.getDate()).padStart(2, '0');
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        return `${dd}.${mm}`;
    };
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

  currentDayIndex = signal<number>(0); 

  // Task Pool State
  newTodoText = signal('');
  newTaskCategory = signal<'asap' | 'soon' | 'pending' | 'offTime' | 'chore' | null>('asap');
  // FIX: Broaden type to `number | string` to safely handle values from `[(ngModel)]`.
  taskDuration = signal<number | string>(30);
  todoPool = signal<Todo[]>(this.loadFromLocalStorage<Todo[]>('planner-todoPool') || [
      // ASAP
      { id: 101, text: 'Review Report', completed: false, urgent: true, important: true, duration: 120, habit: false },
      { id: 102, text: 'Fix critical bugs', completed: false, urgent: true, important: true, duration: 180, habit: false },
      { id: 103, text: 'Client presentation', completed: false, urgent: true, important: true, duration: 90, habit: false },
      // SOON
      { id: 104, text: 'Brainstorm ideas', completed: false, urgent: false, important: true, duration: 90, habit: false },
      { id: 105, text: 'Order calendar', completed: false, urgent: false, important: true, duration: 60, habit: false },
      { id: 106, text: 'Research eBay auto', completed: false, urgent: false, important: true, duration: 120, habit: false },
      { id: 107, text: 'Start an online course', completed: false, urgent: false, important: true, duration: 45, habit: false },
      // PENDING
      { id: 108, text: 'Schedule dentist', completed: false, urgent: true, important: false, duration: 15, habit: false },
      { id: 109, text: 'Pay electricity', completed: false, urgent: true, important: false, duration: 10, habit: false },
      { id: 110, text: 'Check mails', completed: false, urgent: true, important: false, duration: 30, habit: false },
      // OFF TIME
      { id: 111, text: 'Organize Photos', completed: false, urgent: false, important: false, duration: 180, habit: false },
      { id: 112, text: 'Watch a new movie', completed: false, urgent: false, important: false, duration: 120, habit: false },
      { id: 113, text: 'Read one chapter', completed: false, urgent: false, important: false, duration: 30, habit: false },
      { id: 114, text: 'Call a friend', completed: false, urgent: false, important: false, duration: 20, habit: false },
      // CHORES
      { id: 201, text: 'Vacuum', completed: false, urgent: false, important: false, duration: 20, habit: true },
      { id: 202, text: 'Clean Up', completed: false, urgent: false, important: false, duration: 15, habit: true },
      { id: 203, text: 'Trash Out', completed: false, urgent: false, important: false, duration: 5, habit: true },
      { id: 204, text: 'Shave', completed: false, urgent: false, important: false, duration: 10, habit: true },
      { id: 205, text: 'Laundry', completed: false, urgent: false, important: false, duration: 60, habit: true },
  ]);

  asapPool = computed(() => this.todoPool().filter(t => !t.habit && t.urgent && t.important));
  soonPool = computed(() => this.todoPool().filter(t => !t.habit && !t.urgent && t.important));
  pendingPool = computed(() => this.todoPool().filter(t => !t.habit && t.urgent && !t.important));
  offTimePool = computed(() => this.todoPool().filter(t => !t.habit && !t.urgent && !t.important));
  
  choresPool = computed(() => {
    const allTasksInWeek = Object.values(this.week()).flatMap((day: DayTasks) => Object.values(day).flat());
    const scheduledChoreSourceIds = new Set(
      allTasksInWeek
        .filter(task => task.sourceId != null)
        .map(task => task.sourceId)
    );
    return this.todoPool().filter(t => t.habit && !scheduledChoreSourceIds.has(t.id));
  });

  activeDropTarget = signal<DropTarget>(null);
  draggedTaskInfo = signal<{ source: 'week'; day: string; category: CategoryKey; todo: Todo; weekKey: string } | { source: 'pool'; todo: Todo } | null>(null);
  isDraggingTask = signal(false);

  // UI State
  isDataConfigOpen = signal(false);
  justCompletedTaskId = signal<number | null>(null); // For animation trigger

  // Editing State
  editingTaskId = signal<number | null>(null);
  editingTaskText = signal('');
  // FIX: Allow string type to accommodate form input values, preventing type pollution.
  editingTaskDuration = signal<number | string>(30);
  
  // Audio Context
  private audioCtx: AudioContext | null = null;

  // New Features State
  dailyCapacity = 480; // 8 hours in minutes

  constructor() {
    this.calculateWeekDates(this.weekOffset());
    this.setTodayIndex();

    if(!this.allWeeks()[this.currentWeekKey()]) {
      this.allWeeks.update(weeks => ({...weeks, [this.currentWeekKey()]: this.initializeWeek()}));
    }

    effect(() => {
        const timeoutId = setTimeout(() => this.saveToLocalStorage('planner-allWeeks', this.allWeeks()), 500);
        return () => clearTimeout(timeoutId);
    });
    effect(() => {
        const timeoutId = setTimeout(() => this.saveToLocalStorage('planner-todoPool', this.todoPool()), 500);
        return () => clearTimeout(timeoutId);
    });

    if (typeof document !== 'undefined') {
      const dragEndHandler = (event: DragEvent) => {
        if (event.dataTransfer?.dropEffect === 'none') {
            const draggedInfo = this.draggedTaskInfo();
            if (draggedInfo) {
                const todo = draggedInfo.todo;
                if (draggedInfo.source === 'pool') {
                    this.todoPool.update(pool => pool.filter(t => t.id !== todo.id));
                } else if (draggedInfo.source === 'week') {
                    const { day, category, weekKey } = draggedInfo;
                    this.allWeeks.update(w => {
                        const sourceWeek = w[weekKey];
                         if (!sourceWeek || !sourceWeek[day] || !sourceWeek[day][category]) return w;
                         return {
                            ...w,
                            [weekKey]: { 
                                ...sourceWeek, 
                                [day]: { 
                                    ...sourceWeek[day], 
                                    [category]: sourceWeek[day][category].filter((t: Todo) => t.id !== todo.id) 
                                } 
                            }
                        };
                    });
                }
            }
        }
        
        this.isDraggingTask.set(false);
        this.draggedTaskInfo.set(null);
        this.activeDropTarget.set(null);
      };
      document.addEventListener('dragend', dragEndHandler);

      document.addEventListener('dragleave', (e) => {
        if (e.clientX === 0 && e.clientY === 0) {
            this.isDraggingTask.set(false);
            this.draggedTaskInfo.set(null);
            this.activeDropTarget.set(null);
        }
      });

      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && this.editingTaskId() !== null) {
          this.cancelEdit();
        }
      });
    }
  }

  // Initialize Web Audio API on user interaction to handle autoplay policies
  private initAudio() {
    if (!this.audioCtx && typeof window !== 'undefined') {
       const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
       if (AudioContext) {
         this.audioCtx = new AudioContext();
       }
    }
  }

  private playSuccessSound() {
    this.initAudio();
    if (!this.audioCtx) return;

    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }

    const t = this.audioCtx.currentTime;
    const oscillator = this.audioCtx.createOscillator();
    const gainNode = this.audioCtx.createGain();
    
    // Pretty "Ding" sound: Sine wave + Harmonics
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(523.25, t); // C5
    oscillator.frequency.exponentialRampToValueAtTime(880, t + 0.1); // Slide up to A5

    // Envelope
    gainNode.gain.setValueAtTime(0, t);
    gainNode.gain.linearRampToValueAtTime(0.1, t + 0.02); // Attack
    gainNode.gain.exponentialRampToValueAtTime(0.001, t + 0.8); // Decay

    oscillator.connect(gainNode);
    gainNode.connect(this.audioCtx.destination);

    oscillator.start(t);
    oscillator.stop(t + 0.8);
    
    // Add a sparkle harmonic
    const osc2 = this.audioCtx.createOscillator();
    const gain2 = this.audioCtx.createGain();
    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(1046.5, t); // C6
    gain2.gain.setValueAtTime(0, t);
    gain2.gain.linearRampToValueAtTime(0.05, t + 0.05);
    gain2.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    
    osc2.connect(gain2);
    gain2.connect(this.audioCtx.destination);
    osc2.start(t);
    osc2.stop(t + 0.4);
  }

  toggleDataConfigOpen(): void {
    this.isDataConfigOpen.update(v => !v);
  }

  dayStats = computed(() => {
    const stats: Record<string, string> = {};
    const weekData = this.week();
    for (const day of this.daysOfWeek) {
      const dayTasks = weekData[day];
      if (!dayTasks) {
        stats[day] = '0h 0m (0%)';
        continue;
      }
      // FIX: Use parseFloat for robust parsing of task durations, which might be strings.
      const totalMinutes = Object.values(dayTasks)
        .flat()
        .reduce<number>((sum, task: Todo) => {
            const d = parseFloat(String(task.duration));
            return sum + (isNaN(d) ? 0 : d);
        }, 0);

      const percentage = this.dailyCapacity > 0 ? Math.round((totalMinutes / this.dailyCapacity) * 100) : 0;
      const hours = Math.floor(totalMinutes / 60);
      const minutes = totalMinutes % 60;

      stats[day] = `${hours}h ${minutes}m (${percentage}%)`;
    }
    return stats;
  });

  dailyLoad = computed(() => {
    const weekData = this.week();
    const result: Record<string, { total: number; percentage: number, color: string }> = {};

    for (const day of this.daysOfWeek) {
        const dayTasks = weekData[day];
        let totalMinutes = 0;
        if (dayTasks) {
            // FIX: Use parseFloat for robust parsing of task durations to prevent type errors.
            totalMinutes = Object.values(dayTasks)
                .flat()
                .reduce<number>((sum, task: Todo) => {
                    const d = parseFloat(String(task.duration));
                    return sum + (isNaN(d) ? 0 : d);
                }, 0);
        }
        const percentage = this.dailyCapacity > 0 ? Math.min((totalMinutes / this.dailyCapacity) * 100, 100) : 0;
        const color = this.getLoadColor(percentage);
        result[day] = { total: totalMinutes, percentage, color };
    }
    return result;
  });

  private getLoadColor(percentage: number): string {
    const p = percentage / 100;
    const h = 120 * (1 - p);
    const s = 90;
    const l = 55 - (20 * p);
    return this.hslToHex(h, s, l);
  }

  // FIX: Replaced HSL to Hex conversion to fix arithmetic and type errors.
  private hslToHex(h: number, s: number, l: number): string {
    // Explicitly cast to numbers to avoid TS arithmetic errors
    const H = Number(h);
    const S = Number(s);
    const L = Number(l);

    const lNorm = L / 100;
    const a = (S / 100) * Math.min(lNorm, 1 - lNorm);
    const f = (n: number) => {
      const N = Number(n);
      const k = (N + H / 30) % 12;
      const color = lNorm - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
      return Math.round(255 * color).toString(16).padStart(2, '0');
    };
    return `#${f(0)}${f(8)}${f(4)}`;
  }

  addTodo(): void {
    if (!this.newTodoText().trim() || !this.newTaskCategory()) return;

    const category = this.newTaskCategory();
    let urgent = false;
    let important = false;
    let habit = false;

    switch (category) {
      case 'asap':
        urgent = true;
        important = true;
        break;
      case 'soon':
        urgent = false;
        important = true;
        break;
      case 'pending':
        urgent = true;
        important = false;
        break;
      case 'offTime':
        urgent = false;
        important = false;
        break;
      case 'chore':
        habit = true;
        break;
    }

    const durationVal = parseFloat(String(this.taskDuration()));
    const newTodo: Todo = {
      id: Date.now(),
      text: this.newTodoText().trim(),
      completed: false,
      urgent: urgent,
      important: important,
      // FIX: Use parseFloat to safely handle potential string values from input bindings.
      duration: isNaN(durationVal) ? 30 : durationVal,
      habit: habit,
    };
    this.todoPool.update(pool => [...pool, newTodo]);
    
    this.newTodoText.set('');
    this.taskDuration.set(30);
  }

  toggleTodoCompletion(day: string, category: CategoryKey, todoId: number): void {
    const weekKey = this.currentWeekKey();
    let wasCompleted = false;
    this.allWeeks.update(currentWeeks => {
      const weekToUpdate = { ...currentWeeks[weekKey] };
      const task = weekToUpdate[day][category].find(t => t.id === todoId);
      if (task) {
        wasCompleted = !task.completed;
      }
      return {
        ...currentWeeks,
        [weekKey]: {
          ...weekToUpdate,
          [day]: {
            ...weekToUpdate[day],
            [category]: weekToUpdate[day][category].map(t =>
              t.id === todoId ? { ...t, completed: !t.completed } : t
            )
          }
        }
      };
    });
    
    if (wasCompleted) {
      this.playSuccessSound();
      this.justCompletedTaskId.set(todoId);
      setTimeout(() => this.justCompletedTaskId.set(null), 1000); // Reset after animation
    }
  }

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
    // FIX: Safely parse duration from the input, providing a fallback to prevent NaN.
    // The value can be a string from the input, so it needs parsing.
    const newDuration = parseInt(String(this.editingTaskDuration()), 10) || 0;
    const weekKey = this.currentWeekKey();

    let foundInWeek = false;
    this.allWeeks.update(currentWeeks => {
      const newWeeks = { ...currentWeeks };
      const weekToUpdate = { ...newWeeks[weekKey] };
      for (const day of this.daysOfWeek) {
        for (const cat of Object.keys(weekToUpdate[day])) {
          const category = cat as CategoryKey;
          if (Array.isArray(weekToUpdate[day][category])) {
            const taskIndex = weekToUpdate[day][category].findIndex(t => t.id === id);
            if (taskIndex > -1) {
              const updatedCategory = [...weekToUpdate[day][category]];
              updatedCategory[taskIndex] = { ...updatedCategory[taskIndex], text: newText, duration: newDuration };
              weekToUpdate[day] = { ...weekToUpdate[day], [category]: updatedCategory };
              newWeeks[weekKey] = weekToUpdate;
              foundInWeek = true;
              return newWeeks;
            }
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

  onPoolDragStart(event: DragEvent, todo: Todo): void {
    event.dataTransfer?.setData('text/plain', JSON.stringify({ source: 'pool', todo }));
    this.draggedTaskInfo.set({ source: 'pool', todo });
    this.isDraggingTask.set(true);
  }

  onWeekDragStart(event: DragEvent, todo: Todo, day: string, category: CategoryKey): void {
    const weekKey = this.currentWeekKey();
    event.dataTransfer?.setData('text/plain', JSON.stringify({ source: 'week', day, category, todo, weekKey }));
    this.draggedTaskInfo.set({ source: 'week', day, category, todo, weekKey });
    this.isDraggingTask.set(true);
  }

  onDragEnd(event: DragEvent): void {
    this.isDraggingTask.set(false);
    this.activeDropTarget.set(null);
  }

  onDragEnter(day: string, category: CategoryKey): void {
    this.activeDropTarget.set({ type: 'day', day, category });
  }

  onDragEnterTarget(target: 'pool'): void {
    this.activeDropTarget.set({ type: target });
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
  }

  onDrop(event: DragEvent, day: string, category: CategoryKey): void {
    event.preventDefault();
    const dataStr = event.dataTransfer?.getData('text/plain');
    if (!dataStr) return;

    try {
      const data = JSON.parse(dataStr);
      const todo: Todo = data.todo;
      const targetWeekKey = this.currentWeekKey();

      if (category === 'goal' && this.week()[day].goal.length > 0 && !(data.source === 'week' && data.day === day && data.category === 'goal' && data.weekKey === targetWeekKey)) {
        console.warn("Goal slot is already occupied.");
        return;
      }

      if (todo.habit && data.source === 'pool') {
        const newInstance = { ...todo, id: Date.now(), sourceId: todo.id, completed: false };
        this.allWeeks.update(w => {
          const targetWeek = w[targetWeekKey];
          return {
          ...w,
          [targetWeekKey]: { 
            ...targetWeek, 
            [day]: { ...targetWeek[day], [category]: [...targetWeek[day][category], newInstance] } 
          }
        }});
        return;
      }
      
      if (data.source === 'pool') {
        this.todoPool.update(pool => pool.filter(t => t.id !== todo.id));
      } else if (data.source === 'week') {
        this.allWeeks.update(w => {
          const sourceWeek = w[data.weekKey];
          return {
          ...w,
          [data.weekKey]: {
            ...sourceWeek,
            [data.day]: {
              ...sourceWeek[data.day],
              [data.category]: sourceWeek[data.day][data.category].filter((t: Todo) => t.id !== todo.id)
            }
          }
        }});
      }

      this.allWeeks.update(w => {
        const targetWeek = w[targetWeekKey];
        const updatedTodo = { ...todo, completed: false };
        return {
        ...w,
        [targetWeekKey]: { 
          ...targetWeek, 
          [day]: { ...targetWeek[day], [category]: [...targetWeek[day][category], updatedTodo] } 
        }
      }});
    } catch (e) {
      console.error("Error parsing drag data", e);
    }
  }

  onPoolDrop(event: DragEvent): void {
    event.preventDefault();
    const dataStr = event.dataTransfer?.getData('text/plain');
    if (!dataStr) return;

    try {
      const data = JSON.parse(dataStr);
      if (data.source === 'week') {
        const todo: Todo = data.todo;
        if (todo.habit || todo.sourceId) {
           return;
        }
        this.allWeeks.update(w => {
          const sourceWeek = w[data.weekKey];
          return {
          ...w,
          [data.weekKey]: { ...sourceWeek, [data.day]: { ...sourceWeek[data.day], [data.category]: sourceWeek[data.day][data.category].filter((t: Todo) => t.id !== todo.id) } }
        }});
        this.todoPool.update(pool => [...pool, todo]);
      }
    } catch (e) {
      console.error("Error parsing drag data for pool drop", e);
    }
  }

  isDropTarget(dayOrTarget: string, category?: CategoryKey): boolean {
    const target = this.activeDropTarget();
    if (!target) return false;
    if (target.type === 'day' && category) {
      return target.day === dayOrTarget && target.category === category;
    }
    if (target.type === 'pool' && !category) {
      return target.type === dayOrTarget;
    }
    return false;
  }
  
  isTaskBeingDragged(todo: Todo, day: string, category: CategoryKey): boolean {
    const dragged = this.draggedTaskInfo();
    if (!dragged || dragged.source !== 'week') return false;
    return dragged.todo.id === todo.id && dragged.day === day && dragged.category === category;
  }

  isPoolTaskBeingDragged(todo: Todo): boolean {
    const dragged = this.draggedTaskInfo();
    if (!dragged || dragged.source !== 'pool') return false;
    return dragged.todo.id === todo.id;
  }

  isPastDay(dayIndex: number): boolean {
    if (this.weekOffset() < 0) return true;
    if (this.weekOffset() > 0) return false;
    return dayIndex < this.currentDayIndex();
  }

  getEmptyPlaceholders(currentLength: number, maxLength: number): any[] {
    return new Array(Math.max(0, maxLength - currentLength));
  }
  
  private setTodayIndex(): void {
    const today = new Date();
    const currentDay = today.getDay(); // Sunday - 0
    this.currentDayIndex.set(currentDay === 0 ? 6 : currentDay - 1); // Monday - 0
  }

  private getMondayOfWeek(offsetWeeks: number): Date {
    const today = new Date();
    today.setDate(today.getDate() + offsetWeeks * 7);
    const dayOfWeek = today.getDay(); // 0 = Sunday
    const diff = today.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1); // adjust when day is sunday
    return new Date(today.setDate(diff));
  }

  private calculateWeekDates(offset: number): void {
    const firstDayOfWeek = this.getMondayOfWeek(offset);
    const dates: Date[] = [];
    for (let i = 0; i < 7; i++) {
      const day = new Date(firstDayOfWeek);
      day.setDate(firstDayOfWeek.getDate() + i);
      dates.push(day);
    }
    this.weekDateObjects.set(dates);
  }

  navigateWeek(direction: number): void {
    this.weekOffset.update(val => val + direction);
    this.calculateWeekDates(this.weekOffset());
    const newWeekKey = this.currentWeekKey();
    if (!this.allWeeks()[newWeekKey]) {
      this.allWeeks.update(weeks => ({ ...weeks, [newWeekKey]: this.initializeWeek() }));
    }
  }

  private initializeWeek(): Week {
    const newWeek: Week = {};
    this.daysOfWeek.forEach(day => {
      newWeek[day] = {
        goal: [], focus: [], core: [], offTime: [], chore: []
      };
    });
    return newWeek;
  }

  exportData(): void {
    try {
      const dataToExport = {
        allWeeks: this.allWeeks(),
        todoPool: this.todoPool()
      };
      const blob = new Blob([JSON.stringify(dataToExport, null, 2)], { type: 'application/json' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `planner-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Error exporting data:', e);
    }
  }

  importData(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;
    const file = input.files[0];
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        const data = JSON.parse(text);
        if (data && data.allWeeks && data.todoPool) {
          this.allWeeks.set(data.allWeeks);
          this.todoPool.set(data.todoPool);
          this.weekOffset.set(0);
          this.calculateWeekDates(0);
        } else {
          alert('Invalid import file format.');
        }
      } catch (err) {
        alert('Error importing data. Check console for details.');
        console.error('Error importing data:', err);
      }
    };
    reader.readAsText(file);
    input.value = '';
  }

  resetCurrentWeekTasks(): void {
    if (confirm('Are you sure you want to reset this week? All scheduled tasks will be moved back to their pools.')) {
      const weekKey = this.currentWeekKey();
      const currentWeek = this.week();

      const tasksToMoveBack = Object.values(currentWeek)
        .flatMap((day: DayTasks) => Object.values(day).flat())
        .filter(task => !task.habit && task.sourceId == null);

      this.todoPool.update(pool => [...pool, ...tasksToMoveBack]);

      this.allWeeks.update(weeks => ({
        ...weeks,
        [weekKey]: this.initializeWeek()
      }));
    }
  }
  
  deleteAllData(): void {
    if (confirm('Are you sure you want to delete all data? This action cannot be undone.')) {
      const persistentHabits = this.todoPool().filter(t => t.habit);
      this.todoPool.set(persistentHabits);
      this.allWeeks.set({[this.currentWeekKey()]: this.initializeWeek()});
      this.weekOffset.set(0);
      this.calculateWeekDates(0);
    }
  }

  private loadFromLocalStorage<T>(key: string): T | null {
    if (typeof localStorage === 'undefined') return null;
    try {
      const item = localStorage.getItem(key);
      return item ? JSON.parse(item) : null;
    } catch (e) {
      console.error(`Error reading from localStorage for key "${key}":`, e);
      return null;
    }
  }

  private saveToLocalStorage(key: string, value: any): void {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.error(`Error writing to localStorage for key "${key}":`, e);
    }
  }
}