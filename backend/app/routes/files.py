from fastapi import APIRouter, Depends, Request, File, UploadFile
from app.dependencies import get_file_service
from app.services.file_service import FileService
from app.schemas.file import FileOut

files_router = APIRouter(prefix="/api/v1")


@files_router.post("/sessions/{sessions_id}/files", response_model=FileOut)
async def upload_message_file(
    sessions_id: str,
    file: UploadFile = File(...),
    file_service: FileService = Depends(get_file_service)
):
    # 检查文件名
    if not file.filename or file.filename == "":
        raise Exception("未选择文件")

    file_info = await file_service.upload_message_file(sessions_id, file)

    return file_info


@files_router.put("/files/{file_id}", response_model=FileOut)
async def update_message_file(
    file_id: str,
    request: Request,
    file_service: FileService = Depends(get_file_service)
):
    json_data = await request.json()
    message_id = json_data.get("message_id")
    file_type = json_data.get("type", "copy")
    if file_type == "copy":
        return await file_service.copy_message_file(file_id, message_id)
    else:
        raise Exception("不支持的type")