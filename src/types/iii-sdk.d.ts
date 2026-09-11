declare module 'iii-sdk' {
  export interface ISdk {
    registerFunction(id: string, handler: (input: any) => Promise<any>, options?: Record<string, unknown>): unknown;
    registerTrigger(trigger: { type: string; function_id: string; config: Record<string, unknown> }): unknown;
    trigger(req: { function_id: string; payload?: unknown; action?: unknown }): Promise<any>;
    shutdown(): Promise<void>;
  }
  export const TriggerAction: { Void(): unknown; Enqueue(opts: { queue: string }): unknown };
  export function registerWorker(url: string, options?: Record<string, unknown>): ISdk;
}
