export interface Todo {
  id: number;
  text: string;
  completed: boolean;
  urgent: boolean;
  important: boolean;
  duration: number;
}

export type CategoryKey = 'goal' | 'mustDo' | 'prioTask' | 'chore' | 'events' | 'habits';

export interface Category {
  key: CategoryKey;
  label: string;
  color: string;
}

export interface DayTasks {
  goal: Todo[];
  mustDo: Todo[];
  prioTask: Todo[];
  chore: Todo[];
  events: Todo[];
  habits: Todo[];
}

export interface Week {
  [key: string]: DayTasks;
}