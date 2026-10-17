-- pgvector replaces the Chroma bookkeeping: the vector lives on the row. The table was never written to.
-- Search is exact over one organization's rows (idx_embeddings_org); an HNSW index would filter after the
-- nearest-neighbour step and miss matches, and Prisma can't declare one.
CREATE EXTENSION IF NOT EXISTS "vector";

-- DropIndex
DROP INDEX "finding_embeddings_collection_vector_id_key";

-- AlterTable
ALTER TABLE "finding_embeddings" DROP COLUMN "collection",
DROP COLUMN "vector_id",
ADD COLUMN     "embedding" vector(768) NOT NULL;
