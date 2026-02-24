/**
 * Migrate story cover images from Pollinations URLs to Cloudinary.
 *
 * Finds all stories with pollinations.ai cover image URLs,
 * downloads each image, uploads to Cloudinary, and updates the DB.
 *
 * Usage:
 *   npx ts-node prisma/seeds/migrate-pollinations-to-cloudinary.ts
 *
 * Requires these env vars (from .env):
 *   CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET
 */
import { PrismaClient } from '@prisma/client';
import { v2 as cloudinary } from 'cloudinary';

// eslint-disable-next-line @typescript-eslint/no-require-imports
require('dotenv').config();

const requiredEnvVars = [
  'CLOUDINARY_CLOUD_NAME',
  'CLOUDINARY_API_KEY',
  'CLOUDINARY_API_SECRET',
] as const;

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`Missing required env var: ${envVar}`);
    process.exit(1);
  }
}

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

const prisma = new PrismaClient();

async function uploadToCloudinary(imageUrl: string): Promise<string> {
  const result = await cloudinary.uploader.upload(imageUrl, {
    folder: 'storytime/covers',
    resource_type: 'image',
    transformation: [
      { width: 1024, height: 1024, crop: 'limit' },
      { quality: 'auto' },
      { format: 'webp' },
    ],
  });
  return result.secure_url;
}

async function main() {
  const stories = await prisma.story.findMany({
    where: {
      coverImageUrl: { contains: 'pollinations.ai' },
    },
    select: { id: true, title: true, coverImageUrl: true },
  });

  console.log(`Found ${stories.length} stories with Pollinations URLs\n`);

  if (stories.length === 0) {
    console.log('Nothing to migrate.');
    return;
  }

  let success = 0;
  let failed = 0;

  for (const story of stories) {
    try {
      console.log(`[${success + failed + 1}/${stories.length}] "${story.title}"...`);

      // Validate that the URL actually points to pollinations.ai
      try {
        const parsed = new URL(story.coverImageUrl);
        if (
          (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
          (parsed.hostname !== 'pollinations.ai' &&
            !parsed.hostname.endsWith('.pollinations.ai'))
        ) {
          console.log(`  ⏭ Skipped: not a Pollinations URL (${parsed.hostname})`);
          continue;
        }
      } catch {
        console.log(`  ⏭ Skipped: invalid URL`);
        continue;
      }

      const cloudinaryUrl = await uploadToCloudinary(story.coverImageUrl);

      await prisma.story.update({
        where: { id: story.id },
        data: { coverImageUrl: cloudinaryUrl },
      });

      console.log(`  ✓ ${cloudinaryUrl}`);
      success++;

      // Small delay to avoid Cloudinary rate limits
      await new Promise((resolve) => setTimeout(resolve, 200));
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`  ✗ Failed: ${msg}`);
      failed++;
    }
  }

  console.log(`\nDone. ${success} migrated, ${failed} failed.`);
}

main()
  .catch((e) => {
    console.error('Migration failed:', e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
