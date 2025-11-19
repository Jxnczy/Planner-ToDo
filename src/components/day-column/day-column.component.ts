
import { ChangeDetectionStrategy, Component, inject, input, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TaskService } from '../../services/task.service';
import { Todo, CategoryKey, CATEGORIES } from '../../models/todo.model';

@Component({
  selector: 'app-day-column',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './day-column.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DayColumnComponent {
  taskService = inject(TaskService);
  
  day = input.required<string>();
  dayIndex = input.required<number>();
  
  readonly categories = CATEGORIES;

  isCurrentDay = computed(() => {
    return this.taskService.weekOffset() === 0 && this.dayIndex() === this.taskService.currentDayIndex();
  });

  getRemainingSlotsForCategory(category: CategoryKey): number[] {
    const taskCount = this.taskService.week()[this.day()][category].length;
    const minSlots = {
      goal: 1,
      focus: 3,
      work: 3,
      leisure: 3,
      basics: 4
    };
    
    // Goal is special: it can only have 1 total. If a task is present, 0 slots remain.
    if (category === 'goal') {
      return taskCount > 0 ? [] : [0];
    }
    
    const remaining = Math.max(0, minSlots[category] - taskCount);
    return Array.from({ length: remaining }, (_, i) => i);
  }

  onWeekDragStart(event: DragEvent, todo: Todo, category: CategoryKey): void {
    const weekKey = this.taskService.currentWeekKey();
    event.dataTransfer?.setData('text/plain', '');
    this.taskService.onDragStart({ source: 'week', day: this.day(), category, todo, weekKey });
  }

  isDropTarget(category: CategoryKey): boolean {
    const target = this.taskService.activeDropTarget();
    return target?.type === 'day' && target.day === this.day() && target.category === category;
  }

  handleDrop(event: DragEvent, category: CategoryKey): void {
    event.preventDefault();
    this.taskService.onDrop(this.day(), category);
  }

  isPastDay(): boolean {
    const weekOffset = this.taskService.weekOffset();
    if (weekOffset < 0) return true;
    if (weekOffset > 0) return false;
    return this.dayIndex() < this.taskService.currentDayIndex();
  }
}