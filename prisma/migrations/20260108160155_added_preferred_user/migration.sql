-- CreateTable
CREATE TABLE "_UserPreferredCategories" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_UserPreferredCategories_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_UserPreferredCategories_B_index" ON "_UserPreferredCategories"("B");

-- AddForeignKey
ALTER TABLE "_UserPreferredCategories" ADD CONSTRAINT "_UserPreferredCategories_A_fkey" FOREIGN KEY ("A") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_UserPreferredCategories" ADD CONSTRAINT "_UserPreferredCategories_B_fkey" FOREIGN KEY ("B") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
