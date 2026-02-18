-- AddForeignKey
ALTER TABLE "user_usages" ADD CONSTRAINT "user_usages_selectedSecondVoiceId_fkey" FOREIGN KEY ("selectedSecondVoiceId") REFERENCES "voices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
