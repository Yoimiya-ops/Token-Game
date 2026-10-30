import type { ForgeState } from './weapons';
export type ConnectionStatus = 'waiting' | 'connected' | 'missing' | 'unsupported' | 'error';

export type CompanionState = {
  forge: ForgeState;
  totalTokens: number;
  todayTokens: number;
  pendingTokens: number;
  acknowledgedTokens: number;
  legacyTokens: number;
  boundAt: string;
  receipt: { revision: number; tokens: number; at: string | null };
  connection: {
    status: ConnectionStatus;
    directory: string;
    lastCheckedAt: string | null;
    lastUsageAt: string | null;
    message: string;
    recovered: boolean;
  };
};
