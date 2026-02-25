/**
 * Migrate story cover images from Pollinations URLs to Cloudinary.
 *
 * Since Pollinations is down (HTTP 530), this script regenerates
 * cover images using Hugging Face FLUX.1-schnell, uploads them to
 * Cloudinary, and updates the DB.
 *
 * Usage:
 *   npx ts-node prisma/seeds/migrate-pollinations-to-cloudinary.ts
 *
 * Requires these env vars (from .env):
 *   HF_TOKEN, CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { v2 as cloudinary } from 'cloudinary';

const requiredEnvVars = [
  'HF_TOKEN',
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

const HF_API_URL =
  'https://router.huggingface.co/hf-inference/models/black-forest-labs/FLUX.1-schnell';

async function generateAndUpload(
  title: string,
  description: string,
): Promise<string> {
  const imagePrompt = `Children's story book cover for "${title}". ${description}. Colorful, vibrant, detailed, 4k, digital art style, friendly characters, magical atmosphere`;

  const response = await fetch(HF_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.HF_TOKEN}`,
      'Content-Type': 'application/json',
      Accept: 'image/png',
    },
    body: JSON.stringify({ inputs: imagePrompt }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HF API error ${response.status}: ${errorText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  if (buffer.length === 0) {
    throw new Error('Hugging Face returned no image data');
  }

  // Upload buffer to Cloudinary
  const result = await new Promise<{ secure_url: string }>(
    (resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: 'storytime/covers',
          resource_type: 'image',
          transformation: [
            { width: 1024, height: 1024, crop: 'limit' },
            { quality: 'auto' },
            { format: 'webp' },
          ],
        },
        (error, result) => {
          if (error) return reject(error);
          if (!result) return reject(new Error('Cloudinary returned no result'));
          if (!result.secure_url)
            return reject(new Error('Cloudinary upload missing secure_url'));
          resolve({ secure_url: result.secure_url });
        },
      );
      stream.end(buffer);
    },
  );

  return result.secure_url;
}

async function main() {
  const stories = await prisma.story.findMany({
    where: {
      coverImageUrl: { contains: 'pollinations.ai' },
    },
    select: {
      id: true,
      title: true,
      description: true,
      coverImageUrl: true,
    },
  });

  console.log(`Found ${stories.length} stories with Pollinations URLs\n`);

  if (stories.length === 0) {
    console.log('Nothing to migrate.');
    return;
  }

  let success = 0;
  let failed = 0;

  for (const story of stories) {
    const index = success + failed + 1;
    try {
      console.log(`[${index}/${stories.length}] "${story.title}"...`);

      const cloudinaryUrl = await generateAndUpload(
        story.title,
        story.description ?? '',
      );

      await prisma.story.update({
        where: { id: story.id },
        data: { coverImageUrl: cloudinaryUrl },
      });

      console.log(`  ✓ ${cloudinaryUrl}`);
      success++;

      // Delay to respect rate limits
      await new Promise((resolve) => setTimeout(resolve, 1000));
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
