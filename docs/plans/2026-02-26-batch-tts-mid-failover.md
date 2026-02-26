# Batch TTS Mid-Batch Failover Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** When a TTS provider dies mid-batch, immediately retry the entire batch with the next provider so the user always gets a complete story in one request.

**Architecture:** Extend the batch generation loop to detect failures, then retry ALL paragraphs (not just failed ones) with the next provider in the chain. Update the schema unique constraint to include `provider` so cache entries from different providers coexist. Return `usedProvider` and `preferredProvider` in the response so mobile knows when to retry for the preferred voice.

**Tech Stack:** NestJS, Prisma, PostgreSQL, Jest

---

### Task 1: Update Schema — Add provider to unique constraint

**Files:**
- Modify: `prisma/schema.prisma:1127`
- Create: `prisma/migrations/<timestamp>_add_provider_to_unique_constraint/migration.sql`

**Step 1: Update the schema unique constraint**

In `prisma/schema.prisma`, change the ParagraphAudioCache model:

```prisma
// Before
@@unique([storyId, textHash, voiceId])

// After
@@unique([storyId, textHash, voiceId, provider])
```

**Step 2: Create the migration**

Run: `npx prisma migrate dev --name add_provider_to_unique_constraint --create-only`

Verify the generated SQL drops the old constraint and adds the new one:
```sql
ALTER TABLE "paragraph_audio_cache" DROP CONSTRAINT "paragraph_audio_cache_storyId_textHash_voiceId_key";
ALTER TABLE "paragraph_audio_cache" ADD CONSTRAINT "paragraph_audio_cache_storyId_textHash_voiceId_provider_key" UNIQUE ("storyId", "textHash", "voiceId", "provider");
```

**Step 3: Update cacheParagraphAudio upsert**

In `src/story/text-to-speech.service.ts`, the `cacheParagraphAudio` method uses `storyId_textHash_voiceId` as the upsert key. Update to `storyId_textHash_voiceId_provider`:

```typescript
private async cacheParagraphAudio(
  storyId: string, text: string, voiceId: string, audioUrl: string, provider: string,
): Promise<void> {
  const textHash = this.hashText(text);
  await this.prisma.paragraphAudioCache.upsert({
    where: {
      storyId_textHash_voiceId_provider: { storyId, textHash, voiceId, provider },
    },
    create: { storyId, textHash, voiceId, audioUrl, provider },
    update: { audioUrl },
  });
}
```

**Step 4: Regenerate Prisma client and build**

Run: `pnpm run db:generate && pnpm run build`
Expected: No errors.

**Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/ src/story/text-to-speech.service.ts
git commit -m "fix: add provider to paragraph_audio_cache unique constraint"
```

---

### Task 2: Extract batch generation into a reusable helper

**Files:**
- Modify: `src/story/text-to-speech.service.ts:734-800`

The current generation loop (lines 734-800) will be called multiple times for failover. Extract it into a private method.

**Step 1: Write the failing test**

In `src/story/text-to-speech.service.spec.ts`, add to the `batchTextToSpeechCloudUrls` describe block:

```typescript
it('should failover to Deepgram when ElevenLabs fails mid-batch', async () => {
  mockPrisma.paragraphAudioCache.findMany.mockResolvedValue([]);
  mockIsPremiumUser.mockResolvedValue(true);

  // ElevenLabs fails for all paragraphs
  mockElevenLabsGenerate.mockRejectedValue(new Error('ElevenLabs 500'));
  // Deepgram succeeds
  mockDeepgramGenerate.mockResolvedValue(Buffer.from('deepgram-audio'));
  mockUploadAudio.mockResolvedValue('https://uploaded.com/audio.mp3');

  const result = await service.batchTextToSpeechCloudUrls(
    storyId,
    fullText,
    VoiceType.MILO,
    userId,
  );

  // All paragraphs should have audio (failover to Deepgram)
  expect(result.results.every((r) => r.audioUrl !== null)).toBe(true);
  // ElevenLabs was attempted
  expect(mockElevenLabsGenerate).toHaveBeenCalled();
  // Deepgram was used as fallback
  expect(mockDeepgramGenerate).toHaveBeenCalled();
  // Response indicates fallback happened
  expect(result.usedProvider).toBe('deepgram');
  expect(result.preferredProvider).toBe('elevenlabs');
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest src/story/text-to-speech.service.spec.ts -t "should failover to Deepgram when ElevenLabs fails mid-batch"`
Expected: FAIL — current code returns nulls for failed paragraphs, no `usedProvider` field.

**Step 3: Extract `generateBatchForProvider` helper**

In `src/story/text-to-speech.service.ts`, extract the generation loop (lines 748-800) into:

```typescript
/**
 * Attempt to generate all uncached paragraphs with a single provider.
 * Returns the generated results and a count of failures.
 */
private async generateBatchForProvider(
  uncached: Array<{ index: number; text: string; hash: string }>,
  batchProvider: 'elevenlabs' | 'deepgram' | 'edgetts',
  storyId: string,
  voiceType: string,
  userId: string | undefined,
  isPremium: boolean,
): Promise<{ results: BatchResult[]; failedCount: number }> {
  const generated: BatchResult[] = [];

  this.logger.log(
    `Batch story ${storyId}: generating ${uncached.length} paragraphs with ${batchProvider}`,
  );

  for (let i = 0; i < uncached.length; i += MAX_CONCURRENT) {
    const chunk = uncached.slice(i, i + MAX_CONCURRENT);
    const chunkResults = await Promise.all(
      chunk.map(async ({ index, text, hash }) => {
        try {
          const result = await this.generateTTS(
            storyId, text, voiceType, userId,
            { skipQuotaCheck: true, isPremium, providerOverride: batchProvider },
          );
          return { index, text, hash, audioUrl: result.audioUrl, provider: result.provider, ok: true as const };
        } catch {
          return { index, text, hash, audioUrl: null, provider: null, ok: false as const };
        }
      }),
    );

    for (const r of chunkResults) {
      generated.push({ index: r.index, text: r.text, hash: r.hash, audioUrl: r.audioUrl, provider: r.provider });
    }
  }

  const failedCount = generated.filter((r) => !r.audioUrl).length;
  return { results: generated, failedCount };
}
```

**Step 4: Implement mid-batch failover in `batchTextToSpeechCloudUrls`**

Replace the current generation section (after the "uncached.length === 0" early return) with:

```typescript
// Provider failover chain for batch generation
const providerChain: Array<'elevenlabs' | 'deepgram' | 'edgetts'> = [];
if (batchProvider === 'elevenlabs') providerChain.push('elevenlabs', 'deepgram', 'edgetts');
else if (batchProvider === 'deepgram') providerChain.push('deepgram', 'edgetts');
else providerChain.push('edgetts');

const preferredProvider = batchProvider;
let generated: BatchResult[] = [];
let actualProvider = batchProvider;

for (const provider of providerChain) {
  // Skip providers with open circuit breakers (except the first — already checked)
  if (provider !== batchProvider) {
    const breaker = this.getBreakerForProvider(provider);
    if (!breaker.canExecute()) {
      this.logger.warn(
        `${provider} circuit breaker OPEN, skipping failover for batch story ${storyId}`,
      );
      continue;
    }
    // Re-do cache lookup for this provider — may have cached entries from a previous run
    const providerCacheEntries = await this.prisma.paragraphAudioCache.findMany({
      where: { storyId, voiceId: type, provider, textHash: { in: [...hashMap.keys()] } },
    });
    const providerCacheMap = new Map(providerCacheEntries.map((e) => [e.textHash, e.audioUrl]));

    // Rebuild cached/uncached for this provider
    cached.length = 0;
    uncached.length = 0;
    uncachedHashes.clear();
    for (const [hash, entries] of hashMap) {
      const cachedUrl = providerCacheMap.get(hash);
      if (cachedUrl) {
        for (const { index, text } of entries) {
          cached.push({ index, text, audioUrl: cachedUrl });
        }
      } else {
        if (!uncachedHashes.has(hash)) {
          uncachedHashes.add(hash);
          uncached.push({ index: entries[0].index, text: entries[0].text, hash });
        }
      }
    }

    if (uncached.length === 0) {
      actualProvider = provider;
      break;
    }
  }

  const attempt = await this.generateBatchForProvider(
    uncached, provider, storyId, voiceType, userId, isPremium,
  );

  if (attempt.failedCount === 0) {
    // All succeeded — use this provider's results
    generated = attempt.results;
    actualProvider = provider;
    break;
  }

  // Some failed — log and try next provider
  this.logger.warn(
    `Batch story ${storyId}: ${attempt.failedCount}/${uncached.length} failed with ${provider}, trying next provider`,
  );
  actualProvider = provider;
  generated = attempt.results;
  // Continue to next provider in chain
}

const failedCount = generated.filter((r) => !r.audioUrl).length;
if (failedCount > 0) {
  this.logger.warn(
    `Batch story ${storyId}: ${failedCount}/${uncached.length} paragraphs failed on all providers`,
  );
}
```

**Step 5: Update return type and response**

Update the method return type to include the new fields:

```typescript
async batchTextToSpeechCloudUrls(
  ...
): Promise<{
  results: Array<{ index: number; text: string; audioUrl: string | null }>;
  totalParagraphs: number;
  wasTruncated: boolean;
  usedProvider: 'elevenlabs' | 'deepgram' | 'edgetts';
  preferredProvider?: 'elevenlabs' | 'deepgram' | 'edgetts';
  providerStatus?: 'degraded';
}> {
```

Update the early return for empty text:
```typescript
if (!fullText?.trim())
  return { results: [], totalParagraphs: 0, wasTruncated: false, usedProvider: 'deepgram' };
```

Update the cached-only early return:
```typescript
if (uncached.length === 0) {
  return {
    results: cached.sort((a, b) => a.index - b.index),
    totalParagraphs: allParagraphs.length,
    wasTruncated,
    usedProvider: batchProvider,
  };
}
```

Update the final return:
```typescript
return {
  results: [...cached, ...generated, ...duplicates].sort((a, b) => a.index - b.index),
  totalParagraphs: allParagraphs.length,
  wasTruncated,
  usedProvider: actualProvider,
  ...(actualProvider !== preferredProvider ? { preferredProvider } : {}),
  ...(isDegraded ? { providerStatus: 'degraded' as const } : {}),
};
```

**Step 6: Run test to verify it passes**

Run: `npx jest src/story/text-to-speech.service.spec.ts -t "should failover to Deepgram when ElevenLabs fails mid-batch"`
Expected: PASS

**Step 7: Commit**

```bash
git add src/story/text-to-speech.service.ts src/story/text-to-speech.service.spec.ts
git commit -m "feat: add mid-batch failover for TTS providers"
```

---

### Task 3: Update existing tests for new response shape

**Files:**
- Modify: `src/story/text-to-speech.service.spec.ts`
- Modify: `src/voice/voice.controller.spec.ts:132`
- Modify: `src/voice/voice.controller.ts:321-339`

**Step 1: Add `usedProvider` assertions to existing batch tests**

Every test that calls `batchTextToSpeechCloudUrls` should now assert `usedProvider`. Key tests to update:

- "should return empty results for empty text" → `expect(result.usedProvider).toBe('deepgram')`
- "should return cached results without reserving quota when all cached" → `expect(result.usedProvider).toBeDefined()`
- "should call providers only for uncached paragraphs" → `expect(result.usedProvider).toBe('deepgram')`
- "should return all nulls when premium ElevenLabs batch fails" → `expect(result.usedProvider).toBeDefined()` (will now be 'deepgram' or 'edgetts' due to failover)
- Circuit breaker batch tests → update for new response shape

**Step 2: Update the "should return all nulls when premium ElevenLabs batch fails" test**

This test needs to change — with failover, ElevenLabs failure now falls through to Deepgram. If Deepgram also fails, falls through to Edge TTS. Only returns nulls if ALL providers fail:

```typescript
it('should failover through all providers when each fails', async () => {
  mockPrisma.paragraphAudioCache.findMany.mockResolvedValue([]);
  mockIsPremiumUser.mockResolvedValue(true);
  mockElevenLabsGenerate.mockRejectedValue(new Error('ElevenLabs timeout'));
  mockDeepgramGenerate.mockRejectedValue(new Error('Deepgram timeout'));
  mockEdgeTtsGenerate.mockRejectedValue(new Error('Edge TTS timeout'));

  const result = await service.batchTextToSpeechCloudUrls(
    storyId, fullText, VoiceType.MILO, userId,
  );

  expect(result.results.every((r) => r.audioUrl === null)).toBe(true);
  expect(mockElevenLabsGenerate).toHaveBeenCalled();
  expect(mockDeepgramGenerate).toHaveBeenCalled();
  expect(mockEdgeTtsGenerate).toHaveBeenCalled();
});
```

**Step 3: Add preferredProvider test**

```typescript
it('should set preferredProvider when failover occurs', async () => {
  mockPrisma.paragraphAudioCache.findMany.mockResolvedValue([]);
  mockIsPremiumUser.mockResolvedValue(true);
  mockElevenLabsGenerate.mockRejectedValue(new Error('ElevenLabs down'));
  mockDeepgramGenerate.mockResolvedValue(Buffer.from('audio'));
  mockUploadAudio.mockResolvedValue('https://uploaded.com/audio.mp3');

  const result = await service.batchTextToSpeechCloudUrls(
    storyId, fullText, VoiceType.MILO, userId,
  );

  expect(result.usedProvider).toBe('deepgram');
  expect(result.preferredProvider).toBe('elevenlabs');
});

it('should NOT set preferredProvider when preferred provider succeeds', async () => {
  mockPrisma.paragraphAudioCache.findMany.mockResolvedValue([]);
  mockIsPremiumUser.mockResolvedValue(true);
  mockElevenLabsGenerate.mockResolvedValue(Buffer.from('audio'));
  mockUploadAudio.mockResolvedValue('https://uploaded.com/audio.mp3');

  const result = await service.batchTextToSpeechCloudUrls(
    storyId, fullText, VoiceType.MILO, userId,
  );

  expect(result.usedProvider).toBe('elevenlabs');
  expect(result.preferredProvider).toBeUndefined();
});
```

**Step 4: Update voice controller to pass through new fields**

In `src/voice/voice.controller.ts:321-339`, destructure and forward the new fields:

```typescript
const {
  results: paragraphs,
  totalParagraphs,
  wasTruncated,
  usedProvider,
  preferredProvider,
} = await this.textToSpeechService.batchTextToSpeechCloudUrls(
  dto.storyId,
  story.textContent,
  resolvedVoice,
  req.authUserData.userId,
);

return {
  message: 'Batch audio generated successfully',
  paragraphs,
  totalParagraphs,
  wasTruncated,
  voiceId: resolvedVoice,
  usedProvider,
  ...(preferredProvider ? { preferredProvider } : {}),
  statusCode: 200,
};
```

**Step 5: Update voice controller spec mock**

In `src/voice/voice.controller.spec.ts:132`, add `usedProvider`:

```typescript
mockTextToSpeechService.batchTextToSpeechCloudUrls.mockResolvedValue({
  results: [{ index: 0, text: 'Hello world', audioUrl: 'https://audio.com/a.mp3' }],
  totalParagraphs: 1,
  wasTruncated: false,
  usedProvider: 'deepgram',
});
```

**Step 6: Run all tests**

Run: `npx jest src/story/text-to-speech.service.spec.ts src/voice/voice.controller.spec.ts`
Expected: All tests PASS

**Step 7: Build**

Run: `pnpm run build`
Expected: No errors

**Step 8: Commit**

```bash
git add src/story/text-to-speech.service.ts src/story/text-to-speech.service.spec.ts src/voice/voice.controller.ts src/voice/voice.controller.spec.ts
git commit -m "feat: expose usedProvider/preferredProvider in batch TTS response"
```

---

### Task 4: Apply migration and final verification

**Step 1: Apply migration locally**

Run: `npx prisma migrate dev`
Expected: Migration applied successfully

**Step 2: Run full test suite**

Run: `npx jest src/story/text-to-speech.service.spec.ts src/voice/voice.controller.spec.ts`
Expected: All tests pass

**Step 3: Build**

Run: `pnpm run build`
Expected: Clean build

**Step 4: Commit any remaining changes**

```bash
git add -A
git commit -m "chore: apply provider unique constraint migration"
```
