export type ManifestHeader = {
  kind: 'header';
  version: 1;
  sessionId: string;
  guildId: string;
  voiceChannelId: string;
  textChannelId: string;
  startedAt: string;
  startedBy: string;
};

export type SegmentJob = {
  id: string;
  userId: string;
  displayName: string;
  timestamp: string;
  durationMs: number;
  spoolPath: string;
};

export type JobStatus = 'committed' | 'processing' | 'done' | 'failed' | 'dead_letter';

export type JobState = SegmentJob & {
  status: JobStatus;
  attempts: number;
  result: string | null;
  lastError: string | null;
  nextEligibleAt: string | null;
};

export type ClaimedJob = SegmentJob & {
  attempts: number;
};

export type QueueStats = Record<JobStatus, number> & {
  total: number;
  pending: number;
  pendingDurationMs: number;
  dropped: number;
  sealed: boolean;
  resolvedAt: string | null;
};

export type TranscriptionResult = {
  jobId: string;
  userId: string;
  displayName: string;
  timestamp: string;
  text: string | null;
  status: 'done' | 'dead_letter' | 'capture_dropped';
  error: string | null;
};

export type DroppedCapture = {
  id: string;
  userId: string;
  displayName: string;
  timestamp: string;
  durationMs: number;
  reason: string;
};

export type QueueSnapshot = {
  throughEventSeq: number;
  sealed: boolean;
  resolvedAt: string | null;
  participants: Array<{ userId: string; displayName: string }>;
  jobs: JobState[];
  droppedCaptures: DroppedCapture[];
};

export type FileManifestQueueOptions = {
  maxAttempts: number;
  retryBaseMs?: number;
  retryMaxMs?: number;
  now?: () => Date;
  jitter?: () => number;
};

export interface TranscriptionJobQueue {
  readonly header: Readonly<ManifestHeader>;
  commit(segment: SegmentJob): Promise<void>;
  claim(): Promise<ClaimedJob | null>;
  nextEligibleAt(): string | null;
  ack(jobId: string, result: string): Promise<void>;
  nack(jobId: string, error: string): Promise<void>;
  deadLetter(jobId: string, error: string): Promise<void>;
  seal(): Promise<void>;
  addParticipant(userId: string, displayName: string): Promise<void>;
  recordDroppedCapture(capture: DroppedCapture): Promise<void>;
  isFullyResolved(): boolean;
  stats(): QueueStats;
  completedResults(): TranscriptionResult[];
  checkpoint(): Promise<void>;
  compact(): Promise<void>;
}
