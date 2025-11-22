/*
  Warnings:

  - A unique constraint covering the columns `[name]` on the table `age_groups` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "age_groups_name_key" ON "age_groups"("name");
