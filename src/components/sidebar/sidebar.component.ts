
import { ChangeDetectionStrategy, Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TaskService } from '../../services/task.service';
import { ThemeService } from '../../services/theme.service';
import { Todo } from '../../models/todo.model';

@Component({
  selector: 'app-sidebar',
  templateUrl: './sidebar.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [CommonModule, FormsModule],
})
export class SidebarComponent {
  taskService = inject(TaskService);
  themeService = inject(ThemeService);

  // Form State
  newTodoText = signal('');
  newTaskCategory = signal<'asap' | 'soon' | 'pending' | 'leisure' | 'basics'>('asap');
  taskDuration = signal<number | string>(30);
  
  // UI State
  isDataConfigOpen = signal(false);
  isThemeMenuOpen = signal(false);

  // Computed state for the view
  isOrganizeDisabled = computed(() => {
    return this.taskService.isOrganizing() || this.taskService.todoPool().filter(t => !t.habit).length === 0;
  });

  addTodo(): void {
    if (!this.newTodoText().trim() || !this.newTaskCategory()) return;
    this.taskService.addTodo(
      this.newTodoText(),
      this.newTaskCategory(),
      this.taskDuration()
    );
    this.newTodoText.set('');
    this.taskDuration.set(30);
  }

  onPoolDragStart(event: DragEvent, todo: Todo): void {
    event.dataTransfer?.setData('text/plain', ''); // Necessary for Firefox
    this.taskService.onDragStart({ source: 'pool', todo });
  }

  isPoolTaskBeingDragged(todo: Todo): boolean {
    const dragged = this.taskService.draggedTaskInfo();
    return dragged?.source === 'pool' && dragged.todo.id === todo.id;
  }
  
  isPoolDropTarget(): boolean {
      const target = this.taskService.activeDropTarget();
      return target?.type === 'pool';
  }

  handleImport(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files?.length) {
      this.taskService.importData(input.files[0]);
      input.value = ''; // Reset file input
    }
  }
}