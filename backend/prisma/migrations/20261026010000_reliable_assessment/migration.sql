-- Additive upgrade. No table reset, participant deletion, or published snapshot overwrite.
-- IF NOT EXISTS accommodates installations previously created with prisma db push.
ALTER TABLE "Attempt" ADD COLUMN IF NOT EXISTS "missionVersion" INTEGER DEFAULT 1;
ALTER TABLE "Decision" ADD COLUMN IF NOT EXISTS "impactSnapshot" JSONB;
ALTER TABLE "Decision" ADD COLUMN IF NOT EXISTS "contextSnapshot" JSONB;
ALTER TABLE "Mission" ADD COLUMN IF NOT EXISTS "editRevision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Mission" ADD COLUMN IF NOT EXISTS "draftGraph" JSONB;
ALTER TABLE "Mission" ALTER COLUMN "version" SET DEFAULT 0;
ALTER TABLE "ScenarioNode" ADD COLUMN IF NOT EXISTS "graphVersion" INTEGER NOT NULL DEFAULT 1;
UPDATE "ScenarioNode" n SET "graphVersion" = m.version FROM "Mission" m WHERE m.id=n."missionId";
DROP INDEX IF EXISTS "ScenarioNode_missionId_key_key";
CREATE UNIQUE INDEX IF NOT EXISTS "ScenarioNode_missionId_graphVersion_key_key" ON "ScenarioNode"("missionId","graphVersion","key");
ALTER TABLE "Participant" ADD COLUMN IF NOT EXISTS "tokenExpiresAt" TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP + interval '7 days');
ALTER TABLE "Participant" ADD COLUMN IF NOT EXISTS "revokedAt" TIMESTAMP(3);
UPDATE "Participant" SET "tokenExpiresAt" = LEAST("tokenExpiresAt", "createdAt" + interval '7 days');
CREATE TABLE IF NOT EXISTS "MissionVersion" (
  id UUID NOT NULL, "missionId" UUID NOT NULL, version INTEGER NOT NULL,
  title VARCHAR(160) NOT NULL, description TEXT, "pedagogicalGoal" TEXT, "targetCompetencies" TEXT,
  "estimatedDuration" INTEGER DEFAULT 15, "graphSnapshot" JSONB NOT NULL, changelog TEXT,
  "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MissionVersion_pkey" PRIMARY KEY(id),
  CONSTRAINT "MissionVersion_missionId_fkey" FOREIGN KEY("missionId") REFERENCES "Mission"(id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "MissionVersion_missionId_version_key" ON "MissionVersion"("missionId",version);
CREATE INDEX IF NOT EXISTS "MissionVersion_missionId_idx" ON "MissionVersion"("missionId");

-- Restore a usable snapshot only where none exists. Earlier edits cannot be reconstructed.
WITH graphs AS (
 SELECT m.id, COALESCE(jsonb_agg(jsonb_build_object(
  'id',n.id,'key',n.key,'kind',n.kind,'title',n.title,'story',n.story,'question',n.question,
  'isStart',n."isStart",'posX',n."posX",'posY',n."posY",'choices',COALESCE((
   SELECT jsonb_agg(jsonb_build_object('id',c.id,'position',c.position,'label',c.label,'nextNodeId',c."nextNodeId",'impacts',COALESCE((
    SELECT jsonb_agg(jsonb_build_object('competencyId',i."competencyId",'competencySlug',co.slug,'competencyLabel',co.label,'indicator',i.indicator))
    FROM "ChoiceImpact" i JOIN "Competency" co ON co.id=i."competencyId" WHERE i."choiceId"=c.id
   ),'[]'::jsonb)) ORDER BY c.position) FROM "ScenarioChoice" c WHERE c."nodeId"=n.id
  ),'[]'::jsonb)) ORDER BY n.key) FILTER(WHERE n.id IS NOT NULL),'[]'::jsonb) AS graph
 FROM "Mission" m LEFT JOIN "ScenarioNode" n ON n."missionId"=m.id GROUP BY m.id
), required AS (
 SELECT id AS "missionId", version FROM "Mission" WHERE version>0
 UNION SELECT n."missionId",COALESCE(a."missionVersion",1) FROM "Attempt" a JOIN "ScenarioNode" n ON n.id=a."currentNodeId"
)
INSERT INTO "MissionVersion" (id,"missionId",version,title,description,"pedagogicalGoal","targetCompetencies","estimatedDuration","graphSnapshot",changelog)
SELECT gen_random_uuid(),m.id,r.version,m.title,m.description,m."pedagogicalGoal",m."targetCompetencies",m."estimatedDuration",g.graph,
 'LEGACY_BACKFILL: reconstructed from available data; earlier edits cannot be recovered.'
FROM required r JOIN "Mission" m ON m.id=r."missionId" JOIN graphs g ON g.id=m.id
ON CONFLICT ("missionId",version) DO NOTHING;

-- Preserve already-recorded snapshots, including intentionally empty impact arrays.
UPDATE "Decision" d SET "impactSnapshot"=COALESCE((
 SELECT jsonb_agg(jsonb_build_object('competencyId',i."competencyId",'competencySlug',c.slug,'competencyLabel',c.label,'indicator',i.indicator))
 FROM "ChoiceImpact" i JOIN "Competency" c ON c.id=i."competencyId" WHERE i."choiceId"=d."choiceId"
),'[]'::jsonb) WHERE d."impactSnapshot" IS NULL;

INSERT INTO "Competency" (id,slug,label,description) VALUES
(gen_random_uuid(),'communication','Communication','Clarté et qualité des échanges.'),
(gen_random_uuid(),'leadership','Leadership','Initiative et coordination.'),
(gen_random_uuid(),'travail-en-equipe','Travail en équipe','Collaboration et entraide.'),
(gen_random_uuid(),'gestion-du-temps','Gestion du temps','Priorisation et organisation.'),
(gen_random_uuid(),'resolution-de-problemes','Résolution de problèmes','Analyse et recherche de solutions.'),
(gen_random_uuid(),'adaptabilite','Adaptabilité','Ajustement face aux imprévus.'),
(gen_random_uuid(),'ecoute-et-empathie','Écoute et empathie','Prise en compte des besoins d’autrui.')
ON CONFLICT(slug) DO NOTHING;

CREATE OR REPLACE FUNCTION skillquest_immutable_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Published mission versions are immutable'; END;
$$;
DROP TRIGGER IF EXISTS immutable_mission_version ON "MissionVersion";
CREATE TRIGGER immutable_mission_version BEFORE UPDATE OR DELETE ON "MissionVersion"
FOR EACH ROW EXECUTE FUNCTION skillquest_immutable_version();
