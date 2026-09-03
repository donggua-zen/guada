import type { ApiContext } from "./api-context";
import type { UploadResponse, ResourceUploadResponse } from "@/types/service";

export interface FileUploadApi {
  uploadAvatar(uid: string, file: File, type?: "character" | "session"): Promise<ResourceUploadResponse>;
  uploadUserAvatar(file: File): Promise<ResourceUploadResponse>;
  uploadWallpaper(file: File): Promise<ResourceUploadResponse>;
  deleteWallpaper(): Promise<{ success: boolean }>;
  uploadFile(sessionId: string, file: File): Promise<UploadResponse>;
}

export const fileUploadApi: FileUploadApi = {
  async uploadAvatar(this: ApiContext, uid: string, file: File, type: "character" | "session" = "character") {
    const formData = new FormData();
    formData.append("avatar", file);

    try {
      const url = type === "character" ? "characters" : "sessions";
      return await this.axiosInstance.post(`/${url}/${uid}/avatars`, formData, {
        headers: {
          "Content-Type": "multipart/form-data",
        },
      });
    } catch (error) {
      console.error("上传错误:", error);
      throw error;
    }
  },

  async uploadUserAvatar(this: ApiContext, file: File) {
    const formData = new FormData();
    formData.append("avatar", file);

    try {
      return await this.axiosInstance.post("/user/avatars", formData, {
        headers: {
          "Content-Type": "multipart/form-data",
        },
      });
    } catch (error) {
      console.error("上传错误:", error);
      throw error;
    }
  },

  async uploadWallpaper(this: ApiContext, file: File) {
    const formData = new FormData();
    formData.append("wallpaper", file);

    try {
      return await this.axiosInstance.post("/user/wallpaper", formData, {
        headers: {
          "Content-Type": "multipart/form-data",
        },
      });
    } catch (error) {
      console.error("壁纸上传错误:", error);
      throw error;
    }
  },

  async deleteWallpaper(this: ApiContext) {
    try {
      return await this.axiosInstance.delete("/user/wallpaper");
    } catch (error) {
      console.error("壁纸删除错误:", error);
      throw error;
    }
  },

  async uploadFile(this: ApiContext, sessionId: string, file: File) {
    const formData = new FormData();
    formData.append("file", file, file.name);

    try {
      return await this.axiosInstance.post(
        `/sessions/${sessionId}/files`,
        formData,
        {
          headers: {
            "Content-Type": "multipart/form-data",
          },
        },
      );
    } catch (error) {
      console.error("上传错误:", error);
      throw error;
    }
  },
};
