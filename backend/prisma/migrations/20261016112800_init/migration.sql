-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'STUDENT');

-- CreateEnum
CREATE TYPE "AssessmentStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('DRAFT', 'OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "NodeKind" AS ENUM ('QUESTION', 'ENDING');

-- CreateEnum
CREATE TYPE "AttemptStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "passwordHash" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'STUDENT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Assessment" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(80) NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "status" "AssessmentStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Assessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Mission" (
    "id" UUID NOT NULL,
    "assessmentId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "title" VARCHAR(160) NOT NULL,

    CONSTRAINT "Mission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScenarioNode" (
    "id" UUID NOT NULL,
    "missionId" UUID NOT NULL,
    "key" VARCHAR(80) NOT NULL,
    "kind" "NodeKind" NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "story" TEXT NOT NULL,
    "question" TEXT,
    "isStart" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ScenarioNode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScenarioChoice" (
    "id" UUID NOT NULL,
    "nodeId" UUID NOT NULL,
    "nextNodeId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "label" TEXT NOT NULL,

    CONSTRAINT "ScenarioChoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Competency" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(80) NOT NULL,
    "label" VARCHAR(120) NOT NULL,
    "description" TEXT,

    CONSTRAINT "Competency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChoiceImpact" (
    "choiceId" UUID NOT NULL,
    "competencyId" UUID NOT NULL,
    "indicator" INTEGER NOT NULL,

    CONSTRAINT "ChoiceImpact_pkey" PRIMARY KEY ("choiceId","competencyId")
);

-- CreateTable
CREATE TABLE "AssessmentSession" (
    "id" UUID NOT NULL,
    "assessmentId" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "label" VARCHAR(160) NOT NULL,
    "codeHash" CHAR(64) NOT NULL,
    "status" "SessionStatus" NOT NULL DEFAULT 'DRAFT',
    "opensAt" TIMESTAMP(3),
    "closesAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssessmentSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Participant" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "userId" UUID,
    "publicId" VARCHAR(20) NOT NULL,
    "displayName" VARCHAR(100) NOT NULL,
    "guestTokenHash" CHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Participant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attempt" (
    "id" UUID NOT NULL,
    "participantId" UUID NOT NULL,
    "currentNodeId" UUID NOT NULL,
    "status" "AttemptStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Attempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Decision" (
    "id" UUID NOT NULL,
    "attemptId" UUID NOT NULL,
    "nodeId" UUID NOT NULL,
    "choiceId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Decision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Assessment_slug_key" ON "Assessment"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Mission_assessmentId_position_key" ON "Mission"("assessmentId", "position");

-- CreateIndex
CREATE INDEX "ScenarioNode_missionId_isStart_idx" ON "ScenarioNode"("missionId", "isStart");

-- CreateIndex
CREATE UNIQUE INDEX "ScenarioNode_missionId_key_key" ON "ScenarioNode"("missionId", "key");

-- CreateIndex
CREATE INDEX "ScenarioChoice_nextNodeId_idx" ON "ScenarioChoice"("nextNodeId");

-- CreateIndex
CREATE UNIQUE INDEX "ScenarioChoice_nodeId_position_key" ON "ScenarioChoice"("nodeId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "Competency_slug_key" ON "Competency"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentSession_codeHash_key" ON "AssessmentSession"("codeHash");

-- CreateIndex
CREATE INDEX "AssessmentSession_assessmentId_status_idx" ON "AssessmentSession"("assessmentId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Participant_publicId_key" ON "Participant"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "Participant_guestTokenHash_key" ON "Participant"("guestTokenHash");

-- CreateIndex
CREATE INDEX "Participant_sessionId_idx" ON "Participant"("sessionId");

-- CreateIndex
CREATE INDEX "Participant_userId_idx" ON "Participant"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Attempt_participantId_key" ON "Attempt"("participantId");

-- CreateIndex
CREATE INDEX "Decision_choiceId_idx" ON "Decision"("choiceId");

-- CreateIndex
CREATE UNIQUE INDEX "Decision_attemptId_nodeId_key" ON "Decision"("attemptId", "nodeId");

-- AddForeignKey
ALTER TABLE "Mission" ADD CONSTRAINT "Mission_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScenarioNode" ADD CONSTRAINT "ScenarioNode_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "Mission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScenarioChoice" ADD CONSTRAINT "ScenarioChoice_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "ScenarioNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScenarioChoice" ADD CONSTRAINT "ScenarioChoice_nextNodeId_fkey" FOREIGN KEY ("nextNodeId") REFERENCES "ScenarioNode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChoiceImpact" ADD CONSTRAINT "ChoiceImpact_choiceId_fkey" FOREIGN KEY ("choiceId") REFERENCES "ScenarioChoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChoiceImpact" ADD CONSTRAINT "ChoiceImpact_competencyId_fkey" FOREIGN KEY ("competencyId") REFERENCES "Competency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentSession" ADD CONSTRAINT "AssessmentSession_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentSession" ADD CONSTRAINT "AssessmentSession_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Participant" ADD CONSTRAINT "Participant_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AssessmentSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Participant" ADD CONSTRAINT "Participant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_currentNodeId_fkey" FOREIGN KEY ("currentNodeId") REFERENCES "ScenarioNode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Decision" ADD CONSTRAINT "Decision_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "Attempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Decision" ADD CONSTRAINT "Decision_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "ScenarioNode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Decision" ADD CONSTRAINT "Decision_choiceId_fkey" FOREIGN KEY ("choiceId") REFERENCES "ScenarioChoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
