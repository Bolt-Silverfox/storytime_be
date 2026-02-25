/**
 * Migrate story cover images from Pollinations URLs to Cloudinary.
 *
 * Since Pollinations is down (HTTP 530), this script regenerates
 * cover images using Google Imagen, uploads them to Cloudinary,
 * and updates the DB.
 *
 * Usage:
 *   npx ts-node prisma/seeds/migrate-pollinations-to-cloudinary.ts
 *
 * Requires these env vars (from .env):
 *   GEMINI_API_KEY, CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET
 */
import { PrismaClient } from '@prisma/client';
import { GoogleGenAI } from '@google/genai';
import { v2 as cloudinary } from 'cloudinary';

// eslint-disable-next-line @typescript-eslint/no-require-imports
require('dotenv').config();

const requiredEnvVars = [
  'GEMINI_API_KEY',
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

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const prisma = new PrismaClient();

async function generateAndUpload(
  title: string,
  description: string,
): Promise<string> {
  const imagePrompt = `Children's story book cover for "${title}". ${description}. Colorful, vibrant, detailed, 4k, digital art style, friendly characters, magical atmosphere. Generate only the image, no text response.`;

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash-image',
    contents: imagePrompt,
    config: {
      responseModalities: ['IMAGE'],
    },
  });

  const imagePart = response.candidates?.[0]?.content?.parts?.find(
    (part) => part.inlineData,
  );
  if (!imagePart?.inlineData?.data) {
    throw new Error('Gemini returned no image data');
  }

  const buffer = Buffer.from(imagePart.inlineData.data, 'base64');

  // Upload buffer to Cloudinary
  const result = await new Promise<{ secure_url: string }>((resolve, reject) => {
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
        resolve(result as { secure_url: string });
      },
    );
    stream.end(buffer);
  });

  return result.secure_url;
}

async function main() {
  const stories = await prisma.story.findMany({
    where: {
      coverImageUrl: { contains: 'pollinations.ai' },
    },
    select: { id: true, title: true, description: true, coverImageUrl: true },
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

      // Delay to respect Imagen and Cloudinary rate limits
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } catch (error) {
      const msg =
        error instanceof Error
          ? error.message
          : typeof error === 'object' && error !== null && 'message' in error
            ? (error as { message: string }).message
            : String(error);
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
