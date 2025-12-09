import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

describe('Auth Session Invalidation (e2e)', () => {
    let app: INestApplication;
    let prismaService: PrismaService;
    let email: string;
    const password = 'Password123!';
    const newPassword = 'NewPassword123!';

    beforeAll(async () => {
        const moduleFixture: TestingModule = await Test.createTestingModule({
            imports: [AppModule],
        }).compile();

        app = moduleFixture.createNestApplication();
        await app.init();

        // 1. Grab the PrismaService instance from the app so we can hack the DB
        prismaService = app.get<PrismaService>(PrismaService);

        // Create a unique email for this specific test run
        email = `session-test-${Date.now()}@example.com`;
    });

    afterAll(async () => {
        // Clean up the user we created to keep the DB tidy
        if (email) {
            await prismaService.user.deleteMany({ where: { email } });
        }
        await app.close();
    });

    it('should invalidate other sessions after password change but keep current one', async () => {
        // ======================================================
        // Step 1: Register User -> Get Session A
        // ======================================================
        // Registration returns a token immediately (Session A) 
        // even if email isn't verified yet.
        const registerResponse = await request(app.getHttpServer())
            .post('/auth/register')
            .send({
                email,
                password,
                fullName: 'Session Tester',
                role: 'parent',
            })
            .expect(200); // Changed to 200 based on your controller @HttpCode(HttpStatus.OK)

        const sessionTokenA = registerResponse.body.jwt;
        expect(sessionTokenA).toBeDefined();

        // ======================================================
        // Step 2: The "Backdoor" - Verify Email via Prisma
        // ======================================================
        // We cannot login to get Session B unless the user is verified.
        // So, we manually flip the switch in the DB.
        await prismaService.user.update({
            where: { email },
            data: { isEmailVerified: true },
        });

        // ======================================================
        // Step 3: Login again -> Get Session B
        // ======================================================
        // Now that we are "verified", login should work.
        const loginResponse = await request(app.getHttpServer())
            .post('/auth/login')
            .send({ email, password })
            .expect(200);

        const sessionTokenB = loginResponse.body.jwt;
        expect(sessionTokenB).toBeDefined();

        // Sanity Check: Ensure tokens are different (different session IDs)
        expect(sessionTokenA).not.toEqual(sessionTokenB);

        // ======================================================
        // Step 4: Change Password using Session A
        // ======================================================
        // This should keep Session A alive but kill Session B
        await request(app.getHttpServer())
            .post('/auth/change-password')
            .set('Authorization', `Bearer ${sessionTokenA}`)
            .send({
                oldPassword: password,
                newPassword: newPassword,
            })
            .expect(200);

        // ======================================================
        // Step 5: Verify Session A is STILL valid
        // ======================================================
        // We use the token to hit a protected route (e.g., profile)
        await request(app.getHttpServer())
            .put('/auth/profile')
            .set('Authorization', `Bearer ${sessionTokenA}`)
            .send({ language: 'fr' }) // Just a dummy update
            .expect(200);

        // ======================================================
        // Step 6: Verify Session B is NOW INVALID
        // ======================================================
        // This request should fail because the session was deleted
        await request(app.getHttpServer())
            .put('/auth/profile')
            .set('Authorization', `Bearer ${sessionTokenB}`)
            .send({ language: 'de' })
            .expect(401);
    });
});