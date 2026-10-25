/** A tiny synchronous listener set. A failing listener never stops the others. */
export interface Emitter<T> {
  emit(value: T): void;
  subscribe(listener: (value: T) => void): () => void;
  clear(): void;
}

export function createEmitter<T>(): Emitter<T> {
  const listeners = new Set<(value: T) => void>();
  return {
    emit(value) {
      for (const listener of [...listeners]) {
        try {
          listener(value);
        } catch (error) {
          console.error("Vela listener failed", error);
        }
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    clear() {
      listeners.clear();
    },
  };
}

export const errorMessage = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));
