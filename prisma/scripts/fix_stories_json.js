const fs = require('fs');
const path = require('path');

// Master lists from seed.ts
const validCategories = [
  'Animal',
  'Educational',
  'Bedtime',
  'Fairytales & Folktales',
  'Adventures and Action',
  'Fantasy and Magical Stories',
  'Funny Stories',
  'Friendship and Feelings',
  'Nature and Oceans',
  'Science and Discovery',
  'Mystery & Spooky',
  'History & Heroes',
  'Holiday/Seasonal',
  'Superheroes',
  'Value and Life Lessons',
];

const validThemes = [
  'Adventure',
  'Betrayal & Redemption',
  'Change & Transformation',
  'Coming of Age',
  'Courage / Bravery',
  'Emotional',
  'Fantasy',
  'Freedom & Adventure',
  'Friendship & Belonging',
  'Good vs. Evil',
  'Greed vs. Generosity',
  'Healing & Forgiveness',
  'Hope & Perseverance',
  'Honesty & Integrity',
  'Identity & Self-Discovery',
  'Justice & Fairness',
  'Love & Family',
  'Sci-Fi',
  'Trust & Loyalty',
];

// Helper: fuzzy match to closest valid value (case-insensitive, ignore punctuation)
function findClosestValid(value, validList) {
  if (!value) return null;
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const valueNorm = norm(value);
  let best = null, bestScore = 0;
  for (const valid of validList) {
    const validNorm = norm(valid);
    let score = 0;
    for (let i = 0; i < Math.min(valueNorm.length, validNorm.length); i++) {
      if (valueNorm[i] === validNorm[i]) score++;
      else break;
    }
    if (score > bestScore) {
      bestScore = score;
      best = valid;
    }
  }
  // Only accept if at least 60% of the string matches
  if (best && bestScore >= Math.floor(best.length * 0.6)) return best;
  return null;
}

const dataDir = path.resolve(__dirname, '../data');
const files = fs.readdirSync(dataDir).filter(f => f.startsWith('stories') && f.endsWith('.json') && !f.includes('backup'));

for (const file of files) {
  const filePath = path.join(dataDir, file);
  console.log(`Fixing categories and themes in ${file}...`);

  try {
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    const stories = JSON.parse(fileContent);

    for (const story of stories) {
      // --- CATEGORY ---
      let cats = story.category;
      if (!Array.isArray(cats)) cats = cats ? [cats] : [];
      cats = cats
        .map((c) => findClosestValid(c, validCategories))
        .filter((c) => !!c);
      story.category = cats;

      // --- THEME ---
      let ths = story.theme;
      if (!Array.isArray(ths)) ths = ths ? [ths] : [];
      ths = ths
        .map((t) => findClosestValid(t, validThemes))
        .filter((t) => !!t);
      story.theme = ths;
    }

    // Create backup before overriding
    const backupPath = filePath + '.bak';
    fs.writeFileSync(backupPath, fileContent);

    fs.writeFileSync(filePath, JSON.stringify(stories, null, 2));
  } catch (error) {
    console.error(`Error processing file ${file}:`, error);
  }
}

console.log('stories JSON files have been fixed!'); 