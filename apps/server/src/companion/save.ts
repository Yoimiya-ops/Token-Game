import { copyFileSync, existsSync, mkdirSync, openSync, closeSync, fsyncSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { LEGENDARY_PITY, RARE_PITY, WEAPONS, weaponById } from '@token-game/shared';

const count = z.number().int().nonnegative().safe();
const weaponId = z.string().refine(id => Boolean(weaponById(id)), 'Unknown weapon');
const cursorSchema = z.object({
  offset: count, signature: z.string(), signatureBytes: count,
  sessionId: z.string().nullable(), startedAt: z.string().nullable(), forked: z.boolean()
});
export type Cursor = z.infer<typeof cursorSchema>;
const resultSchema = z.object({
  kind: z.enum(['draw', 'dismantle', 'exchange']), weaponIds: z.array(weaponId).max(WEAPONS.length),
  quantity: count, shardsDelta: z.number().int().safe(), tokensSpent: count
});
const forgeSchema = z.object({
  revision: count, spentTokens: count, shards: count, inventory: z.record(weaponId, count),
  draws: count, sinceRare: count.max(RARE_PITY - 1), sinceLegendary: count.max(LEGENDARY_PITY - 1),
  lastDraw: z.array(weaponId).max(10),
  recentActions: z.array(z.object({ id: z.string(), key: z.string(), result: resultSchema })).max(32)
});
export const emptyForge = (): z.infer<typeof forgeSchema> => ({
  revision: 0, spentTokens: 0, shards: 0, inventory: {}, draws: 0,
  sinceRare: 0, sinceLegendary: 0, lastDraw: [], recentActions: []
});
const saveSchema = z.object({
  schemaVersion: z.literal(2), boundAt: z.string().datetime(), codexHome: z.string(),
  totalTokens: count, acknowledgedTokens: count, legacyTokens: count, daily: z.record(count),
  files: z.record(cursorSchema),
  sessions: z.record(z.object({ total: count, reset: z.boolean(), lastSnapshotAt: z.string().nullable().default(null) })),
  lastUsageAt: z.string().nullable(),
  receipt: z.object({ revision: count, tokens: count, at: z.string().nullable() }),
  forge: forgeSchema
}).refine(s => s.acknowledgedTokens <= s.totalTokens && s.forge.spentTokens <= s.acknowledgedTokens, 'Invalid token balance');
export type CompanionSave = z.infer<typeof saveSchema>;
function decode(text: string) {
  const raw = JSON.parse(text);
  const migrated = raw?.schemaVersion === 1;
  const save = saveSchema.parse(migrated ? { ...raw, schemaVersion: 2, forge: emptyForge() } : raw);
  return { save, migrated };
}

export class SaveStore {
  readonly file: string;
  recovered = false;
  created = false;
  constructor(readonly dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.file = path.join(dataDir, 'companion.json');
  }
  load(codexHome: string, now: Date): CompanionSave {
    if (existsSync(this.file) || existsSync(this.file + '.bak')) {
      let loaded;
      try { loaded = decode(readFileSync(this.file, 'utf8')); }
      catch {
        loaded = decode(readFileSync(this.file + '.bak', 'utf8'));
        if (existsSync(this.file)) copyFileSync(this.file, this.file + '.damaged-' + Date.now());
        copyFileSync(this.file + '.bak', this.file);
        this.recovered = true;
      }
      if (loaded.migrated) {
        // Existing acknowledged tokens become spendable exactly once, through a derived balance.
        if (!existsSync(this.file + '.pre-weapons.bak')) copyFileSync(this.file, this.file + '.pre-weapons.bak');
        this.commit(loaded.save);
      }
      return loaded.save;
    }
    let legacyTokens = 0;
    const legacyFile = path.join(this.dataDir, 'ledger.json');
    if (existsSync(legacyFile)) {
      if (!existsSync(legacyFile + '.pre-companion.bak')) copyFileSync(legacyFile, legacyFile + '.pre-companion.bak');
      try {
        const value = JSON.parse(readFileSync(legacyFile, 'utf8')).player?.totalTokens;
        if (Number.isSafeInteger(value) && value >= 0) legacyTokens = value;
      } catch { /* Preserve the original and backup for manual recovery. */ }
    }
    const initial: CompanionSave = {
      schemaVersion: 2, boundAt: now.toISOString(), codexHome,
      totalTokens: 0, acknowledgedTokens: 0, legacyTokens,
      daily: {}, files: {}, sessions: {}, lastUsageAt: null,
      receipt: { revision: 0, tokens: 0, at: null }, forge: emptyForge()
    };
    this.commit(initial);
    this.created = true;
    return initial;
  }
  commit(value: CompanionSave) {
    saveSchema.parse(value);
    const temporary = this.file + '.tmp';
    const fd = openSync(temporary, 'w');
    try { writeFileSync(fd, JSON.stringify(value)); fsyncSync(fd); }
    finally { closeSync(fd); }
    if (existsSync(this.file)) copyFileSync(this.file, this.file + '.bak');
    renameSync(temporary, this.file);
  }
}
