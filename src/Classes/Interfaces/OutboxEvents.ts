
import { OutgoingEvents } from "./SocketEvents";



export interface OutboxEvent<T = any> {
  id: string;
  type: keyof OutgoingEvents;
  payload: T;
  timestamp: number;
  priority: number;
  retries: number;
  maxRetries: number;
  nextRetryAt?: number;
  lastError?: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'timeout';
  timeoutMs?: number; // Individual event timeout
  processingStartedAt?: number; // When processing started (for timeout calculation)
}


export interface OutboxConfig {
  // Path to store outbox events
  filePath: string;
  // Maximum number of retries for failed events
  maxRetries: number;
  // Delay between retries in milliseconds
  retryDelayMs: number;

  maxRetryDelayMs: number;
  // Whether to persist events to disk
  enablePersistence: boolean;
  defaultTimeoutMs?: number; // Default timeout for all events (e.g., 10000ms = 10 seconds)
  enableTimeoutRetry?: boolean; // Whether to retry timed out events
}

export interface OutboxStats {
  total: number;
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  cancelled: number;
  timeout: number; // Add timeout status count
  byType: Record<string, number>;
  isProcessing: boolean;
}
