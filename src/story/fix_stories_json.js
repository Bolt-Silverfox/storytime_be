const fs = require('fs');
const path = require('path');

// Master lists from seed.ts
const validCategories = [
  'Animal Stories',
  'Adventure & Action',
  'Bedtime Stories',
  'Cultural & Folklore Stories',
  'Drama & Family Stories',
  'Educational & Learning Stories',
  'Fairy Tales',
  'Fables & Morality Stories',
  'Fantasy & Magic',
  'Historical Fiction',
  'Holiday / Seasonal Stories',
  'Horror & Ghost Stories',
  'Humor & Satire',
  'Myths & Legends',
  'Nature',
  'Ocean',
  'Mystery & Detective Stories',
  'Robots',
  'Romance & Love Stories',
  'Science Fiction & Space',
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

const filePath = path.resolve(__dirname, 'stories.json');
const stories = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

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

fs.writeFileSync(filePath, JSON.stringify(stories, null, 2));
console.log('stories.json has been fixed!'); 