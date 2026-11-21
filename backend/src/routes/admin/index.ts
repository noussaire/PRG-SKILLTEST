import { Router } from "express";
import { adminAuthRouter } from "./auth.routes.js";
import { adminAdaptiveRouter } from "./adaptive.routes.js";
import { adminDashboardRouter } from "./dashboard.routes.js";
import { adminParticipantRouter } from "./participant.routes.js";
import { adminSessionRouter } from "./session.routes.js";
import { adminConnectionRoleRouter } from "./connection-role.routes.js";

import { adminMissionRouter } from "./mission.routes.js";
import { adminReportRouter } from "./report.routes.js";

export const adminRouter = Router();

adminRouter.use("/auth", adminAuthRouter);
adminRouter.use("/connection-role", adminConnectionRoleRouter);
adminRouter.use("/adaptive", adminAdaptiveRouter);
adminRouter.use("/dashboard", adminDashboardRouter);
adminRouter.use("/participants", adminParticipantRouter);
adminRouter.use("/sessions", adminSessionRouter);
adminRouter.use("/missions", adminMissionRouter);
adminRouter.use("/reports", adminReportRouter);



