export interface ParamSchema {
  name: string;
  type: 'string' | 'number' | 'boolean';
  required: boolean;
  description: string;
}

export interface ActionResult {
  success: boolean;
  data?: unknown;
  feedback?: string;
}

export interface ActionDefinition {
  id: string;
  description: string;
  params?: ParamSchema[];
  execute(params: Record<string, unknown>): Promise<ActionResult>;
}

export interface Plugin {
  id: string;
  name: string;
  description: string;
  actions: ActionDefinition[];
  init?(): Promise<void>;
  destroy?(): void;
}

export interface ActionIntent {
  plugin: string;
  action: string;
  params?: Record<string, unknown>;
}
