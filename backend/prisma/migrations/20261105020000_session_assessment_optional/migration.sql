-- AlterTable: Make assessmentId optional on AssessmentSession
ALTER TABLE "AssessmentSession" ALTER COLUMN "assessmentId" DROP NOT NULL;
