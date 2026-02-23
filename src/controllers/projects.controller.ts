import { Request, Response } from "express";
import { addProjectPhotographerService, createProjectService, getMyProjectsService, getProjectImagesService } from "../services/projects.service";

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

export async function addProjectPhotographer(req: Request, res: Response) {
    try {
        const { id } = req.params;
        const { photographerId } = req.body;
        const userId = req.user?.id;

        if (!userId) {
            return res.status(401).json({ message: "Unauthorized" });
        }

        const result = await addProjectPhotographerService({
            projectId: id,
            userId,
            photographerId,
        });

        return res.status(200).json(result);
    } catch (error: any) {
        console.error(error);
        return res.status(400).json({ message: error.message || "Failed to add photographer" });
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
