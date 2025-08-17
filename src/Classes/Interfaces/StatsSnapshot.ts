// Add to src/Classes/Interfaces/SocketEvents.ts

export interface BotStatsSnapshot {
  botId: string;
  timestamp: number;
//   version: number;
  
  // Queue stats
  queues: {
    [queueType: string]: QueueStats;
  };
  
  // Bot general stats
  bot: {
    ready: boolean;
    paused: boolean;
    uptime: number;
    steamId: string;
  };
  
  // Trade manager stats
//   tradeManager?: {
//     activeTrades: number;
//   };
  
  // Memory and performance
  system?: {
    memoryUsage: NodeJS.MemoryUsage;
    cpuUsage?: NodeJS.CpuUsage;
  };
}

export interface QueueStats {
  type: string;
  size: number;
  processing: boolean;
  paused: boolean;
  pauseReason?: string;
  pauseTimeRemaining?: number;
  totalProcessed: number;
  totalFailed: number;
  estimatedWaitTime?: number;
  lastProcessedAt?: number;
  averageProcessingTime?: number;
}

export interface BotStatsDelta {
  botId: string;
  timestamp: number;
//   version: number;
  changes: Partial<BotStatsSnapshot>;
}