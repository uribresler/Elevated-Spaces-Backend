import { Router } from "express";
import { requireAuth } from "../middlewares/auth";
import { addProjectPhotographer, createProject, deleteProjectPhotographer, getMyProjects, getProjectImages, updateProjectName } from "../controllers/projects.controller";

const router = Router();

router.post("/", requireAuth, createProject);
router.get("/", requireAuth, getMyProjects);
router.patch("/:id", requireAuth, updateProjectName);
router.get("/:projectId/images", requireAuth, getProjectImages);
router.post("/:id/photographers", requireAuth, addProjectPhotographer);
router.delete("/:id/photographers/:photographerId", requireAuth, deleteProjectPhotographer);

export default router;
