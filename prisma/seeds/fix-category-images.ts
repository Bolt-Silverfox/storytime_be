/**
 * Regenerate + replace the Cloudinary image for the categories whose image
 * currently fails to load ("Educational", "Value and Life Lessons"). Mirrors
 * migrate-pollinations-to-cloudinary.ts: generate via Hugging Face → upload to
 * Cloudinary → update Category.image. Safe + idempotent (only touches the two
 * named categories; skips any not found).
 *
 * Run:
 *   DATABASE_URL=<prod-or-target> \
 *   HF_TOKEN=<hf-token> \
 *   CLOUDINARY_CLOUD_NAME=... CLOUDINARY_API_KEY=... CLOUDINARY_API_SECRET=... \
 *   npx ts-node prisma/seeds/fix-category-images.ts
 */
import { PrismaClient } from '@prisma/client';
import { v2 as cloudinary } from 'cloudinary';

const REQUIRED_ENV = [
  'DATABASE_URL',
  'HF_TOKEN',
  'CLOUDINARY_CLOUD_NAME',
  'CLOUDINARY_API_KEY',
  'CLOUDINARY_API_SECRET',
];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`Missing required env var: ${key}`);
    process.exit(1);
  }
}

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const prisma = new PrismaClient({
  datasourceUrl: process.env.DATABASE_URL,
});

const HF_API_URL =
  'https://router.huggingface.co/hf-inference/models/black-forest-labs/FLUX.1-schnell';
const HF_TIMEOUT_MS = 60_000;

// Exact category names (per prisma/data) + a tailored image prompt for each.
const CATEGORIES: { name: string; prompt: string }[] = [
  {
    name: 'Educational',
    prompt:
      "Children's educational category illustration: curious happy kids learning, open books, letters and numbers, science and discovery, a globe and a magnifying glass, colorful, vibrant, friendly, soft warm palette, digital art, no text",
  },
  {
    name: 'Value and Life Lessons',
    prompt:
      "Children's illustration about values and life lessons: kindness, sharing, friendship and honesty, diverse kids helping each other, warm heartwarming scene, colorful, vibrant, friendly characters, soft warm palette, digital art, no text",
  },
];

async function generateAndUpload(prompt: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HF_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(HF_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.HF_TOKEN}`,
        'Content-Type': 'application/json',
        Accept: 'image/png',
      },
      body: JSON.stringify({ inputs: prompt }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`HF API timed out after ${HF_TIMEOUT_MS / 1000}s`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HF API error ${response.status}: ${errorText}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length === 0) {
    throw new Error('Hugging Face returned no image data');
  }

  const result = await new Promise<{ secure_url: string }>(
    (resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: 'storytime/categories',
          resource_type: 'image',
          transformation: [
            { width: 1024, height: 1024, crop: 'limit' },
            { quality: 'auto' },
            { format: 'webp' },
          ],
        },
        (error: unknown, uploaded) => {
          if (error) {
            return reject(
              error instanceof Error
                ? error
                : new Error('Cloudinary upload failed'),
            );
          }
          if (!uploaded?.secure_url) {
            return reject(new Error('Cloudinary upload missing secure_url'));
          }
          resolve({ secure_url: uploaded.secure_url });
        },
      );
      stream.end(buffer);
    },
  );

  return result.secure_url;
}

async function main() {
  let updated = 0;
  for (const cat of CATEGORIES) {
    const existing = await prisma.category.findUnique({
      where: { name: cat.name },
    });
    if (!existing) {
      console.warn(`Category "${cat.name}" not found — skipping.`);
      continue;
    }
    console.log(`Generating image for "${cat.name}"...`);
    const url = await generateAndUpload(cat.prompt);
    await prisma.category.update({
      where: { name: cat.name },
      data: { image: url },
    });
    console.log(`  ✓ ${cat.name} -> ${url}`);
    updated++;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  console.log(`\nDone. Updated ${updated} category image(s).`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
