# users.py
import os
from fastapi import APIRouter, Depends, Request, File, UploadFile, HTTPException, status
from app.dependencies import get_user_service, get_current_user
from app.schemas.user import UserOut
from app.services.user_service import UserService
from app.models.user import User
from app.security import create_access_token, verify_password

users_router = APIRouter(prefix="/api/v1")


@users_router.post("/auth/register", response_model=UserOut)
async def register(
    request: Request, user_service: UserService = Depends(get_user_service)
):
    data = await request.json()

    # 检查用户是否已存在
    if await user_service.user_repo.user_exists(email=data.get("email")):
        raise HTTPException(status_code=400, detail="邮箱已被注册")

    if data.get("username") and await user_service.user_repo.user_exists(
        username=data.get("username")
    ):
        raise HTTPException(status_code=400, detail="用户名已被使用")

    # 创建新用户
    user_data = {
        "username": data.get("username"),
        "email": data.get("email"),
        "password": data.get("password"),
        "role": "primary",  # 默认为主账户
    }

    user = await user_service.user_repo.add_user(data=user_data)
    # set_password 方法应在模型内部处理密码哈希
    user.set_password(data["password"])
    await user_service.user_repo.session.commit()
    await user_service.user_repo.session.refresh(user)

    # 生成访问令牌
    access_token = create_access_token(data={"sub": str(user.id)})

    return user


@users_router.post("/auth/login")
async def login(
    request: Request, user_service: UserService = Depends(get_user_service)
):
    data = await request.json()
    type = data.get("type")
    username = data.get("username")
    password = data.get("password")

    user = None
    if type == "phone":
        if not username or not password:
            raise HTTPException(status_code=400, detail="请填写手机号码和密码")
        user = await user_service.user_repo.get_user_by_phone(username)
    elif type == "email":
        if not username or not password:
            raise HTTPException(status_code=400, detail="请填写邮箱和密码")
        user = await user_service.user_repo.get_user_by_email(username)
    else:
        raise HTTPException(status_code=400, detail="请选择正确的登录方式")

    if user and verify_password(password, user.password_hash):
        access_token = create_access_token(data={"sub": str(user.id)})
        return {
            "access_token": access_token,
            "user": user.to_dict(),
        }

    raise HTTPException(status_code=422, detail="用户名或密码错误")


@users_router.get("/user/profile", response_model=UserOut)
async def get_profile(current_user: User = Depends(get_current_user)):
    return current_user


@users_router.put("/user/profile", response_model=UserOut)
async def update_profile(
    request: Request,
    current_user: User = Depends(get_current_user),
    user_service: UserService = Depends(get_user_service),
):
    data = await request.json()
    return await user_service.user_repo.update_user(current_user.id, data)


@users_router.put("/user/password")
async def update_password(
    request: Request,
    current_user: User = Depends(get_current_user),
    user_service: UserService = Depends(get_user_service),
):
    data = await request.json()
    old_password = data.get("old_password")
    new_password = data.get("new_password")
    if not old_password or not new_password:
        raise HTTPException(status_code=400, detail="请填写旧密码和新密码")

    result = await user_service.update_password(
        current_user, old_password, new_password
    )


@users_router.post("/subaccounts", response_model=UserOut)
async def create_subaccount(
    request: Request,
    current_user: User = Depends(get_current_user),
    user_service: UserService = Depends(get_user_service),
):
    data = await request.json()
    return await user_service.create_subaccount(current_user, data)


@users_router.get("/subaccounts")
async def get_subaccounts(
    current_user: User = Depends(get_current_user),
    user_service: UserService = Depends(get_user_service),
):
    accounts = await user_service.get_subaccounts(current_user)
    return accounts


@users_router.delete("/subaccounts/{account_id}")
async def delete_subaccount(
    account_id: str,
    current_user: User = Depends(get_current_user),
    user_service: UserService = Depends(get_user_service),
):
    await user_service.delete_subaccount(current_user, account_id)


@users_router.put("/subaccounts/{account_id}", response_model=UserOut)
async def update_subaccount(
    account_id: str,
    request: Request,
    current_user: User = Depends(get_current_user),
    user_service: UserService = Depends(get_user_service),
):

    data = await request.json()
    subaccount = await user_service.user_repo.get_user_by_id(user_id=account_id)
    if not subaccount or subaccount.role != "subaccount":
        raise HTTPException(status_code=404, detail="该用户不存在")
    if current_user.id != account_id and current_user.id != subaccount.parent_id:
        raise HTTPException(status_code=403, detail="无权限")

    # 更新字段
    updatable_fields = ["nickname", "email", "phone"]
    for field in updatable_fields:
        if field in data:
            setattr(subaccount, field, data[field])
    if current_user.id != account_id:
        if "password" in data:
            subaccount.set_password(data["password"])
    await user_service.user_repo.session.commit()
    return subaccount.to_dict()


# 上传头像
@users_router.post("/user/avatars")
async def upload_avatar(
    avatar: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    user_service: UserService = Depends(get_user_service),
):
    return await user_service.upload_avatar(current_user, avatar_file=avatar)


@users_router.get("/user/reset-password")
async def check_reset_password():
    # 判断标记文件是否存在
    if os.path.exists("password_is_set.txt"):
        raise HTTPException(status_code=400, detail="密码已设置，无法重置")


@users_router.post("/user/reset-password")
async def reset_password(
    request: Request, user_service: UserService = Depends(get_user_service)
):
    """
    重置用户密码

    该函数允许用户通过手机或邮箱方式重置其主要密码，并在重置后创建标记文件防止再次重置
    """
    await check_reset_password()
    data = await request.json()
    type = data.get("type")

    # 根据不同类型验证并获取相应的账户信息和密码
    if type == "phone":
        phone = data.get("phone")
        password = data.get("password")
        if not phone or not password:
            raise HTTPException(status_code=400, detail="请填写手机号码和密码")
    elif type == "email":
        email = data.get("email")
        password = data.get("password")
        if not email or not password:
            raise HTTPException(status_code=400, detail="请填写邮箱和密码")
    else:
        raise HTTPException(status_code=400, detail="请选择正确的方式")

    await user_service.reset_primary_password(password, phone=phone, email=email)
    # 创建标记文件
    with open("password_is_set.txt", "w") as f:
        f.write("password has been set")
