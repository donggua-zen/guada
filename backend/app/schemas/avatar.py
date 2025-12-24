from pydantic import BaseModel


class AvatarOut(BaseModel):
    url: str
