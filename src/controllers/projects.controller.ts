import { Request, Response } from "express";
import { addProjectPhotographerService, createProjectService, deleteProjectPhotographerService, getMyProjectsService, getProjectImagesService, updateProjectNameService } from "../services/projects.service";

export async function createProject(req: Request, res: Response) {
    try {
        const { teamId, name, address, description, photographerEmail } = req.body;
        const userId = req.user?.id;

        if (!userId) {
            return res.status(401).json({ message: "Unauthorized" });
        }

        const result = await createProjectService({
            teamId,
            name,
            address,
            description,
            photographerEmail,
            userId,
        });

        return res.status(201).json(result);
    } catch (error: any) {
        console.error(error);
        if (error?.code === "PROJECT_NAME_TAKEN") {
            return res.status(409).json({ message: error.message || "A project with this name already exists in this team." });
        }
        return res.status(400).json({ message: error.message || "Failed to create project" });
    }
}

export async function getMyProjects(req: Request, res: Response) {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ message: "Unauthorized" });
        }

        const result = await getMyProjectsService({ userId });
        return res.status(200).json(result);
    } catch (error: any) {
        console.error(error);
        return res.status(400).json({ message: error.message || "Failed to fetch projects" });
    }
}

export async function updateProjectName(req: Request, res: Response) {
    try {
        const { id } = req.params;
        const { name } = req.body;
        const userId = req.user?.id;

        if (!userId) {
            return res.status(401).json({ message: "Unauthorized" });
        }

        const result = await updateProjectNameService({
            projectId: id,
            userId,
            name,
        });

        return res.status(200).json(result);
    } catch (error: any) {
        console.error(error);
        if (error?.code === "PROJECT_NAME_TAKEN") {
            return res.status(409).json({ message: error.message || "A project with this name already exists." });
        }
        if (error?.message === "Project not found") {
            return res.status(404).json({ message: error.message });
        }
        if (error?.message === "You are not allowed to rename this project") {
            return res.status(403).json({ message: error.message });
        }
        return res.status(400).json({ message: error.message || "Failed to rename project" });
    }
}

export async function addProjectPhotographer(req: Request, res: Response) {
    try {
        const { id } = req.params;
        const { photographerId, photographerEmail } = req.body;
        const userId = req.user?.id;

        if (!userId) {
            return res.status(401).json({ message: "Unauthorized" });
        }

        const result = await addProjectPhotographerService({
            projectId: id,
            userId,
            photographerId,
            photographerEmail,
        });

        return res.status(200).json(result);
    } catch (error: any) {
        console.error(error);
        return res.status(400).json({ message: error.message || "Failed to add photographer" });
    }
}

export async function deleteProjectPhotographer(req: Request, res: Response) {
    try {
        const { id, photographerId } = req.params;
        const userId = req.user?.id;

        if (!userId) {
            return res.status(401).json({ message: "Unauthorized" });
        }

        const result = await deleteProjectPhotographerService({
            projectId: id,
            userId,
            photographerId,
        });

        return res.status(200).json(result);
    } catch (error: any) {
        console.error(error);
        return res.status(400).json({ message: error.message || "Failed to remove photographer" });
    }
}

export async function getProjectImages(req: Request, res: Response) {
    try {
        const { projectId } = req.params;
        const userId = req.user?.id;

        if (!userId) {
            return res.status(401).json({ message: "Unauthorized" });
        }

        const result = await getProjectImagesService({
            projectId,
            userId,
        });

        return res.status(200).json(result);
    } catch (error: any) {
        console.error(error);
        return res.status(400).json({ message: error.message || "Failed to fetch project images" });
    }
}
