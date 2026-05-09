import { Router } from "express";
import { getPublicBlogBySlugController, getPublicBlogsController } from "../controllers/publicBlogController.ts";

export const publicBlogsRoute = Router();

publicBlogsRoute.get("/api/public/blogs", getPublicBlogsController);
publicBlogsRoute.get("/api/public/blogs/:slug", getPublicBlogBySlugController);
