import PrismaService from '../prisma/prisma.service';
import { AvatarSeederService } from './avatar.seeder.service';

async function run() {
  const prisma = new PrismaService();
  const seeder = new AvatarSeederService(prisma);

  console.log('Seeding system avatars...');

  await seeder.seedSystemAvatars();

  console.log('System avatars seeding complete.');

  await prisma.$disconnect();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
