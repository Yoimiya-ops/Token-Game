import { homedir } from 'node:os';
import type { Provider } from './base';
import { CodexProvider } from './codex';
import { ClaudeCodeProvider } from './claude';
import { KimiCodeProvider } from './kimi';
import { WorkBuddyProvider } from './workbuddy';
import { CursorProvider } from './cursor';
import { ZcodeProvider } from './zcode';

/**
 * Returns the list of providers we support, in stable order. Each provider
 * is safe to construct on machines where the corresponding CLI is not
 * installed — listFiles() / parseFile() will simply return an empty result.
 *
 * Scope: we intentionally cover only the high-share AI CLIs (Claude Code,
 * Codex, Kimi Code, WorkBuddy, Cursor, ZCode). Adding more is a
 * one-file change — drop a new provider here — but we keep the list small
 * while the game is in pre-launch.
 */
export function getDefaultProviders(
  home: string = homedir(),
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): Provider[] {
  return [
    new ClaudeCodeProvider(home),
    new CodexProvider(home),
    new KimiCodeProvider(home, env),
    new WorkBuddyProvider(home, env),
    new CursorProvider(home, env, platform),
    new ZcodeProvider(home, env)
  ];
}

export type { Provider } from './base';
export { CodexProvider } from './codex';
export { ClaudeCodeProvider } from './claude';
export { KimiCodeProvider } from './kimi';
export { WorkBuddyProvider } from './workbuddy';
export { CursorProvider } from './cursor';
export { ZcodeProvider } from './zcode';
export { readSqliteJsonRows, readSqliteFirstValue, resetSqliteWarningsForTest } from './sqlite-reader';
